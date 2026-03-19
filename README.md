# FII Market Dashboard

Institutional-grade FII market interpretation dashboard for India equities.

## Deploy to Railway (Free)

1. Go to https://railway.app and sign up with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Upload this folder or connect your GitHub repo
4. Railway auto-detects Node.js and deploys
5. Click **Settings** → **Domains** → **Generate Domain**
6. Open your URL — done!

## Local Development

```bash
npm install
npm start
```

Open http://localhost:3000

## Data Sources

- **Auto-fetched** (server-side): Nifty 50, Bank Nifty, USD/INR, India VIX, Brent Crude, US 10Y, India 10Y
- **Manual entry required**: FII Cash Flow, DII Cash Flow, FII L/S Ratio (from NSE website)

## Where to get manual inputs daily

- FII/DII flows → https://www.nseindia.com → Market Data → FII/DII Activity  
- FII L/S Ratio → NSE → F&O → Participant-wise OI → (FII Long OI) ÷ (FII Long + Short OI)
