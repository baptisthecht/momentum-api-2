import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { OrderSide, Position } from "../position/position.entity";
import { Session, SessionStatus } from "../session/session.entity";
import { PositionTpTarget } from "../tp-target/position-tp-target.entity";
import { BitgetClientService } from "./bitget-client.service";
import { BitgetMarkPriceWsService, MarkPriceEvent } from "./bitget-markprice-ws.service";

const MAX_RETRY = 5;
const RETRY_DELAY_MS = 500;

/**
 * PositionManagerService — Real-time TP execution via mark price WebSocket.
 *
 * Flow:
 * 1. When a real position opens → subscribe to mark price for its symbol
 * 2. On every markprice.update → check all open real positions for that symbol
 * 3. If mark price crosses a TP level → send partial close order to Bitget
 * 4. After TP1 hit → update SL to break-even (entry + fees)
 * 5. If partial close fails → retry x5, then close full position as safety
 */
@Injectable()
export class PositionManagerService implements OnModuleInit {
	private readonly log = new Logger(PositionManagerService.name);

	/** Lock per positionId to avoid concurrent TP execution */
	private readonly executing = new Set<string>();

	constructor(
		@InjectRepository(Position)
		private readonly posRepo: Repository<Position>,
		@InjectRepository(PositionTpTarget)
		private readonly tpRepo: Repository<PositionTpTarget>,
		@InjectRepository(Session)
		private readonly sessionRepo: Repository<Session>,
		private readonly bitget: BitgetClientService,
		private readonly markPriceWs: BitgetMarkPriceWsService,
	) {}

	async onModuleInit() {
		// On startup, subscribe to mark price for all symbols with open real positions
		const openPositions = await this.posRepo.find({
			where: { isClosed: false },
			relations: ["session"],
		});

		const symbols = new Set<string>();
		for (const pos of openPositions) {
			if (pos.session && !pos.session.simulation) {
				symbols.add(pos.symbol);
			}
		}

		for (const symbol of symbols) {
			this.markPriceWs.subscribe(symbol);
			this.log.log(`Resumed mark price subscription: ${symbol}`);
		}
	}

	// ── Called by BotService when a real position opens ──────────────────────

	/**
	 * Register a newly opened real position for TP monitoring.
	 * Subscribes to mark price if not already done.
	 */
	registerPosition(symbol: string) {
		this.markPriceWs.subscribe(symbol);
	}

	/**
	 * Check if there are still open real positions for a symbol.
	 * If not, unsubscribe from mark price to save resources.
	 */
	async maybeUnsubscribe(symbol: string) {
		const count = await this.posRepo.count({
			where: { symbol, isClosed: false },
			relations: ["session"],
		});
		if (count === 0) {
			this.markPriceWs.unsubscribe(symbol);
		}
	}

	// ── Mark price event handler ──────────────────────────────────────────────

	@OnEvent("markprice.update")
	async onMarkPriceUpdate(ev: MarkPriceEvent) {
		const { symbol, markPrice } = ev;

		// Load all open real positions for this symbol
		const positions = await this.posRepo.find({
			where: { symbol, isClosed: false },
			relations: ["session", "session.user", "tpTargets"],
		});

		for (const pos of positions) {
			// Skip simulation sessions
			if (!pos.session || pos.session.simulation) continue;
			if (pos.session.status !== SessionStatus.RUNNING) continue;
			if (!pos.session.user?.bitgetApiKey) continue;

			// Skip if already being processed
			if (this.executing.has(pos.id)) continue;

			await this.checkTpTargets(pos, markPrice);
		}
	}

	// ── TP check logic ────────────────────────────────────────────────────────

	private async checkTpTargets(pos: Position, markPrice: number) {
		// Load unhit targets sorted by sortOrder
		const targets = await this.tpRepo.find({
			where: { positionId: pos.id, hit: false },
			order: { sortOrder: "ASC" },
		});

		if (targets.length === 0) return;

		// Check each target in order
		for (const target of targets) {
			const isHit = this.isTargetHit(pos.side, markPrice, target.price);
			if (!isHit) break; // targets are ordered, if this one isn't hit, next ones won't be either

			this.log.log(
				`TP${target.sortOrder + 1} hit! pos=${pos.id} symbol=${pos.symbol} ` +
				`side=${pos.side} markPrice=${markPrice} targetPrice=${target.price}`,
			);

			await this.executePartialClose(pos, target, markPrice);
		}
	}

	private isTargetHit(side: OrderSide, markPrice: number, targetPrice: number): boolean {
		if (side === OrderSide.LONG) return markPrice >= targetPrice;
		return markPrice <= targetPrice;
	}

	// ── Partial close execution ───────────────────────────────────────────────

	private async executePartialClose(
		pos: Position,
		target: PositionTpTarget,
		markPrice: number,
	) {
		if (this.executing.has(pos.id)) return;
		this.executing.add(pos.id);

		try {
			const session = pos.session;
			const user = session.user;
			const qty = target.targetQty;
			const isFirstTp = target.sortOrder === 0;

			// Mark target as hit immediately to prevent double execution
			await this.tpRepo.update(
				{ id: target.id },
				{ hit: true, filledQty: qty, executedPrice: markPrice },
			);

			// Send partial close order to Bitget with retries
			const success = await this.closePartialWithRetry({
				apiKey: user.bitgetApiKey,
				apiSecret: user.bitgetApiSecret,
				passphrase: user.bitgetPassphrase,
				symbol: pos.symbol,
				side: pos.side,
				qty,
				positionId: pos.id,
				targetLabel: target.label ?? `TP${target.sortOrder + 1}`,
			});

			if (!success) {
				// Revert hit flag and close entire position as safety
				this.log.error(`All retries failed for ${pos.id} TP${target.sortOrder + 1} — closing full position`);
				await this.tpRepo.update({ id: target.id }, { hit: false, filledQty: 0, executedPrice: null });
				await this.closeFullPositionSafety(pos, user);
				return;
			}

			// After TP1 hit: move SL to break-even
			if (isFirstTp) {
				await this.moveSLToBreakeven(pos, user, target.price);
			}

			// Update position qty in DB
			const newQty = Math.max(0, pos.qty - qty);
			const isClosed = newQty <= 1e-8;
			await this.posRepo.update(
				{ id: pos.id },
				{ qty: newQty, isClosed },
			);

			if (isClosed) {
				await this.maybeUnsubscribe(pos.symbol);
			}

			this.log.log(
				`Partial close OK: ${target.label ?? `TP${target.sortOrder + 1}`} ` +
				`qty=${qty} pos=${pos.id} remainingQty=${newQty}`,
			);
		} finally {
			this.executing.delete(pos.id);
		}
	}

	// ── Partial close with retry ──────────────────────────────────────────────

	private async closePartialWithRetry(p: {
		apiKey: string;
		apiSecret: string;
		passphrase: string;
		symbol: string;
		side: OrderSide;
		qty: number;
		positionId: string;
		targetLabel: string;
	}): Promise<boolean> {
		for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
			try {
				await this.bitget.closePartialPosition({
					apiKey: p.apiKey,
					apiSecret: p.apiSecret,
					passphrase: p.passphrase,
					symbol: p.symbol,
					side: p.side,
					qty: p.qty,
				});
				this.log.log(`${p.targetLabel} partial close sent (attempt ${attempt})`);
				return true;
			} catch (e: any) {
				this.log.warn(
					`${p.targetLabel} partial close attempt ${attempt}/${MAX_RETRY} failed: ${e.message}`,
				);
				if (attempt < MAX_RETRY) {
					await this.sleep(RETRY_DELAY_MS * attempt);
				}
			}
		}
		return false;
	}

	// ── SL move to break-even ─────────────────────────────────────────────────

	private async moveSLToBreakeven(
		pos: Position,
		user: any,
		tp1Price: number,
	) {
		try {
			// Break-even = entry + (entry fee + exit fee) / qty
			// Fees are taker fees on both legs
			const takerRate = 0.0006; // 0.06%
			const entryFeePerUnit = pos.entryPrice * takerRate;
			const exitFeePerUnit = pos.entryPrice * takerRate; // approximate
			const totalFeePerUnit = entryFeePerUnit + exitFeePerUnit;

			let newSL: number;
			if (pos.side === OrderSide.LONG) {
				const breakeven = pos.entryPrice + totalFeePerUnit;
				// Only move SL if breakeven is below TP1 (i.e., we'd still profit)
				newSL = breakeven < tp1Price ? breakeven : pos.entryPrice;
				// SL must be below current price (below TP1)
				newSL = Math.min(newSL, tp1Price * 0.9999);
			} else {
				const breakeven = pos.entryPrice - totalFeePerUnit;
				newSL = breakeven > tp1Price ? breakeven : pos.entryPrice;
				// SL must be above current price (above TP1)
				newSL = Math.max(newSL, tp1Price * 1.0001);
			}

			// Round to symbol price precision
			newSL = parseFloat(newSL.toFixed(1)); // BTCUSDT = 1 decimal

			this.log.log(
				`Moving SL to break-even: pos=${pos.id} entry=${pos.entryPrice} ` +
				`oldSL=${pos.sl} newSL=${newSL}`,
			);

			// Update SL on Bitget
			await this.bitget.updateSL({
				apiKey: user.bitgetApiKey,
				apiSecret: user.bitgetApiSecret,
				passphrase: user.bitgetPassphrase,
				symbol: pos.symbol,
				side: pos.side,
				qty: pos.qty,
				newSLPrice: newSL,
			});

			// Update SL in DB
			await this.posRepo.update({ id: pos.id }, { sl: newSL });
		} catch (e: any) {
			this.log.warn(`SL move to breakeven failed for pos=${pos.id}: ${e.message}`);
		}
	}

	// ── Safety: close full position ───────────────────────────────────────────

	private async closeFullPositionSafety(pos: Position, user: any) {
		this.log.warn(`SAFETY: closing full position ${pos.id} ${pos.symbol}`);
		try {
			await this.bitget.closeFullPosition({
				apiKey: user.bitgetApiKey,
				apiSecret: user.bitgetApiSecret,
				passphrase: user.bitgetPassphrase,
				symbol: pos.symbol,
				side: pos.side,
				qty: pos.qty,
			});
			await this.posRepo.update({ id: pos.id }, { isClosed: true, qty: 0 });
			await this.maybeUnsubscribe(pos.symbol);
		} catch (e: any) {
			this.log.error(`SAFETY close also failed for ${pos.id}: ${e.message}`);
		}
	}

	private sleep(ms: number) {
		return new Promise((r) => setTimeout(r, ms));
	}
}
