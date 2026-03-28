import { Injectable, Logger } from "@nestjs/common";
import { RestClientV2 } from "bitget-api";
import { OrderSide } from "../position/position.entity";
import { OhlcvBar } from "./indicators";

const PUBLIC_CLIENT = new RestClientV2();

// Bitget size precision per symbol (decimal places allowed)
const SIZE_PRECISION: Record<string, number> = {
	BTCUSDT: 4,
	ETHUSDT: 3,
	ADAUSDT: 0,
	SOLUSDT: 2,
	XRPUSDT: 1,
	DOGEUSDT: 0,
	BNBUSDT: 2,
	MATICUSDT: 0,
	DOTUSDT: 1,
	LINKUSDT: 2,
	AVAXUSDT: 2,
	LTCUSDT: 3,
};
const DEFAULT_SIZE_PRECISION = 4;

@Injectable()
export class BitgetClientService {
	private readonly logger = new Logger(BitgetClientService.name);

	/**
	 * Truncate quantity to the allowed decimal places for a symbol.
	 * Uses floor to avoid exceeding available balance.
	 */
	private truncateSize(symbol: string, size: number): string {
		const precision = SIZE_PRECISION[symbol] ?? DEFAULT_SIZE_PRECISION;
		const factor = Math.pow(10, precision);
		const truncated = Math.floor(size * factor) / factor;
		return truncated.toFixed(precision);
	}

	async fetchCandles(
		symbol: string,
		granularity = "5m",
		limit = 200,
		productType = "usdt-futures",
	): Promise<OhlcvBar[]> {
		try {
			const resp = await PUBLIC_CLIENT.getFuturesHistoricCandles({
				symbol,
				productType: productType as any,
				granularity: granularity as any,
				limit: String(limit),
			});
			const rows: any[] = Array.isArray(resp?.data) ? resp.data : [];
			const bars = rows
				.map((r: any) => ({
					openTime: new Date(Number(r[0])),
					open: Number(r[1]),
					high: Number(r[2]),
					low: Number(r[3]),
					close: Number(r[4]),
					volume: Number(r[5]),
				}))
				.filter((b) => !isNaN(b.close));
			bars.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
			return bars;
		} catch (err: any) {
			this.logger.error("Candle fetch failed: " + err.message);
			return [];
		}
	}

	/**
	 * Create a signed RestClientV2 from user credentials.
	 */
	private makeClient(
		apiKey: string,
		apiSecret: string,
		passphrase: string,
	): RestClientV2 {
		return new RestClientV2({
			apiKey,
			apiSecret,
			apiPass: passphrase,
		});
	}

	/**
	 * Ensure the account is in hedge mode (double_hold).
	 * Bitget returns an error if already in hedge mode — we ignore it.
	 * Must be called before placing any order.
	 */
	async ensureHedgeMode(
		apiKey: string,
		apiSecret: string,
		passphrase: string,
	): Promise<void> {
		const client = this.makeClient(apiKey, apiSecret, passphrase);
		try {
			await client.setFuturesPositionMode({
				productType: "USDT-FUTURES",
				posMode: "hedge_mode",
			});
			this.logger.log("Position mode set to hedge_mode");
		} catch (e: any) {
			// Bitget returns an error if already in hedge mode — safe to ignore
			this.logger.warn(`ensureHedgeMode: ${e.body?.msg ?? e.message}`);
		}
	}

	async placeOrder(p: {
		apiKey: string;
		apiSecret: string;
		passphrase: string;
		symbol: string;
		side: OrderSide;
		qty: number;
		leverage: number;
		sl?: number;
		tp?: number;
	}): Promise<any> {
		if (!p.apiKey || !p.apiSecret || !p.passphrase)
			throw new Error("Missing Bitget API credentials");

		// Debug: log credential shapes (never log full secrets!)
		this.logger.log(
			`Credentials: key=${p.apiKey.substring(0, 6)}...${p.apiKey.slice(-4)} (len=${p.apiKey.length}), secret=len=${p.apiSecret.length}, pass=len=${p.passphrase.length}`,
		);

		const client = this.makeClient(p.apiKey, p.apiSecret, p.passphrase);
		const isBuy = p.side === OrderSide.LONG;

		// ────────────────────────────────────────────
		// 0. Ensure hedge mode before anything else
		// ────────────────────────────────────────────
		await this.ensureHedgeMode(p.apiKey, p.apiSecret, p.passphrase);

		// ────────────────────────────────────────────
		// 1. Set leverage
		//    Hedge mode: pass holdSide ('long' or 'short')
		// ────────────────────────────────────────────
		try {
			await client.setFuturesLeverage({
				symbol: p.symbol,
				productType: "USDT-FUTURES",
				marginCoin: "USDT",
				leverage: String(p.leverage),
				holdSide: isBuy ? "long" : "short",
			});
			this.logger.log(`Leverage set to ${p.leverage}x for ${p.symbol}`);
		} catch (e: any) {
			this.logger.warn(`Leverage set warning: ${e.body?.msg ?? e.message}`);
		}

		// ────────────────────────────────────────────
		// 2. Place market order
		//    Hedge mode V2: side = 'open_long' | 'open_short', tradeSide = 'open'
		// ────────────────────────────────────────────
		const sideLabel = isBuy ? "LONG" : "SHORT";
		const sizeStr = this.truncateSize(p.symbol, p.qty);
		this.logger.log(`Placing order: ${sideLabel} ${sizeStr} ${p.symbol}`);

		try {
			const resp = await client.futuresSubmitOrder({
				symbol: p.symbol,
				productType: "USDT-FUTURES",
				marginCoin: "USDT",
				marginMode: "crossed",
				side: isBuy ? "buy" : "sell",
				tradeSide: "open" as any,
				orderType: "market",
				size: sizeStr,
				clientOid: `bot#${Date.now()}`,
			});

			this.logger.log(
				`Order placed: ${sideLabel} ${p.qty} ${p.symbol} | orderId=${resp?.data?.orderId}`,
			);

			// ────────────────────────────────────────────
			// 3. Place TP/SL as separate TPSL orders
			//    holdSide is required in hedge mode
			// ────────────────────────────────────────────
			const tpslHoldSide = isBuy ? "long" : "short";
			if (p.tp)
				await this.placeTpsl(
					client,
					p.symbol,
					sizeStr,
					tpslHoldSide,
					"profit_plan",
					p.tp,
				);
			if (p.sl)
				await this.placeTpsl(
					client,
					p.symbol,
					sizeStr,
					tpslHoldSide,
					"loss_plan",
					p.sl,
				);

			return resp;
		} catch (e: any) {
			const errMsg = e.body ? JSON.stringify(e.body) : e.message;
			throw new Error(`Order failed: ${errMsg}`);
		}
	}

	/**
	 * Place TP or SL via /api/v2/mix/order/place-tpsl-order
	 */
	private async placeTpsl(
		client: RestClientV2,
		symbol: string,
		size: string,
		holdSide: string,
		planType: string,
		triggerPrice: number,
	): Promise<void> {
		const label = planType === "profit_plan" ? "TP" : "SL";
		try {
			await client.futuresSubmitTPSLOrder({
				symbol,
				productType: "USDT-FUTURES",
				marginCoin: "USDT",
				size,
				planType: planType as any,
				holdSide: holdSide as any,
				triggerPrice: String(triggerPrice),
				triggerType: "mark_price",
			});
			this.logger.log(
				`${label} placed: ${holdSide} ${triggerPrice} for ${symbol}`,
			);
		} catch (e: any) {
			const errMsg = e.body ? JSON.stringify(e.body) : e.message;
			this.logger.warn(`${label} failed: ${errMsg}`);
		}
	}

	/**
	 * Test credentials by calling a simple authenticated endpoint.
	 */
	async testCredentials(apiKey: string, apiSecret: string, passphrase: string) {
		this.logger.log(
			`Testing credentials: key=${apiKey.substring(0, 6)}...${apiKey.slice(-4)} (len=${apiKey.length}), secret=len=${apiSecret.length}, pass=len=${passphrase.length}`,
		);

		const client = this.makeClient(apiKey, apiSecret, passphrase);
		try {
			const resp = await client.getFuturesAccountAsset({
				symbol: "BTCUSDT",
				productType: "USDT-FUTURES",
				marginCoin: "USDT",
			});
			this.logger.log("Credentials OK");
			return { ok: true, data: resp?.data };
		} catch (e: any) {
			const body = e.body ?? {};
			this.logger.error(`Credentials test failed: ${JSON.stringify(body)}`);
			return { ok: false, code: body.code, error: body.msg ?? e.message };
		}
	}
}
