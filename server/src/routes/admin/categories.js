/** Admin: per-category logos rendered across the storefront. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { listProducts } from '../../services/productService.js';
import { getCategoryLogos, setCategoryLogo } from '../../services/settingsService.js';
import { assertSafeImageValue } from '../../utils/imageUrl.js';
import { audit } from '../../services/auditService.js';

const router = Router();

// The categories the owner actually sells + any that already have a logo, so
// the admin can set an image for each. Labels are derived on the client.
router.get('/', requirePermission('orders.read'), asyncHandler(async (_req, res) => {
  const products = await listProducts();
  const logos = await getCategoryLogos();
  const slugs = new Set([...products.map((p) => p.category).filter(Boolean), ...Object.keys(logos)]);
  res.json({ categories: [...slugs].sort(), logos });
}));

// Set (image present) or clear (empty/null) one category's logo.
router.put('/logo', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const { slug, image } = z.object({
    slug: z.string().min(1).max(60),
    image: z.string().max(2_600_000).nullish(),
  }).parse(req.body);
  const value = String(image || '').trim();
  if (value) assertSafeImageValue(value);
  await setCategoryLogo(slug, value || null);
  await audit({ actor: req.user, action: 'category.logo_update', metadata: { slug, cleared: !value }, req });
  res.json({ logos: await getCategoryLogos() });
}));

export default router;
