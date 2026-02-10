/**
 * Simulator - EXACT port of Python Simulator. Manages positions, SL/TP/trailing.
 * TS errors from v1 fixed: null → undefined for optional params, proper string types.
 */

import { OrderSide } from '../position/position.entity';
import { OhlcvBar } from './indicators';

export interface SimPosition {
  id: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  originalQty: number;
  entryPrice: number;
  sl: number;
  tp: number;
  leverage: number;
  openTime: Date;
  tpTargets: SimTpTarget[];
  trailAtrMult: number | null;
  atrValue: number | null;
  rMultiple: number | null;
  trailingActive: boolean;
  trailingOffset: number | null;
  bestPrice: number;
  entryFeeTotal: number;
  entryFeeRemaining: number;
  realizedFees: number;
  riskAmount: number;
  riskAmountRemaining: number;
}

export interface SimTpTarget {
  index: number;
  price: number;
  ratio: number;
  qty: number;
  filledQty: number;
  hit: boolean;
  label: string | null;
}

export interface SimTrade {
  positionId: string;
  symbol: string;
  side: OrderSide;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  leverage: number;
  sl: number;
  tp: number;
  pnl: number;
  pnlPct: number;
  openTime: Date;
  closeTime: Date;
  fees: number;
  riskAmount: number;
  reason: string;
  isPartial: boolean;
}

export class Simulator {
  balance: number;
  equity: number;
  openPositions: SimPosition[] = [];
  closedTrades: SimTrade[] = [];
  takerFeeRate: number;
  minFeeUsdt: number;
  private posCounter = 0;

  constructor(startingBalance: number, takerFeeRate = 0, minFeeUsdt = 0) {
    this.balance = startingBalance;
    this.equity = startingBalance;
    this.takerFeeRate = Math.max(0, takerFeeRate);
    this.minFeeUsdt = Math.max(0, minFeeUsdt);
  }

  openPosition(p: {
    symbol: string; side: OrderSide; qty: number; entryPrice: number;
    leverage: number; sl: number; tp: number; openTime: Date;
    tpTargets?: any[]; trailAtrMult?: number | null; atrValue?: number | null;
    rMultiple?: number | null; features?: Record<string, any> | null; riskAmount?: number;
  }): SimPosition {
    this.posCounter++;
    const id = `sim-${p.symbol}-${p.openTime.getTime()}-${this.posCounter}`;
    const trailMult = p.trailAtrMult ?? null;
    const atrVal = p.atrValue ?? null;
    let trailingOffset: number | null = null;
    if (trailMult !== null && atrVal !== null) trailingOffset = Math.max(0, trailMult * atrVal);

    const targets = this.normalizeTargets(p.qty, p.tp, p.tpTargets);
    const finalTp = targets.length > 0 ? targets[targets.length - 1].price : p.tp;

    const entryFeeBase = p.entryPrice * p.qty * this.takerFeeRate;
    const minEntry = this.minFeeUsdt > 0 ? this.minFeeUsdt * 0.5 : 0;
    const entryFeeTotal = Math.max(entryFeeBase, minEntry);

    const pos: SimPosition = {
      id, symbol: p.symbol, side: p.side, qty: p.qty, originalQty: p.qty,
      entryPrice: p.entryPrice, sl: p.sl, tp: finalTp, leverage: p.leverage,
      openTime: p.openTime, tpTargets: targets,
      trailAtrMult: trailMult, atrValue: atrVal, rMultiple: p.rMultiple ?? null,
      trailingActive: false, trailingOffset, bestPrice: p.entryPrice,
      entryFeeTotal, entryFeeRemaining: entryFeeTotal, realizedFees: 0,
      riskAmount: p.riskAmount ?? 0, riskAmountRemaining: p.riskAmount ?? 0,
    };
    this.openPositions.push(pos);
    return pos;
  }

  onNewCandle(bar: OhlcvBar): SimTrade[] {
    const price = bar.close;
    const now = bar.openTime;
    const closed: SimTrade[] = [];
    const remaining: SimPosition[] = [];

    for (const pos of this.openPositions) {
      let done = false;
      if (pos.bestPrice === 0) pos.bestPrice = pos.entryPrice;
      pos.bestPrice = pos.side === OrderSide.LONG ? Math.max(pos.bestPrice, price) : Math.min(pos.bestPrice, price);

      // TP targets
      if (!done) {
        while (true) {
          const t = this.nextTarget(pos);
          if (!t || !this.targetHit(pos, price, t)) break;
          const remQty = Math.max(0, t.qty - t.filledQty);
          if (remQty <= 0) { t.hit = true; this.updateTp(pos); continue; }
          const q = Math.min(pos.qty, remQty);
          if (q <= 0) break;
          const exitP = t.price || price;
          const reason = t.label || `tp_target_${t.index + 1}`;
          const [trade, full] = this.closePart(pos, exitP, now, q, reason);
          closed.push(trade);
          this.markProgress(t, q);
          if (t.index === 0) { pos.sl = pos.entryPrice; this.activateTrailing(pos, price); }
          this.updateTp(pos);
          done = full;
          if (done) break;
        }
      }

      if (!done && pos.trailingActive) this.updateTrail(pos, price);

      if (!done) {
        const [reason, exitP] = this.checkExit(pos, price);
        if (exitP !== null && reason !== null) {
          const [trade, full] = this.closePart(pos, exitP, now, pos.qty, reason);
          closed.push(trade);
          done = full;
        }
      }

      if (!done) remaining.push(pos);
    }

    this.openPositions = remaining;
    this.updateEquity(price);
    return closed;
  }

  forceCloseAll(price: number, ts: Date): SimTrade[] {
    const closed: SimTrade[] = [];
    for (const pos of [...this.openPositions]) {
      const [trade] = this.closePart(pos, price, ts, pos.qty, 'force_close');
      closed.push(trade);
    }
    this.openPositions = [];
    this.updateEquity(price);
    return closed;
  }

  // ── Internals ──

  private normalizeTargets(qty: number, tp: number, raw?: any[]): SimTpTarget[] {
    const out: SimTpTarget[] = [];
    let remR = 1;
    if (Array.isArray(raw)) {
      for (let i = 0; i < raw.length; i++) {
        const t = raw[i];
        if (!t) continue;
        const p = Number(t.price ?? 0), r = Number(t.ratio ?? 0);
        if (p <= 0 || r <= 0 || remR <= 0) continue;
        const a = Math.min(Math.max(r, 0), remR);
        out.push({ index: i, price: p, ratio: a, qty: 0, filledQty: 0, hit: false, label: t.label ?? null });
        remR = Math.max(0, remR - a);
      }
    }
    if (out.length > 0 && remR > 1e-6) out.push({ index: out.length, price: tp, ratio: remR, qty: 0, filledQty: 0, hit: false, label: null });
    if (out.length === 0) out.push({ index: 0, price: tp, ratio: 1, qty: 0, filledQty: 0, hit: false, label: null });
    for (const t of out) { t.qty = Math.max(0, qty * t.ratio); if (t.qty <= 0) t.hit = true; }
    return out;
  }

  private nextTarget(pos: SimPosition): SimTpTarget | null {
    for (const t of pos.tpTargets) { if (!t.hit && t.qty > 0) return t; }
    return null;
  }
  private targetHit(pos: SimPosition, price: number, t: SimTpTarget): boolean {
    return t.price > 0 && (pos.side === OrderSide.LONG ? price >= t.price : price <= t.price);
  }
  private markProgress(t: SimTpTarget, q: number) {
    t.filledQty = Math.min(t.qty, t.filledQty + Math.max(0, q));
    if (t.qty <= 0 || t.filledQty >= t.qty - 1e-10) t.hit = true;
  }
  private updateTp(pos: SimPosition) { const n = this.nextTarget(pos); if (n) pos.tp = n.price; }
  private activateTrailing(pos: SimPosition, price: number) {
    if (pos.trailingActive || !pos.trailingOffset || pos.trailingOffset <= 0) return;
    pos.trailingActive = true; pos.bestPrice = price;
  }
  private updateTrail(pos: SimPosition, price: number) {
    if (!pos.trailingActive || pos.trailingOffset === null) return;
    if (pos.side === OrderSide.LONG) {
      pos.bestPrice = Math.max(pos.bestPrice, price);
      const ns = Math.max(pos.bestPrice - pos.trailingOffset, pos.entryPrice);
      if (ns > pos.sl) pos.sl = ns;
    } else {
      pos.bestPrice = Math.min(pos.bestPrice, price);
      const ns = Math.min(pos.bestPrice + pos.trailingOffset, pos.entryPrice);
      if (ns < pos.sl) pos.sl = ns;
    }
  }
  private checkExit(pos: SimPosition, price: number): [string | null, number | null] {
    if (pos.side === OrderSide.LONG) {
      if (price <= pos.sl) return [pos.trailingActive && pos.sl >= pos.entryPrice ? 'trailing_stop' : 'stop_loss', pos.sl];
      if (price >= pos.tp) return ['take_profit', pos.tp];
    } else {
      if (price >= pos.sl) return [pos.trailingActive && pos.sl <= pos.entryPrice ? 'trailing_stop' : 'stop_loss', pos.sl];
      if (price <= pos.tp) return ['take_profit', pos.tp];
    }
    return [null, null];
  }

  private closePart(pos: SimPosition, exitPrice: number, closeTime: Date, qty: number, reason: string): [SimTrade, boolean] {
    const q = Math.min(qty, pos.qty);
    const dir = pos.side === OrderSide.LONG ? 1 : -1;
    const gross = (exitPrice - pos.entryPrice) * q * pos.leverage * dir;

    let entryShare = 0;
    if (pos.originalQty > 0 && pos.entryFeeTotal > 0) {
      entryShare = pos.entryFeeTotal * Math.max(0, Math.min(1, q / pos.originalQty));
      pos.entryFeeRemaining = Math.max(0, pos.entryFeeRemaining - entryShare);
    }
    let exitFee = exitPrice * q * this.takerFeeRate;
    let totalFees = entryShare + exitFee;
    if (this.minFeeUsdt > 0) {
      const minF = pos.originalQty > 0 ? this.minFeeUsdt * Math.max(0, Math.min(1, q / pos.originalQty)) : this.minFeeUsdt;
      if (totalFees < minF) { exitFee += minF - totalFees; totalFees = minF; }
    }
    const net = gross - totalFees;
    pos.realizedFees += totalFees;
    this.balance += net;

    const notional = pos.entryPrice * q * pos.leverage;
    const pnlPct = notional > 0 ? (net / notional) * 100 : 0;
    const full = q >= pos.qty - 1e-10;

    let riskShare = 0;
    if (pos.riskAmount > 0 && pos.originalQty > 0) {
      const r = Math.max(0, Math.min(1, q / pos.originalQty));
      riskShare = Math.min(pos.riskAmountRemaining, pos.riskAmount * r);
      pos.riskAmountRemaining = Math.max(0, pos.riskAmountRemaining - riskShare);
    }

    const trade: SimTrade = {
      positionId: pos.id, symbol: pos.symbol, side: pos.side,
      entryPrice: pos.entryPrice, exitPrice, qty: q, leverage: pos.leverage,
      sl: pos.sl, tp: pos.tp, pnl: net, pnlPct,
      openTime: pos.openTime, closeTime, fees: totalFees, riskAmount: riskShare,
      reason, isPartial: !full,
    };
    this.closedTrades.push(trade);
    pos.qty = full ? 0 : pos.qty - q;
    return [trade, full];
  }

  private updateEquity(price: number) {
    let unr = 0;
    for (const p of this.openPositions) {
      const dir = p.side === OrderSide.LONG ? 1 : -1;
      unr += (price - p.entryPrice) * p.qty * p.leverage * dir;
      unr -= p.entryFeeRemaining;
    }
    this.equity = this.balance + unr;
  }
}
