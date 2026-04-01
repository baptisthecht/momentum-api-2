import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Candle } from "../candle/candle.entity";
import { OrderSide, Position } from "../position/position.entity";
import { RiskManagerService } from "../risk/risk-manager.service";
import { Session, SessionStatus } from "../session/session.entity";
import {
	EvaluationResult,
	SignalConditionCheck,
	SignalEvaluation,
} from "../signal-evaluation/signal-evaluation.entity";
import { StrategyService } from "../strategy/strategy.service";
import { PositionTpTarget } from "../tp-target/position-tp-target.entity";
import { Trade } from "../trade/trade.entity";
import { BitgetClientService } from "./bitget-client.service";
import { CandleEvent } from "./bitget-ws.service";
import { OhlcvBar } from "./indicators";
import { SimTrade, Simulator } from "./simulator";
import {
	EvaluationOutput,
	SignalSide,
	StrategyEngine,
} from "./strategy-engine";

@Injectable()
export class BotService implements OnModuleInit {
	private readonly log = new Logger(BotService.name);
	private readonly processing = new Set<string>();

	constructor(
		@InjectRepository(Session)
		private readonly sessionRepo: Repository<Session>,
		@InjectRepository(Candle) private readonly candleRepo: Repository<Candle>,
		@InjectRepository(Position) private readonly posRepo: Repository<Position>,
		@InjectRepository(Trade) private readonly tradeRepo: Repository<Trade>,
		@InjectRepository(PositionTpTarget)
		private readonly tpRepo: Repository<PositionTpTarget>,
		@InjectRepository(SignalEvaluation)
		private readonly evalRepo: Repository<SignalEvaluation>,
		@InjectRepository(SignalConditionCheck)
		private readonly checkRepo: Repository<SignalConditionCheck>,
		private readonly strategyService: StrategyService,
		private readonly bitget: BitgetClientService,
		private readonly riskManager: RiskManagerService,
	) {}

	async onModuleInit() {
		this.log.log("BotService active — event-driven via WebSocket");
	}

	@OnEvent("candle.closed")
	async onCandleClosed(ev: CandleEvent) {
		const { symbol } = ev;
		const candle = await this.storeCandle(ev);
		if (this.processing.has(symbol)) {
			this.log.warn(`Already processing ${symbol}, skipping`);
			return;
		}
		this.processing.add(symbol);
		try {
			const sessions = await this.sessionRepo.find({
				where: { symbol, status: SessionStatus.RUNNING },
				relations: ["strategy", "strategy.tpTemplates", "user"],
			});
			for (const session of sessions) {
				try { await this.processSession(session, candle); }
				catch (e: any) { this.log.error(`Session ${session.id}: ${e.message}`); }
			}
		} finally {
			this.processing.delete(symbol);
		}
	}

	@OnEvent("candle.update")
	async onCandleUpdate(ev: CandleEvent) {
		await this.storeCandle(ev);
	}

	private async storeCandle(ev: CandleEvent): Promise<Candle> {
		await this.candleRepo.query(
			`INSERT INTO candles (symbol, granularity, "openTime", open, high, low, close, volume)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 ON CONFLICT (symbol, granularity, "openTime")
			 DO UPDATE SET
			   high = GREATEST(candles.high, EXCLUDED.high),
			   low = LEAST(candles.low, EXCLUDED.low),
			   close = EXCLUDED.close,
			   volume = EXCLUDED.volume`,
			[ev.symbol, ev.granularity, ev.openTime, ev.open, ev.high, ev.low, ev.close, ev.volume],
		);
		return this.candleRepo.findOneOrFail({
			where: { symbol: ev.symbol, granularity: ev.granularity, openTime: ev.openTime },
		});
	}

	private async processSession(session: Session, latestCandle: Candle): Promise<void> {
		// Resolve config first so we can compute the correct bar count (MOM-08)
		const config = await this.strategyService.resolveConfigForSymbol(
			session.strategyId,
			session.symbol,
		);
		if (session.riskPerTradePct !== null) config.risk_per_trade_pct = session.riskPerTradePct;
		if (session.maxNotionalUsdt !== null) config.max_notional_usdt = session.maxNotionalUsdt;
		if (session.minProfitUsdt !== null) config.min_profit_usdt = session.minProfitUsdt;

		// MOM-08: compute minimum bar count needed for HTF EMA
		// trendTfMultiplier * trendTfEmaPeriod + buffer = actual bars needed
		const minBars = Math.max(
			Number(config.min_candles_warmup ?? 250),
			Number(config.ema_slow_period ?? 200) + 10,
			Number(config.trend_tf_multiplier ?? 5) * Number(config.trend_tf_ema_period ?? 200) + 50,
		);
		const bars = await this.loadBars(session.symbol, "5m", minBars);
		if (bars.length < 50) return;

		const engine = new StrategyEngine(config);

		const openPos = await this.posRepo.find({ where: { sessionId: session.id, isClosed: false } });
		const posIds = openPos.map((p) => p.id);
		const dbTargets = posIds.length > 0
			? await this.tpRepo.find({ where: { positionId: In(posIds) }, order: { sortOrder: "ASC" } })
			: [];

		const feeRate = this.normFee(config.taker_pct ?? 0.06);
		const minFee = Number(config.min_trade_fee_usdt ?? 1.5);
		const sim = new Simulator(session.currentBalance, feeRate, minFee);

		for (const dp of openPos) {
			const targets = dbTargets
				.filter((t) => t.positionId === dp.id)
				.sort((a, b) => a.sortOrder - b.sortOrder);
			sim.openPositions.push({
				id: dp.id, symbol: dp.symbol, side: dp.side,
				qty: dp.qty, originalQty: dp.originalQty, entryPrice: dp.entryPrice,
				sl: dp.sl, tp: dp.tp, leverage: dp.leverage, openTime: dp.openTime,
				tpTargets: targets.map((t) => ({
					index: t.sortOrder, price: t.price, ratio: t.ratio,
					qty: t.targetQty, filledQty: t.filledQty, hit: t.hit, label: t.label,
				})),
				trailAtrMult: dp.trailAtrMult, atrValue: dp.atrValue, rMultiple: dp.rMultiple,
				trailingActive: dp.trailingActive, trailingOffset: dp.trailingOffset,
				bestPrice: dp.bestPrice, entryFeeTotal: dp.entryFeeTotal,
				entryFeeRemaining: dp.entryFeeRemaining, realizedFees: dp.realizedFees,
				riskAmount: dp.riskAmount, riskAmountRemaining: dp.riskAmountRemaining,
				features: dp.features,
			});
		}

		const lastBar = bars[bars.length - 1];

		// 1. Process existing positions
		const closed = sim.onNewCandle(lastBar);
		for (const t of closed) {
			await this.persistTrade(session, t);
			// MOM-17-21: register result with risk manager
			session = await this.riskManager.registerTradeResult(session, t.pnl, sim.equity);
		}

		// 2. Evaluate strategy
		const evalResult = engine.evaluate(bars);

		// 3. Persist signal evaluation
		await this.persistEval(session, latestCandle, evalResult);

		// 4. Open position if signal
		if (evalResult.signal)
			await this.openFromSignal(session, sim, evalResult.signal, lastBar, config);

		// 5. Sync positions back to DB
		await this.syncPositions(session, sim);
		await this.sessionRepo.update(session.id, {
			currentBalance: sim.balance,
			currentEquity: sim.equity,
		});
	}

	private async openFromSignal(
		session: Session,
		sim: Simulator,
		sig: NonNullable<EvaluationOutput["signal"]>,
		lastBar: OhlcvBar,
		config: Record<string, any>,
	) {
		const side = sig.side === SignalSide.LONG ? OrderSide.LONG : OrderSide.SHORT;

		// MOM-23: guard reads DB (source of truth for real sessions)
		const alreadyOpen = await this.posRepo.findOne({
			where: { sessionId: session.id, side, isClosed: false },
		});
		if (alreadyOpen) {
			this.log.debug(`Signal ${side} ignoré — position déjà ouverte pour ${session.symbol}`);
			return;
		}

		// MOM-22: configurable max_open_positions
		const maxOpen = session.maxOpenPositions;
		if (maxOpen !== null && maxOpen > 0) {
			const openCount = await this.posRepo.count({ where: { sessionId: session.id, isClosed: false } });
			if (openCount >= maxOpen) {
				this.log.debug(`Signal ignoré — max_open_positions atteint (${openCount}/${maxOpen})`);
				return;
			}
		}

		const stopDist = side === OrderSide.LONG ? sig.entryPrice - sig.sl : sig.sl - sig.entryPrice;
		if (stopDist <= 0 || sim.equity <= 0) return;

		// MOM-17-21: ensure day + check risk manager
		session = await this.riskManager.ensureDay(session, sim.equity);
		if (!this.riskManager.canOpenNewTrade(session, sim.equity)) {
			this.log.log(`Signal ${side} ignoré — risk manager bloque`);
			return;
		}

		const lev = session.leverage;

		// MOM-20: effective risk pct uses risk_multiplier
		const baseRiskPct = Number(config.risk_per_trade_pct ?? 0.1);
		const effectiveRiskPct = this.riskManager.getEffectiveRiskPct(session, baseRiskPct);

		// MOM-16: capital fraction
		const capitalFraction = session.capitalFraction;
		const availableEquity = capitalFraction !== null && capitalFraction > 0
			? sim.equity * capitalFraction
			: sim.equity;

		let qty = (availableEquity * effectiveRiskPct) / (stopDist * lev);
		if (qty <= 0) return;

		// MOM-15: absolute risk cap in USDT
		const maxRiskUsdt = session.maxRiskPerTradeUsdt;
		if (maxRiskUsdt !== null && maxRiskUsdt > 0) {
			const riskUsdt = stopDist * qty * lev;
			if (riskUsdt > maxRiskUsdt) qty = maxRiskUsdt / (stopDist * lev);
		}

		// max_notional_usdt cap
		const maxN = Number(config.max_notional_usdt ?? 0);
		if (maxN > 0 && sig.entryPrice * qty > maxN) qty = maxN / sig.entryPrice;
		if (qty <= 0) return;

		// min_profit_usdt filter
		const minP = Number(config.min_profit_usdt ?? 0);
		if (minP > 0) {
			const est = this.estProfit(side, sig.entryPrice, lev, qty, sig.tpTargets, this.normFee(config.taker_pct ?? 0.06));
			if (est < minP) return;
		}

		const riskAmt = stopDist * qty * lev;

		// MOM-29: pass features from signal to simulator
		sim.openPosition({
			symbol: session.symbol, side, qty,
			entryPrice: sig.entryPrice, leverage: lev,
			sl: sig.sl, tp: sig.tp, openTime: lastBar.openTime,
			tpTargets: sig.tpTargets, trailAtrMult: sig.trailAtrMult,
			atrValue: sig.atrValue, rMultiple: sig.rMultiple,
			riskAmount: riskAmt, features: sig.features,
		});

		// Real order
		if (!session.simulation && session.user?.bitgetApiKey) {
			try {
				await this.bitget.placeOrder({
					apiKey: session.user.bitgetApiKey,
					apiSecret: session.user.bitgetApiSecret,
					passphrase: session.user.bitgetPassphrase,
					symbol: session.symbol, side, qty, leverage: lev,
					sl: sig.sl, tp: sig.tp,
				});
				this.log.log(`REAL ORDER: ${side} ${qty.toFixed(6)} ${session.symbol}`);

				// MOM-28: fetch and store liquidation price
				await this.fetchAndStoreLiqPrice(session, side, sig.entryPrice, qty, lev);
			} catch (e: any) {
				this.log.error("Order failed: " + e.message);
			}
		}

		// Persist position
		const sp = sim.openPositions[sim.openPositions.length - 1];
		const dbPos = this.posRepo.create({
			sessionId: session.id, symbol: session.symbol, side,
			qty, originalQty: qty, entryPrice: sig.entryPrice,
			sl: sig.sl, tp: sig.tp, leverage: lev, openTime: lastBar.openTime,
			trailAtrMult: sig.trailAtrMult, atrValue: sig.atrValue, rMultiple: sig.rMultiple,
			riskAmount: riskAmt, riskAmountRemaining: riskAmt,
			entryFeeTotal: sp.entryFeeTotal, entryFeeRemaining: sp.entryFeeRemaining,
			features: sig.features,   // MOM-29
		});
		const saved = await this.posRepo.save(dbPos);

		for (let i = 0; i < sp.tpTargets.length; i++) {
			const t = sp.tpTargets[i];
			await this.tpRepo.save(this.tpRepo.create({
				positionId: saved.id, sortOrder: i, price: t.price, ratio: t.ratio,
				targetQty: t.qty, filledQty: 0, hit: false, label: t.label ?? undefined,
			}));
		}

		sp.id = saved.id;
	}

	// MOM-28: fetch liquidation price from Bitget and update the position
	private async fetchAndStoreLiqPrice(
		session: Session,
		side: OrderSide,
		entryPrice: number,
		qty: number,
		leverage: number,
	): Promise<void> {
		try {
			const liqPrice = await this.bitget.fetchLiqPrice({
				apiKey: session.user.bitgetApiKey,
				apiSecret: session.user.bitgetApiSecret,
				passphrase: session.user.bitgetPassphrase,
				symbol: session.symbol,
				side,
			});
			if (liqPrice !== null) {
				// Update the most recently created open position for this session
				const pos = await this.posRepo.findOne({
					where: { sessionId: session.id, side, isClosed: false },
					order: { createdAt: 'DESC' },
				});
				if (pos) await this.posRepo.update({ id: pos.id }, { liqPrice });
			}
		} catch (e: any) {
			this.log.warn(`fetchLiqPrice failed: ${e.message}`);
		}
	}

	private async persistTrade(session: Session, t: SimTrade) {
		await this.posRepo.update(
			{ id: t.positionId, sessionId: session.id },
			{ isClosed: !t.isPartial, qty: t.isPartial ? undefined : 0 },
		);
		await this.tradeRepo.save(this.tradeRepo.create({
			sessionId: session.id, positionId: t.positionId,
			symbol: t.symbol, side: t.side,
			entryPrice: t.entryPrice, exitPrice: t.exitPrice,
			qty: t.qty, leverage: t.leverage, sl: t.sl, tp: t.tp,
			pnl: t.pnl, pnlPct: t.pnlPct, fees: t.fees, riskAmount: t.riskAmount,
			openTime: t.openTime, closeTime: t.closeTime,
			reason: t.reason, isPartial: t.isPartial,
		}));
	}

	private async persistEval(session: Session, candle: Candle, ev: EvaluationOutput) {
		let result = EvaluationResult.REJECTED;
		if (ev.signal)
			result = ev.signal.side === SignalSide.LONG ? EvaluationResult.SIGNAL_LONG : EvaluationResult.SIGNAL_SHORT;

		const saved = await this.evalRepo.save(this.evalRepo.create({
			sessionId: session.id, candleId: candle.id, symbol: session.symbol, result,
			closePrice: ev.snapshot.closePrice, rsiValue: ev.snapshot.rsiValue,
			atrValue: ev.snapshot.atrValue, emaFastValue: ev.snapshot.emaFastValue,
			emaSlowValue: ev.snapshot.emaSlowValue,
		}));

		if (ev.checks.length > 0) {
			await this.checkRepo.save(ev.checks.map((c) =>
				this.checkRepo.create({
					evaluationId: saved.id, side: c.side, conditionName: c.conditionName,
					expectedValue: c.expectedValue, actualValue: c.actualValue, passed: c.passed,
				}),
			));
		}
	}

	private async syncPositions(session: Session, sim: Simulator) {
		for (const sp of sim.openPositions) {
			await this.posRepo.update(
				{ id: sp.id, sessionId: session.id },
				{
					qty: sp.qty, sl: sp.sl, tp: sp.tp,
					trailingActive: sp.trailingActive, bestPrice: sp.bestPrice,
					entryFeeRemaining: sp.entryFeeRemaining, realizedFees: sp.realizedFees,
					riskAmountRemaining: sp.riskAmountRemaining,
				},
			);
			for (const t of sp.tpTargets) {
				await this.tpRepo
					.createQueryBuilder()
					.update(PositionTpTarget)
					.set({ filledQty: t.filledQty, hit: t.hit })
					.where("positionId = :pid AND sortOrder = :so", { pid: sp.id, so: t.index })
					.execute();
			}
		}
	}

	private async loadBars(sym: string, gran: string, lim: number): Promise<OhlcvBar[]> {
		const c = await this.candleRepo.find({
			where: { symbol: sym, granularity: gran },
			order: { openTime: "DESC" },
			take: lim,
		});
		c.reverse();
		return c.map((r) => ({
			openTime: r.openTime, open: r.open, high: r.high,
			low: r.low, close: r.close, volume: r.volume,
		}));
	}

	private normFee(v: any): number {
		const r = Number(v) || 0;
		return r <= 0 ? 0 : r > 1 ? r / 100 : r > 0.01 ? r / 100 : r;
	}

	private estProfit(
		side: OrderSide, ep: number, lev: number, qty: number,
		tps: { price: number; ratio: number }[], fee: number,
	): number {
		let n = -(ep * qty * fee);
		let rem = 1;
		for (const t of tps) {
			const r = Math.min(t.ratio, rem);
			if (t.price <= 0 || r <= 0) continue;
			const q = qty * r, d = side === OrderSide.LONG ? t.price - ep : ep - t.price;
			if (d <= 0) continue;
			n += d * lev * q - t.price * q * fee;
			rem -= r;
			if (rem <= 1e-6) break;
		}
		return n;
	}
}
