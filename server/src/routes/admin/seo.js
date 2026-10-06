/**
 * Admin → SEO pages: every generated page with its title, description, FAQ,
 * links and keywords, ranked by real signals (marketplace listings observed,
 * own sales, own visits, catalogue depth), and the keywords the catalogue
 * implies that no page answers yet. No search-volume figures: none exist here.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { seoReport } from '../../services/seoPageService.js';

const router = Router();
router.get('/pages', requirePermission('analytics.read'), asyncHandler(async (_req, res) => {
  res.json(await seoReport());
}));
export default router;
