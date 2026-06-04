# MemeForge — Go Live on Vercel (everything in one project)

MemeForge runs **entirely on Vercel**: the Next.js frontend **and** the full
backend (the Express API is mounted at `/api/v1/*` via a Next Route Handler),
**Vercel Postgres** for the database, and **Vercel Cron** for automation.

Because Vercel is serverless there are two intentional trade-offs:
- **Realtime** uses polling (every ~15s) instead of WebSockets.
- **Automation** (price ticks, auto-sell, trailing stops, profit-lock, reports)
  runs from **Vercel Cron** instead of an always-on loop. Per-minute cron needs
  the **Pro** plan; on **Hobby** crons run once/day (so automation is daily).

It runs on the built-in **mock data engine**, so no third-party API keys are
needed for a working demo.

---

## Step 1 — Import the project
1. **vercel.com → Add New → Project** → import GitHub repo `dm2book/nexushub`.
2. Branch: `claude/memeforge-platform-sDFK2` (or merge to `main` first).
3. Root Directory: **repo root** (the included `vercel.json` builds everything
   and registers the cron jobs).
4. Don't deploy yet — add the database + env first (Steps 2–3).

## Step 2 — Add Vercel Postgres
1. In the project → **Storage → Create → Postgres** → create & connect.
2. This injects `POSTGRES_*` env vars. MemeForge's Prisma reads `DATABASE_URL`,
   so add one more env var:
   ```
   DATABASE_URL = <value of POSTGRES_PRISMA_URL>
   ```
   (Copy the `POSTGRES_PRISMA_URL` value Vercel created.)

## Step 3 — Environment variables
Add in **Settings → Environment Variables**:
```
DATABASE_URL  = <POSTGRES_PRISMA_URL from Step 2>
JWT_SECRET    = <a long random string>
OWNER_EMAIL   = t6202600@gmail.com
CRON_SECRET   = <a long random string>     # Vercel sends this to cron calls
NODE_ENV      = production
```
Leave `NEXT_PUBLIC_API_BASE_URL` **unset** — the API is same-origin.
(Optional later: `DATA_PROVIDER=birdeye` + `BIRDEYE_API_KEY`, SMTP vars,
`ANTHROPIC_API_KEY`, VAPID keys, OAuth IDs — see `.env.example`.)

## Step 4 — Create the database schema
The schema must be created once. Easiest options:
- **From your machine** (with the Postgres URL):
  ```bash
  git clone <repo> && cd nexushub && npm install
  DATABASE_URL="<POSTGRES_URL_NON_POOLING>" npm run db:deploy   # prisma migrate deploy
  DATABASE_URL="<POSTGRES_URL_NON_POOLING>" npm run db:seed     # optional demo data
  ```
- Or use the Vercel Postgres **Query** tab to run the SQL in
  `apps/api/prisma/migrations/*/migration.sql`.

> The OWNER account is created automatically on first login, so `db:seed` is
> optional (it only adds demo positions/whales/etc).

## Step 5 — Deploy & log in
1. Click **Deploy** → you get `https://<project>.vercel.app`.
2. Open it → sign in with `OWNER_EMAIL` (`t6202600@gmail.com`).
3. Without SMTP the OTP is **printed in the Vercel function logs**
   (Deployments → Functions → logs for `/api/v1/auth/otp/request`). Enter it →
   you're the OWNER.

That's the live link. 🎉

---

## Notes
- **Cron frequency**: `vercel.json` schedules tick (1m), scan (2m), daily (08:00)
  and weekly. On the Hobby plan Vercel limits crons to once/day — upgrade to Pro
  for true realtime-ish automation, or trigger manually:
  `POST /api/v1/cron/tick` with header `Authorization: Bearer <CRON_SECRET>`.
- **SMTP** (real OTP emails): set `SMTP_HOST/PORT/USER/PASS` + `EMAIL_FROM`.
- **Function logs** are where mock-mode OTP codes and automation events appear.

## Alternative: separate always-on API (full realtime)
If you want true WebSocket realtime + always-on automation, host the API on
Render/Railway/Fly (see `render.yaml`) and set `NEXT_PUBLIC_API_BASE_URL` +
`NEXT_PUBLIC_REALTIME=1` on the Vercel web project. The same codebase supports
both modes.
