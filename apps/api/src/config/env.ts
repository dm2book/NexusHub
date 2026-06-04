import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env regardless of cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config(); // also pick up a local .env if present

const bool = (v: string | undefined, d = false): boolean =>
  v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  // Most hosts (Render/Railway/Fly/Heroku) inject PORT; fall back to API_PORT.
  apiPort: num(process.env.PORT ?? process.env.API_PORT, 4000),
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:4000',
  webBaseUrl: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
  // Allow-listed browser origins in production (comma-separated). Defaults to
  // WEB_BASE_URL so a single Vercel domain works out of the box.
  corsOrigins: (process.env.CORS_ORIGINS ?? process.env.WEB_BASE_URL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  databaseUrl: process.env.DATABASE_URL ?? '',

  jwtSecret: process.env.JWT_SECRET ?? 'dev-insecure-secret-change-me',  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  ownerEmail: (process.env.OWNER_EMAIL ?? '').toLowerCase(),
  // Secret used to authorize serverless cron invocations (Vercel injects
  // "Authorization: Bearer <CRON_SECRET>" when this env var is set).
  cronSecret: process.env.CRON_SECRET ?? '',

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID ?? '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
    botToken: process.env.DISCORD_BOT_TOKEN ?? '',
    guildId: process.env.DISCORD_GUILD_ID ?? '',
    alertChannelId: process.env.DISCORD_ALERT_CHANNEL_ID ?? '',
  },
  oauthRedirectBase: process.env.OAUTH_REDIRECT_BASE ?? 'http://localhost:4000/api/v1/auth',

  dataProvider: (process.env.DATA_PROVIDER ?? 'mock') as 'mock' | 'dexscreener' | 'birdeye',
  birdeyeApiKey: process.env.BIRDEYE_API_KEY ?? '',
  heliusApiKey: process.env.HELIUS_API_KEY ?? '',
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? '',

  ai: {
    provider: (process.env.AI_PROVIDER ?? 'heuristic') as 'heuristic' | 'anthropic',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
  },

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.EMAIL_FROM ?? 'MemeForge <alerts@memeforge.local>',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:alerts@memeforge.local',
  },

  flags: {
    automation: bool(process.env.ENABLE_AUTOMATION, true),
    bot: bool(process.env.ENABLE_BOT, false),
    cron: bool(process.env.ENABLE_CRON, true),
  },
};

export type Env = typeof env;
