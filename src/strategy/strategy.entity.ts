import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';
import { Session } from '../session/session.entity';
import { StrategyTpTemplate } from './strategy-tp-template.entity';
import { SymbolOverride } from './symbol-override.entity';

@Entity('strategies')
export class Strategy {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column() name: string;
  @Column({ nullable: true }) description: string;
  @Column({ default: true }) isDefault: boolean;

  // ── RSI ──
  @Column({ type: 'int', default: 14 }) rsiPeriod: number;
  @Column({ type: 'float', default: 68 }) rsiOverbought: number;
  @Column({ type: 'float', default: 32 }) rsiOversold: number;

  // ── EMA ──
  @Column({ type: 'int', default: 50 }) emaFastPeriod: number;
  @Column({ type: 'int', default: 200 }) emaSlowPeriod: number;
  @Column({ type: 'float', default: 0.6 }) emaTouchTolerancePct: number;
  @Column({ type: 'float', default: 0.25 }) priceExtensionPct: number;

  // ── Filters ──
  @Column({ default: true }) requirePriceCross: boolean;
  @Column({ default: true }) requireRsiRebound: boolean;
  @Column({ default: true }) requireRsiReboundLong: boolean;
  @Column({ default: true }) requireRsiReboundShort: boolean;
  @Column({ default: true }) requirePrimaryTrend: boolean;
  @Column({ default: true }) enableRsiLong: boolean;
  @Column({ default: true }) enableRsiShort: boolean;
  @Column({ default: true }) requirePriceZoneLong: boolean;
  @Column({ default: true }) requirePriceZoneShort: boolean;
  @Column({ type: 'float', default: 0 }) minTrendStrengthPct: number;
  @Column({ type: 'float', default: 0 }) minPriceDisplacementPct: number;

  // ── Higher TF ──
  @Column({ type: 'int', default: 5 }) trendTfMultiplier: number;
  @Column({ type: 'int', default: 200 }) trendTfEmaPeriod: number;
  @Column({ default: true }) requireTrendConfirmation: boolean;

  // ── ATR / SL / TP ──
  @Column({ type: 'int', default: 14 }) atrPeriod: number;
  @Column({ type: 'float', default: 2.0 }) atrTpMult: number;
  @Column({ type: 'float', default: 2.4 }) atrSlMult: number;
  @Column({ type: 'float', default: 0.7 }) tp1RMultiple: number;
  @Column({ type: 'float', default: 1.5 }) tp2RMultiple: number;
  @Column({ type: 'float', default: 0.4 }) tp1Ratio: number;
  @Column({ default: true }) trailingEnabled: boolean;
  @Column({ type: 'float', default: 1.8 }) trailingAtrMult: number;
  @Column({ type: 'int', default: 250 }) minCandlesWarmup: number;
  @Column({ type: 'varchar', default: '5m' }) defaultGranularity: string;

  // ── Risk ──
  @Column({ type: 'float', default: 0.10 }) riskPerTradePct: number;
  @Column({ type: 'float', default: 1000 }) maxNotionalUsdt: number;
  @Column({ type: 'float', default: 4.0 }) minProfitUsdt: number;
  @Column({ type: 'float', default: 0.06 }) takerFeePct: number;
  @Column({ type: 'float', default: 1.5 }) minTradeFeeUsdt: number;

  // ── Relations ──
  @OneToMany(() => StrategyTpTemplate, (tp) => tp.strategy, { cascade: true, eager: true })
  tpTemplates: StrategyTpTemplate[];

  @OneToMany(() => SymbolOverride, (o) => o.strategy, { cascade: true })
  symbolOverrides: SymbolOverride[];

  @OneToMany(() => Session, (s) => s.strategy)
  sessions: Session[];

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;

  /** Convert entity → flat config dict for StrategyEngine constructor */
  toEngineConfig(): Record<string, any> {
    const c: Record<string, any> = {
      rsi_period: this.rsiPeriod, rsi_overbought: this.rsiOverbought, rsi_oversold: this.rsiOversold,
      ema_fast_period: this.emaFastPeriod, ema_slow_period: this.emaSlowPeriod,
      ema_touch_tolerance_pct: this.emaTouchTolerancePct, price_extension_pct: this.priceExtensionPct,
      require_price_cross: this.requirePriceCross, require_rsi_rebound: this.requireRsiRebound,
      require_rsi_rebound_long: this.requireRsiReboundLong, require_rsi_rebound_short: this.requireRsiReboundShort,
      require_primary_trend: this.requirePrimaryTrend, enable_rsi_long: this.enableRsiLong,
      enable_rsi_short: this.enableRsiShort, require_price_zone_long: this.requirePriceZoneLong,
      require_price_zone_short: this.requirePriceZoneShort,
      min_trend_strength_pct: this.minTrendStrengthPct, min_price_displacement_pct: this.minPriceDisplacementPct,
      trend_tf_multiplier: this.trendTfMultiplier, trend_tf_ema_period: this.trendTfEmaPeriod,
      require_trend_confirmation: this.requireTrendConfirmation,
      atr_period: this.atrPeriod, atr_tp_mult: this.atrTpMult, atr_sl_mult: this.atrSlMult,
      tp1_r_multiple: this.tp1RMultiple, tp2_r_multiple: this.tp2RMultiple, tp1_ratio: this.tp1Ratio,
      trailing_enabled: this.trailingEnabled, trailing_atr_mult: this.trailingAtrMult,
      min_candles_warmup: this.minCandlesWarmup,
      risk_per_trade_pct: this.riskPerTradePct, max_notional_usdt: this.maxNotionalUsdt,
      min_profit_usdt: this.minProfitUsdt, taker_pct: this.takerFeePct, min_trade_fee_usdt: this.minTradeFeeUsdt,
    };
    if (this.tpTemplates?.length > 0) {
      c.tp_targets_template = [...this.tpTemplates]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({ r_multiple: t.rMultiple, ratio: t.ratio, label: t.label }));
    }
    return c;
  }
}
