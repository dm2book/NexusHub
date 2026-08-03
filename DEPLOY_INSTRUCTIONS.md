# 🚀 ForgeMarket — Deploy everything on Vercel

ForgeMarket runs as a single Vercel project: the React storefront/dashboards are
served as static files, and the whole Express API runs as one serverless
function under `/api/*` (`api/index.js` → `server/src/app.js`). Data lives in
Postgres. On the first request after a deploy the API **auto-migrates and seeds**
the database (roles, permissions, email templates) — no manual step.

## Step 1 — Push the repo to GitHub
This branch already contains everything (`api/`, `server/`, the SPA, `vercel.json`).

## Step 2 — Create the Vercel project
1. Go to **vercel.com → Add New → Project** and import this GitHub repo.
2. Framework preset: **Vite** (auto-detected). Build `npm run build`, output `dist`.
   `vercel.json` already wires the API function + SPA routing — leave the rest default.
3. Don't deploy yet — add the database + env vars first (Step 3-4).

## Step 3 — Add a Postgres database
In the project's **Storage** tab → **Create Database → Postgres** (Neon-backed).
Vercel injects `POSTGRES_URL` (pooled) into the project automatically — the API
reads it. (Any external Neon/Supabase Postgres works too: set `DATABASE_URL`.)

## Step 4 — Set environment variables
Project → **Settings → Environment Variables**:

| Variable | Required | Value |
|----------|----------|-------|
| `JWT_SECRET` | ✅ | a long random string |
| `NODE_ENV` | ✅ | `production` |
| `DATABASE_SSL` | ✅ | `true` |
| `APP_URL` | ✅ | your deployed URL, e.g. `https://forgemarket.vercel.app` |
| `API_URL` | ✅ | same URL (API is same-origin) |
| `POSTGRES_URL` | auto | set by Vercel Postgres (or set `DATABASE_URL` yourself) |
| `MOLLIE_API_KEY` | recommended | `live_…` from my.mollie.com → Developers → API keys. Enables iDEAL, Bancontact, Apple Pay, credit card and PayPal, and takes priority over every other method. A `test_` key makes the server refuse to boot in production. |
| `MOLLIE_WEBHOOK_BASE` | only locally | leave empty in production — the webhook uses `API_URL` and needs no setup in the Mollie dashboard. Locally, point it at a tunnel (Mollie cannot reach `localhost`). |
| `STRIPE_SECRET_KEY` | optional | enables real card payments via Stripe Checkout (`sk_live_…`/`sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | `whsec_…` — set the webhook endpoint to `https://YOUR-URL/api/payments/stripe/webhook` (event `checkout.session.completed`) |
| `FRAUD_REVIEW_THRESHOLD` / `FRAUD_BLOCK_THRESHOLD` | optional | default `60` / `85`. At or above review, an order is paid but **no code is delivered** until you approve it in Admin → Security → Fraud review. At or above block, it is refused at checkout. |
| `LIMIT_CHECKOUT_PER_MINUTE` | optional | default `20` per IP. The first limit a burst hits — raise it before a drop, because everyone behind one NAT (school, office, mobile carrier) shares an address. |
| `LIMIT_ORDERS_PER_EMAIL_DAY` / `LIMIT_ORDERS_PER_IP_DAY` | optional | default `8` / `15` per rolling 24h. `0` disables. |
| `LIMIT_VALUE_PER_EMAIL_DAY` / `LIMIT_MAX_ORDER_VALUE` | optional | in cents; default `100000` (€1000/day per customer) and `50000` (€500 max single order). `0` disables. |
| `DEMO_PAYMENTS` | optional | `true` marks orders paid instantly (no PSP). Used only when Stripe is not configured. |
| `SMTP_URL` | optional | e.g. `smtps://user:pass@smtp.host:465` — without it, emails are recorded to `email_log` instead of delivered |
| `EMAIL_FROM_NAME` / `EMAIL_FROM_ADDRESS` | optional | branded sender |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | enables Google login |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | optional | enables Discord login |
| `DISCORD_BOT_TOKEN` | for roles | lets the site grant and **revoke** the customer / VIP / reviewer / loyalty roles. The bot's own role must sit **above** every managed role in Server Settings → Roles, or Discord refuses the assignment. Check it at Admin → Security → Discord. |
| `DISCORD_VIP_THRESHOLD_CENTS` | optional | lifetime paid spend for VIP; default `20000` (€200) |
| `DISCORD_ROLE_CUSTOMER` / `DISCORD_ROLE_VIP` / `DISCORD_ROLE_REVIEW` | optional | rename the managed roles if your server already uses different names |
| `DISCORD_GUILD_ID` | optional | shows **live** online count + member avatars on `/discord` (enable the server Widget in Discord) |
| `DISCORD_INVITE_URL` | optional | the `https://discord.gg/…` link behind the Join button |
| `DISCORD_ORDER_WEBHOOK_URL` | optional | posts order events (received/completed/refunded) to a Discord channel |
| `DISCORD_SERVER_NAME` / `DISCORD_TAGLINE` | optional | branding for the community page |

For OAuth, set the provider redirect URLs to
`https://YOUR-URL/api/auth/oauth/google/callback` and `/discord/callback`.

## Step 5 — Deploy
Click **Deploy**. After the build, open the URL — the storefront loads and the
first API call migrates + seeds Postgres.

## Step 6 — Make yourself the Owner
Sign in once (email OTP) to create your account, then promote it. Either:

- **Locally** against the same DB:
  ```bash
  cd server && npm install
  DATABASE_URL="<your POSTGRES_URL>" DATABASE_SSL=true \
    node src/db/seed.js grant you@example.com owner
  ```
- **Or** one row in the Vercel Postgres query console:
  ```sql
  INSERT INTO user_roles (user_id, role_id, granted_at)
  SELECT id, 'owner', now()::text FROM users WHERE email='you@example.com';
  ```

Now `/admin` is unlocked. 🎉

## Optional — fill the shop with a demo catalog
A fresh store is empty. To showcase the storefront instantly with realistic
products (Robux, Nitro, Steam/PSN/Xbox cards, V-Bucks), run once against your DB:

```bash
cd server && DATABASE_URL="<your POSTGRES_URL>" DATABASE_SSL=true npm run seed:demo
```

It's opt-in, safe to re-run, and you can edit/remove the items in the admin
console. Skip it if you'll add your own products.

---

## Run locally
```bash
# Postgres (any local instance), then:
cd server && cp .env.example .env   # point DATABASE_URL at your DB
npm install && npm run setup        # migrate + seed
npm start                           # API on :4000

# storefront (repo root, separate terminal)
npm install && npm run dev          # :3000, proxies /api → :4000
```

## Alternative host (stateful Node)
The same code runs on Render/Railway/Fly/containers: set `DATABASE_URL`, run
`npm run setup` once, then `npm start` (uses `server/src/index.js`). On those
platforms you can serve the SPA separately or behind the same domain.
