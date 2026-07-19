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
    serverName: env.DISCORD_SERVER_NAME || 'ForgeMarket Community',
    tagline: env.DISCORD_TAGLINE || 'Drops, giveaways, support & vouches.',
    // Guild id enables live stats via the public widget.json (widget must be
    // enabled in Discord → Server Settings → Widget).
    guildId: env.DISCORD_GUILD_ID || '',
    // Invite link for the Join button. Falls back to the official server invite.
    inviteUrl: env.DISCORD_INVITE_URL || 'https://discord.gg/vNcfgDbVd',
    // Bot token — lets the API grant Discord roles (Verified vs VIP) to buyers who
    // signed in with Discord. Optional; role automation is skipped without it.
    botToken: env.DISCORD_BOT_TOKEN || '',
    // Spend (in minor units) at/above which a buyer becomes a VIP Customer.
    vipThreshold: Number(env.DISCORD_VIP_THRESHOLD_CENTS || 2000),
    // Optional webhook to post order events into an ops/sales channel.
    orderWebhookUrl: env.DISCORD_ORDER_WEBHOOK_URL || '',
    // Optional webhook for the public #drops-and-deals channel (new products,
    // restocks, coupons, bundles). Separate from the private ops webhook.
    dropsWebhookUrl: env.DISCORD_DROPS_WEBHOOK_URL || '',
    // Optional webhook for staff stock alerts; falls back to the order webhook.
    stockWebhookUrl: env.DISCORD_STOCK_WEBHOOK_URL || '',
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

  security: {
    // Sliding-window rate limit defaults; per-route overrides live in code.
    rateLimitWindowMs: Number(env.RATE_LIMIT_WINDOW_MS || 60_000),
    rateLimitMax: Number(env.RATE_LIMIT_MAX || 120),
    // Shared secret the maintenance cron must present (Vercel Cron sets the
    // Authorization header to `Bearer <CRON_SECRET>`).
    cronSecret: env.CRON_SECRET || '',
    // Fraud scoring threshold above which an order is flagged for review.
    fraudReviewThreshold: Number(env.FRAUD_REVIEW_THRESHOLD || 60),
    fraudBlockThreshold: Number(env.FRAUD_BLOCK_THRESHOLD || 85),
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
    // Manual payment methods (Tikkie / Revolut / PayPal). The customer pays via the
    // link with their order number as reference; an admin confirms in the dashboard.
    manual: {
      tikkie: env.PAY_TIKKIE || '',     // a Tikkie payment-request link
      revolut: env.PAY_REVOLUT || '',   // revolut.me/yourname
      paypal: env.PAY_PAYPAL || '',     // paypal.me/yourname or your PayPal email
      note: env.PAY_NOTE || 'After paying, your order is confirmed within minutes during open hours.',
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
config.shop = { coupons: parseCoupons(env.COUPONS), announcement: env.SITE_ANNOUNCEMENT || '' };

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
  if (config.auth.jwtSecret.startsWith('dev-only')) missing.push('JWT_SECRET');
  if (!config.db.url) missing.push('DATABASE_URL (or POSTGRES_URL)');
  if (missing.length) {
    throw new Error(`Refusing to start in production without: ${missing.join(', ')}`);
  }
  // Email delivery is optional: without Resend or SMTP, emails are rendered and
  // recorded in email_log (nothing is dropped). Warn so it's not a silent
  // surprise — but not when Resend is configured (that path delivers fine).
  if (!config.email.resendApiKey && !config.email.smtpUrl) {
    console.warn('[config] No RESEND_API_KEY or SMTP_URL — emails will be recorded to email_log, not delivered.');
  }
}
