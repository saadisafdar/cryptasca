# Cryptasca

**A premium crypto portfolio tracking dashboard** — built with vanilla HTML, CSS, and JavaScript. No frameworks, no build step.

## Features

- **Overview** — Animated portfolio total, 24h change, allocation donut chart, top movers strip
- **Holdings** — Sortable table with add/edit/delete, real-time P&L, mobile card view
- **Watchlist** — Live coin search, sparkline charts, 24h % changes
- **Coin Detail** — Price history chart (24h/7d/30d/1y), market cap, volume, ATH, supply

## Tech stack

| Concern | Choice |
|---|---|
| Language | Vanilla JS (no frameworks) |
| Charts | Chart.js v4 (CDN) |
| Data | CoinGecko public API (free tier, no key required) |
| Persistence | localStorage |
| Styling | Vanilla CSS with custom properties |
| Build | None — open index.html directly |

## Getting started

```bash
# Clone or open the folder
cd cryptasca

# Option 1: open directly in browser
start index.html

# Option 2: use VS Code Live Server (recommended for CORS-free dev)
# Install "Live Server" extension → right-click index.html → Open with Live Server
```

## Project structure

```
cryptasca/
├── index.html            # App shell — all HTML
├── css/
│   ├── style.css         # Design tokens, reset, layout, animations
│   └── components.css    # Cards, table, modal, panel, search, states
├── js/
│   ├── api.js            # CoinGecko fetch wrappers + cache + formatters
│   ├── portfolio.js      # LocalStorage CRUD + demo seed + gain/loss math
│   ├── charts.js         # Chart.js donut, line, sparkline wrappers
│   ├── ui.js             # DOM helpers, tabs, modal, panel, reveal observer
│   └── main.js           # App bootstrap, event wiring, 60s auto-refresh
└── assets/
    └── icons/            # (reserved for custom icons)
```

## Color palette

| Token | Value | Use |
|---|---|---|
| Background | `#0B1210` | Page background |
| Surface | `#1C2B27` | Card and panel surfaces |
| Accent | `#D4FF61` | CTAs, active states, positive numbers, chart lines |
| Loss | `#E05252` | Negative numbers only |
| Text primary | `#E8F2E9` | Main text |
| Text secondary | `#8FA89A` | Labels, secondary info |

## API notes

- Uses CoinGecko's **free public API** — no key required
- All coin fetches are batched via `/coins/markets` (comma-separated IDs) to stay within rate limits
- Response cache TTL: **55 seconds** (refreshes every 60s via `setInterval`)
- On API error: stale cache is served and an error banner is shown

## Demo data

On first load, three demo holdings are seeded automatically (BTC/ETH/SOL). A **"Clear demo data"** button appears in the nav to wipe them and start fresh.

## Responsive

- **Desktop (1280px+)** — full table, 4-col stats, side-by-side charts
- **Tablet (768–1024px)** — responsive grid, narrower charts
- **Mobile (<768px)** — holdings table → card list, stacked stats, full-screen slide panel
