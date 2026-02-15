import { Injectable, Logger } from '@nestjs/common';
import { RestClientV2 } from 'bitget-api';
import { OhlcvBar } from './indicators';
import { OrderSide } from '../position/position.entity';

const PUBLIC_CLIENT = new RestClientV2();

@Injectable()
export class BitgetClientService {
  private readonly logger = new Logger(BitgetClientService.name);

  async fetchCandles(
    symbol: string, granularity = '5m', limit = 200, productType = 'usdt-futures',
  ): Promise<OhlcvBar[]> {
    try {
      const resp = await PUBLIC_CLIENT.getFuturesHistoricCandles({
        symbol,
        productType: productType as any,
        granularity,
        limit: String(limit),
      });
      const rows: any[] = Array.isArray(resp?.data) ? resp.data : [];
      const bars = rows.map((r: any) => ({
        openTime: new Date(Number(r[0])), open: Number(r[1]), high: Number(r[2]),
        low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]),
      })).filter((b) => !isNaN(b.close));
      bars.sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
      return bars;
    } catch (err: any) {
      this.logger.error('Candle fetch failed: ' + err.message);
      return [];
    }
  }

  /**
   * Create a signed RestClientV2 from user credentials.
   */
  private makeClient(apiKey: string, apiSecret: string, passphrase: string): RestClientV2 {
    return new RestClientV2({
      apiKey,
      apiSecret,
      apiPass: passphrase,
    });
  }

  async placeOrder(p: {
    apiKey: string; apiSecret: string; passphrase: string;
    symbol: string; side: OrderSide; qty: number; leverage: number;
    sl?: number; tp?: number;
  }): Promise<any> {
    if (!p.apiKey || !p.apiSecret || !p.passphrase) throw new Error('Missing Bitget API credentials');

    // Debug: log credential shapes (never log full secrets!)
    this.logger.log(`Credentials: key=${p.apiKey.substring(0, 6)}...${p.apiKey.slice(-4)} (len=${p.apiKey.length}), secret=len=${p.apiSecret.length}, pass=len=${p.passphrase.length}`);

    const client = this.makeClient(p.apiKey, p.apiSecret, p.passphrase);
    const isBuy = p.side === OrderSide.LONG;
    const holdSide = isBuy ? 'long' : 'short';

    // ââââââââââââââââââââââââââââââââââââââââââââ
    // 1. Set leverage (matches Python ensure_leverage)
    // ââââââââââââââââââââââââââââââââââââââââââââ
    try {
      await client.setFuturesLeverage({
        symbol: p.symbol,
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
        leverage: String(p.leverage),
        holdSide: holdSide as any,
      });
      this.logger.log(`Leverage set to ${p.leverage}x for ${p.symbol} ${holdSide}`);
    } catch (e: any) {
      this.logger.warn(`Leverage set warning: ${e.body?.msg ?? e.message}`);
    }

    // ââââââââââââââââââââââââââââââââââââââââââââ
    // 2. Place market order (matches Python place_order exactly)
    //    side: "buy" or "sell" â one-way mode, no tradeSide
    // ââââââââââââââââââââââââââââââââââââââââââââ
    const sideLabel = isBuy ? 'LONG' : 'SHORT';
    this.logger.log(`Placing order: ${sideLabel} ${p.qty} ${p.symbol}`);

    try {
      const resp = await client.futuresSubmitOrder({
        symbol: p.symbol,
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
        marginMode: 'crossed',
        side: isBuy ? 'buy' : 'sell',
        orderType: 'market',
        size: String(p.qty),
        clientOid: `bot#${Date.now()}`,
      });

      this.logger.log(`Order placed: ${sideLabel} ${p.qty} ${p.symbol} | orderId=${resp?.data?.orderId}`);

      // ââââââââââââââââââââââââââââââââââââââââââââ
      // 3. Place TP/SL as separate TPSL orders (matches Python _submit_tpsl_orders)
      // ââââââââââââââââââââââââââââââââââââââââââââ
      if (p.tp) await this.placeTpsl(client, p.symbol, p.qty, holdSide, 'profit_plan', p.tp);
      if (p.sl) await this.placeTpsl(client, p.symbol, p.qty, holdSide, 'loss_plan', p.sl);

      return resp;
    } catch (e: any) {
      const errMsg = e.body ? JSON.stringify(e.body) : e.message;
      throw new Error(`Order failed: ${errMsg}`);
    }
  }

  /**
   * Place TP or SL via /api/v2/mix/order/place-tpsl-order
   * Matches Python place_tpsl_order() exactly.
   */
  private async placeTpsl(
    client: RestClientV2, symbol: string, size: number,
    holdSide: string, planType: string, triggerPrice: number,
  ): Promise<void> {
    const label = planType === 'profit_plan' ? 'TP' : 'SL';
    try {
      await client.futuresSubmitTPSLOrder({
        symbol,
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
        size: String(size),
        planType: planType as any,
        holdSide: holdSide as any,
        triggerPrice: String(triggerPrice),
        triggerType: 'market_price',
      });
      this.logger.log(`${label} placed: ${holdSide} ${triggerPrice} for ${symbol}`);
    } catch (e: any) {
      const errMsg = e.body ? JSON.stringify(e.body) : e.message;
      this.logger.warn(`${label} failed: ${errMsg}`);
    }
  }

  /**
   * Test credentials by calling a simple authenticated endpoint.
   */
  async testCredentials(apiKey: string, apiSecret: string, passphrase: string) {
    this.logger.log(`Testing credentials: key=${apiKey.substring(0, 6)}...${apiKey.slice(-4)} (len=${apiKey.length}), secret=len=${apiSecret.length}, pass=len=${passphrase.length}`);

    const client = this.makeClient(apiKey, apiSecret, passphrase);
    try {
      const resp = await client.getFuturesAccountAsset({
        symbol: 'BTCUSDT',
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
      });
      this.logger.log('Credentials OK');
      return { ok: true, data: resp?.data };
    } catch (e: any) {
      const body = e.body ?? {};
      this.logger.error(`Credentials test failed: ${JSON.stringify(body)}`);
      return { ok: false, code: body.code, error: body.msg ?? e.message };
    }
  }
}
