import { Injectable, Logger } from "@nestjs/common";
import { RestClientV2 } from "bitget-api";
import { OrderSide } from "../position/position.entity";
import { OhlcvBar } from "./indicators";

const PUBLIC_CLIENT = new RestClientV2();

// Bitget size precision per symbol (decimal places allowed for qty)
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

// Bitget price precision per symbol (decimal places allowed for trigger prices)
const PRICE_PRECISION: Record<string, number> = {
	BTCUSDT: 1,
	ETHUSDT: 2,
	ADAUSDT: 4,
	SOLUSDT: 2,
	XRPUSDT: 4,
	DOGEUSDT: 5,
	BNBUSDT: 2,
	MATICUSDT: 4,
	DOTUSDT: 3,
	LINKUSDT: 3,
	AVAXUSDT: 2,
	LTCUSDT: 2,
};
const DEFAULT_PRICE_PRECISION = 2;

export interface TpTarget {
	price: number;
	ratio: number;
}

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

	/**
	 * Round price to the allowed decimal places for a symbol.
	 * Uses round (not floor) to stay close to the intended price.
	 */
	private roundPrice(symbol: string, price: number): string {
		const precision = PRICE_PRECISION[symbol] ?? DEFAULT_PRICE_PRECISION;
		return price.toFixed(precision);
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
	 * Bitget returns an error if already in hedge mode â we ignore it.
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
		tpTargets?: TpTarget[];
	}): Promise<any> {
		if (!p.apiKey || !p.apiSecret || !p.passphrase)
			throw new Error("Missing Bitget API credentials");

		this.logger.log(
			`Credentials: key=${p.apiKey.substring(0, 6)}...${p.apiKey.slice(-4)} (len=${p.apiKey.length}), secret=len=${p.apiSecret.length}, pass=len=${p.passphrase.length}`,
		);

		const client = this.makeClient(p.apiKey, p.apiSecret, p.passphrase);
		const isBuy = p.side === OrderSide.LONG;
		const holdSide = isBuy ? "long" : "short";

		// 0. Ensure hedge mode
		await this.ensureHedgeMode(p.apiKey, p.apiSecret, p.passphrase);

		// 1. Set leverage (hedge mode requires holdSide)
		try {
			await client.setFuturesLeverage({
				symbol: p.symbol,
				productType: "USDT-FUTURES",
				marginCoin: "USDT",
				leverage: String(p.leverage),
				holdSide: holdSide as any,
			});
			this.logger.log(`Leverage set to ${p.leverage}x for ${p.symbol}`);
		} catch (e: any) {
			this.logger.warn(`Leverage set warning: ${e.body?.msg ?? e.message}`);
		}

		// 2. Place market order
		const sizeStr = this.truncateSize(p.symbol, p.qty);
		const sideLabel = isBuy ? "LONG" : "SHORT";
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
				`Order placed: ${sideLabel} ${sizeStr} ${p.symbol} | orderId=${resp?.data?.orderId}`,
			);

			// 3. SL â full position qty, price rounded to symbol precision
			if (p.sl) {
				await this.placeTpsl(client, p.symbol, sizeStr, holdSide, "loss_plan", p.sl);
			}

			// 4. TP â one order per target with proportional qty
			//    Falls back to single TP if no tpTargets provided
			if (p.tpTargets && p.tpTargets.length > 0) {
				const totalQty = parseFloat(sizeStr);
				let remainingRatio = 1;
				for (let i = 0; i < p.tpTargets.length; i++) {
					const target = p.tpTargets[i];
					const isLast = i === p.tpTargets.length - 1;
					const ratio = isLast ? remainingRatio : Math.min(target.ratio, remainingRatio);
					const targetSizeStr = this.truncateSize(p.symbol, totalQty * ratio);
					if (parseFloat(targetSizeStr) <= 0) continue;
					await this.placeTpsl(client, p.symbol, targetSizeStr, holdSide, "profit_plan", target.price);
					remainingRatio = Math.max(0, remainingRatio - ratio);
					if (remainingRatio <= 1e-6) break;
				}
			} else if (p.tp) {
				await this.placeTpsl(client, p.symbol, sizeStr, holdSide, "profit_plan", p.tp);
			}

			return resp;
		} catch (e: any) {
			const errMsg = e.body ? JSON.stringify(e.body) : e.message;
			throw new Error(`Order failed: ${errMsg}`);
		}
	}

	/**
	 * Place a single TP or SL via /api/v2/mix/order/place-tpsl-order
	 * Prices are rounded to the symbol's allowed precision.
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
		const priceStr = this.roundPrice(symbol, triggerPrice);
		try {
			await client.futuresSubmitTPSLOrder({
				symbol,
				productType: "USDT-FUTURES",
				marginCoin: "USDT",
				size,
				planType: planType as any,
				holdSide: holdSide as any,
				triggerPrice: priceStr,
				triggerType: "mark_price",
			});
			this.logger.log(
				`${label} placed: holdSide=${holdSide} price=${priceStr} qty=${size} for ${symbol}`,
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
