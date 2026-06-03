# 🔥 MemeForge

> Personal crypto intelligence, portfolio management, market analysis & automation platform.
> A professional-grade trading terminal — built for a single owner.

MemeForge combines the best of **DexScreener**, **Phantom**, **Coinbase**,
**TradingView**, **Jupiter** and **Birdeye** into one dark-luxury terminal:
discover opportunities early, protect profits, reduce losses, automate exits,
track market activity and get continuous AI intelligence.

> ⚠️ MemeForge **never** auto-buys. Auto-**sell** only. Withdrawals are always
> manual. The goal is risk-managed intelligence — not guaranteed profit.

---

## Monorepo layout

```
memeforge/
├── apps/
│   ├── api/        # Express + TypeScript backend, Prisma/PostgreSQL, WebSockets, cron automation
│   ├── web/        # Next.js 14 (App Router) + Tailwind + Framer Motion PWA terminal
│   └── bot/        # Discord bot (slash commands + alert relay)
├── packages/
│   └── shared/     # Shared TypeScript types, constants, scoring utilities
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   └── DEPLOYMENT.md
├── docker-compose.yml
└── .env.example
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the full system design,
**[docs/DATABASE.md](docs/DATABASE.md)** for the schema, and
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for deployment.

---

## Quick start

```bash
# 1. Install dependencies (npm workspaces)
npm install

# 2. Configure environment
cp .env.example .env       # works out-of-the-box with the mock data engine

# 3. Start PostgreSQL (or use docker-compose)
docker compose up -d postgres

# 4. Create the schema + seed demo portfolio
npm run db:generate
npm run db:migrate
npm run db:seed

# 5. Run everything (api + web + bot)
npm run dev
```

- API → http://localhost:4000 (health: `/api/v1/health`)
- Web → http://localhost:3000
- Default owner login: the email in `OWNER_EMAIL`, via email OTP (the OTP is
  printed to the API console when SMTP isn't configured).

---

## What's inside

| Subsystem | Where |
|-----------|-------|
| Auth (Email OTP, Google, Discord) + RBAC (Owner / Admin / Viewer) | `apps/api/src/modules/auth` |
| Portfolio & positions (realtime PnL) | `apps/api/src/modules/portfolio` |
| Alert engine (price / volume / whale) | `apps/api/src/modules/alerts` |
| Auto-sell, trailing stop, profit lock | `apps/api/src/modules/automation` |
| AI Market Brain + Why Up / Why Down | `apps/api/src/modules/ai` |
| Memecoin discovery + scoring | `apps/api/src/modules/discovery` |
| Whale tracker + smart money | `apps/api/src/modules/whales` |
| Risk engine | `apps/api/src/modules/risk` |
| Watchlist + trading journal | `apps/api/src/modules/watchlist`, `journal` |
| Analytics | `apps/api/src/modules/analytics` |
| Notifications (Email / Discord / Telegram / Push / In-App) | `apps/api/src/modules/notifications` |
| Realtime WebSocket hub | `apps/api/src/realtime` |
| Market data engine (mock + pluggable providers) | `apps/api/src/services/market` |
| Discord bot | `apps/bot` |
| Web terminal (dashboard, watchlist, discovery, journal…) | `apps/web` |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run api + web + bot concurrently |
| `npm run build` | Build all workspaces |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed demo owner + portfolio + positions |
| `npm run db:studio` | Open Prisma Studio |
| `npm run typecheck` | Typecheck api + web |

---

## License

Private. Single-owner platform. Not for redistribution.
