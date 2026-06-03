# MemeForge — Architecture

## 1. System overview

MemeForge is a single-owner crypto intelligence terminal. It is built as a
TypeScript monorepo with three deployable apps and one shared package.

```
                         ┌──────────────────────────────────────────┐
                         │                Web (Next.js)             │
                         │  Dark-luxury PWA trading terminal         │
                         │  Dashboard · Watchlist · Discovery ·      │
                         │  Whales · Journal · Analytics · Settings  │
                         └───────────────┬───────────────┬──────────┘
                              REST/JSON   │   WebSocket    │
                                          ▼               ▼
              ┌──────────────────────────────────────────────────────────┐
              │                     API (Express + TS)                    │
              │                                                            │
              │  Auth(OTP/OAuth/RBAC) · Portfolio · Alerts · Automation    │
              │  AI Brain · Discovery · Whales · SmartMoney · Risk         │
              │  Watchlist · Journal · Analytics · Notifications           │
              │                                                            │
              │  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐  │
              │  │ Realtime   │  │ Scheduler  │  │ Market Data Engine   │  │
              │  │ (ws hub)   │  │ (cron)     │  │ mock | dexscreener   │  │
              │  └────────────┘  └────────────┘  │ | birdeye providers │  │
              │                                   └─────────────────────┘  │
              └───────────────┬───────────────────────────┬───────────────┘
                              │                            │
                     ┌────────▼─────────┐        ┌─────────▼──────────┐
                     │  PostgreSQL      │        │  Notification Bus   │
                     │  (Prisma ORM)    │        │  Email·Discord·     │
                     └──────────────────┘        │  Telegram·Push·App  │
                                                  └─────────┬──────────┘
                                                            │
                                                  ┌─────────▼──────────┐
                                                  │  Discord Bot       │
                                                  │  (slash commands)  │
                                                  └────────────────────┘
```

## 2. Apps & packages

| Workspace | Stack | Responsibility |
|-----------|-------|----------------|
| `@memeforge/api` | Node, Express, TypeScript, Prisma, ws, node-cron | All business logic, persistence, realtime, automation, notifications |
| `@memeforge/web` | Next.js 14 App Router, Tailwind, Framer Motion, Recharts, Zustand | The terminal UI + PWA |
| `@memeforge/bot` | discord.js v14 | Discord slash commands + alert relay |
| `@memeforge/shared` | Pure TypeScript | Cross-cutting types, enums, scoring math, constants |

## 3. Request lifecycle

1. **HTTP** request hits Express → `helmet`/`cors`/`rateLimit` → route → zod
   validation → controller → service → Prisma → response.
2. **Auth**: `Authorization: Bearer <accessToken>` JWT verified by middleware,
   which attaches `req.user`. Role guards (`requireRole`) gate owner-only
   actions (all trading/automation mutations).
3. **Realtime**: client opens `ws://api/realtime?token=...`. The hub
   authenticates, subscribes the socket to channels (`portfolio`, `prices`,
   `alerts`, `whales`, `discovery`) and pushes diffs.

## 4. The Market Data Engine

A provider abstraction (`services/market/provider.ts`) exposes a single
`MarketProvider` interface:

```ts
interface MarketProvider {
  getToken(address: string): Promise<TokenSnapshot>;
  getTokens(addresses: string[]): Promise<TokenSnapshot[]>;
  getTrending(): Promise<TokenSnapshot[]>;
  getNewLaunches(): Promise<TokenSnapshot[]>;
  getWhaleTransfers(since: Date): Promise<WhaleTransfer[]>;
}
```

- **`MockProvider`** (default) generates deterministic-but-lively market data
  with a geometric-Brownian-motion price walk so the whole platform runs with
  zero external keys. This is what makes the repo runnable end-to-end.
- **`DexScreenerProvider` / `BirdeyeProvider`** are real adapters (wired to the
  HTTP endpoints) selectable via `DATA_PROVIDER`.

The **PriceTicker** loop polls the active provider every few seconds, updates
position marks, persists `PriceCandle`s, and emits realtime price diffs. Every
tick feeds the **AlertEngine** and **AutomationEngine**.

## 5. Automation pipeline (owner-only, sell-only)

```
PriceTick ─▶ AlertEngine ─▶ (matches) ─▶ NotificationBus
          └▶ AutomationEngine
                 ├─ AutoSellRules     (laddered take-profit)
                 ├─ TrailingStops     (peak-tracking stop)
                 └─ ProfitLock        (EOD realized → reserve)
                         │
                         ▼
                 SellExecution (records a closed/partial position)
                         │
                         ▼
                 NotificationBus + Journal entry
```

**Invariants enforced in code:**
- `AutomationEngine` only ever produces **SELL** intents. There is no buy path.
- Profit lock moves realized profit into a **Reserve** ledger; it never
  withdraws funds — withdrawal is a manual, owner-confirmed action.
- All automation execution is gated behind `role === OWNER` and the
  `ENABLE_AUTOMATION` flag.

## 6. AI Market Brain

`modules/ai` runs a `BrainService` that aggregates portfolio, volume,
liquidity, social, whale and smart-money signals into structured reports
(daily / weekly / market / risk / opportunity) and per-token "Why am I
up/down" explanations.

Two strategies behind one interface:
- **`HeuristicStrategy`** (default): transparent rule-based reasoning over the
  signal set — fully offline, deterministic, explainable.
- **`AnthropicStrategy`**: sends the signal bundle to the Claude API
  (`ANTHROPIC_API_KEY`) for richer natural-language synthesis, with the
  heuristic output as a guaranteed fallback.

## 7. Scoring

`packages/shared/src/scoring.ts` holds pure functions used everywhere:
`momentumScore`, `opportunityScore`, `riskScore`, `confidenceScore`. Because
they're pure and shared, the API, bot and web all rank tokens identically.

## 8. Scheduler (cron)

| Job | Cadence | Action |
|-----|---------|--------|
| `priceTick` | every 5s | poll provider, mark positions, emit diffs |
| `discoveryScan` | every 60s | scan launches/trending, score, persist |
| `whaleScan` | every 30s | detect whale transfers, alert |
| `profitLock` | daily 23:59 | sweep realized profit → reserve |
| `dailyReport` | daily 08:00 | AI daily report → email/discord |
| `weeklyReport` | Mon 08:00 | AI weekly report → email/discord |

## 9. Notifications

A `NotificationBus` fans a single `NotificationEvent` out to enabled channels
per the owner's preferences: **In-App** (persisted + ws push), **Email**
(nodemailer), **Discord** (webhook/bot), **Telegram** (bot API), **Push**
(web-push/VAPID). Each channel is a small adapter implementing
`NotificationChannel.send(event)`; missing credentials degrade gracefully to
console logging.

## 10. Security model

- Single owner; `OWNER_EMAIL` is auto-promoted on first login.
- Roles: **Owner** (everything, only one who can trade/automate),
  **Admin** (manage alerts/watchlist/view analytics), **Viewer** (read-only).
- JWT access (short) + refresh (rotating) tokens.
- All mutating trading/automation routes are `requireRole(OWNER)`.
- `helmet`, strict CORS allow-list, per-IP rate limiting, zod input validation,
  Prisma parameterized queries.

## 11. Folder structure (api)

```
apps/api/src/
├── index.ts                # bootstrap (http + ws + cron)
├── app.ts                  # express app wiring
├── config/                 # env, constants
├── lib/                    # prisma, logger, jwt, errors, http
├── middleware/             # auth, rbac, validate, error handler, rate limit
├── realtime/               # ws hub + channels
├── scheduler/              # cron jobs
├── services/
│   ├── market/             # provider abstraction + mock/real adapters + ticker
│   └── ai/                 # brain strategies
├── modules/
│   ├── auth/
│   ├── portfolio/
│   ├── alerts/
│   ├── automation/
│   ├── ai/
│   ├── discovery/
│   ├── whales/
│   ├── smartmoney/
│   ├── risk/
│   ├── watchlist/
│   ├── journal/
│   ├── analytics/
│   └── notifications/
└── prisma/                 # schema + seed
```
