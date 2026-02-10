export interface OhlcvBar {
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** EMA using span (pandas ewm(span=period, adjust=False)) */
export function ema(values: number[], period: number): number[] {
  const alpha = 2.0 / (period + 1);
  const result: number[] = new Array(values.length);
  result[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    result[i] = alpha * values[i] + (1 - alpha) * result[i - 1];
  }
  return result;
}

/** RSI using ewm(alpha=1/period, adjust=False) */
export function rsi(closes: number[], period: number): number[] {
  const n = closes.length;
  const result: number[] = new Array(n).fill(50);
  if (n < 2) return result;
  const alpha = 1.0 / period;
  const gains: number[] = new Array(n).fill(0);
  const losses: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  const gE: number[] = new Array(n);
  const lE: number[] = new Array(n);
  gE[0] = gains[0]; lE[0] = losses[0];
  for (let i = 1; i < n; i++) {
    gE[i] = alpha * gains[i] + (1 - alpha) * gE[i - 1];
    lE[i] = alpha * losses[i] + (1 - alpha) * lE[i - 1];
  }
  for (let i = 0; i < n; i++) {
    result[i] = lE[i] === 0 ? 50 : 100 - 100 / (1 + gE[i] / lE[i]);
  }
  return result;
}

/** ATR using ewm(alpha=1/period, adjust=False) */
export function atr(bars: OhlcvBar[], period: number): number[] {
  const n = bars.length;
  const result: number[] = new Array(n).fill(0);
  if (n < 2) return result;
  const tr: number[] = new Array(n);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < n; i++) {
    const pc = bars[i - 1].close;
    tr[i] = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc));
  }
  const alpha = 1.0 / period;
  result[0] = tr[0];
  for (let i = 1; i < n; i++) {
    result[i] = alpha * tr[i] + (1 - alpha) * result[i - 1];
  }
  return result;
}
