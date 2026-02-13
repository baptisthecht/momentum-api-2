import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebSocket } from 'ws';

const WS_URL = 'wss://ws.bitget.com/v2/ws/public';

export const TRACKED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'];
export const GRANULARITY = '5m';

export interface CandleEvent {
  symbol: string;
  granularity: string;
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

@Injectable()
export class BitgetWsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BitgetWsService.name);
  private ws: WebSocket | null = null;
  private alive = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Track the last closed candle openTime per symbol.
   * On WS reconnect, Bitget sends a snapshot of ALL recent candles with confirm=1.
   * Without this guard, we'd emit 500 candle.closed events in <1 second.
   * We only emit candle.closed for NEW candles (openTime > lastProcessed).
   */
  private lastClosedTime = new Map<string, number>();

  constructor(private readonly events: EventEmitter2) {}

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.alive = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }

  private connect() {
    if (!this.alive) return;
    this.log.log('Connecting to Bitget WS...');

    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      this.log.log('WS connected — subscribing to candle channels');
      this.subscribe();
      this.startPing();
    });

    this.ws.on('message', (raw: Buffer | string) => {
      try {
        const str = raw.toString();
        if (str === 'pong') return;

        const msg = JSON.parse(str);
        if (msg.event === 'subscribe') return;

        if (msg.arg?.channel?.startsWith('candle') && Array.isArray(msg.data)) {
          this.onCandleData(msg.arg.instId, msg.data);
        }
      } catch (e: any) {
        this.log.error('WS parse: ' + e.message);
      }
    });

    this.ws.on('close', (code: number) => {
      this.log.warn('WS closed (code=' + code + ')');
      this.stopPing();
      this.scheduleReconnect();
    });

    this.ws.on('error', (e: Error) => {
      this.log.error('WS error: ' + e.message);
    });
  }

  private subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const args = TRACKED_SYMBOLS.map((s) => ({
      instType: 'USDT-FUTURES', channel: 'candle' + GRANULARITY, instId: s,
    }));
    this.ws.send(JSON.stringify({ op: 'subscribe', args }));
    this.log.log('Subscribed: ' + TRACKED_SYMBOLS.join(', '));
  }

  /**
   * Bitget v2 candle format per row:
   * [ts, open, high, low, close, volCoin, volUsdt, confirm]
   * confirm = "1" → candle closed, "0" → in progress
   */
  private onCandleData(symbol: string, data: any[]) {
    for (const row of data) {
      const openTimeMs = Number(row[0]);
      const candle: CandleEvent = {
        symbol, granularity: GRANULARITY,
        openTime: new Date(openTimeMs),
        open: Number(row[1]), high: Number(row[2]),
        low: Number(row[3]), close: Number(row[4]),
        volume: Number(row[5]),
      };
      const confirm = String(row[7] ?? '0');

      if (confirm === '1') {
        // Deduplicate: only emit if this candle is NEWER than the last one we processed.
        // On reconnect, Bitget sends a snapshot of ALL recent candles with confirm=1.
        const lastTs = this.lastClosedTime.get(symbol) ?? 0;
        if (openTimeMs <= lastTs) {
          // Already processed this candle (or an older one) — store but don't trigger sessions
          this.events.emit('candle.update', candle);
          continue;
        }
        this.lastClosedTime.set(symbol, openTimeMs);
        this.events.emit('candle.closed', candle);
      } else {
        this.events.emit('candle.update', candle);
      }
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('ping');
    }, 25_000);
  }

  private stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private scheduleReconnect() {
    if (!this.alive) return;
    const d = 3000 + Math.random() * 2000;
    this.log.log('Reconnecting in ' + Math.round(d) + 'ms...');
    this.reconnectTimer = setTimeout(() => this.connect(), d);
  }
}
