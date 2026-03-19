const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const rootPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicPath)) res.sendFile(publicPath);
  else if (fs.existsSync(rootPath)) res.sendFile(rootPath);
  else res.send('index.html not found.');
});

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// Yahoo Finance fetch with proper headers
async function fetchYahoo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://finance.yahoo.com/',
        'Origin': 'https://finance.yahoo.com',
      },
      timeout: 10000
    });
    const result = res.data.chart.result[0];
    const q = result.indicators.quote[0];
    const closes = q.close.filter(x => x != null);
    if (closes.length < 1) throw new Error('No closes');
    const cur = closes[closes.length - 1];
    const prev = closes.length > 1 ? closes[closes.length - 2] : cur;
    return {
      cur: parseFloat(cur.toFixed(2)),
      prev: parseFloat(prev.toFixed(2)),
      chg: parseFloat((cur - prev).toFixed(2)),
      pct: parseFloat(((cur - prev) / prev * 100).toFixed(2))
    };
  } catch (e) {
    console.log(`Yahoo failed for ${symbol}: ${e.message}`);
    return null;
  }
}

// Stooq fallback
async function fetchStooq(symbol) {
  try {
    const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    const lines = res.data.trim().split('\n').filter(l => l && !l.startsWith('Date'));
    if (lines.length < 2) throw new Error('Not enough data');
    const parse = l => {
      const parts = l.split(',');
      return parseFloat(parts[4] || parts[1]);
    };
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
    console.log(`Stooq failed for ${symbol}: ${e.message}`);
    return null;
  }
}

async function fetchSymbol(yahooSym, stooqSym, label) {
  let data = await fetchYahoo(yahooSym);
  if (data && data.cur > 0) { console.log(`✓ ${label} via Yahoo: ${data.cur}`); return data; }
  if (stooqSym) {
    data = await fetchStooq(stooqSym);
    if (data && data.cur > 0) { console.log(`✓ ${label} via Stooq: ${data.cur}`); return data; }
  }
  console.log(`✗ ${label} all sources failed`);
  return null;
}

app.get('/api/marketdata', async (req, res) => {
  console.log('Fetching market data...');

  const [nifty, bnifty, inr, vix, brent, us10y, in10y] = await Promise.all([
    fetchSymbol('^NSEI',       '^nf.in',    'Nifty'),
    fetchSymbol('^NSEBANK',    '^nfbn.in',  'Bank Nifty'),
    fetchSymbol('INR=X',       'usdinr',    'USD/INR'),
    fetchSymbol('^INDIAVIX',   null,        'VIX'),
    fetchSymbol('BZ=F',        'cb.f',      'Brent'),
    fetchSymbol('^TNX',        '10usy.b',   'US 10Y'),
    fetchSymbol('^IN10YT=RR',  '10iny.b',   'India 10Y'),
  ]);

  // Fix US 10Y (Yahoo quotes as e.g. 42.3 meaning 4.23%)
  if (us10y && us10y.cur > 20) {
    us10y.cur = parseFloat((us10y.cur / 10).toFixed(2));
    us10y.prev = parseFloat((us10y.prev / 10).toFixed(2));
    us10y.chg = parseFloat((us10y.chg / 10).toFixed(2));
  }
  if (in10y && in10y.cur > 20) {
    in10y.cur = parseFloat((in10y.cur / 10).toFixed(2));
    in10y.prev = parseFloat((in10y.prev / 10).toFixed(2));
    in10y.chg = parseFloat((in10y.chg / 10).toFixed(2));
  }

  // INR=X from Yahoo gives direct INR per USD (~87), should be fine
  // But if somehow inverted (< 5), flip it
  if (inr && inr.cur < 5) {
    inr.cur = parseFloat((1 / inr.cur).toFixed(2));
  }

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    data: { nifty, bnifty, inr, vix, brent, us10y, in10y }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`FII Dashboard running on port ${PORT}`);
});
