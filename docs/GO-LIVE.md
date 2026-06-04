# MemeForge — Go Live (working public link)

MemeForge is full-stack: a **web** app (Vercel) + a **long-running API**
(Express/WebSocket/cron) + **PostgreSQL**. A web-only deploy looks fine but
login/data won't work — the API must be live too. It runs on the built-in
**mock data engine**, so a public demo needs *no* third-party API keys.

The repo is pre-configured for this. Two paths — both done from your own
browser/machine (no secrets shared in chat).

---

## ⭐ Fastest path: Render (API + DB) + Vercel (web) — ~10 min, no CLI

### 1) Backend + database on Render (one click)
1. Go to **render.com → New → Blueprint**.
2. Connect this GitHub repo and pick branch `claude/memeforge-platform-sDFK2`
   (or merge it to `main` first).
3. Render reads `render.yaml` and provisions:
   - `memeforge-api` (Docker, from `apps/api/Dockerfile`) — migrations run on boot
   - `memeforge-db` (free PostgreSQL), auto-wired via `DATABASE_URL`
4. Click **Apply**. When live, copy the API URL, e.g.
   `https://memeforge-api.onrender.com` and check `…/api/v1/health`.

### 2) Frontend on Vercel
1. **vercel.com → Add New → Project** → import the repo.
2. Root Directory: **repo root** (the included `vercel.json` builds the web app).
3. Add env var:
   ```
   NEXT_PUBLIC_API_BASE_URL = https://memeforge-api.onrender.com
   ```
4. **Deploy** → you get `https://<project>.vercel.app`.

### 3) Connect them (CORS)
Back in Render → `memeforge-api` → Environment → set:
```
WEB_BASE_URL = https://<project>.vercel.app
```
Save (it redeploys). Done.

### 4) Log in
Open the Vercel URL → sign in with `OWNER_EMAIL`
(`mohamedelhannouti51@gmail.com`). Without SMTP the OTP is shown in dev mode and
printed in the Render API logs → enter it → you're the OWNER.

> Note: Render's **free** API sleeps after inactivity; the first request after a
> nap takes ~30–60s to wake. Upgrade the API to a paid instance for always-on
> realtime/automation.

---

## Alternative hosts for the API
- **Railway**: New project → Deploy from repo → it detects `apps/api/Dockerfile`.
  Add a Postgres plugin, set `DATABASE_URL`, `JWT_SECRET`, `OWNER_EMAIL`,
  `WEB_BASE_URL`. Railway injects `PORT` (handled).
- **Fly.io**: `fly launch` using `apps/api/Dockerfile`, attach `fly postgres`.
- **Neon** can replace any managed Postgres — paste its `DATABASE_URL`.

## CLI deploy (run on YOUR machine, tokens stay local)
```bash
# Web → Vercel
npm i -g vercel && vercel link && vercel --prod
# API → Railway
npm i -g @railway/cli && railway login && railway up
```

## Go fully live (optional, real data + notifications)
Set on the API host: `DATA_PROVIDER=birdeye` + `BIRDEYE_API_KEY`, SMTP vars,
`DISCORD_BOT_TOKEN`/`TELEGRAM_BOT_TOKEN`, VAPID keys, OAuth client IDs, and
`AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`. See `.env.example`.
