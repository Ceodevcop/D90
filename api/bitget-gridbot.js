import axios from 'axios';
import crypto from 'crypto';

const BASE_URL = 'https://api.bitget.com';

const COINS = ['BTCUSDT', 'ETHUSDT']; // Add your desired pairs
const GRID_SPACING = 0.02; // 2%
const LOT_SIZE = 0.001; // in coin units

// Bitget headers signer
function getHeaders(method, path, body = '') {
  const timestamp = Date.now().toString();
  const preHash = timestamp + method.toUpperCase() + path + body;

  const hmac = crypto.createHmac('sha256', process.env.BITGET_API_SECRET);
  hmac.update(preHash);
  const sign = hmac.digest('base64');

  return {
    'ACCESS-KEY': process.env.BITGET_API_KEY,
    'ACCESS-SIGN': sign,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': process.env.BITGET_PASSPHRASE,
    'Content-Type': 'application/json'
  };
}

// Fetch current price
async function getTicker(symbol) {
  const res = await axios.get(`${BASE_URL}/api/spot/v1/market/ticker?symbol=${symbol}`);
  return parseFloat(res.data.data.close);
}

// Place spot order
async function placeOrder(symbol, side, price, size) {
  const body = {
    symbol,
    side,
    orderType: 'limit',
    force: 'gtc',
    price: price.toString(),
    size: size.toString(),
  };

  const headers = getHeaders('POST', '/api/spot/v1/trade/orders', JSON.stringify(body));
  const res = await axios.post(`${BASE_URL}/api/spot/v1/trade/orders`, body, { headers });
  return res.data;
}

// Simulate grid logic
const gridState = {};

async function runGridBot(symbol) {
  const currentPrice = await getTicker(symbol);
  const state = gridState[symbol] || { lastBuyPrice: null };

  let logs = [];

  if (!state.lastBuyPrice) {
    await placeOrder(symbol, 'buy', currentPrice, LOT_SIZE);
    gridState[symbol] = { lastBuyPrice: currentPrice };
    logs.push(`Bought ${symbol} @ ${currentPrice}`);
  } else {
    const diff = (currentPrice - state.lastBuyPrice) / state.lastBuyPrice;

    if (diff >= GRID_SPACING) {
      await placeOrder(symbol, 'sell', currentPrice, LOT_SIZE);
      const profit = (currentPrice - state.lastBuyPrice) * LOT_SIZE;
      logs.push(`Sold ${symbol} @ ${currentPrice} | Profit: $${profit.toFixed(2)}`);

      // Reset for next cycle
      await placeOrder(symbol, 'buy', currentPrice, LOT_SIZE);
      gridState[symbol] = { lastBuyPrice: currentPrice };
      logs.push(`Re-bought ${symbol} @ ${currentPrice}`);
    } else {
      logs.push(`No trade for ${symbol}. Waiting...`);
    }
  }

  return logs;
}

export default async function handler(req, res) {
  try {
    let result = [];
    for (let coin of COINS) {
      const logs = await runGridBot(coin);
      result.push(...logs);
    }
    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      logs: result,
    });
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error: 'Bot failed to run', details: err.message });
  }
}
