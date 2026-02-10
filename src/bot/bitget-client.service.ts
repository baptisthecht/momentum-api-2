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

    const ts = String(Date.now());
    const path = '/api/v2/mix/order/place-order';
    const tradeSide = p.side === OrderSide.LONG ? 'open_long' : 'open_short';
    const body: Record<string, any> = {
      symbol: p.symbol, productType: 'USDT-FUTURES', marginCoin: 'USDT',
      marginMode: 'crossed', side: tradeSide, orderType: 'market', size: String(p.qty),
    };
    if (p.sl) body.presetStopLossPrice = String(p.sl);
    if (p.tp) body.presetTakeProfitPrice = String(p.tp);

    const bodyStr = JSON.stringify(body);
    const sig = crypto.createHmac('sha256', p.apiSecret).update(ts + 'POST' + path + bodyStr).digest('base64');
    const headers = {
      'ACCESS-KEY': p.apiKey, 'ACCESS-SIGN': sig,
      'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': p.passphrase,
      'Content-Type': 'application/json',
    };
    const resp = await axios.post(BASE + path, body, { headers, timeout: 10000 });
    if (resp.data?.code !== '00000') throw new Error('Bitget rejected: ' + JSON.stringify(resp.data));
    this.logger.log('Order placed: ' + tradeSide + ' ' + p.qty + ' ' + p.symbol);
    return resp.data;
  }
}
