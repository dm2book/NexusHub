/** Scheduled maintenance + health, called by Vercel Cron and uptime monitors. */
import { Router } from 'express';
import { config } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { runMaintenance, runScheduledBackup } from '../services/maintenanceService.js';
import { healthSummary } from '../services/diagnosticsService.js';
import { forbidden } from '../utils/errors.js';

const router = Router();

// Health & diagnostics: { database, email, sms, storage, queue }.
// ?deep=1 also runs a read/write/update/delete DB self-test.
router.get('/health', asyncHandler(async (req, res) => {
  /* The plain check is public (the footer dot, uptime monitors). The deep one
     writes to the database on every call, and `tables` lists row counts of
     users and sessions — both only for whoever holds the cron secret. */
  if (req.query.deep || req.query.tables) assertCron(req);
  const h = await healthSummary({ deep: req.query.deep === '1', tables: req.query.tables === '1' });
  /* The storefront footer polls this on every page view to decide whether to
     show "systems normal". Thirty seconds of edge caching turns that from an
     origin hit per visitor into one per half minute, which is well inside how
     long anyone would tolerate a stale dot. Deliberately NO
     stale-while-revalidate: a status that keeps serving "up" out of a stale
     cache during a real outage is worse than showing no status at all. */
  if (!req.query.deep && !req.query.tables) {
    res.set('Cache-Control', 'public, max-age=0, s-maxage=30');
  }
  res.status(h.ok ? 200 : 503).json(h);
}));

/* Protected: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. In prod a
   secret is required; locally it is open for testing. */
function assertCron(req) {
  const secret = config.security.cronSecret;
  const auth = req.get('authorization') || '';
  const ok = secret
    ? auth === `Bearer ${secret}` || req.get('x-cron-secret') === secret
    : !config.isProd;
  if (!ok) throw forbidden('Bad cron secret');
}

// Scheduled maintenance.
router.get('/cron/maintenance', asyncHandler(async (req, res) => {
  assertCron(req);
  res.json(await runMaintenance());
}));

// The weekly backup, on its own schedule and its own time budget.
router.get('/cron/backup', asyncHandler(async (req, res) => {
  assertCron(req);
  res.json(await runScheduledBackup());
}));

export default router;
