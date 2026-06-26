/** Admin analytics dashboard endpoints. */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as analytics from '../../services/analyticsService.js';

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

export default router;
