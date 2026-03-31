import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { WebSocket } from "ws";

const WS_URL = "wss://ws.bitget.com/v2/ws/public";

export interface MarkPriceEvent {
	symbol: string;
	markPrice: number;
	ts: Date;
}

/**
 * Dedicated WebSocket service for mark price updates (~100ms).
 * Bitget sends mark price via the "markPrice" channel on USDT-FUTURES.
 * Used by PositionManagerService to check TP levels in real-time.
 */
@Injectable()
export class BitgetMarkPriceWsService implements OnModuleInit, OnModuleDestroy {
	private readonly log = new Logger(BitgetMarkPriceWsService.name);
	private ws: WebSocket | null = null;
	private alive = true;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;

	/** Symbols currently subscribed */
	private subscribedSymbols = new Set<string>();

	/** Latest mark price per symbol (cache) */
	private latestPrices = new Map<string, number>();

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

	// ── Public API ──────────────────────────────────────────────

	/**
	 * Subscribe to mark price updates for a symbol.
	 * Safe to call multiple times for the same symbol.
	 */
	subscribe(symbol: string) {
		if (this.subscribedSymbols.has(symbol)) return;
		this.subscribedSymbols.add(symbol);
		this.log.log(`Subscribing to mark price: ${symbol}`);
		this.sendSubscribe([symbol]);
	}

	/**
	 * Unsubscribe from a symbol when no more positions are open.
	 */
	unsubscribe(symbol: string) {
		if (!this.subscribedSymbols.has(symbol)) return;
		this.subscribedSymbols.delete(symbol);
		this.latestPrices.delete(symbol);
		this.log.log(`Unsubscribing from mark price: ${symbol}`);
		this.sendUnsubscribe([symbol]);
	}

	/**
	 * Get the latest cached mark price for a symbol.
	 */
	getMarkPrice(symbol: string): number | null {
		return this.latestPrices.get(symbol) ?? null;
	}

	// ── WebSocket internals ──────────────────────────────────────

	private connect() {
		if (!this.alive) return;
		this.log.log("Connecting to Bitget mark price WS...");
		this.ws = new WebSocket(WS_URL);

		this.ws.on("open", () => {
			this.log.log("Mark price WS connected");
			// Re-subscribe to all symbols after reconnect
			if (this.subscribedSymbols.size > 0) {
				this.sendSubscribe([...this.subscribedSymbols]);
			}
			this.startPing();
		});

		this.ws.on("message", (raw: Buffer | string) => {
			try {
				const str = raw.toString();
				if (str === "pong") return;
				const msg = JSON.parse(str);
				if (msg.event === "subscribe" || msg.event === "unsubscribe") return;
				if (msg.arg?.channel === "markPrice" && Array.isArray(msg.data)) {
					this.onMarkPriceData(msg.arg.instId, msg.data);
				}
			} catch (e: any) {
				this.log.error("Mark price WS parse error: " + e.message);
			}
		});

		this.ws.on("close", (code: number) => {
			this.log.warn(`Mark price WS closed (code=${code})`);
			this.stopPing();
			this.scheduleReconnect();
		});

		this.ws.on("error", (e: Error) => {
			this.log.error("Mark price WS error: " + e.message);
		});
	}

	private onMarkPriceData(symbol: string, data: any[]) {
		for (const row of data) {
			const markPrice = Number(row.markPx ?? row.markPrice ?? 0);
			if (!markPrice || isNaN(markPrice)) continue;

			this.latestPrices.set(symbol, markPrice);

			const event: MarkPriceEvent = {
				symbol,
				markPrice,
				ts: new Date(Number(row.ts ?? Date.now())),
			};
			this.events.emit("markprice.update", event);
		}
	}

	private sendSubscribe(symbols: string[]) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		const args = symbols.map((s) => ({
			instType: "USDT-FUTURES",
			channel: "markPrice",
			instId: s,
		}));
		this.ws.send(JSON.stringify({ op: "subscribe", args }));
	}

	private sendUnsubscribe(symbols: string[]) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		const args = symbols.map((s) => ({
			instType: "USDT-FUTURES",
			channel: "markPrice",
			instId: s,
		}));
		this.ws.send(JSON.stringify({ op: "unsubscribe", args }));
	}

	private startPing() {
		this.stopPing();
		this.pingTimer = setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("ping");
		}, 25_000);
	}

	private stopPing() {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}

	private scheduleReconnect() {
		if (!this.alive) return;
		const d = 3000 + Math.random() * 2000;
		this.reconnectTimer = setTimeout(() => this.connect(), d);
	}
}
