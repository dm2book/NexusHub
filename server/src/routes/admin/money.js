/**
 * The money dashboard: nine figures, all of them euros.
 *
 * Its own route rather than another block on /analytics, because the two answer
 * different questions and mixing them is what made the money hard to find. A
 * conversion rate belongs next to a funnel; a refund belongs next to the
 * revenue it came out of.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { moneyDashboard } from '../../services/moneyService.js';

const router = Router();
router.use(requirePermission('analytics.read'));

router.get('/', asyncHandler(async (_req, res) => {
  res.json(await moneyDashboard());
}));

export default router;
