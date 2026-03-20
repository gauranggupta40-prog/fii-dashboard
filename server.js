const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'history.json');

app.use(express.json());
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

// ── History store (last 10 days) ──
function loadHistory() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) {}
  return [];
}

function saveHistory(history) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2)); } catch(e) {}
}

function addToHistory(entry) {
  const history = loadHistory();
  // Use client-supplied date if provided, otherwise today
  const today = entry.date || new Date().toISOString().split('T')[0];
  delete entry.date; // remove from entry object before storing
  const existing = history.findIndex(h => h.date === today);
  if (existing >= 0) history[existing] = { date: today, ...entry };
  else history.push({ date: today, ...entry });
  const sorted = history.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  saveHistory(sorted);
  return sorted;
}

// ── Market data fetchers ──
async function fetchStooq(symbol) {
  try {
    const res = await axios.get(`https://stooq.com/q/d/l/?s=${symbol}&i=d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000
    });
    const lines = res.data.trim().split('\n').filter(l => l && !l.startsWith('Date'));
    if (lines.length < 2) throw new Error('Not enough rows');
    const parse = l => parseFloat(l.split(',')[4] || l.split(',')[1]);
    const cur = parse(lines[lines.length - 1]);
    const prev = parse(lines[lines.length - 2]);
    if (!cur || isNaN(cur) || cur === 0) throw new Error('Zero or NaN');
    return { cur: +cur.toFixed(2), prev: +prev.toFixed(2), chg: +(cur-prev).toFixed(2), pct: +((cur-prev)/prev*100).toFixed(2) };
  } catch(e) { console.log(`Stooq [${symbol}]: ${e.message}`); return null; }
}

async function fetchYahoo(symbol) {
  try {
    const res = await axios.get(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' },
      timeout: 10000
    });
    const q = res.data.chart.result[0].indicators.quote[0];
    const closes = q.close.filter(x => x != null);
    if (!closes.length) throw new Error('No closes');
    const cur = closes[closes.length-1], prev = closes.length > 1 ? closes[closes.length-2] : cur;
    if (!cur || cur === 0) throw new Error('Zero');
    return { cur: +cur.toFixed(2), prev: +prev.toFixed(2), chg: +(cur-prev).toFixed(2), pct: +((cur-prev)/prev*100).toFixed(2) };
  } catch(e) { console.log(`Yahoo [${symbol}]: ${e.message}`); return null; }
}

async function fetch2(stooqSym, yahooSym, label) {
  if (stooqSym) {
    const d = await fetchStooq(stooqSym);
    if (d && d.cur > 0) { console.log(`✓ ${label}: ${d.cur} (Stooq)`); return d; }
  }
  if (yahooSym) {
    const d = await fetchYahoo(yahooSym);
    if (d && d.cur > 0) { console.log(`✓ ${label}: ${d.cur} (Yahoo)`); return d; }
  }
  console.log(`✗ ${label}: all failed`); return null;
}

const fixYield = d => {
  if (d && d.cur > 20) { d.cur = +(d.cur/10).toFixed(2); d.prev = +(d.prev/10).toFixed(2); d.chg = +(d.chg/10).toFixed(3); }
  return d;
};

// ── Market data API ──
app.get('/api/marketdata', async (req, res) => {
  console.log(`\n[${new Date().toISOString()}] Fetching...`);
  const [nifty, bnifty, inr, brent, us10y, in10y, vix] = await Promise.all([
    fetch2('^nf.in',  '^NSEI',      'Nifty'),
    fetch2('^nfbn.in','^NSEBANK',   'BankNifty'),
    fetch2('usdinr',  'INR=X',      'USD/INR'),
    fetch2('cb.f',    'BZ=F',       'Brent'),
    fetch2('10usy.b', '^TNX',       'US10Y'),
    fetch2('10iny.b', '^IN10YT=RR', 'IN10Y'),
    fetch2(null,      '^INDIAVIX',  'VIX'),
  ]);
  if (inr && inr.cur < 5) { inr.cur = +(1/inr.cur).toFixed(2); inr.prev = +(1/inr.prev).toFixed(2); }
  res.json({ success: true, timestamp: new Date().toISOString(), data: { nifty, bnifty, inr, vix, brent, us10y: fixYield(us10y), in10y: fixYield(in10y) } });
});

// ── Save daily entry + get history ──
app.post('/api/saveday', (req, res) => {
  const entry = req.body;
  const history = addToHistory(entry);
  res.json({ success: true, history });
});

app.get('/api/history', (req, res) => {
  res.json({ success: true, history: loadHistory() });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, () => console.log(`FII Dashboard on port ${PORT}`));
