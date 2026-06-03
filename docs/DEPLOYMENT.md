# MemeForge — Deployment

MemeForge is a single-owner platform. A typical production deployment:

- **Web** → Vercel (Next.js)
- **API + Bot** → a small VPS / Fly.io / Railway container
- **PostgreSQL** → managed Postgres (Neon, Supabase, RDS)

## 1. Local / Docker

```bash
docker compose up -d            # postgres + api + web + bot
```

`docker-compose.yml` builds the API and web images and provisions Postgres.
On first boot the API runs migrations and seeds the owner account.

## 2. Environment

Copy `.env.example` → `.env` and set at minimum:

- `DATABASE_URL`
- `JWT_SECRET` (long random string)
- `OWNER_EMAIL`

Everything else is optional — without provider/notification keys the platform
runs on the mock data engine and logs notifications to the console.

To go live with real data set `DATA_PROVIDER=birdeye` (+ `BIRDEYE_API_KEY`) or
`DATA_PROVIDER=dexscreener`, and fill the notification + OAuth credentials.

## 3. Database

```bash
npm run db:generate     # prisma client
npm run db:migrate      # apply migrations (prisma migrate deploy in prod)
npm run db:seed         # owner + demo portfolio (skip in prod if undesired)
```

## 4. API (Express)

```bash
npm run build:api
node apps/api/dist/index.js
```

Health check: `GET /api/v1/health`. Put it behind a reverse proxy (Caddy/Nginx)
with TLS. The WebSocket endpoint is `/realtime` on the same origin.

## 5. Web (Next.js)

```bash
npm run build:web
npm run start -w @memeforge/web
```

Set `NEXT_PUBLIC_API_BASE_URL` to the public API origin. The app ships as an
installable PWA (`manifest.webmanifest` + service worker) with push support.

### Vercel
- Root directory: `apps/web`
- Build command: `npm run build`
- Install command: `npm install` (from repo root for workspaces)
- Env: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

## 6. Discord bot

Set `DISCORD_BOT_TOKEN`, `DISCORD_BOT_CLIENT_ID`, `DISCORD_GUILD_ID`, then:

```bash
npm run register -w @memeforge/bot   # register slash commands
npm run dev -w @memeforge/bot
```

## 7. Web push keys

```bash
npx web-push generate-vapid-keys
# put the public key in VAPID_PUBLIC_KEY + NEXT_PUBLIC_VAPID_PUBLIC_KEY
# put the private key in VAPID_PRIVATE_KEY
```

## 8. Production checklist

- [ ] `NODE_ENV=production`, strong `JWT_SECRET`
- [ ] `prisma migrate deploy` on release
- [ ] CORS allow-list = your web origin only
- [ ] Rate limiting + helmet enabled (default on)
- [ ] Backups on Postgres
- [ ] `ENABLE_AUTOMATION` only after verifying sell rules in dry-run
