/** Scheduled maintenance + health, called by Vercel Cron and uptime monitors. */
import { Router } from 'express';
import { config } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { runMaintenance } from '../services/maintenanceService.js';
import { healthSummary } from '../services/diagnosticsService.js';
import { forbidden } from '../utils/errors.js';

const router = Router();

// Health & diagnostics: { database, email, sms, storage, queue }.
// ?deep=1 also runs a read/write/update/delete DB self-test.
router.get('/health', asyncHandler(async (req, res) => {
  const h = await healthSummary({ deep: req.query.deep === '1' });
  res.status(h.ok ? 200 : 503).json(h);
}));

// Scheduled maintenance. Protected: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
router.get('/cron/maintenance', asyncHandler(async (req, res) => {
  const secret = config.security.cronSecret;
  const auth = req.get('authorization') || '';
  const ok = secret
    ? auth === `Bearer ${secret}` || req.get('x-cron-secret') === secret
    : !config.isProd; // in prod a secret is required; locally it's open for testing
  if (!ok) throw forbidden('Bad cron secret');
  res.json(await runMaintenance());
}));

export default router;
