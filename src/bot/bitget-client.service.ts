import { Injectable, Logger } from '@nestjs/common';
import { OhlcvBar } from './indicators';
import { OrderSide } from '../position/position.entity';

const BASE = 'https://api.bitget.com';

@Injectable()
export class BitgetClientService {
  private readonly logger = new Logger(BitgetClientService.name);

  async fetchCandles(
    symbol: string, granularity = '5m', limit = 200, productType = 'usdt-futures',
  ): Promise<OhlcvBar[]> {
    const axios = (await import('axios')).default;
    try {
      const resp = await axios.get(BASE + '/api/v2/mix/market/history-candles', {
        params: { symbol, productType, granularity, limit: String(limit) }, timeout: 10000,
      });
      const rows: any[] = Array.isArray(resp.data?.data) ? resp.data.data : [];
      const bars = rows.map((r) => ({
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
   * Build signed headers for Bitget V2 API.
   * Signature: base64( HMAC-SHA256( secret, timestamp + METHOD + path + body ) )
   * Matches Python BitgetAuthClient._sign() exactly.
   */
  private async makeHeaders(
    apiSecret: string, apiKey: string, passphrase: string,
    method: string, path: string, bodyStr: string,
  ) {
    const crypto = await import('crypto');
    const ts = String(Date.now());
    // Python: base64.b64encode( hmac.new(secret, content, sha256).digest() )
    const sig = crypto.createHmac('sha256', apiSecret)
      .update(ts + method + path + bodyStr)
      .digest('base64');
    return {
      headers: {
        'ACCESS-KEY': apiKey,
        'ACCESS-SIGN': sig,
        'ACCESS-TIMESTAMP': ts,
        'ACCESS-PASSPHRASE': passphrase,
        'Content-Type': 'application/json',
      },
      timestamp: ts,
    };
  }

  async placeOrder(p: {
    apiKey: string; apiSecret: string; passphrase: string;
    symbol: string; side: OrderSide; qty: number; leverage: number;
    sl?: number; tp?: number;
  }): Promise<any> {
    const axios = (await import('axios')).default;
    if (!p.apiKey || !p.apiSecret || !p.passphrase) throw new Error('Missing Bitget API credentials');

    const isBuy = p.side === OrderSide.LONG;

    // ââââââââââââââââââââââââââââââââââââââââââââ
    // 1. Set leverage (same as Python ensure_leverage)
    // ââââââââââââââââââââââââââââââââââââââââââââ
    try {
      const levPath = '/api/v2/mix/account/set-leverage';
      const levBody: Record<string, any> = {
        symbol: p.symbol,
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
        leverage: String(p.leverage),
        marginMode: 'crossed',
      };
      // Python: hold_side only in hedge mode. We pass it for safety.
      levBody.holdSide = isBuy ? 'long' : 'short';

      const levStr = JSON.stringify(levBody);
      const { headers: levHeaders } = await this.makeHeaders(
        p.apiSecret, p.apiKey, p.passphrase, 'POST', levPath, levStr,
      );
      await axios.post(BASE + levPath, levBody, { headers: levHeaders, timeout: 10000 });
      this.logger.log(`Leverage set to ${p.leverage}x for ${p.symbol} ${p.side}`);
    } catch (e: any) {
      const errData = e.response?.data ?? {};
      this.logger.warn(`Leverage set warning: ${errData.msg ?? e.message}`);
    }

    // ââââââââââââââââââââââââââââââââââââââââââââ
    // 2. Place order â matches Python place_order() exactly
    //    Python body: { productType, symbol, marginCoin, size, side, orderType, marginMode, clientOid }
    //    Python side: "buy" or "sell" (one-way mode)
    //    Python: NO presetStopSurplusPrice in body (TP/SL are separate TPSL orders)
    // ââââââââââââââââââââââââââââââââââââââââââââ
    const path = '/api/v2/mix/order/place-order';
    const clientOid = `bot#${Date.now()}`;
    const body: Record<string, any> = {
      productType: 'USDT-FUTURES',
      symbol: p.symbol,
      marginCoin: 'USDT',
      size: String(p.qty),
      side: isBuy ? 'buy' : 'sell',
      orderType: 'market',
      marginMode: 'crossed',
      clientOid,
    };

    const bodyStr = JSON.stringify(body);
    const sideLabel = isBuy ? 'LONG' : 'SHORT';
    this.logger.log(`Placing order: ${sideLabel} ${p.qty} ${p.symbol} | Body: ${bodyStr}`);

    const { headers } = await this.makeHeaders(
      p.apiSecret, p.apiKey, p.passphrase, 'POST', path, bodyStr,
    );

    try {
      const resp = await axios.post(BASE + path, body, { headers, timeout: 10000 });
      if (resp.data?.code !== '00000') {
        throw new Error('Bitget rejected: ' + JSON.stringify(resp.data));
      }
      this.logger.log(`Order placed: ${sideLabel} ${p.qty} ${p.symbol} | orderId=${resp.data?.data?.orderId}`);

      // ââââââââââââââââââââââââââââââââââââââââââââ
      // 3. Place TP/SL as separate TPSL orders (same as Python _submit_tpsl_orders)
      //    Uses /api/v2/mix/order/place-tpsl-order
      // ââââââââââââââââââââââââââââââââââââââââââââ
      const holdSide = isBuy ? 'long' : 'short';
      if (p.tp) await this.placeTpsl(p, p.symbol, p.qty, holdSide, 'profit_plan', p.tp);
      if (p.sl) await this.placeTpsl(p, p.symbol, p.qty, holdSide, 'loss_plan', p.sl);

      return resp.data;
    } catch (e: any) {
      const errData = e.response?.data;
      const errMsg = errData ? JSON.stringify(errData) : e.message;
      throw new Error(`Order failed [${e.response?.status ?? '?'}]: ${errMsg}`);
    }
  }

  /**
   * Place a TP or SL order via the TPSL endpoint.
   * Matches Python place_tpsl_order() exactly.
   */
  private async placeTpsl(
    creds: { apiKey: string; apiSecret: string; passphrase: string },
    symbol: string, size: number, holdSide: string,
    planType: string, triggerPrice: number,
  ): Promise<void> {
    const axios = (await import('axios')).default;
    const tpslPath = '/api/v2/mix/order/place-tpsl-order';
    const label = planType === 'profit_plan' ? 'TP' : 'SL';

    const tpslBody: Record<string, any> = {
      productType: 'USDT-FUTURES',
      symbol,
      marginCoin: 'USDT',
      size: String(size),
      planType,
      holdSide,
      triggerPrice: String(triggerPrice),
      triggerType: 'market_price',
    };

    const tpslStr = JSON.stringify(tpslBody);
    const { headers } = await this.makeHeaders(
      creds.apiSecret, creds.apiKey, creds.passphrase, 'POST', tpslPath, tpslStr,
    );

    try {
      const resp = await axios.post(BASE + tpslPath, tpslBody, { headers, timeout: 10000 });
      if (resp.data?.code !== '00000') {
        this.logger.warn(`${label} order warning: ${JSON.stringify(resp.data)}`);
      } else {
        this.logger.log(`${label} placed: ${holdSide} ${triggerPrice} for ${symbol}`);
      }
    } catch (e: any) {
      const errData = e.response?.data;
      this.logger.warn(`${label} failed: ${errData ? JSON.stringify(errData) : e.message}`);
    }
  }
}
