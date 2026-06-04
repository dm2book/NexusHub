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

const env = process.env;
export const isProd = env.NODE_ENV === 'production';

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  port: Number(env.PORT || 4000),

  // Public origin of the storefront SPA, used for CORS + email links + OAuth redirects.
  appUrl: env.APP_URL || 'http://localhost:3000',
  apiUrl: env.API_URL || 'http://localhost:4000',

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
    // Invite link for the Join button. Falls back gracefully if unset.
    inviteUrl: env.DISCORD_INVITE_URL || '',
    // Optional webhook to post order events into an ops/sales channel.
    orderWebhookUrl: env.DISCORD_ORDER_WEBHOOK_URL || '',
  },

  email: {
    // When SMTP is not configured, the email service falls back to a JSON
    // transport that records messages in the email_log table (never silently
    // dropping them). This keeps non-production environments fully functional.
    smtpUrl: env.SMTP_URL || '',
    fromName: env.EMAIL_FROM_NAME || 'ForgeMarket',
    fromAddress: env.EMAIL_FROM_ADDRESS || 'no-reply@forgemarket.app',
    brandColor: env.EMAIL_BRAND_COLOR || '#6366f1',
    logoUrl: env.EMAIL_LOGO_URL || '',
  },

  security: {
    // Sliding-window rate limit defaults; per-route overrides live in code.
    rateLimitWindowMs: Number(env.RATE_LIMIT_WINDOW_MS || 60_000),
    rateLimitMax: Number(env.RATE_LIMIT_MAX || 120),
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
  },
};

/** Throws on startup if production is missing critical secrets. */
export function assertProductionConfig() {
  if (!isProd) return;
  const missing = [];
  if (config.auth.jwtSecret.startsWith('dev-only')) missing.push('JWT_SECRET');
  if (!config.db.url) missing.push('DATABASE_URL (or POSTGRES_URL)');
  if (missing.length) {
    throw new Error(`Refusing to start in production without: ${missing.join(', ')}`);
  }
  // SMTP is optional: without it, emails are still rendered and recorded in the
  // email_log table (nothing is dropped). Warn so it's not a silent surprise.
  if (!config.email.smtpUrl) {
    console.warn('[config] SMTP_URL not set — emails will be recorded to email_log, not delivered.');
  }
}
