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

  async placeOrder(p: {
    apiKey: string; apiSecret: string; passphrase: string;
    symbol: string; side: OrderSide; qty: number; leverage: number;
    sl?: number; tp?: number;
  }): Promise<any> {
    const axios = (await import('axios')).default;
    const crypto = await import('crypto');
    if (!p.apiKey || !p.apiSecret || !p.passphrase) throw new Error('Missing Bitget API credentials');

    const makeHeaders = (method: string, path: string, bodyStr: string) => {
      const ts = String(Date.now());
      const sig = crypto.createHmac('sha256', p.apiSecret).update(ts + method + path + bodyStr).digest('base64');
      return {
        'ACCESS-KEY': p.apiKey, 'ACCESS-SIGN': sig,
        'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': p.passphrase,
        'Content-Type': 'application/json',
      };
    };

    // 1. Set leverage before placing order
    try {
      const levPath = '/api/v2/mix/account/set-leverage';
      const levBody = JSON.stringify({
        symbol: p.symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT',
        leverage: String(p.leverage), holdSide: p.side === OrderSide.LONG ? 'long' : 'short',
      });
      await axios.post(BASE + levPath, JSON.parse(levBody), {
        headers: makeHeaders('POST', levPath, levBody), timeout: 10000,
      });
      this.logger.log(`Leverage set to ${p.leverage}x for ${p.symbol} ${p.side}`);
    } catch (e: any) {
      const errData = e.response?.data ?? {};
      this.logger.warn(`Leverage set failed (may be ok): ${errData.msg ?? e.message}`);
    }

    // 2. Place the order
    const path = '/api/v2/mix/order/place-order';
    const tradeSide = p.side === OrderSide.LONG ? 'open_long' : 'open_short';
    const body: Record<string, any> = {
      symbol: p.symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT',
      marginMode: 'crossed', side: tradeSide, orderType: 'market', size: String(p.qty),
    };
    if (p.sl) body.presetStopLossPrice = String(p.sl);
    if (p.tp) body.presetTakeProfitPrice = String(p.tp);

    const bodyStr = JSON.stringify(body);
    this.logger.log(`Placing order: ${tradeSide} ${p.qty} ${p.symbol} | SL=${p.sl} TP=${p.tp} | Body: ${bodyStr}`);

    try {
      const resp = await axios.post(BASE + path, body, {
        headers: makeHeaders('POST', path, bodyStr), timeout: 10000,
      });
      if (resp.data?.code !== '00000') {
        throw new Error('Bitget rejected: ' + JSON.stringify(resp.data));
      }
      this.logger.log('Order placed: ' + tradeSide + ' ' + p.qty + ' ' + p.symbol);
      return resp.data;
    } catch (e: any) {
      // Extract the real error from Bitget
      const errData = e.response?.data;
      const errMsg = errData ? JSON.stringify(errData) : e.message;
      throw new Error(`Order failed [${e.response?.status ?? '?'}]: ${errMsg}`);
    }
  }
}
