/** Admin analytics dashboard endpoints. */
import { Router } from 'express';
import { requirePermission } from '../../middleware/rbac.js';
import * as analytics from '../../services/analyticsService.js';

const router = Router();
router.use(requirePermission('analytics.read'));

router.get('/overview', (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  res.json({
    overview: analytics.overview({ days }),
    revenueSeries: analytics.revenueSeries({ days }),
    statusBreakdown: analytics.statusBreakdown(),
  });
});

router.get('/top-products', (req, res) => {
  res.json({ products: analytics.topProducts({
    days: Math.min(Number(req.query.days) || 90, 365),
    limit: Math.min(Number(req.query.limit) || 10, 50),
  }) });
});

router.get('/clv', (_req, res) => {
  res.json(analytics.customerLifetimeValue({ limit: 10 }));
});

export default router;
