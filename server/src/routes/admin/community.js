/**
 * The community layer, from the owner's side: how many people are at each
 * level, which badges and achievements have really been earned, streaks, and
 * how far the shop is from its next milestone. Distributions only — there is
 * no list of named customers ranked by spend.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { communityDashboard } from '../../services/communityService.js';

const router = Router();

router.get('/', requirePermission('analytics.read'), asyncHandler(async (_req, res) => {
  res.json(await communityDashboard());
}));

export default router;
