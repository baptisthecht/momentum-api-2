import {
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { OhlcvBar } from "./indicators";

const WS_URL = "wss://ws.bitget.com/v2/ws/public";
const TRACKED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT"];
const GRANULARITY = "candle5m";
const INST_TYPE = "USDT-FUTURES";

/**
 * Persistent WebSocket connection to Bitget public API.
 *
 * - Subscribes to candle5m for all tracked symbols
 * - Detects candle close (new candle timestamp !== previous)
 * - Emits 'candle.closed' event with the completed bar
 * - Auto-reconnects with exponential backoff
 * - Sends ping every 25s to keep alive
 */
@Injectable()
export class BitgetWsService implements OnModuleInit, OnModuleDestroy {
	private readonly log = new Logger(BitgetWsService.name);
	private ws: any = null; // WebSocket instance
	private stopped = false;
	private reconnectDelay = 1000;
	private pingInterval: ReturnType<typeof setInterval> | null = null;

	/**
	 * Track current (in-progress) candle per symbol.
	 * When a message arrives with a DIFFERENT openTime, the previous candle is closed.
	 */
	private currentCandles = new Map<
		string,
		{ openTime: number; bar: OhlcvBar }
	>();

	constructor(private readonly events: EventEmitter2) {}

	async onModuleInit() {
		this.stopped = false;
		this.connect();
	}

	onModuleDestroy() {
		this.stopped = true;
		this.cleanup();
	}

	private async connect() {
		if (this.stopped) return;

		let WebSocket: any;
		try {
			const wsModule = await import("ws");
			// ESM interop: default export or module itself (CJS)
			WebSocket = (wsModule as any).default ?? wsModule;
		} catch {
			this.log.error("ws package not installed — npm install ws");
			return;
		}

		try {
			this.log.log("Connecting to Bitget WebSocket...");
			this.ws = new WebSocket(WS_URL);

			this.ws.on("open", () => {
				this.log.log("WebSocket connected");
				this.reconnectDelay = 1000;
				this.subscribe();
				this.startPing();
			});

			this.ws.on("message", (data: any) => {
				this.handleMessage(typeof data === "string" ? data : data.toString());
			});

			this.ws.on("close", (code: number, reason: string) => {
				this.log.warn(`WebSocket closed: ${code} ${reason}`);
				this.cleanup();
				this.scheduleReconnect();
			});

			this.ws.on("error", (err: any) => {
				this.log.error("WebSocket error: " + err.message);
			});
		} catch (err: any) {
			this.log.error("Connection failed: " + err.message);
			this.scheduleReconnect();
		}
	}

	private subscribe() {
		if (!this.ws) return;
		const args = TRACKED_SYMBOLS.map((symbol) => ({
			instType: INST_TYPE,
			channel: GRANULARITY,
			instId: symbol,
		}));
		this.ws.send(JSON.stringify({ op: "subscribe", args }));
		this.log.log(
			`Subscribed to ${GRANULARITY} for ${TRACKED_SYMBOLS.join(", ")}`,
		);
	}

	private startPing() {
		this.stopPing();
		this.pingInterval = setInterval(() => {
			if (this.ws?.readyState === 1) this.ws.send("ping");
		}, 25000);
	}

	private stopPing() {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}

	private cleanup() {
		this.stopPing();
		if (this.ws) {
			try {
				this.ws.close();
			} catch {}
			this.ws = null;
		}
	}

	private scheduleReconnect() {
		if (this.stopped) return;
		const delay = Math.min(this.reconnectDelay, 30000);
		this.log.log(`Reconnecting in ${delay}ms...`);
		setTimeout(() => this.connect(), delay);
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
	}

	private handleMessage(raw: string) {
		if (raw === "pong") return;

		let msg: any;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}

		const arg = msg?.arg;
		const data = msg?.data;
		if (
			!arg?.channel ||
			!arg?.instId ||
			!Array.isArray(data) ||
			data.length === 0
		)
			return;
		if (!arg.channel.startsWith("candle")) return;

		const symbol: string = arg.instId;

		for (const row of data) {
			try {
				const openTimeMs = Number(row[0]);
				const bar: OhlcvBar = {
					openTime: new Date(openTimeMs),
					open: Number(row[1]),
					high: Number(row[2]),
					low: Number(row[3]),
					close: Number(row[4]),
					volume: Number(row[5]) || 0,
				};

				const current = this.currentCandles.get(symbol);

				if (!current) {
					// First candle for this symbol — just store it
					this.currentCandles.set(symbol, { openTime: openTimeMs, bar });
				} else if (openTimeMs !== current.openTime) {
					// New candle arrived → the PREVIOUS candle is now CLOSED
					const closedBar = current.bar;

					// Emit the closed candle event
					this.events.emit("candle.closed", { symbol, bar: closedBar });

					// Store the new in-progress candle
					this.currentCandles.set(symbol, { openTime: openTimeMs, bar });
				} else {
					// Same candle, update OHLCV (in-progress update)
					current.bar.high = Math.max(current.bar.high, bar.high);
					current.bar.low = Math.min(current.bar.low, bar.low);
					current.bar.close = bar.close;
					current.bar.volume = bar.volume;
				}
			} catch {}
		}
	}
}
