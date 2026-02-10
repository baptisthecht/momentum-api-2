import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
  CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';
import { Strategy } from './strategy.entity';
import { SymbolOverrideTpTemplate } from './symbol-override-tp-template.entity';

@Entity('strategy_symbol_overrides')
export class SymbolOverride {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Strategy, (s) => s.symbolOverrides, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'strategyId' })
  strategy: Strategy;

  @Column() strategyId: string;
  @Column() symbol: string;

  // All nullable = use parent default
  @Column({ type: 'float', nullable: true }) rsiOverbought: number | null;
  @Column({ type: 'float', nullable: true }) rsiOversold: number | null;
  @Column({ type: 'float', nullable: true }) emaTouchTolerancePct: number | null;
  @Column({ type: 'float', nullable: true }) priceExtensionPct: number | null;
  @Column({ type: 'boolean', nullable: true }) requirePriceCross: boolean | null;
  @Column({ type: 'boolean', nullable: true }) requireRsiRebound: boolean | null;
  @Column({ type: 'boolean', nullable: true }) requireRsiReboundLong: boolean | null;
  @Column({ type: 'boolean', nullable: true }) requireRsiReboundShort: boolean | null;
  @Column({ type: 'boolean', nullable: true }) requirePrimaryTrend: boolean | null;
  @Column({ type: 'boolean', nullable: true }) enableRsiLong: boolean | null;
  @Column({ type: 'boolean', nullable: true }) enableRsiShort: boolean | null;
  @Column({ type: 'boolean', nullable: true }) requirePriceZoneLong: boolean | null;
  @Column({ type: 'boolean', nullable: true }) requirePriceZoneShort: boolean | null;
  @Column({ type: 'float', nullable: true }) minTrendStrengthPct: number | null;
  @Column({ type: 'float', nullable: true }) minPriceDisplacementPct: number | null;
  @Column({ type: 'float', nullable: true }) atrSlMult: number | null;
  @Column({ type: 'float', nullable: true }) atrTpMult: number | null;
  @Column({ type: 'float', nullable: true }) trailingAtrMult: number | null;
  @Column({ type: 'float', nullable: true }) riskPerTradePct: number | null;
  @Column({ type: 'float', nullable: true }) minProfitUsdt: number | null;

  @OneToMany(() => SymbolOverrideTpTemplate, (t) => t.symbolOverride, { cascade: true, eager: true })
  tpTemplates: SymbolOverrideTpTemplate[];

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;

  /** Merge non-null fields over a base config dict */
  applyTo(config: Record<string, any>): Record<string, any> {
    const m = { ...config };
    const map: [keyof SymbolOverride, string][] = [
      ['rsiOverbought', 'rsi_overbought'], ['rsiOversold', 'rsi_oversold'],
      ['emaTouchTolerancePct', 'ema_touch_tolerance_pct'], ['priceExtensionPct', 'price_extension_pct'],
      ['requirePriceCross', 'require_price_cross'], ['requireRsiRebound', 'require_rsi_rebound'],
      ['requireRsiReboundLong', 'require_rsi_rebound_long'], ['requireRsiReboundShort', 'require_rsi_rebound_short'],
      ['requirePrimaryTrend', 'require_primary_trend'], ['enableRsiLong', 'enable_rsi_long'],
      ['enableRsiShort', 'enable_rsi_short'], ['requirePriceZoneLong', 'require_price_zone_long'],
      ['requirePriceZoneShort', 'require_price_zone_short'],
      ['minTrendStrengthPct', 'min_trend_strength_pct'], ['minPriceDisplacementPct', 'min_price_displacement_pct'],
      ['atrSlMult', 'atr_sl_mult'], ['atrTpMult', 'atr_tp_mult'],
      ['trailingAtrMult', 'trailing_atr_mult'], ['riskPerTradePct', 'risk_per_trade_pct'],
      ['minProfitUsdt', 'min_profit_usdt'],
    ];
    for (const [ek, ck] of map) {
      const v = (this as any)[ek];
      if (v !== null && v !== undefined) m[ck] = v;
    }
    // Override TP templates if present
    if (this.tpTemplates?.length > 0) {
      m.tp_targets_template = [...this.tpTemplates]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({ r_multiple: t.rMultiple, ratio: t.ratio, label: t.label }));
    }
    return m;
  }
}
