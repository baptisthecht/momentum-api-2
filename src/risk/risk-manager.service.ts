/**
 * RiskManagerService — MOM-17 to MOM-21
 *
 * Mirrors Python's RiskManager + RiskState.
 * State is persisted on the Session entity so the kill switch survives restarts.
 *
 * Checks (in order):
 *   MOM-17: max_daily_loss_pct / max_daily_loss_usdt  → kill switch
 *   MOM-18: max_trades_per_day
 *   MOM-19: max_consecutive_losses
 *   MOM-20: drawdown_auto_reduce_after/factor/recovery → risk_multiplier
 *   MOM-21: kill_switch_triggered persisted on Session
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../session/session.entity';

@Injectable()
export class RiskManagerService {
  private readonly log = new Logger(RiskManagerService.name);

  constructor(
    @InjectRepository(Session)
    private readonly sessionRepo: Repository<Session>,
  ) {}

  // ── Day rollover ────────────────────────────────────────────────────────────

  /**
   * Called at the start of processSession. If it's a new UTC day, reset daily counters.
   * Returns the (possibly updated) session.
   */
  async ensureDay(session: Session, currentEquity: number): Promise<Session> {
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const dayStarted = session.riskDayStartedAt;
    const dayStartedUTC = dayStarted
      ? new Date(Date.UTC(dayStarted.getUTCFullYear(), dayStarted.getUTCMonth(), dayStarted.getUTCDate()))
      : null;

    if (!dayStarted || dayStartedUTC!.getTime() < todayUTC.getTime()) {
      // New day — reset daily counters, keep weekly/session state
      session.dailyPnl = 0;
      session.tradesToday = 0;
      session.consecutiveLosses = 0;
      session.killSwitchTriggered = false;
      session.riskMultiplier = 1.0;
      session.recoveryCounter = 0;
      session.riskDayStartedAt = now;
      session.riskDayStartingEquity = currentEquity;
      session = await this.sessionRepo.save(session);
      this.log.log(`[Risk] Day reset for session ${session.id}: equity=${currentEquity.toFixed(2)}`);
    }

    return session;
  }

  // ── Main guard ──────────────────────────────────────────────────────────────

  /**
   * Returns true if a new trade can be opened.
   * Should be called after ensureDay().
   */
  canOpenNewTrade(session: Session, currentEquity: number): boolean {
    // MOM-21: hard kill switch (persisted)
    if (session.killSwitchTriggered) {
      this.log.warn(`[Risk] Kill switch active for session ${session.id}`);
      return false;
    }

    // MOM-18: max trades per day
    const maxTrades = session.maxTradesPerDay;
    if (maxTrades !== null && maxTrades > 0 && session.tradesToday >= maxTrades) {
      this.log.debug(`[Risk] Max trades/day reached (${session.tradesToday}/${maxTrades})`);
      return false;
    }

    // MOM-19: max consecutive losses
    const maxConsec = session.maxConsecutiveLosses;
    if (maxConsec !== null && maxConsec > 0 && session.consecutiveLosses >= maxConsec) {
      this.log.debug(`[Risk] Max consecutive losses reached (${session.consecutiveLosses}/${maxConsec})`);
      return false;
    }

    // MOM-17: daily loss limits
    if (!this.checkDailyLossLimits(session, currentEquity)) {
      return false;
    }

    return true;
  }

  private checkDailyLossLimits(session: Session, currentEquity: number): boolean {
    const startEq = session.riskDayStartingEquity;
    if (startEq === null || startEq <= 0) return true;

    const ddUsdt = Math.max(0, startEq - currentEquity);

    if (session.maxDailyLossUsdt !== null && session.maxDailyLossUsdt > 0) {
      if (ddUsdt >= session.maxDailyLossUsdt) {
        this.log.warn(`[Risk] Daily loss USDT limit hit: ${ddUsdt.toFixed(2)} >= ${session.maxDailyLossUsdt}`);
        return false;
      }
    }

    if (session.maxDailyLossPct !== null && session.maxDailyLossPct > 0) {
      const ddPct = (ddUsdt / startEq) * 100;
      if (ddPct >= session.maxDailyLossPct) {
        this.log.warn(`[Risk] Daily loss % limit hit: ${ddPct.toFixed(2)}% >= ${session.maxDailyLossPct}%`);
        return false;
      }
    }

    return true;
  }

  // ── After trade closes ──────────────────────────────────────────────────────

  /**
   * Register a completed trade result. Updates daily PnL, consecutive losses,
   * drawdown risk multiplier, and potentially triggers the kill switch.
   * Persists to DB.
   */
  async registerTradeResult(
    session: Session,
    pnl: number,
    currentEquity: number,
  ): Promise<Session> {
    session.dailyPnl += pnl;
    session.tradesToday += 1;

    if (pnl < 0) {
      session.consecutiveLosses += 1;

      // MOM-20: drawdown auto-reduce
      const reduceAfter = session.drawdownAutoReduceAfter;
      const reduceFactor = session.drawdownAutoReduceFactor;
      if (
        reduceAfter !== null && reduceAfter > 0 &&
        reduceFactor !== null && reduceFactor > 0 && reduceFactor < 1.0 &&
        session.consecutiveLosses >= reduceAfter
      ) {
        session.riskMultiplier = Math.min(session.riskMultiplier, reduceFactor);
        this.log.log(`[Risk] Auto-reduce triggered: riskMultiplier=${session.riskMultiplier}`);
      }
    } else {
      session.consecutiveLosses = 0;

      // MOM-20: recovery
      if (session.riskMultiplier < 1.0) {
        session.recoveryCounter += 1;
        const recoveryNeeded = session.drawdownRecoveryTrades ?? 1;
        if (session.recoveryCounter >= recoveryNeeded) {
          session.riskMultiplier = 1.0;
          session.recoveryCounter = 0;
          this.log.log(`[Risk] Risk multiplier recovered to 1.0`);
        }
      } else {
        session.recoveryCounter = 0;
      }
    }

    // MOM-17/21: check if daily loss limit just got triggered → set kill switch
    if (!this.checkDailyLossLimits(session, currentEquity)) {
      session.killSwitchTriggered = true;
      this.log.warn(`[Risk] Kill switch triggered for session ${session.id}`);
    }

    return this.sessionRepo.save(session);
  }

  // ── Effective risk pct ──────────────────────────────────────────────────────

  /**
   * Returns risk_per_trade_pct * risk_multiplier (clamped to [0, 1]).
   */
  getEffectiveRiskPct(session: Session, baseRiskPct: number): number {
    return Math.max(0, Math.min(1, baseRiskPct * session.riskMultiplier));
  }
}
