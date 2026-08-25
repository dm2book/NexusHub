/** Admin analytics dashboard endpoints. */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as analytics from '../../services/analyticsService.js';
import * as attribution from '../../services/attributionService.js';

const router = Router();
router.use(requirePermission('analytics.read'));

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

export default router;
