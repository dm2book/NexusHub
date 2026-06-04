# MemeForge — Go Live (working public link)

MemeForge is full-stack: a **web** app (Vercel) + a **long-running API**
(Express/WebSocket/cron) + **PostgreSQL**. A web-only deploy looks fine but
login/data won't work — the API must be live too.

Recommended split:

| Part | Host | Why |
|------|------|-----|
| Web (Next.js) | **Vercel** | Best Next.js host |
| API (Express + WS + cron) | **Railway / Render / Fly.io** | Needs a persistent process |
| Database | **Neon / Supabase / Railway Postgres** | Managed PostgreSQL |

It runs on the **mock data engine** with zero third-party keys, so a public demo
needs only: an API host, a Postgres URL, and Vercel.

---

## A. Database (Neon — free)
1. Create a project at neon.tech → copy the `DATABASE_URL`.

## B. API (Railway — easiest)
1. New project → Deploy from GitHub repo `dm2book/nexushub`.
2. Settings → Build: use Dockerfile `apps/api/Dockerfile` (or Nixpacks with
   build `npm run build -w @memeforge/shared && npm run build -w @memeforge/api`
   and start `node apps/api/dist/index.js`).
3. Env vars:
   ```
   DATABASE_URL=<from Neon>
   JWT_SECRET=<long random string>
   OWNER_EMAIL=mohamedelhannouti51@gmail.com
   WEB_BASE_URL=https://<your-vercel-domain>
   API_PORT=4000
   ```
4. After first deploy, run once: `npx prisma migrate deploy` then `npm run db:seed`
   (Railway shell), or rely on the Dockerfile's `migrate deploy` on boot.
5. Copy the public API URL, e.g. `https://memeforge-api.up.railway.app`.

## C. Web (Vercel)
1. vercel.com → Add New → Project → import `dm2book/nexushub`.
2. Root Directory: **repo root** (the included `vercel.json` builds the web app).
3. Env vars:
   ```
   NEXT_PUBLIC_API_BASE_URL=https://<your API url>
   ```
4. Deploy → you get `https://<project>.vercel.app`.

## D. Log in
Open the Vercel URL → sign in with `OWNER_EMAIL`. If SMTP isn't configured the
OTP is returned in dev mode and printed in the API logs.

---

## Doing it via CLI (if you give me a token)
With a `VERCEL_TOKEN` I can run, from repo root:
```bash
vercel pull --yes --environment=production --token $VERCEL_TOKEN
vercel deploy --prod --token $VERCEL_TOKEN
```
This still requires a live `NEXT_PUBLIC_API_BASE_URL` (steps A+B) to be useful.
