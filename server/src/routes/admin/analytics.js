/** Admin analytics dashboard endpoints. */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as analytics from '../../services/analyticsService.js';
import * as profit from '../../services/profitService.js';
import * as attribution from '../../services/attributionService.js';
import * as adPerf from '../../services/adPerformanceService.js';
import { z } from 'zod';
import { audit } from '../../services/auditService.js';

const router = Router();
router.use(requirePermission('analytics.read'));

/* Profit, which is a different question from revenue.
   Its own endpoint rather than more fields on /overview: it carries three
   periods, every product, three leaderboards and the coverage each figure was
   computed over, and folding that into the revenue summary would make the one
   number people read depend on a payload they did not ask for. */
router.get('/profit', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  res.json(await profit.profitDashboard({ limit }));
}));

router.get('/overview', asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const [overview, revenueSeries, statusBreakdown] = await Promise.all([
    analytics.overview({ days }),
    analytics.revenueSeries({ days }),
    analytics.statusBreakdown(),
  ]);
  res.json({ overview, revenueSeries, statusBreakdown });
}));

router.get('/top-products', asyncHandler(async (req, res) => {
  res.json({ products: await analytics.topProducts({
    days: Math.min(Number(req.query.days) || 90, 365),
    limit: Math.min(Number(req.query.limit) || 10, 50),
  }) });
}));

router.get('/clv', asyncHandler(async (_req, res) => {
  res.json(await analytics.customerLifetimeValue({ limit: 10 }));
}));

router.get('/retention', asyncHandler(async (_req, res) => {
  res.json(await analytics.retentionMetrics());
}));

router.get('/recovery', asyncHandler(async (req, res) => {
  res.json(await analytics.recoveryMetrics({
    days: Math.min(Number(req.query.days) || 30, 365),
  }));
}));

/**
 * Which advert sold something.
 *
 * One call rather than three: the funnel, the creatives and the campaign
 * rollup are the same report read at three zoom levels, and fetching them
 * separately would let the page render a funnel and a table computed over
 * different windows — which looks like a bug in the funnel.
 */
router.get('/attribution', asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const [funnel, creatives, campaigns] = await Promise.all([
    attribution.funnel({ days }),
    attribution.creativePerformance({ days, limit: Math.min(Number(req.query.limit) || 50, 200) }),
    attribution.campaignPerformance({ days }),
  ]);
  res.json({
    funnel, creatives, campaigns,
    windowDays: attribution.ATTRIBUTION_WINDOW_DAYS,
    // Printed in the report's empty state, so whoever is building a link by
    // hand has the accepted spellings in front of them rather than in a source
    // file they would have to go and find.
    recognisedParams: attribution.RECOGNISED_PARAMS,
  });
}));

/**
 * The ad report: every creative with its platform numbers, graded.
 *
 * Read-only. Nothing here pauses an advert — this shop has no write access to
 * anybody's ad account, and a dashboard that claimed to turn one off would be
 * describing a button that does not exist.
 */
router.get('/ads', asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const minVisits = Math.max(1, Math.min(Number(req.query.minVisits) || 30, 10_000));
  res.json(await adPerf.adPerformance({ days, minVisits }));
}));

/** One measure per day per creative, for the chart. */
router.get('/ads/timeseries', asyncHandler(async (req, res) => {
  const { metric, days } = z.object({
    metric: z.enum(['roas', 'conversion', 'ctr', 'revenue']).optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
  }).parse(req.query || {});
  res.json(await adPerf.adTimeseries({ metric: metric || 'roas', days: days || 30 }));
}));

/**
 * What the platform charged, entered by hand or imported.
 *
 * The only way impressions and spend get into this system: neither is
 * observable from here, and both are required before CTR or ROAS mean anything.
 */
router.post('/ads/spend', requirePermission('analytics.write'), asyncHandler(async (req, res) => {
  const body = z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    network: z.string().min(1).max(40),
    campaign: z.string().max(200).nullish(),
    creative: z.string().max(200).nullish(),
    impressions: z.coerce.number().int().min(0).nullish(),
    clicks: z.coerce.number().int().min(0).nullish(),
    spendCents: z.coerce.number().int().min(0).nullish(),
    note: z.string().max(400).nullish(),
  }).parse(req.body || {});
  try {
    const row = await adPerf.recordSpend({ ...body, source: 'manual' });
    await audit({ actor: req.user, action: 'ads.spend_recorded',
      metadata: { day: body.day, network: body.network, creative: body.creative }, req });
    res.json({ spend: row });
  } catch (e) {
    res.status(400).json({ error: { message: e.message } });
  }
}));

export default router;
