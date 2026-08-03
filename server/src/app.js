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
import { seed, isSeeded, syncEmailTemplates } from './db/seed.js';
import { seedDemoCatalog, syncCatalogImages } from './db/demoSeed.js';
import { seedStarterContent } from './db/starterContent.js';
import { attachUser } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { runMaintenance } from './services/maintenanceService.js';

import authRoutes from './routes/auth.js';
import cronRoutes from './routes/cron.js';
import accountRoutes from './routes/account.js';
import catalogRoutes from './routes/catalog.js';
import discordRoutes from './routes/discord.js';
import paymentRoutes from './routes/payments.js';
import mollieWebhook, { mollieApi } from './routes/mollie.js';
import seoRoutes from './routes/seo.js';
import socialRoutes from './routes/social.js';
import adminRoutes from './routes/admin/index.js';

let readyPromise = null;
/**
 * Best-effort upkeep that is NOT required to serve a request correctly, so it
 * runs once in the background after boot instead of blocking the first request.
 * On a cold serverless start this is the difference between a ~100-query stall
 * and serving immediately: template upgrades, starter content and per-product
 * art backfill all happen a beat later without the user waiting on them.
 */
let upkeepStarted = false;
function startBackgroundUpkeep(wasSeeded) {
  if (upkeepStarted) return;
  upkeepStarted = true;
  Promise.resolve().then(async () => {
    const t = Date.now();
    try {
      // Upgrade improved default email templates on already-seeded databases.
      // (A brand-new DB already got them synchronously via seed().)
      if (wasSeeded) await syncEmailTemplates();
      await seedStarterContent();
      await syncCatalogImages();
      console.log('[boot] background upkeep done in', Date.now() - t, 'ms');
    } catch (e) { console.error('[boot] background upkeep:', e.message); }
  });
}

/**
 * Run migrations + (idempotent) seed exactly once per process. Only the work
 * that a request truly depends on is awaited (schema exists; an empty catalog is
 * filled); everything else is deferred to background upkeep so a cold start
 * doesn't make the first request wait.
 */
export function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await migrate();
      const seeded = await isSeeded();
      if (!seeded) await seed(); // empty DB needs roles/permissions/templates before serving
      // Zero-config: an empty shop must have products before we serve it, else
      // the storefront is blank. An already-stocked store skips this entirely.
      const { n } = await get('SELECT COUNT(*) AS n FROM products WHERE active = 1').catch(() => ({ n: 1 }));
      if (config.seedDemo || Number(n) === 0) await seedDemoCatalog();
      // Non-critical upkeep runs AFTER we're ready to serve.
      startBackgroundUpkeep(seeded);
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
  // Mollie POSTs form data (`id=tr_xxx`), not JSON — give that one path its own
  // parser before the JSON one rejects the content type.
  app.use('/api/payments/mollie/webhook', express.urlencoded({ extended: false, limit: '16kb' }));
  // 3mb so a (base64) product image an admin uploads fits — the image guard
  // (isSafeImageValue) still caps the actual data URI below this.
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());

  // On serverless, make sure the schema exists before handling API traffic.
  if (lazyReady) {
    app.use(async (_req, _res, next) => {
      try { await ensureReady(); next(); } catch (err) { next(err); }
    });
  }

  // Self-scheduling maintenance: piggyback on live traffic so OTP purges,
  // stale-order cleanup and payment reminders run WITHOUT any external cron
  // or CRON_SECRET setup. At most once per hour per warm instance, fired
  // after the schema is ready and never blocking the request. Vercel Cron
  // (when configured) still works as a belt-and-braces backup.
  let lastMaintenanceAt = 0;
  app.use((_req, _res, next) => {
    const now = Date.now();
    if (now - lastMaintenanceAt > 3_600_000) {
      lastMaintenanceAt = now;
      runMaintenance()
        .then((s) => console.log('[maintenance:auto]', JSON.stringify(s)))
        .catch((e) => console.error('[maintenance:auto]', e.message));
    }
    next();
  });

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

  // Vercel rewrites /sitemap.xml to this function with the ORIGINAL path, so
  // alias it onto the API route where the dynamic sitemap lives.
  app.use((req, _res, next) => {
    if (req.path === '/sitemap.xml') req.url = '/api/sitemap.xml';
    next();
  });

  // Health + scheduled maintenance — mounted before auth/rate-limit so uptime
  // monitors and Vercel Cron aren't throttled or require a session.
  app.use('/api', cronRoutes);

  // Mollie's webhook is a server-to-server call with no session, and Mollie
  // retries a non-2xx for two days. Mounted before the general API rate limit so
  // a busy hour can never turn a payment confirmation into a 429; the route
  // carries its own, far more generous, limiter.
  app.use('/api/payments', mollieWebhook);

  app.use(attachUser);
  app.use('/api', rateLimit({ bucket: 'api' }));

  app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/discord', discordRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/social', socialRoutes);
  app.use('/api', mollieApi);
  app.use('/api', catalogRoutes);
  app.use('/api/admin', adminRoutes);

  // HTML for product pages, with that product's own title, description, social
  // image and Product markup in the head. Every other route is a real file
  // written at build time; a product's content lives in the database, so this
  // one is rendered per request and cached hard at the edge.
  app.use(seoRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
