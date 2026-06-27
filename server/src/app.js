/**
 * Express app factory. Builds and returns the configured app WITHOUT listening,
 * so it can be used both by the standalone server (index.js) and by a serverless
 * handler (../../api/index.js on Vercel).
 *
 * `ensureReady()` lazily runs migrations + seed once per process — safe for
 * serverless cold starts where there's no separate deploy step.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { config } from './config/env.js';
import { get } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed, isSeeded } from './db/seed.js';
import { seedDemoCatalog } from './db/demoSeed.js';
import { attachUser } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

import authRoutes from './routes/auth.js';
import cronRoutes from './routes/cron.js';
import accountRoutes from './routes/account.js';
import catalogRoutes from './routes/catalog.js';
import discordRoutes from './routes/discord.js';
import paymentRoutes from './routes/payments.js';
import adminRoutes from './routes/admin/index.js';

let readyPromise = null;
/** Run migrations + (idempotent) seed exactly once per process. */
export function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await migrate();
      if (!(await isSeeded())) await seed();
      // Zero-config: auto-fill the catalog whenever the shop is empty, so a fresh
      // deploy is never an empty store. (SEED_DEMO=true also forces a re-sync.)
      const { n } = await get('SELECT COUNT(*) AS n FROM products WHERE active = 1').catch(() => ({ n: 1 }));
      if (config.seedDemo || Number(n) === 0) await seedDemoCatalog();
    })().catch((err) => {
      readyPromise = null; // allow retry on next request
      throw err;
    });
  }
  return readyPromise;
}

export function createApp({ lazyReady = false } = {}) {
  const app = express();
  app.set('trust proxy', 1);

  // CORS: allow the storefront origin. Same-origin deploys don't need it but it
  // is harmless and supports split frontend/api domains.
  app.use(cors({ origin: config.appUrl, credentials: true }));
  // Stripe webhook needs the raw body for signature verification — mount it
  // BEFORE the JSON parser.
  app.use('/api/payments/stripe/webhook', express.raw({ type: '*/*' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // On serverless, make sure the schema exists before handling API traffic.
  if (lazyReady) {
    app.use(async (_req, _res, next) => {
      try { await ensureReady(); next(); } catch (err) { next(err); }
    });
  }

  // Structured request logging → Vercel logs (method, path, status, duration).
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/health') return; // don't spam logs with health pings
      console.log(JSON.stringify({
        lvl: res.statusCode >= 500 ? 'error' : 'info',
        method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t,
      }));
    });
    next();
  });

  // Health + scheduled maintenance — mounted before auth/rate-limit so uptime
  // monitors and Vercel Cron aren't throttled or require a session.
  app.use('/api', cronRoutes);

  app.use(attachUser);
  app.use('/api', rateLimit({ bucket: 'api' }));

  app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/discord', discordRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
