import {
	Injectable,
	NotFoundException,
	BadRequestException,
	Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Session, SessionStatus } from "./session.entity";
import { Position } from "../position/position.entity";
import { Trade } from "../trade/trade.entity";
import { StrategyService } from "../strategy/strategy.service";
import { UserService } from "../user/user.service";
import { BitgetClientService } from "../bot/bitget-client.service";
import { BitgetSyncService } from "../sync/bitget-sync.service";
import { StartSessionDto } from "./dto/session.dto";

@Injectable()
export class SessionService {
	private readonly logger = new Logger(SessionService.name);

	constructor(
		@InjectRepository(Session)
		private readonly sessionRepo: Repository<Session>,
		@InjectRepository(Position)
		private readonly posRepo: Repository<Position>,
		@InjectRepository(Trade)
		private readonly tradeRepo: Repository<Trade>,
		private readonly strategyService: StrategyService,
		private readonly userService: UserService,
		private readonly bitget: BitgetClientService,
		private readonly sync: BitgetSyncService,
	) {}

	async start(userId: string, dto: StartSessionDto): Promise<Session> {
		let strategy;
		if (dto.strategyId) {
			strategy = await this.strategyService.findById(dto.strategyId);
			if (!strategy) throw new NotFoundException("Strategy not found");
		} else {
			strategy = await this.strategyService.findDefault();
			if (!strategy)
				throw new BadRequestException("No default strategy available");
		}

		const balance = dto.startingBalance ?? 1000;
		const session = this.sessionRepo.create({
			userId,
			strategyId: strategy.id,
			symbol: dto.symbol.toUpperCase(),
			leverage: dto.leverage ?? 35,
			simulation: dto.simulation ?? false,
			startingBalance: balance,
			currentBalance: balance,
			currentEquity: balance,
			riskPerTradePct: dto.riskPerTradePct ?? null,
			maxNotionalUsdt: dto.maxNotionalUsdt ?? null,
			minProfitUsdt: dto.minProfitUsdt ?? null,
			maxRiskPerTradeUsdt: dto.maxRiskPerTradeUsdt ?? null,
			capitalFraction: dto.capitalFraction ?? null,
			maxDailyLossPct: dto.maxDailyLossPct ?? null,
			maxDailyLossUsdt: dto.maxDailyLossUsdt ?? null,
			maxTradesPerDay: dto.maxTradesPerDay ?? null,
			maxConsecutiveLosses: dto.maxConsecutiveLosses ?? null,
			drawdownAutoReduceAfter: dto.drawdownAutoReduceAfter ?? null,
			drawdownAutoReduceFactor: dto.drawdownAutoReduceFactor ?? null,
			drawdownRecoveryTrades: dto.drawdownRecoveryTrades ?? null,
			status: SessionStatus.RUNNING,
		});

		const saved = await this.sessionRepo.save(session);

		if (!saved.simulation) {
			const user = await this.userService.findById(userId);
			if (user?.bitgetApiKey && user?.bitgetApiSecret && user?.bitgetPassphrase) {
				await this.bitget.ensureHedgeMode(user.bitgetApiKey, user.bitgetApiSecret, user.bitgetPassphrase);

				// Sync initial balance from Bitget for real sessions
				try {
					const withUser = { ...saved, user } as Session;
					await this.sync.syncSession(withUser as any);
				} catch (e: any) {
					this.logger.warn(`Initial sync failed for session ${saved.id}: ${e.message}`);
				}
			} else {
				this.logger.warn(`Session ${saved.id}: no Bitget credentials found`);
			}
		}

		this.logger.log(`Session started: ${saved.id} (${saved.symbol}, user=${userId})`);
		return saved;
	}

	async stop(sessionId: string, userId: string): Promise<Session> {
		const session = await this.sessionRepo.findOne({
			where: { id: sessionId, userId },
			relations: ['user'],
		});
		if (!session) throw new NotFoundException("Session not found");
		if (session.status === SessionStatus.STOPPED)
			throw new BadRequestException("Already stopped");

		// Final sync before stopping
		if (!session.simulation) {
			try {
				await this.sync.syncSession(session);
			} catch (e: any) {
				this.logger.warn(`Final sync failed for session ${session.id}: ${e.message}`);
			}
		}

		session.status = SessionStatus.STOPPED;
		session.stoppedAt = new Date();
		return this.sessionRepo.save(session);
	}

	findByUser(userId: string) {
		return this.sessionRepo.find({
			where: { userId },
			relations: ["strategy"],
			order: { createdAt: "DESC" },
		});
	}

	findById(sessionId: string, userId: string) {
		return this.sessionRepo.findOne({
			where: { id: sessionId, userId },
			relations: ["strategy", "positions", "trades"],
		});
	}

	findRunning(userId: string) {
		return this.sessionRepo.find({
			where: { userId, status: SessionStatus.RUNNING },
			relations: ["strategy"],
		});
	}

	/**
	 * Full dashboard: DB stats + live Bitget snapshot for real sessions.
	 * Returns aggregated P&L, trade stats, and current live state.
	 */
	async getDashboard(sessionId: string, userId: string): Promise<SessionDashboard> {
		const session = await this.sessionRepo.findOne({
			where: { id: sessionId, userId },
			relations: ['strategy', 'user'],
		});
		if (!session) throw new NotFoundException("Session not found");

		// DB stats
		const positions = await this.posRepo.find({ where: { sessionId } });
		const trades = await this.tradeRepo.find({ where: { sessionId }, order: { closeTime: 'DESC' } });

		const closedTrades = trades.filter((t) => !t.isPartial || t.reason === 'external_closure');
		const partialTrades = trades.filter((t) => t.isPartial);
		const winningTrades = closedTrades.filter((t) => t.pnl > 0);
		const losingTrades = closedTrades.filter((t) => t.pnl < 0);
		const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
		const totalFees = trades.reduce((s, t) => s + t.fees, 0);
		const grossPnl = totalPnl + totalFees;
		const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
		const avgWin = winningTrades.length > 0 ? winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length : 0;
		const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((s, t) => s + t.pnl, 0) / losingTrades.length) : 0;
		const profitFactor = avgLoss > 0 ? avgWin / avgLoss : null;

		const openPositions = positions.filter((p) => !p.isClosed);
		const closedPositions = positions.filter((p) => p.isClosed);

		// Live Bitget snapshot (real sessions only, cached)
		let liveSnapshot: import('../sync/bitget-sync.service').SessionSnapshot | null = null;
		if (!session.simulation && session.user?.bitgetApiKey) {
			try {
				liveSnapshot = await this.sync.getSnapshot(session);
			} catch (e: any) {
				this.logger.warn(`Snapshot failed for ${sessionId}: ${e.message}`);
			}
		}

		return {
			session: {
				id: session.id,
				symbol: session.symbol,
				status: session.status,
				simulation: session.simulation,
				leverage: session.leverage,
				startingBalance: session.startingBalance,
				currentBalance: session.currentBalance,
				currentEquity: session.currentEquity,
				riskMultiplier: session.riskMultiplier,
				killSwitchTriggered: session.killSwitchTriggered,
				tradesToday: session.tradesToday,
				consecutiveLosses: session.consecutiveLosses,
				createdAt: session.createdAt,
				stoppedAt: session.stoppedAt,
			},
			stats: {
				totalPnl,
				grossPnl,
				totalFees,
				totalTrades: closedTrades.length,
				partialTrades: partialTrades.length,
				winningTrades: winningTrades.length,
				losingTrades: losingTrades.length,
				winRate: parseFloat(winRate.toFixed(2)),
				avgWin: parseFloat(avgWin.toFixed(4)),
				avgLoss: parseFloat(avgLoss.toFixed(4)),
				profitFactor: profitFactor ? parseFloat(profitFactor.toFixed(3)) : null,
				openPositions: openPositions.length,
				closedPositions: closedPositions.length,
				pnlFromStart: session.currentEquity - session.startingBalance,
				pnlPctFromStart: ((session.currentEquity - session.startingBalance) / session.startingBalance) * 100,
			},
			recentTrades: trades.slice(0, 20),
			openPositions,
			live: liveSnapshot,
		};
	}
}

export interface SessionDashboard {
	session: Record<string, any>;
	stats: Record<string, any>;
	recentTrades: Trade[];
	openPositions: Position[];
	live: any;
}
