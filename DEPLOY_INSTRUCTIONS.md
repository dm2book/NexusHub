# 🚀 ForgeMarket Deploy Guide

ForgeMarket is now a full-stack app: a React storefront/dashboard (`/`) and an
Express API (`/server`). See `ARCHITECTURE.md` for the system overview.

## 1. Backend API (`server/`)

```bash
cd server
cp .env.example .env        # fill in JWT_SECRET, SMTP_URL, OAuth keys for prod
npm install
npm run setup               # runs migrations + seeds roles/permissions/email templates
npm start                   # listens on PORT (default 4000)
```

Bootstrap the first admin after they log in once:

```bash
node src/db/seed.js grant you@example.com owner
```

**Required in production** (`assertProductionConfig` enforces): `JWT_SECRET`, `SMTP_URL`.
Configure `GOOGLE_*` / `DISCORD_*` to enable those logins (otherwise hidden). Point
`DATABASE_FILE` at a persistent volume. Host on any Node platform (Render, Fly,
Railway, a VM, or a container) behind HTTPS.

## 2. Frontend (repo root)

```bash
npm install
npm run dev      # dev server on :3000, proxies /api → :4000
npm run build    # production bundle in dist/
```

The SPA calls the API on the **same origin** by default (works behind one domain /
reverse proxy). For a separate API host, set `VITE_API_URL=https://api.yourdomain.com`
at build time and ensure CORS `APP_URL` matches the storefront origin.

### Vercel (storefront)

Import the repo, framework **Vite**, build `npm run build`, output `dist`. Set
`VITE_API_URL` to your deployed API. `vercel.json` already SPA-rewrites and adds
security headers.

## 3. Recommended production topology

```
yourdomain.com         → static SPA (dist/)
yourdomain.com/api/*   → reverse-proxy to the Express API (same origin = no CORS)
```

Keeping API and SPA same-origin lets the httpOnly refresh cookie and JWT flow work with
zero CORS configuration.
