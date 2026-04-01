import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RestClientV2 } from 'bitget-api';
import { Session, SessionStatus } from '../session/session.entity';
import { Position, OrderSide } from '../position/position.entity';
import { Trade } from '../trade/trade.entity';

/**
 * BitgetSyncService — pulls live data from Bitget and reconciles it with the DB.
 *
 * Sync scope per session (real, non-simulation only):
 *   - Account balance & equity  → session.currentBalance / currentEquity
 *   - Open positions            → position.qty, sl, liqPrice, unrealizedPnl
 *   - Closed trades (fills)     → reconcile DB trades vs Bitget fill history
 *   - TP/SL order status        → detect external closures (manual, liquidation)
 */
@Injectable()
export class BitgetSyncService {
  private readonly log = new Logger(BitgetSyncService.name);

  /** In-memory cache: sessionId → { balance, equity, ts } */
  private readonly balanceCache = new Map<string, { balance: number; equity: number; ts: number }>();
  private readonly BALANCE_TTL_MS = 30_000; // 30s

  /** In-memory cache: sessionId → { positions, ts } */
  private readonly positionsCache = new Map<string, { positions: BitgetPosition[]; ts: number }>();
  private readonly POSITIONS_TTL_MS = 10_000; // 10s

  constructor(
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Position) private readonly posRepo: Repository<Position>,
    @InjectRepository(Trade) private readonly tradeRepo: Repository<Trade>,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Full sync for one session. Called on demand (e.g. GET /sessions/:id/sync).
   * Returns a snapshot of what was reconciled.
   */
  async syncSession(session: Session): Promise<SyncResult> {
    if (session.simulation || !session.user?.bitgetApiKey) {
      return { skipped: true, reason: 'simulation or no credentials' };
    }

    const client = this.makeClient(session.user);
    const result: SyncResult = { skipped: false, balanceUpdated: false, positionsReconciled: 0, externalClosuresDetected: 0 };

    // 1. Balance
    const bal = await this.fetchBalance(client);
    if (bal) {
      await this.sessionRepo.update(session.id, {
        currentBalance: bal.available,
        currentEquity: bal.equity,
      });
      this.balanceCache.set(session.id, { balance: bal.available, equity: bal.equity, ts: Date.now() });
      result.balanceUpdated = true;
      result.balance = bal;
    }

    // 2. Open positions from Bitget
    const bitgetPositions = await this.fetchPositions(client, session.symbol);
    this.positionsCache.set(session.id, { positions: bitgetPositions, ts: Date.now() });

    // 3. Reconcile DB positions vs Bitget
    const dbPositions = await this.posRepo.find({
      where: { sessionId: session.id, isClosed: false },
    });

    for (const dbPos of dbPositions) {
      const holdSide = dbPos.side === OrderSide.LONG ? 'long' : 'short';
      const bitgetPos = bitgetPositions.find(
        (p) => p.symbol === dbPos.symbol && p.holdSide === holdSide,
      );

      if (!bitgetPos) {
        // Position not found on Bitget → externally closed (manual, liquidation, SL hit)
        this.log.warn(`External closure detected: pos=${dbPos.id} ${dbPos.symbol} ${dbPos.side}`);
        await this.handleExternalClosure(session, dbPos);
        result.externalClosuresDetected++;
      } else {
        // Update DB position with live Bitget data
        await this.posRepo.update(
          { id: dbPos.id },
          {
            qty: parseFloat(bitgetPos.total ?? bitgetPos.available ?? String(dbPos.qty)),
            sl: bitgetPos.stopLossPrice ? parseFloat(bitgetPos.stopLossPrice) : dbPos.sl,
            liqPrice: bitgetPos.liquidationPrice ? parseFloat(bitgetPos.liquidationPrice) : dbPos.liqPrice,
          },
        );
        result.positionsReconciled++;
        result.livePositions = result.livePositions ?? [];
        result.livePositions.push({
          symbol: bitgetPos.symbol,
          side: bitgetPos.holdSide,
          qty: parseFloat(bitgetPos.total ?? '0'),
          entryPrice: parseFloat(bitgetPos.openPriceAvg ?? '0'),
          markPrice: parseFloat(bitgetPos.markPrice ?? '0'),
          unrealizedPnl: parseFloat(bitgetPos.unrealizedPL ?? '0'),
          liqPrice: parseFloat(bitgetPos.liquidationPrice ?? '0'),
          leverage: parseInt(bitgetPos.leverage ?? '1'),
          marginSize: parseFloat(bitgetPos.marginSize ?? '0'),
        });
      }
    }

    return result;
  }

  /**
   * Returns a live snapshot of balance + open positions for a session.
   * Uses cache to avoid hammering Bitget on repeated calls.
   */
  async getSnapshot(session: Session): Promise<SessionSnapshot> {
    if (session.simulation || !session.user?.bitgetApiKey) {
      return {
        isReal: false,
        balance: { available: session.currentBalance, equity: session.currentEquity, unrealizedPnl: 0 },
        positions: [],
        openOrders: [],
      };
    }

    const client = this.makeClient(session.user);

    // Balance (cached)
    let bal = this.getCachedBalance(session.id);
    if (!bal) {
      bal = await this.fetchBalance(client);
      if (bal) this.balanceCache.set(session.id, { balance: bal.available, equity: bal.equity, ts: Date.now() });
    }

    // Positions (cached)
    let positions: BitgetPosition[] = this.getCachedPositions(session.id);
    if (!positions) {
      positions = await this.fetchPositions(client, session.symbol);
      this.positionsCache.set(session.id, { positions, ts: Date.now() });
    }

    // Open TP/SL orders
    const openOrders = await this.fetchTpslOrders(client, session.symbol);

    return {
      isReal: true,
      balance: bal ?? { available: session.currentBalance, equity: session.currentEquity, unrealizedPnl: 0 },
      positions: positions.map((p) => ({
        symbol: p.symbol,
        side: p.holdSide as 'long' | 'short',
        qty: parseFloat(p.total ?? p.available ?? '0'),
        entryPrice: parseFloat(p.openPriceAvg ?? '0'),
        markPrice: parseFloat(p.markPrice ?? '0'),
        unrealizedPnl: parseFloat(p.unrealizedPL ?? '0'),
        liqPrice: parseFloat(p.liquidationPrice ?? '0'),
        leverage: parseInt(p.leverage ?? '1'),
        marginSize: parseFloat(p.marginSize ?? '0'),
        roe: parseFloat(p.achievedProfits ?? '0'),
      })),
      openOrders,
    };
  }

  /**
   * Fetch recent fill history from Bitget and reconcile with DB trades.
   * Returns fills that are NOT yet recorded in the DB.
   */
  async getFillHistory(session: Session, limit = 50): Promise<FillRecord[]> {
    if (session.simulation || !session.user?.bitgetApiKey) return [];

    const client = this.makeClient(session.user);
    const fills = await this.fetchFills(client, session.symbol, limit);

    // Compare with DB trades by closeTime proximity
    const dbTrades = await this.tradeRepo.find({
      where: { sessionId: session.id },
      order: { closeTime: 'DESC' },
      take: 200,
    });

    const dbTradeTimes = new Set(dbTrades.map((t) => Math.floor(new Date(t.closeTime).getTime() / 1000)));

    // Mark fills that don't have a matching DB trade (external fills)
    return fills.map((f) => ({
      ...f,
      isExternal: !dbTradeTimes.has(Math.floor(f.timestamp / 1000)),
    }));
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async fetchBalance(client: RestClientV2): Promise<BalanceSnapshot | null> {
    try {
      const resp = await client.getFuturesAccountAssets({
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
      });
      const assets: any[] = Array.isArray(resp?.data) ? resp.data : [];
      const usdt = assets.find((a: any) => a.marginCoin === 'USDT' || a.coin === 'USDT') ?? assets[0];
      if (!usdt) return null;

      const available = parseFloat(usdt.available ?? usdt.availableAmount ?? '0');
      const equity = parseFloat(usdt.equity ?? usdt.accountEquity ?? usdt.usdtEquity ?? '0') || available;
      const unrealizedPnl = parseFloat(usdt.unrealizedPL ?? usdt.unrealizedPNL ?? '0');

      return { available, equity, unrealizedPnl };
    } catch (e: any) {
      this.log.warn(`fetchBalance failed: ${e.message}`);
      return null;
    }
  }

  private async fetchPositions(client: RestClientV2, symbol?: string): Promise<BitgetPosition[]> {
    try {
      const resp = await client.getFuturesPositions({
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
      });
      const all: any[] = Array.isArray(resp?.data) ? resp.data : [];
      const filtered = symbol ? all.filter((p: any) => p.symbol === symbol) : all;
      // Only return positions with actual size
      return filtered.filter((p: any) => parseFloat(p.total ?? p.available ?? '0') > 0);
    } catch (e: any) {
      this.log.warn(`fetchPositions failed: ${e.message}`);
      return [];
    }
  }

  private async fetchTpslOrders(client: RestClientV2, symbol: string): Promise<TpslOrder[]> {
    try {
      const resp = await client.getFuturesPlanOrders({
        symbol,
        productType: 'USDT-FUTURES',
        isPlan: 'profit_loss',
      } as any);
      const orders: any[] = Array.isArray(resp?.data?.entrustedList)
        ? resp.data.entrustedList
        : Array.isArray(resp?.data) ? resp.data : [];

      return orders.map((o: any) => ({
        orderId: o.orderId,
        planType: o.planType,
        side: o.holdSide,
        triggerPrice: parseFloat(o.triggerPrice ?? '0'),
        size: parseFloat(o.size ?? '0'),
        status: o.planStatus ?? o.status,
      }));
    } catch (e: any) {
      this.log.debug(`fetchTpslOrders failed: ${e.message}`);
      return [];
    }
  }

  private async fetchFills(client: RestClientV2, symbol: string, limit: number): Promise<FillRecord[]> {
    try {
      const resp = await client.getFuturesHistoricPositions({
        productType: 'USDT-FUTURES',
        symbol,
        limit: String(limit),
      } as any);
      const fills: any[] = Array.isArray(resp?.data?.list)
        ? resp.data.list
        : Array.isArray(resp?.data) ? resp.data : [];

      return fills.map((f: any) => ({
        orderId: f.orderId ?? f.id,
        symbol: f.symbol,
        side: f.side ?? f.tradeSide,
        price: parseFloat(f.price ?? f.priceAvg ?? '0'),
        qty: parseFloat(f.size ?? f.baseVolume ?? '0'),
        pnl: parseFloat(f.pnl ?? f.realizedPL ?? '0'),
        fee: parseFloat(f.fee ?? f.fees ?? '0'),
        timestamp: Number(f.cTime ?? f.createTime ?? 0),
        isExternal: false,
      }));
    } catch (e: any) {
      this.log.debug(`fetchFills failed: ${e.message}`);
      return [];
    }
  }

  private async handleExternalClosure(session: Session, dbPos: Position): Promise<void> {
    // Mark position as closed in DB with external reason
    await this.posRepo.update({ id: dbPos.id }, { isClosed: true, qty: 0 });

    // Create a trade record for audit trail
    await this.tradeRepo.save(
      this.tradeRepo.create({
        sessionId: session.id,
        positionId: dbPos.id,
        symbol: dbPos.symbol,
        side: dbPos.side,
        entryPrice: dbPos.entryPrice,
        exitPrice: 0, // unknown — detected externally
        qty: dbPos.originalQty,
        leverage: dbPos.leverage,
        sl: dbPos.sl,
        tp: dbPos.tp,
        pnl: 0,
        pnlPct: 0,
        fees: 0,
        riskAmount: dbPos.riskAmount,
        openTime: dbPos.openTime,
        closeTime: new Date(),
        reason: 'external_closure',
        isPartial: false,
      }),
    );
  }

  private makeClient(user: { bitgetApiKey: string; bitgetApiSecret: string; bitgetPassphrase: string }): RestClientV2 {
    return new RestClientV2({
      apiKey: user.bitgetApiKey,
      apiSecret: user.bitgetApiSecret,
      apiPass: user.bitgetPassphrase,
    });
  }

  private getCachedBalance(sessionId: string): BalanceSnapshot | null {
    const c = this.balanceCache.get(sessionId);
    if (!c || Date.now() - c.ts > this.BALANCE_TTL_MS) return null;
    return { available: c.balance, equity: c.equity, unrealizedPnl: 0 };
  }

  private getCachedPositions(sessionId: string): BitgetPosition[] | null {
    const c = this.positionsCache.get(sessionId);
    if (!c || Date.now() - c.ts > this.POSITIONS_TTL_MS) return null;
    return c.positions;
  }
}

// ── Interfaces ────────────────────────────────────────────────────────────────

interface BitgetPosition {
  symbol: string;
  holdSide: string;
  total?: string;
  available?: string;
  openPriceAvg?: string;
  markPrice?: string;
  unrealizedPL?: string;
  liquidationPrice?: string;
  leverage?: string;
  marginSize?: string;
  achievedProfits?: string;
  stopLossPrice?: string;
}

export interface BalanceSnapshot {
  available: number;
  equity: number;
  unrealizedPnl: number;
}

export interface LivePosition {
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  liqPrice: number;
  leverage: number;
  marginSize: number;
  roe?: number;
}

export interface TpslOrder {
  orderId: string;
  planType: string;
  side: string;
  triggerPrice: number;
  size: number;
  status: string;
}

export interface FillRecord {
  orderId: string;
  symbol: string;
  side: string;
  price: number;
  qty: number;
  pnl: number;
  fee: number;
  timestamp: number;
  isExternal: boolean;
}

export interface SessionSnapshot {
  isReal: boolean;
  balance: BalanceSnapshot;
  positions: (LivePosition & { roe?: number })[];
  openOrders: TpslOrder[];
}

export interface SyncResult {
  skipped: boolean;
  reason?: string;
  balanceUpdated?: boolean;
  positionsReconciled?: number;
  externalClosuresDetected?: number;
  balance?: BalanceSnapshot;
  livePositions?: LivePosition[];
}
