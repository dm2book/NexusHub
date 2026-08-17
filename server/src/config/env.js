/**
 * Centralized configuration. Everything is environment-driven so the same
 * build runs in dev, staging and production without code changes.
 *
 * No secrets are hardcoded. In production the listed *_REQUIRED values must be
 * supplied via the environment (see .env.example).
 */
import 'dotenv/config'; // load server/.env (no-op on platforms that inject env, e.g. Vercel)
import process from 'node:process';

const bool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

/** Pull a Resend API key out of a Resend SMTP URL, e.g.
 *  smtps://resend:re_xxx@smtp.resend.com:465 → re_xxx. Returns '' otherwise. */
function extractResendKey(smtpUrl) {
  if (!smtpUrl || !/resend/i.test(smtpUrl)) return '';
  try {
    const pw = decodeURIComponent(new URL(smtpUrl).password || '');
    return /^re_/.test(pw) ? pw : '';
  } catch { return ''; }
}

const env = process.env;
export const isProd = env.NODE_ENV === 'production';

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  port: Number(env.PORT || 4000),

  // Public origin of the storefront SPA, used for CORS + email links + OAuth
  // redirects. In production we fall back to the live URL so emails/links work
  // with zero extra config (override with APP_URL if you use another domain).
  appUrl: env.APP_URL
    || (isProd ? 'https://forgemarket.nl' : 'http://localhost:3000'),
  apiUrl: env.API_URL
    || (isProd ? 'https://forgemarket.nl' : 'http://localhost:4000'),

  db: {
    // Postgres connection string. Different hosts/integrations expose it under
    // different names — accept all common ones (Vercel Postgres, Neon, Supabase).
    url: env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL
      || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL_UNPOOLED || '',
    // Enable SSL for hosted databases (Neon/Vercel/Supabase require it).
    ssl: bool(env.DATABASE_SSL, isProd),
  },

  // Optionally seed a demo catalog on first boot (handy for a fresh deploy).
  seedDemo: bool(env.SEED_DEMO, false),

  auth: {
    // Signing secret for session JWTs. MUST be overridden in production.
    jwtSecret: env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
    accessTtl: env.ACCESS_TOKEN_TTL || '15m',
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS || 30),
    otpTtlMinutes: Number(env.OTP_TTL_MINUTES || 10),
    otpMaxAttempts: Number(env.OTP_MAX_ATTEMPTS || 5),
    cookieName: env.SESSION_COOKIE || 'fm_session',
    // Emails that are auto-granted the "owner" role on login (bootstrap admin).
    // Always includes the store owner(s); extend via the ADMIN_EMAILS env var
    // (comma-separated). Matching is case-insensitive.
    adminEmails: [
      'mohamedelhannouti51@gmail.com',
      't6202600@gmail.com',
      ...(env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    ],
  },

  oauth: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID || '',
      clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    },
    discord: {
      clientId: env.DISCORD_CLIENT_ID || '',
      clientSecret: env.DISCORD_CLIENT_SECRET || '',
    },
  },

  discord: {
    // Server name shown on the community page (always present).
    serverName: env.DISCORD_SERVER_NAME || 'ForgeMarket Support',
    tagline: env.DISCORD_TAGLINE || 'Order help, delivery updates, drops & giveaways.',
    // Guild id enables live stats via the public widget.json (widget must be
    // enabled in Discord → Server Settings → Widget).
    guildId: env.DISCORD_GUILD_ID || '',
    // Invite link for the Join button. Falls back to the official server invite.
    inviteUrl: env.DISCORD_INVITE_URL || 'https://discord.gg/CrAfqENsSV',
    // Bot token — lets the API grant Discord roles (Verified vs VIP) to buyers who
    // signed in with Discord. Optional; role automation is skipped without it.
    botToken: env.DISCORD_BOT_TOKEN || '',
    // Lifetime paid spend (in cents) at or above which a buyer becomes VIP.
    // Lifetime, not per order: this used to compare a SINGLE order total, so
    // someone who spent €500 across twenty orders was never VIP while a one-off
    // €20 order was. VIP means a good customer, not a big afternoon.
    vipThreshold: Number(env.DISCORD_VIP_THRESHOLD_CENTS || 20_000),
    /**
     * The role names the site manages, matched in the guild BY NAME.
     *
     * Configurable because a server that already has a "Customer" role should
     * not end up with two. Anything not present in the guild is skipped and
     * reported by the diagnostics endpoint rather than failing silently — a role
     * that quietly does nothing is worse than one that says it is missing.
     */
    roles: {
      customer: env.DISCORD_ROLE_CUSTOMER || 'Verified Customer',
      vip: env.DISCORD_ROLE_VIP || 'VIP Customer',
      review: env.DISCORD_ROLE_REVIEW || 'Reviewer',
    },
    // Optional webhook to post order events into an ops/sales channel.
    orderWebhookUrl: env.DISCORD_ORDER_WEBHOOK_URL || '',
    // Optional webhook for the public #drops-and-deals channel (new products,
    // restocks, coupons, bundles). Separate from the private ops webhook.
    dropsWebhookUrl: env.DISCORD_DROPS_WEBHOOK_URL || '',
    // Optional webhook for staff stock alerts; falls back to the order webhook.
    stockWebhookUrl: env.DISCORD_STOCK_WEBHOOK_URL || '',
    // Optional webhook for the public #reviews channel. Unset is the normal
    // case: the community bot relays reviews through the signed outbox instead.
    reviewsWebhookUrl: env.DISCORD_REVIEWS_WEBHOOK_URL || '',
    // Alert when a product's available code count drops below this.
    lowStockThreshold: Number(env.LOW_STOCK_THRESHOLD || 5),
    // Live member count shown on the storefront trust stats (optional).
    memberCount: Number(env.DISCORD_MEMBER_COUNT || 0) || null,
    // Shared secret the bot uses to push /vouch reviews to /api/reviews/ingest.
    reviewIngestSecret: env.REVIEW_INGEST_SECRET || '',
  },

  // SMS / phone OTP via Twilio. Without credentials, phone codes are logged to
  // the server console in non-prod (so the flow is testable) and disabled in prod.
  sms: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    from: env.TWILIO_FROM || '',
    enabled: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM),
  },

  email: {
    // When SMTP is not configured, the email service falls back to a JSON
    // transport that records messages in the email_log table (never silently
    // dropping them). This keeps non-production environments fully functional.
    smtpUrl: env.SMTP_URL || '',
    // Resend HTTP API key — the most reliable path on serverless (Vercel), where
    // raw SMTP connections are often slow or blocked. If only SMTP_URL is set and
    // it points at Resend, we extract the key from it automatically.
    resendApiKey: env.RESEND_API_KEY || extractResendKey(env.SMTP_URL) || '',
    fromName: env.EMAIL_FROM_NAME || 'ForgeMarket',
    // Default to Resend's shared sender, which delivers WITHOUT verifying a
    // custom domain — so login codes work the moment SMTP_URL is set. Switch to
    // your own address (e.g. no-reply@yourdomain) once that domain is verified.
    fromAddress: env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev',
    brandColor: env.EMAIL_BRAND_COLOR || '#6366f1',
    logoUrl: env.EMAIL_LOGO_URL || '',
  },

  /**
   * Where the OWNER is told a sale, a refund or a chargeback happened.
   *
   * Separate from `discord` above on purpose: that one is the shop's public and
   * ops plumbing, and without a webhook URL its events queue for the bot, which
   * polls once a minute. These are alerts, and they are worth nothing a minute
   * late. Every channel is optional and independent — set the one you read.
   */
  notify: {
    // Falls back to the ops webhook so an existing setup keeps working.
    discordWebhookUrl: env.NOTIFY_DISCORD_WEBHOOK_URL || '',
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || '',
      chatId: env.TELEGRAM_CHAT_ID || '',
    },
    pushover: {
      token: env.PUSHOVER_TOKEN || '',
      user: env.PUSHOVER_USER || '',
    },
  },

  security: {
    // Sliding-window rate limit defaults; per-route overrides live in code.
    rateLimitWindowMs: Number(env.RATE_LIMIT_WINDOW_MS || 60_000),
    rateLimitMax: Number(env.RATE_LIMIT_MAX || 120),
    // Shared secret the maintenance cron must present (Vercel Cron sets the
    // Authorization header to `Bearer <CRON_SECRET>`).
    cronSecret: env.CRON_SECRET || '',
    // Fraud scoring thresholds.
    //
    // `review` holds the delivery: the order is paid and normal, but no code
    // leaves the shop until a person has looked at it. `block` refuses the order
    // outright at checkout, before any money is asked for.
    //
    // Digital goods are irreversible — once a code is read it cannot be taken
    // back, and a chargeback lands weeks later with nothing to reclaim. That is
    // why review holds delivery rather than merely colouring a row in the admin.
    fraudReviewThreshold: Number(env.FRAUD_REVIEW_THRESHOLD || 60),
    fraudBlockThreshold: Number(env.FRAUD_BLOCK_THRESHOLD || 85),

    /**
     * How many orders one address may place per MINUTE.
     *
     * Separate from the daily ceilings below, and the wall a burst actually
     * hits first — measured: with the daily limits disabled entirely, a single
     * address was still refused at order 21.
     *
     * That is correct against one abusive buyer. It is also what a school, an
     * office or a mobile carrier looks like, because everyone behind one NAT
     * shares an address — so a genuine group buying during a drop gets a 429 at
     * the checkout button. Raise it before a drop; there is no code change.
     */
    checkoutPerMinute: Number(env.LIMIT_CHECKOUT_PER_MINUTE || 20),

    // Hard limits, checked before an order is even created. These are not risk
    // signals — they are ceilings. A shop run by one person has no legitimate
    // buyer placing fifteen orders in a day, and the damage a stolen card can do
    // in one night is exactly what these bound.
    //
    // Set any of them to 0 to switch that limit off.
    orderLimits: {
      // Per email address, rolling 24h.
      perEmailPerDay: Number(env.LIMIT_ORDERS_PER_EMAIL_DAY ?? 8),
      // Per IP, rolling 24h. Higher than the email limit: a household, a school
      // or a phone network legitimately shares one address.
      perIpPerDay: Number(env.LIMIT_ORDERS_PER_IP_DAY ?? 15),
      // Total value one email may order in 24h, in cents.
      valuePerEmailPerDay: Number(env.LIMIT_VALUE_PER_EMAIL_DAY ?? 100_000),
      // Largest single order, in cents. The ceiling on one mistake.
      maxOrderValue: Number(env.LIMIT_MAX_ORDER_VALUE ?? 50_000),
    },
  },

  payments: {
    // Demo mode lets the storefront mark an order paid without a real PSP, so
    // the full order → fulfillment loop is usable in a demo. Defaults ON outside
    // production; set DEMO_PAYMENTS=true to enable it on a live deploy.
    demoMode: bool(env.DEMO_PAYMENTS, !isProd),
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY || '',
      webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    },
    // Mollie: hosted checkout for iDEAL, Bancontact, Apple Pay, card and PayPal.
    // One key switches it on. There is no webhook secret to configure — Mollie
    // signs nothing, and the webhook is verified by fetching the payment back
    // from the API instead (see mollieService).
    mollie: {
      apiKey: (env.MOLLIE_API_KEY || '').trim(),
      // Optional. Mollie must be able to REACH the webhook, so on a preview
      // deployment or a tunnel this has to be the public origin rather than
      // whatever API_URL happens to be.
      webhookBase: (env.MOLLIE_WEBHOOK_BASE || '').trim(),
    },
    // Manual payment methods (Tikkie / Revolut / PayPal). The customer pays via the
    // link with their order number as reference; an admin confirms in the dashboard.
    manual: {
      tikkie: env.PAY_TIKKIE || '',     // a Tikkie payment-request link
      revolut: env.PAY_REVOLUT || '',   // revolut.me/yourname
      paypal: env.PAY_PAYPAL || '',     // paypal.me/yourname or your PayPal email
      // Empty by default: an owner-written note cannot be translated, so a
      // hardcoded English one would sit on a Dutch page forever. The storefront
      // shows its own translated line when this is unset.
      note: env.PAY_NOTE || '',
    },
  },
};

/** Parse "FORGE10:10,WELCOME5:5" → { FORGE10: 10, WELCOME5: 5 } (percent off). */
function parseCoupons(s) {
  const out = {};
  (s || '').split(',').forEach((p) => {
    const [c, v] = p.split(':');
    const code = (c || '').trim().toUpperCase();
    const pct = Math.max(0, Math.min(90, parseInt(v, 10) || 0));
    if (code && pct) out[code] = pct;
  });
  return out;
}
/**
 * Normalize a link that must leave this site.
 *
 * Copying a URL out of a browser that hides the scheme gives you
 * "nl.trustpilot.com/review/…", and an <a href> without a scheme is a
 * RELATIVE path: the visitor lands on forgemarket.nl/nl.trustpilot.com/… —
 * our own 404 — instead of the profile. The Discord bot already fixes this up
 * for its own copy, so the mistake would work there and break only on the
 * website, which is the hardest kind to notice.
 */
const externalUrl = (v) => {
  const u = String(v || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
};

/**
 * The "write a review" URL that belongs with a given profile URL.
 *
 * Reading and writing are different jobs. A surface that says "see what others
 * think" should open the profile; a surface that ASKS for a review should open
 * the form, because every extra click between the ask and the box costs
 * reviews. Trustpilot spells the second one /evaluate/ instead of /review/.
 *
 * Derived rather than demanded: filling in two near-identical URLs by hand is
 * two chances to paste the wrong one. TRUSTPILOT_REVIEW_URL still overrides it
 * for a shop whose form lives somewhere unusual.
 *
 * The host check matters. Without it any URL containing "/review/" would get
 * rewritten into a path that may not exist — so anything we do not recognise
 * falls back to the profile, which always has a "Write a review" button on it.
 * A longer route beats a broken one.
 */
const trustpilotWriteUrl = (profile) => {
  if (!profile) return '';
  try {
    const u = new URL(profile);
    if (!/(^|\.)trustpilot\.com$/i.test(u.hostname)) return profile;
    if (!/^\/review\//i.test(u.pathname)) return profile;
    u.pathname = u.pathname.replace(/^\/review\//i, '/evaluate/');
    return u.toString().replace(/\/+$/, '');
  } catch { return profile; }
};

const trustpilotUrl = externalUrl(env.TRUSTPILOT_URL);
config.shop = {
  coupons: parseCoupons(env.COUPONS),
  announcement: env.SITE_ANNOUNCEMENT || '',
  // Public Trustpilot profile. Empty until the shop has one — every surface
  // renders the link only when it is set, so an unconfigured shop never sends
  // a buyer to a page that does not exist. An env var rather than a constant
  // so the URL can change without a rebuild.
  trustpilotUrl,
  // Where we send someone we are actively asking for a review.
  trustpilotReviewUrl: externalUrl(env.TRUSTPILOT_REVIEW_URL) || trustpilotWriteUrl(trustpilotUrl),
};

/** Validate a coupon code → { code, percent } or null. */
export function couponFor(code) {
  if (!code) return null;
  const pct = config.shop.coupons[String(code).trim().toUpperCase()];
  return pct ? { code: String(code).trim().toUpperCase(), percent: pct } : null;
}

/** Enabled manual payment methods as [{id,label,target,kind}]. */
export function manualPayMethods() {
  const m = config.payments.manual, out = [];
  if (m.tikkie) out.push({ id: 'tikkie', label: 'Tikkie', target: m.tikkie, kind: 'link' });
  if (m.revolut) out.push({ id: 'revolut', label: 'Revolut', target: m.revolut, kind: 'link' });
  if (m.paypal) out.push({ id: 'paypal', label: 'PayPal', target: m.paypal.includes('@') ? m.paypal : m.paypal, kind: m.paypal.includes('@') ? 'email' : 'link' });
  return out;
}

/** Throws on startup if production is missing critical secrets. */
export function assertProductionConfig() {
  if (!isProd) return;
  const missing = [];
  // Only what leaves the application unsafe or inert at EVERY level. A dev JWT
  // secret is committed to this repository, so anyone who reads it can mint a
  // session for any account; without a database nothing responds anyway. There
  // is no useful degraded mode for either, so refusing to start is honest.
  if (config.auth.jwtSecret.startsWith('dev-only')) missing.push('JWT_SECRET');
  if (!config.db.url) missing.push('DATABASE_URL (or POSTGRES_URL)');
  if (missing.length) {
    throw new Error(`Refusing to start in production without: ${missing.join(', ')}`);
  }
}

/**
 * Reasons this shop must not accept an order right now.
 *
 * These used to live in assertProductionConfig, which meant a missing email key
 * took the ENTIRE site down: no storefront, no order tracking, and — worst of
 * all — no admin panel, so the owner could not sign in to discover why. The
 * function crashed at module scope, Vercel answered every request with the plain
 * text "A server error has occurred", and the only visible symptom was a JSON
 * parse error in the browser. A boot-time absolute for a runtime concern.
 *
 * The thing actually worth preventing is narrower than "the site exists": it is
 * TAKING MONEY the shop cannot honour. So refuse the checkout and leave
 * everything else running. Nobody is charged, the owner can still log in and
 * fix it, and buyers can still track the orders they already placed.
 */
export function commerceBlockers() {
  const reasons = [];
  // The only way a guest receives what they bought. Without a transport
  // sendEmail records to email_log and resolves happily, so an order completes,
  // the track page says to check the spam folder, and the code sits in a table
  // nobody reads.
  if (!config.email.resendApiKey && !config.email.smtpUrl) {
    reasons.push('there is no way to email the buyer their code (set RESEND_API_KEY or SMTP_URL)');
  }
  if (isProd) {
    // Demo mode marks orders paid without any money arriving — live, that hands
    // out codes for free.
    if (config.payments.demoMode) {
      reasons.push('demo payments are on, which marks orders paid without any money arriving (set DEMO_PAYMENTS=false)');
    }
    // A test key takes real buyers to Mollie's sandbox: the order is marked paid
    // and nothing moves. Silent until the bank statement disagrees.
    if (/^test_/.test(config.payments.mollie.apiKey)) {
      reasons.push('MOLLIE_API_KEY is a test key, so no payment would be real (use the live key)');
    }
  }
  return reasons;
}
