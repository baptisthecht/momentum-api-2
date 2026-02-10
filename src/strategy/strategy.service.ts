import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy } from './strategy.entity';
import { StrategyTpTemplate } from './strategy-tp-template.entity';
import { SymbolOverride } from './symbol-override.entity';
import { SymbolOverrideTpTemplate } from './symbol-override-tp-template.entity';

// ── Default seeding data from settings.yaml ──
const SYMBOL_OVERRIDES: Record<string, Record<string, any>> = {
  BTCUSDT: { rsiOversold: 36, rsiOverbought: 64, emaTouchTolerancePct: 1.0, priceExtensionPct: 0.6, requirePriceCross: false, tpTemplates: null },
  ETHUSDT: {
    rsiOversold: 29, rsiOverbought: 69, emaTouchTolerancePct: 1.1, priceExtensionPct: 0.45,
    requirePriceCross: false, requireRsiRebound: true, requireRsiReboundLong: true,
    requirePriceZoneLong: false, requirePriceZoneShort: false, minTrendStrengthPct: 0.32,
    atrSlMult: 1.5, atrTpMult: 3.0, trailingAtrMult: 1.2,
    tpTemplates: [{ rMultiple: 0.6, ratio: 0.4 }, { rMultiple: 1.2, ratio: 0.35 }, { rMultiple: 2.0, ratio: 0.25 }],
  },
  SOLUSDT: {
    rsiOversold: 30, rsiOverbought: 71, emaTouchTolerancePct: 0.65, priceExtensionPct: 0.32,
    requirePrimaryTrend: false, requireRsiRebound: true, requireRsiReboundLong: true, requireRsiReboundShort: true,
    requirePriceZoneLong: true, requirePriceZoneShort: true, minTrendStrengthPct: 0.35,
    atrSlMult: 1.5, atrTpMult: 5.0, trailingAtrMult: 1.3,
    tpTemplates: [{ rMultiple: 0.55, ratio: 0.4 }, { rMultiple: 1.05, ratio: 0.35 }, { rMultiple: 1.75, ratio: 0.25 }],
  },
  XRPUSDT: {
    enableRsiShort: true, enableRsiLong: true, rsiOversold: 30, rsiOverbought: 68,
    emaTouchTolerancePct: 0.7, priceExtensionPct: 0.4, requireRsiRebound: true,
    requirePriceZoneLong: true, atrSlMult: 1.5, atrTpMult: 4.0, minTrendStrengthPct: 0.32, trailingAtrMult: 1.6,
    tpTemplates: [{ rMultiple: 0.7, ratio: 0.5 }, { rMultiple: 1.4, ratio: 0.3 }, { rMultiple: 2.2, ratio: 0.2 }],
  },
  ADAUSDT: {
    enableRsiShort: true, enableRsiLong: true, rsiOversold: 31, rsiOverbought: 68,
    emaTouchTolerancePct: 0.8, priceExtensionPct: 0.4, requireRsiRebound: true,
    requirePriceZoneLong: true, atrSlMult: 1.5, atrTpMult: 4.5, minTrendStrengthPct: 0.32, trailingAtrMult: 1.3,
    tpTemplates: [{ rMultiple: 0.7, ratio: 0.5 }, { rMultiple: 1.4, ratio: 0.3 }, { rMultiple: 2.2, ratio: 0.2 }],
  },
};

@Injectable()
export class StrategyService implements OnModuleInit {
  private readonly logger = new Logger(StrategyService.name);

  constructor(
    @InjectRepository(Strategy) private readonly strategyRepo: Repository<Strategy>,
    @InjectRepository(StrategyTpTemplate) private readonly tpRepo: Repository<StrategyTpTemplate>,
    @InjectRepository(SymbolOverride) private readonly overrideRepo: Repository<SymbolOverride>,
    @InjectRepository(SymbolOverrideTpTemplate) private readonly overrideTpRepo: Repository<SymbolOverrideTpTemplate>,
  ) {}

  async onModuleInit() {
    const existing = await this.strategyRepo.findOne({ where: { isDefault: true } });
    if (existing) return;

    this.logger.log('Seeding default strategy...');

    const strategy = await this.strategyRepo.save(this.strategyRepo.create({
      name: 'EMA+RSI+ATR Momentum',
      description: 'Default momentum strategy with EMA50/200 trend filter, RSI entries, ATR-based SL/TP.',
      isDefault: true,
    }));

    // Default TP templates
    const defaultTps = [
      { rMultiple: 0.8, ratio: 0.4 },
      { rMultiple: 1.5, ratio: 0.35 },
      { rMultiple: 2.2, ratio: 0.25 },
    ];
    for (let i = 0; i < defaultTps.length; i++) {
      await this.tpRepo.save(this.tpRepo.create({
        strategyId: strategy.id, sortOrder: i,
        rMultiple: defaultTps[i].rMultiple, ratio: defaultTps[i].ratio,
      }));
    }

    // Symbol overrides
    for (const [symbol, params] of Object.entries(SYMBOL_OVERRIDES)) {
      const { tpTemplates: tps, ...overrideFields } = params;
      const override = await this.overrideRepo.save(this.overrideRepo.create({
        strategyId: strategy.id, symbol, ...overrideFields,
      }));
      if (Array.isArray(tps)) {
        for (let i = 0; i < tps.length; i++) {
          await this.overrideTpRepo.save(this.overrideTpRepo.create({
            symbolOverrideId: override.id, sortOrder: i,
            rMultiple: tps[i].rMultiple, ratio: tps[i].ratio,
          }));
        }
      }
    }

    this.logger.log('Default strategy seeded with symbol overrides');
  }

  findAll() { return this.strategyRepo.find({ order: { createdAt: 'ASC' }, relations: ['tpTemplates', 'symbolOverrides', 'symbolOverrides.tpTemplates'] }); }
  findById(id: string) { return this.strategyRepo.findOne({ where: { id }, relations: ['tpTemplates', 'symbolOverrides', 'symbolOverrides.tpTemplates'] }); }
  findDefault() { return this.strategyRepo.findOne({ where: { isDefault: true }, relations: ['tpTemplates', 'symbolOverrides', 'symbolOverrides.tpTemplates'] }); }

  /** Resolve config for a specific symbol: base strategy → symbol override */
  async resolveConfigForSymbol(strategyId: string, symbol: string): Promise<Record<string, any>> {
    const strategy = await this.findById(strategyId);
    if (!strategy) throw new Error('Strategy not found');
    const base = strategy.toEngineConfig();
    const override = strategy.symbolOverrides?.find((o) => o.symbol === symbol);
    return override ? override.applyTo(base) : base;
  }
}
