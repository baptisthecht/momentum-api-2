// ─────────────────────────────────────────────────────────────────────────────
// NOUVELLES MÉTHODES À AJOUTER dans BitgetClientService
// Coller ces méthodes à la fin de la classe, avant la dernière accolade
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Close a partial position (one TP target).
 * side = 'long' → we're selling to close; side = 'short' → we're buying to close
 * tradeSide = 'close' is required in hedge mode V2.
 */
async closePartialPosition(p: {
  apiKey: string; apiSecret: string; passphrase: string;
  symbol: string; side: OrderSide; qty: number;
}): Promise<void> {
  const client = this.makeClient(p.apiKey, p.apiSecret, p.passphrase);
  const closeSide = p.side === OrderSide.LONG ? 'sell' : 'buy';
  const sizeStr = this.truncateSize(p.symbol, p.qty);

  const resp = await client.futuresSubmitOrder({
    symbol: p.symbol,
    productType: 'USDT-FUTURES',
    marginCoin: 'USDT',
    marginMode: 'crossed',
    side: closeSide,
    tradeSide: 'close' as any,
    orderType: 'market',
    size: sizeStr,
    clientOid: `tp#${Date.now()}`,
  });

  this.logger.log(
    `Partial close sent: ${p.symbol} ${p.side} qty=${sizeStr} orderId=${resp?.data?.orderId}`,
  );
}

/**
 * Close the full remaining position (safety fallback).
 */
async closeFullPosition(p: {
  apiKey: string; apiSecret: string; passphrase: string;
  symbol: string; side: OrderSide; qty: number;
}): Promise<void> {
  const client = this.makeClient(p.apiKey, p.apiSecret, p.passphrase);
  const closeSide = p.side === OrderSide.LONG ? 'sell' : 'buy';
  const sizeStr = this.truncateSize(p.symbol, p.qty);

  const resp = await client.futuresSubmitOrder({
    symbol: p.symbol,
    productType: 'USDT-FUTURES',
    marginCoin: 'USDT',
    marginMode: 'crossed',
    side: closeSide,
    tradeSide: 'close' as any,
    orderType: 'market',
    size: sizeStr,
    clientOid: `close#${Date.now()}`,
  });

  this.logger.log(
    `Full close sent: ${p.symbol} ${p.side} qty=${sizeStr} orderId=${resp?.data?.orderId}`,
  );
}

/**
 * Update the stop-loss for a position after TP1 is hit.
 * Cancels old TPSL order and places a new one at newSLPrice.
 */
async updateSL(p: {
  apiKey: string; apiSecret: string; passphrase: string;
  symbol: string; side: OrderSide; qty: number; newSLPrice: number;
}): Promise<void> {
  const client = this.makeClient(p.apiKey, p.apiSecret, p.passphrase);
  const holdSide = p.side === OrderSide.LONG ? 'long' : 'short';
  const sizeStr = this.truncateSize(p.symbol, p.qty);
  const priceStr = this.roundPrice(p.symbol, p.newSLPrice);

  try {
    // Place new SL — Bitget will replace the existing one for the same holdSide
    await client.futuresSubmitTPSLOrder({
      symbol: p.symbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      size: sizeStr,
      planType: 'loss_plan' as any,
      holdSide: holdSide as any,
      triggerPrice: priceStr,
      triggerType: 'mark_price',
    });
    this.logger.log(
      `SL updated to ${priceStr} for ${p.symbol} ${holdSide} qty=${sizeStr}`,
    );
  } catch (e: any) {
    const errMsg = e.body ? JSON.stringify(e.body) : e.message;
    this.logger.warn(`SL update failed: ${errMsg}`);
    throw e;
  }
}
