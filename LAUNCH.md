# 🚀 ForgeMarket — Go‑Live Checklist

From "built" to "accepting real orders". Steps marked **(only you)** are dashboard
actions I can't do for you. The code is all on **`main`** and Vercel **auto‑deploys
every merge**, so there's nothing to "merge" — just set the config below.

Live site: **https://forgemarket.nl** · Vercel project: **forgemarket**

---

## 1. Database — Neon Postgres  **(only you)** — *required*
The shop, login, orders, rewards and admin all need Postgres.
- Vercel → project **forgemarket** → **Storage** → **Connect Database** → your **Neon**
  DB → Connect (injects `DATABASE_URL` / `POSTGRES_*`).
- **Use the POOLED connection** (host contains `-pooler`) for fast serverless logins.
- Schema + 4 migrations apply automatically on first request; the catalog auto‑seeds.

## 2. Core secrets  **(only you)** — *required*
Project **forgemarket** → Settings → Environment Variables:
| Variable | Value |
|---|---|
| `JWT_SECRET` | a long random string |
| `RESEND_API_KEY` | your Resend key (for login codes + order emails) |
| `EMAIL_FROM_ADDRESS` | a sender on your **verified** Resend domain (e.g. `noreply@yourdomain`) |
| `EMAIL_FROM_NAME` | `ForgeMarket` |
| `ADMIN_EMAILS` | extra owner emails (comma‑sep). `t6202600@gmail.com` is already built in. |

## 3. Payments — Tikkie / Revolut / PayPal  **(only you)**
Set any of these; the storefront auto‑switches to manual pay with a verification queue:
| Variable | Value |
|---|---|
| `PAY_TIKKIE` | your Tikkie request link |
| `PAY_REVOLUT` | `revolut.me/yourname` |
| `PAY_PAYPAL` | `paypal.me/yourname` **or** your PayPal email |
| `PAY_NOTE` | (optional) note on the pay screen |

Customers pay → submit a transaction ID/screenshot → you confirm in **Admin → Payments**.

## 4. Reviews + Discord bot link  **(only you)**
| Variable (site **and** bot) | Value |
|---|---|
| `REVIEW_INGEST_SECRET` | a shared random string (same on both) |

On the **bot** host (Railway) also set: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`,
`DISCORD_GUILD_ID`, `FORGEMARKET_API_URL=https://forgemarket.nl`,
and optionally `ANTHROPIC_API_KEY`. Then `/vouch` in Discord auto‑publishes (HMAC‑signed)
to the site's reviews + Trust Center.

## 5. Background maintenance (Phase 8)  **(only you)**
| Variable | Value |
|---|---|
| `CRON_SECRET` | a random string |

Vercel runs `/api/cron/maintenance` hourly (configured in `vercel.json`) to purge
expired codes, expire stale sessions and auto‑cancel 14‑day‑unpaid orders.
Health probe for uptime monitors: **`/api/health`**.

## 6. Optional
| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Continue with Google" |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | "Continue with Discord" |
| `COUPONS` | `CODE:percent,CODE2:percent` discount codes |
| `DISCORD_MEMBER_COUNT` | shown in trust stats if the widget isn't public |
| `MOLLIE_API_KEY` | **iDEAL, Bancontact, Apple Pay, card and PayPal.** Takes priority over the manual links — it is the only method that confirms itself and dispatches stock without you |
| `STRIPE_SECRET_KEY` | enable card payments instead of/alongside manual |

---

## 7. Smoke test (2 min) once deployed
1. Open the site → **Log in** with `t6202600@gmail.com` → code from email → you're **Owner**.
2. Top‑right **Admin 🛡** → check **Payments**, **Users**, **Analytics** (Retention panel).
3. Buy a product → submit a fake transaction ID → confirm it in **Admin → Payments** → order completes.
   With `MOLLIE_API_KEY` set: buy a product → pay with iDEAL → you land back on the
   success page, which waits for the real confirmation before it says "payment
   received" → the order shows **Payment Received** and any in-stock code is
   emailed automatically. Then refund it from **Admin → Orders**; the money goes
   back through Mollie before the status changes, so the two can never disagree.
4. Account → **Rewards**: loyalty tier, referral link, Forge+.

## 8. Security housekeeping  **(only you)**
Rotate anything ever pasted in chat: Discord **bot token**, Vercel token, Resend key.
Generate fresh values and set them only as env vars.

---

### What's live (all 8 phases)
Security (OTP throttle + audit, refresh rotation, sessions, signed ingest) ·
Payment verification queue · Race‑safe fulfillment + supplier dashboard · Trust
Center + live social proof · Loyalty/Affiliate/Forge+ · 8 admin dashboards ·
Mobile UI + motion · Cron maintenance + health + structured logs.
