const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (the dashboard HTML)
app.use(express.static(path.join(__dirname, 'public')));

// CORS headers for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ── Yahoo Finance fetcher ──
async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 8000
    });
    const q = res.data.chart.result[0].indicators.quote[0];
    const closes = q.close.filter(x => x != null);
    if (closes.length < 1) throw new Error('No data');
    const cur = closes[closes.length - 1];
    const prev = closes.length > 1 ? closes[closes.length - 2] : cur;
    return {
      cur: parseFloat(cur.toFixed(2)),
      prev: parseFloat(prev.toFixed(2)),
      chg: parseFloat((cur - prev).toFixed(2)),
      pct: parseFloat(((cur - prev) / prev * 100).toFixed(2))
    };
  } catch (e) {
    return null;
  }
}

// ── Stooq fallback ──
async function fetchStooq(symbol) {
  try {
    const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;
    const res = await axios.get(url, { timeout: 8000 });
    const lines = res.data.trim().split('\n').filter(l => l && !l.startsWith('Date'));
    if (lines.length < 2) throw new Error('No data');
    const parse = l => parseFloat(l.split(',')[4] || l.split(',')[1]);
    const cur = parse(lines[lines.length - 1]);
    const prev = parse(lines[lines.length - 2]);
    if (!cur || isNaN(cur)) throw new Error('Bad data');
    return {
      cur: parseFloat(cur.toFixed(2)),
      prev: parseFloat(prev.toFixed(2)),
      chg: parseFloat((cur - prev).toFixed(2)),
      pct: parseFloat(((cur - prev) / prev * 100).toFixed(2))
    };
  } catch (e) {
    return null;
  }
}

// ── Main market data API endpoint ──
app.get('/api/marketdata', async (req, res) => {
  const targets = [
    { key: 'nifty',  yahoo: '%5ENSEI',     stooq: '^nf.in'   },
    { key: 'bnifty', yahoo: '%5ENSEBANK',  stooq: '^nfbn.in' },
    { key: 'inr',    yahoo: 'USDINR%3DX',  stooq: 'usdinr'   },
    { key: 'vix',    yahoo: '%5EINDIAVIX', stooq: null        },
    { key: 'brent',  yahoo: 'BZ%3DF',      stooq: 'cb.f'     },
    { key: 'us10y',  yahoo: '%5ETNX',      stooq: '10usy.b'  },
    { key: 'in10y',  yahoo: '%5EIN10YT%3DRR', stooq: '10iny.b' },
  ];

  const results = {};

  await Promise.all(targets.map(async (t) => {
    // Try Yahoo first (server-side, no CORS issues)
    let data = await fetchYahoo(t.yahoo);
    if (!data && t.stooq) {
      data = await fetchStooq(t.stooq);
    }
    results[t.key] = data;
  }));

  // Clean up specific values
  if (results.us10y && results.us10y.cur > 20) {
    results.us10y.cur = parseFloat((results.us10y.cur / 10).toFixed(2));
    results.us10y.prev = parseFloat((results.us10y.prev / 10).toFixed(2));
  }
  if (results.in10y && results.in10y.cur > 20) {
    results.in10y.cur = parseFloat((results.in10y.cur / 10).toFixed(2));
    results.in10y.prev = parseFloat((results.in10y.prev / 10).toFixed(2));
  }
  // INR: make sure it's INR per USD (should be ~84, not 0.011)
  if (results.inr && results.inr.cur < 5) {
    results.inr.cur = parseFloat((1 / results.inr.cur).toFixed(2));
  }

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    data: results
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`FII Dashboard server running on port ${PORT}`);
});
