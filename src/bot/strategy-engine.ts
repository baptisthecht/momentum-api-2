import { OhlcvBar, ema, rsi, atr } from './indicators';

export enum SignalSide { LONG = 'long', SHORT = 'short' }

export interface ConditionCheck {
  side: string; conditionName: string; expectedValue: string; actualValue: string; passed: boolean;
}

export interface TpTarget { price: number; ratio: number; label: string | null; }

export interface StrategySignal {
  side: SignalSide; entryPrice: number; sl: number; tp: number;
  tpTargets: TpTarget[]; trailAtrMult: number | null;
  rMultiple: number | null; atrValue: number | null;
}

export interface EvaluationOutput {
  signal: StrategySignal | null;
  checks: ConditionCheck[];
  snapshot: { closePrice: number; rsiValue: number; atrValue: number; emaFastValue: number; emaSlowValue: number };
}

interface NormTp { rMultiple: number; ratio: number; label: string | null; }

function int(v: any): number { return Math.floor(Number(v) || 0); }
function fl(v: any): number { return Number(v) || 0; }
function bool(v: any): boolean { return typeof v === 'boolean' ? v : typeof v === 'string' ? v.toLowerCase() === 'true' : !!v; }
function normPct(v: any, fb: number): number { const r = Number(v); if (isNaN(r) || r <= 0) return fb; return r > 1 ? r / 100 : r / 100; }

export class StrategyEngine {
  readonly rsiPeriod: number; readonly rsiOB: number; readonly rsiOS: number;
  readonly emaFP: number; readonly emaSP: number;
  readonly emaTol: number; readonly priceExt: number;
  readonly reqCross: boolean; readonly reqRebLong: boolean; readonly reqRebShort: boolean;
  readonly reqTrend: boolean; readonly enaRsiLong: boolean; readonly enaRsiShort: boolean;
  readonly reqZoneLong: boolean; readonly reqZoneShort: boolean;
  readonly minTrendStr: number; readonly minDisp: number;
  readonly trendMult: number; readonly trendEma: number; readonly reqTrendConf: boolean;
  readonly atrPeriod: number; readonly atrTpM: number; readonly atrSlM: number;
  readonly tp1RM: number; readonly tp2RM: number; readonly tp1Ratio: number;
  readonly trailM: number; readonly trailOn: boolean;
  readonly minWarmup: number; readonly tpTmpl: NormTp[] | null;

  constructor(c: Record<string, any>) {
    this.rsiPeriod = int(c.rsi_period ?? 14);
    this.rsiOB = fl(c.rsi_overbought ?? 70); this.rsiOS = fl(c.rsi_oversold ?? 30);
    this.emaFP = int(c.ema_fast_period ?? 50); this.emaSP = int(c.ema_slow_period ?? 200);
    const rt = fl(c.ema_touch_tolerance_pct ?? 0.25);
    this.emaTol = rt > 1 ? rt / 100 : rt > 0 ? rt / 100 : 0.0025;
    const re = fl(c.price_extension_pct ?? 0);
    this.priceExt = re > 1 ? re / 100 : re > 0 ? re / 100 : 0;
    this.reqCross = bool(c.require_price_cross ?? true);
    const defReb = bool(c.require_rsi_rebound ?? true);
    this.reqRebLong = bool(c.require_rsi_rebound_long ?? defReb);
    this.reqRebShort = bool(c.require_rsi_rebound_short ?? defReb);
    this.reqTrend = bool(c.require_primary_trend ?? true);
    this.enaRsiLong = bool(c.enable_rsi_long ?? true);
    this.enaRsiShort = bool(c.enable_rsi_short ?? true);
    this.reqZoneLong = bool(c.require_price_zone_long ?? true);
    this.reqZoneShort = bool(c.require_price_zone_short ?? true);
    this.minTrendStr = normPct(c.min_trend_strength_pct, 0);
    this.minDisp = normPct(c.min_price_displacement_pct, 0);
    this.trendMult = Math.max(1, int(c.trend_tf_multiplier ?? 5));
    this.trendEma = int(c.trend_tf_ema_period ?? 200);
    this.reqTrendConf = bool(c.require_trend_confirmation ?? true);
    this.atrPeriod = int(c.atr_period ?? 14);
    this.atrTpM = fl(c.atr_tp_mult ?? 2); this.atrSlM = fl(c.atr_sl_mult ?? 1);
    this.tp1RM = fl(c.tp1_r_multiple ?? 1); this.tp2RM = fl(c.tp2_r_multiple ?? 2);
    this.tp1Ratio = Math.max(0, Math.min(1, fl(c.tp1_ratio ?? 0.5)));
    this.trailM = fl(c.trailing_atr_mult ?? 1); this.trailOn = bool(c.trailing_enabled ?? true);
    this.minWarmup = int(c.min_candles_warmup ?? 250);
    this.tpTmpl = this.normTpl(c.tp_targets_template ?? null);
  }

  evaluate(bars: OhlcvBar[]): EvaluationOutput {
    const empty = { closePrice: 0, rsiValue: 0, atrValue: 0, emaFastValue: 0, emaSlowValue: 0 };
    const minR = Math.max(this.minWarmup, this.emaSP + 5, this.rsiPeriod + 5);
    if (bars.length < minR) return { signal: null, checks: [], snapshot: empty };

    const cl = bars.map((b) => b.close);
    const eF = ema(cl, this.emaFP), eS = ema(cl, this.emaSP);
    const rv = rsi(cl, this.rsiPeriod), av = atr(bars, this.atrPeriod);
    const L = bars.length - 1, P = L - 1;
    const lc = cl[L], lr = rv[L], la = av[L], lef = eF[L], les = eS[L];
    const snap = { closePrice: lc, rsiValue: lr, atrValue: la, emaFastValue: lef, emaSlowValue: les };
    if (isNaN(la) || isNaN(lef) || isNaN(les) || lef <= 0) return { signal: null, checks: [], snapshot: snap };

    const tUp = lef > les, tDn = lef < les;
    let hUp = tUp, hDn = tDn, hOk = true;
    if (this.trendMult > 1 && this.reqTrendConf) {
      const h = this.htfTrend(bars);
      if (h) { hUp = h.close > h.ema; hDn = h.close < h.ema; hOk = hUp || hDn; }
    }
    const pc = cl[P], pr = rv[P], pef = eF[P];
    const near = Math.abs(lc - lef) <= Math.max(1e-6, lef * this.emaTol);
    let extOk = false;
    if (!near && this.priceExt > 0) {
      if (tUp && lc > lef) extOk = (lc - lef) <= lef * this.priceExt;
      else if (tDn && lc < lef) extOk = (lef - lc) <= lef * this.priceExt;
    }
    const zone = near || extOk;
    const cxUp = pc < pef && lc >= lef, cxDn = pc > pef && lc <= lef;
    const rebUp = lr > pr, rebDn = lr < pr;
    const disp = lc > 0 ? Math.abs(lc - lef) / lc : 0;
    const tStr = lc > 0 ? Math.abs(lef - les) / lc : 0;

    const all: ConditionCheck[] = [];

    // ── LONG ──
    const lChecks: [string, string, string, boolean][] = [];
    if (this.reqTrend) lChecks.push(['trend_up', 'true', String(tUp), tUp]);
    if (this.enaRsiLong) lChecks.push(['rsi_oversold', '≤' + this.rsiOS, lr.toFixed(2), lr <= this.rsiOS]);
    if (this.reqZoneLong) lChecks.push(['price_zone_ok', 'true', String(zone), zone]);
    if (this.reqTrendConf) { lChecks.push(['htf_trend_up', 'true', String(hUp), hUp]); lChecks.push(['htf_trend_ok', 'true', String(hOk), hOk]); }
    if (this.reqCross) lChecks.push(['price_crossed_up', 'true', String(cxUp), cxUp]);
    if (this.reqRebLong) lChecks.push(['rsi_rebound_up', 'true', String(rebUp), rebUp]);
    if (this.minTrendStr > 0) lChecks.push(['trend_strength', '≥' + this.minTrendStr, tStr.toFixed(4), tStr >= this.minTrendStr]);
    if (this.minDisp > 0) { const ok = lc <= lef && disp >= this.minDisp; lChecks.push(['price_displacement', '≥' + this.minDisp + ' & below', disp.toFixed(4) + ' (' + (lc <= lef ? 'below' : 'above') + ')', ok]); }
    for (const [n, e, a, p] of lChecks) all.push({ side: 'long', conditionName: n, expectedValue: e, actualValue: a, passed: p });

    if (lChecks.every(([, , , p]) => p)) {
      const sig = this.buildSig(SignalSide.LONG, lc, la, lef, les, lr, hUp);
      if (sig) return { signal: sig, checks: all, snapshot: snap };
    }

    // ── SHORT ──
    const sChecks: [string, string, string, boolean][] = [];
    if (this.reqTrend) sChecks.push(['trend_down', 'true', String(tDn), tDn]);
    if (this.enaRsiShort) sChecks.push(['rsi_overbought', '≥' + this.rsiOB, lr.toFixed(2), lr >= this.rsiOB]);
    if (this.reqZoneShort) sChecks.push(['price_zone_ok', 'true', String(zone), zone]);
    if (this.reqTrendConf) { sChecks.push(['htf_trend_down', 'true', String(hDn), hDn]); sChecks.push(['htf_trend_ok', 'true', String(hOk), hOk]); }
    if (this.reqCross) sChecks.push(['price_crossed_down', 'true', String(cxDn), cxDn]);
    if (this.reqRebShort) sChecks.push(['rsi_rebound_down', 'true', String(rebDn), rebDn]);
    if (this.minTrendStr > 0) sChecks.push(['trend_strength', '≥' + this.minTrendStr, tStr.toFixed(4), tStr >= this.minTrendStr]);
    if (this.minDisp > 0) { const ok = lc >= lef && disp >= this.minDisp; sChecks.push(['price_displacement', '≥' + this.minDisp + ' & above', disp.toFixed(4) + ' (' + (lc >= lef ? 'above' : 'below') + ')', ok]); }
    for (const [n, e, a, p] of sChecks) all.push({ side: 'short', conditionName: n, expectedValue: e, actualValue: a, passed: p });

    if (sChecks.every(([, , , p]) => p)) {
      const sig = this.buildSig(SignalSide.SHORT, lc, la, lef, les, lr, hUp);
      if (sig) return { signal: sig, checks: all, snapshot: snap };
    }

    return { signal: null, checks: all, snapshot: snap };
  }

  private buildSig(side: SignalSide, cl: number, la: number, ef: number, es: number, lr: number, hUp: boolean): StrategySignal | null {
    const d = side === SignalSide.LONG ? 1 : -1;
    const sl = cl - d * this.atrSlM * la;
    const distR = Math.abs(cl - sl);
    if (distR <= 0) return null;
    const tps = this.buildTps(cl, distR, side);
    if (tps.length === 0) return null;
    const tp = tps[tps.length - 1].price;
    if (side === SignalSide.SHORT && tp <= 0) return null;
    return { side, entryPrice: cl, sl, tp, tpTargets: tps, trailAtrMult: this.trailOn ? this.trailM : null, rMultiple: distR, atrValue: la };
  }

  private buildTps(e: number, dR: number, side: SignalSide): TpTarget[] {
    if (dR <= 0) return [];
    if (this.tpTmpl) { const c = this.fromTpl(this.tpTmpl, e, dR, side); if (c.length > 0) return c; }
    const dir = side === SignalSide.LONG ? 1 : -1;
    const r1 = Math.max(0, Math.min(this.tp1Ratio, 1));
    const ts: TpTarget[] = [];
    const p1 = e + dir * this.tp1RM * dR;
    if (r1 > 0 && p1 > 0) ts.push({ price: p1, ratio: r1, label: 'TP1' });
    const pf = e + dir * this.tp2RM * dR;
    if (pf <= 0) return [];
    if (r1 >= 1) { if (ts.length > 0) ts[ts.length - 1].price = pf; else ts.push({ price: pf, ratio: 1, label: 'TP1' }); return ts; }
    const rem = Math.max(0, 1 - r1);
    if (rem > 0) ts.push({ price: pf, ratio: ts.length > 0 ? rem : 1, label: 'TP' + (ts.length + 1) });
    else if (ts.length === 0) ts.push({ price: pf, ratio: 1, label: 'TP1' });
    return ts;
  }

  private fromTpl(t: NormTp[], e: number, dR: number, side: SignalSide): TpTarget[] {
    const dir = side === SignalSide.LONG ? 1 : -1;
    const out: TpTarget[] = []; let cum = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i].ratio <= 0 || t[i].rMultiple <= 0) continue;
      const p = e + dir * t[i].rMultiple * dR;
      if (p <= 0) continue;
      cum += t[i].ratio;
      out.push({ price: p, ratio: Math.min(1, t[i].ratio), label: t[i].label || 'TP' + (i + 1) });
    }
    if (cum < 1 - 1e-6 && t.length > 0) {
      const p = e + dir * t[t.length - 1].rMultiple * dR;
      if (p > 0) out.push({ price: p, ratio: 1 - cum, label: 'TP' + (out.length + 1) });
    }
    return out;
  }

  private htfTrend(bars: OhlcvBar[]): { close: number; ema: number } | null {
    if (this.trendMult <= 1) return null;
    const n = this.trendMult;
    const re: OhlcvBar[] = [];
    for (let i = 0; i + n - 1 < bars.length; i += n) {
      const g = bars.slice(i, i + n);
      re.push({ openTime: g[0].openTime, open: g[0].open, high: Math.max(...g.map((b) => b.high)), low: Math.min(...g.map((b) => b.low)), close: g[g.length - 1].close, volume: g.reduce((s, b) => s + b.volume, 0) });
    }
    const rem = bars.length % n;
    if (rem > 0) { const g = bars.slice(bars.length - rem); re.push({ openTime: g[0].openTime, open: g[0].open, high: Math.max(...g.map((b) => b.high)), low: Math.min(...g.map((b) => b.low)), close: g[g.length - 1].close, volume: g.reduce((s, b) => s + b.volume, 0) }); }
    if (re.length < this.trendEma + 2) return null;
    const c = re.map((b) => b.close);
    const e = ema(c, this.trendEma);
    return { close: c[c.length - 1], ema: e[e.length - 1] };
  }

  private normTpl(raw: any): NormTp[] | null {
    if (!raw || !Array.isArray(raw)) return null;
    const o: NormTp[] = []; let rem = 1;
    for (const e of raw) {
      if (!e) continue; const r = fl(e.ratio ?? 0), m = fl(e.r_multiple ?? 0);
      if (r <= 0 || m <= 0 || rem <= 0) continue;
      const a = Math.min(r, rem); o.push({ rMultiple: m, ratio: a, label: e.label ?? null }); rem = Math.max(0, rem - a);
    }
    return o.length > 0 ? o : null;
  }
}
