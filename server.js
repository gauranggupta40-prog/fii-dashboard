const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });

app.get('/', (req, res) => {
  const pub = path.join(__dirname, 'public', 'index.html');
  const root = path.join(__dirname, 'index.html');
  if (fs.existsSync(pub)) res.sendFile(pub);
  else if (fs.existsSync(root)) res.sendFile(root);
  else res.send('index.html not found.');
});

// ── Stooq (primary — works server-side, no blocking) ──
async function fetchStooq(symbol) {
  try {
    const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 12000
    });
    const lines = res.data.trim().split('\n').filter(l => l && !l.startsWith('Date'));
    if (lines.length < 2) throw new Error('Not enough rows');
    const parse = l => parseFloat(l.split(',')[4] || l.split(',')[1]);
    const cur  = parse(lines[lines.length - 1]);
    const prev = parse(lines[lines.length - 2]);
    if (!cur || isNaN(cur) || cur === 0) throw new Error('Zero or NaN');
    return {
      cur:  parseFloat(cur.toFixed(2)),
      prev: parseFloat(prev.toFixed(2)),
      chg:  parseFloat((cur - prev).toFixed(2)),
      pct:  parseFloat(((cur - prev) / prev * 100).toFixed(2))
    };
  } catch (e) {
    console.log(`Stooq [${symbol}] failed: ${e.message}`);
    return null;
  }
}

// ── Yahoo Finance (fallback — often blocked but worth trying) ──
async function fetchYahoo(symbol) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/',
      },
      timeout: 10000
    });
    const q = res.data.chart.result[0].indicators.quote[0];
    const closes = q.close.filter(x => x != null);
    if (closes.length < 1) throw new Error('No closes');
    const cur  = closes[closes.length - 1];
    const prev = closes.length > 1 ? closes[closes.length - 2] : cur;
    if (!cur || cur === 0) throw new Error('Zero price');
    return {
      cur:  parseFloat(cur.toFixed(2)),
      prev: parseFloat(prev.toFixed(2)),
      chg:  parseFloat((cur - prev).toFixed(2)),
      pct:  parseFloat(((cur - prev) / prev * 100).toFixed(2))
    };
  } catch (e) {
    console.log(`Yahoo [${symbol}] failed: ${e.message}`);
    return null;
  }
}

async function fetch2(stooqSym, yahooSym, label) {
  // Try Stooq first (more reliable server-side)
  let d = await fetchStooq(stooqSym);
  if (d && d.cur > 0) { console.log(`✓ ${label}: ${d.cur} (Stooq)`); return d; }
  // Fallback to Yahoo
  if (yahooSym) {
    d = await fetchYahoo(yahooSym);
    if (d && d.cur > 0) { console.log(`✓ ${label}: ${d.cur} (Yahoo)`); return d; }
  }
  console.log(`✗ ${label}: all sources failed`);
  return null;
}

app.get('/api/marketdata', async (req, res) => {
  console.log(`\n[${new Date().toISOString()}] Fetching market data...`);

  // Stooq symbols for Indian market:
  // ^nf.in = Nifty 50, ^nfbn.in = Bank Nifty
  // usdinr = USD/INR spot
  // cb.f = Brent Crude futures
  // 10usy.b = US 10Y yield, 10iny.b = India 10Y yield
  const [nifty, bnifty, inr, brent, us10y, in10y, vix] = await Promise.all([
    fetch2('^nf.in',   '^NSEI',       'Nifty'),
    fetch2('^nfbn.in', '^NSEBANK',    'Bank Nifty'),
    fetch2('usdinr',   'INR=X',       'USD/INR'),
    fetch2('cb.f',     'BZ=F',        'Brent'),
    fetch2('10usy.b',  '^TNX',        'US 10Y'),
    fetch2('10iny.b',  '^IN10YT=RR',  'India 10Y'),
    fetch2(null,       '^INDIAVIX',   'VIX'),
  ]);

  // Fix yields if quoted as ×10 (e.g. 42.3 → 4.23)
  const fixYield = d => {
    if (d && d.cur > 20) {
      d.cur  = parseFloat((d.cur  / 10).toFixed(2));
      d.prev = parseFloat((d.prev / 10).toFixed(2));
      d.chg  = parseFloat((d.chg  / 10).toFixed(3));
    }
    return d;
  };

  // Fix INR if somehow inverted (should be ~84-87, not 0.01)
  if (inr && inr.cur < 5) {
    inr.cur  = parseFloat((1 / inr.cur).toFixed(2));
    inr.prev = parseFloat((1 / inr.prev).toFixed(2));
    inr.chg  = parseFloat((inr.cur - inr.prev).toFixed(2));
  }

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    data: {
      nifty,
      bnifty,
      inr,
      vix,
      brent,
      us10y: fixYield(us10y),
      in10y: fixYield(in10y)
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`FII Dashboard running on port ${PORT}`);
});
