# 🚀 ForgeMarket — Go‑Live Checklist (start selling)

Everything below is what it takes to take ForgeMarket from "built" to "accepting
real orders". Steps marked **(only you)** are dashboard/account actions I can't do
for you. Do them in order.

Live site: **https://forgemarket-store.vercel.app** · Vercel project: **forgemarket**

---

## 0. Merge the code  **(only you)**
All the latest work (new design, animations, fixes, Discord) is in **PR #5**.
- Merge it → https://github.com/dm2book/NexusHub/pull/5
- Vercel auto‑deploys on merge.

## 1. Database  **(only you)**
The shop, login and orders need Postgres connected to the **forgemarket** project.
- Vercel → project **forgemarket** → **Storage** → **Connect Database** → pick your
  existing **Neon** DB → Connect. This injects `DATABASE_URL` / `POSTGRES_*`.
- The catalog auto‑seeds on first boot (no `SEED_DEMO` needed).

## 2. Payments — REQUIRED to sell  **(only you)**
> Right now `paymentMode` resolves to **none** in production (no Stripe key), so
> customers can't check out. Pick ONE:

**A) Real money (Stripe) — recommended**
1. Create a [Stripe](https://stripe.com) account → get your **Secret key** (`sk_live_…`).
2. Vercel env vars (project forgemarket):
   - `STRIPE_SECRET_KEY=sk_live_…`
   - `STRIPE_WEBHOOK_SECRET=whsec_…`
3. Stripe Dashboard → Developers → **Webhooks** → add endpoint
   `https://forgemarket-store.vercel.app/api/payments/stripe/webhook`
   → events: `checkout.session.completed`, `checkout.session.expired` → copy the
   signing secret into `STRIPE_WEBHOOK_SECRET`.

**B) Test the full flow without real money**
- Set `DEMO_PAYMENTS=true` (marks orders paid without a PSP). **Turn this OFF before
  taking real customers** — anyone could "buy" for free.

## 3. Email — REQUIRED for login codes + order emails  **(only you)**
Customers sign in with a one‑time code and get order confirmations by email.
1. [Resend](https://resend.com) → **API Keys** → create one (`re_…`).
2. Vercel env var: `RESEND_API_KEY=re_…`
3. ⚠️ **Verify a domain in Resend** (Resend → Domains) and set
   `EMAIL_FROM_ADDRESS=no-reply@yourdomain`. The default `onboarding@resend.dev`
   only delivers to *your own* Resend account email — fine for a test, **not** for
   real customers. A verified domain is required to email buyers.

## 4. Other env vars  **(only you)** — project forgemarket → Environment Variables
| Variable | Value | Why |
|---|---|---|
| `JWT_SECRET` | a long random string | signs sessions (required in prod) |
| `APP_URL` | `https://forgemarket-store.vercel.app` | email links / redirects (already defaults) |
| `DISCORD_INVITE_URL` | `https://discord.gg/vNcfgDbVd` | Join button (already defaults) |
| `DISCORD_ORDER_WEBHOOK_URL` | a Discord channel webhook | (optional) post sales to an ops channel |
| `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID` | from your bot | (optional) auto VIP/Customer roles on purchase |

After setting vars → **Deployments → Redeploy**.

## 5. Make yourself admin  **(only you)**
1. Set env var `ADMIN_EMAILS=youremail@example.com` (comma-separated for several).
2. Sign in at `/login` with that email — you're auto‑granted the **owner** role, so
   the **/admin** dashboard unlocks (products, orders, suppliers, fulfilment, emails).

## 6. Catalog & pricing  **(you, in the app)**
- The shop auto‑fills with the demo catalog (Robux, V‑Bucks, etc., Eldorado‑style
  pricing). Review/adjust prices and add stock in **/admin/products**.
- Hook suppliers/fulfilment in **/admin/suppliers** + **/admin/fulfillment** (or
  fulfil manually — orders show in **/admin/orders** with a "Complete order" action).

## 7. Discord  **(only you — run once)**
```bash
git pull && cd discord && npm install
cp .env.example .env   # fill DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
npm run setup          # builds roles/channels/gate/panels
npm run register       # slash commands (/rank /leaderboard /giveaway /reroll …)
npm run start          # run the bot (keep it on a host: Railway/Render/VPS)
```
Developer Portal → your **ForgeMarket** bot → enable **Server Members** +
**Message Content** intents. In Server Settings → Roles, drag **Bot** above
*Verified Customer / VIP*.

## 8. Smoke test before announcing
- [ ] Open the site → shop shows products
- [ ] Enter email at `/login` → receive the 6‑digit code → sign in
- [ ] Add an item → checkout → pay (Stripe test card `4242 4242 4242 4242`, or demo)
- [ ] Order appears in `/admin/orders`; complete it → buyer gets the delivery email
- [ ] Track the order at `/track`
- [ ] Discord: join → verify → buy → VIP/Customer role granted (if bot token set)

## 9. Rotate exposed secrets ⚠️
You shared a Discord token, a Vercel token and a Resend key in chat earlier —
**rotate all three** (Discord Dev Portal → Reset Token, Vercel → Tokens, Resend →
API Keys) and only store them as Vercel env vars, never in code or chat.

---

### TL;DR — minimum to take the first real order
1. Merge PR #5  2. Connect Neon DB  3. `RESEND_API_KEY` + verified domain
4. `STRIPE_SECRET_KEY` (+ webhook)  5. `JWT_SECRET`  6. Redeploy  7. Smoke test.
