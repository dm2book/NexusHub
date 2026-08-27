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
/* `isSeeded` is the only thing here that a healthy production boot ever calls,
   so it is the only one imported eagerly. The rest — the roles/permissions/
   template seed, the 71-product demo catalog, the starter content — exist to
   populate an EMPTY database. On a shop that has been running for a day they are
   dead weight in the module graph of every single cold start, and the module
   graph is the most expensive part of a cold start. They load if they are used. */
import { isSeeded } from './db/seed.js';
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
      // Off the request path already, so paying the import here costs nobody.
      if (wasSeeded) await (await import('./db/seed.js')).syncEmailTemplates();
      await (await import('./db/starterContent.js')).seedStarterContent();
      await (await import('./db/demoSeed.js')).syncCatalogImages();
      console.log('[boot] background upkeep done in', Date.now() - t, 'ms');
    } catch (e) { console.error('[boot] background upkeep:', e.message); }
    await logReadiness();
  });
}

/**
 * Print the launch checklist into the boot log, once per cold start.
 *
 * Everything needed to diagnose a misconfigured shop already exists — the
 * /admin dashboard computes exactly this. It is just unreachable at the moment
 * it matters most: reading it requires signing in, signing in requires an email
 * transport, and a missing email transport is one of the things it reports. The
 * owner is locked out of the page that would explain why.
 *
 * The boot log has no such circularity, so the same answers go there too. Names
 * of settings and a status word only — never a value, never a secret. Entirely
 * best-effort: this is diagnostics, and diagnostics must never be the reason a
 * request fails.
 */
async function logReadiness() {
  try {
    const { launchChecks } = await import('./services/launchCheckService.js');
    const { ready, summary, checks } = await launchChecks();
    const mark = { ok: '✓', warn: '!', fail: '✗' };
    console.log(
      `\n[readiness] ${ready ? 'ready to sell' : summary}\n`
      + checks.map((c) => `  ${mark[c.status] || '?'} ${c.label}: ${c.detail}`).join('\n')
      + '\n',
    );
  } catch (e) {
    console.error('[readiness] could not run the launch checks:', e.message);
  }
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
      /* Two independent reads, previously awaited one after the other. On a
         laptop that is a rounding error; from a function in Frankfurt to a
         database in Virginia it is a whole extra round trip on the first request
         after every cold start, to learn two unrelated facts. */
      const [seeded, products] = await Promise.all([
        isSeeded(),
        get('SELECT COUNT(*) AS n FROM products WHERE active = 1').catch(() => ({ n: 1 })),
      ]);
      if (!seeded) await (await import('./db/seed.js')).seed(); // empty DB needs roles/permissions/templates first
      // Zero-config: an empty shop must have products before we serve it, else
      // the storefront is blank. An already-stocked store skips this entirely.
      if (config.seedDemo || Number(products.n) === 0) {
        await (await import('./db/demoSeed.js')).seedDemoCatalog();
      }
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

  /* On serverless, make sure the schema exists before handling API traffic —
     with one exception, which the outage of 26 August is the argument for.

     /api/config needs no database. Every field in it comes from the
     environment, and the single row it would like (the owner's category logos)
     already falls back to {} on its own. But it sat behind this gate like
     everything else, so when Neon started refusing connections the storefront
     could not read its own configuration, and the field it lost mattered most:
     `launchAt`. Without it the browser has no launch moment to compare its
     clock against, so the countdown vanishes and the purchase buttons render as
     though the shop were open — at the exact moment nothing works.

     The server still refuses to sell (that check reads the clock, not the
     database), so this was never a way to buy. It just meant the site lied
     about its state to the one visitor who came to look.

     /api/health is the same argument, sharper. It exists to answer "what is
     wrong", it already reports a dead database as `database.status: "down"`
     rather than throwing, and it reports whether email, SMS and the queue are
     configured — none of which needs a row. Behind this gate it answered 500
     during the one outage it was written for, which is the least useful moment
     for a health check to be silent. Neither endpoint returns a secret. */
  const NO_DATABASE = new Set(['/api/config', '/api/health']);
  if (lazyReady) {
    app.use(async (req, _res, next) => {
      if (NO_DATABASE.has(req.path)) return next();
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
