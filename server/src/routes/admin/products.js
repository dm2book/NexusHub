/** Admin product catalog management. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { listProducts, getProduct, createProduct, updateProduct } from '../../services/productService.js';
import { audit } from '../../services/auditService.js';

const router = Router();

router.get('/', requirePermission('orders.read'), asyncHandler(async (_req, res) => {
  res.json({ products: await listProducts() });
}));

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  price: z.number().int().nonnegative(),
  currency: z.string().length(3).optional(),
  kind: z.enum(['digital', 'physical']).optional(),
  stock: z.number().int().nullable().optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

router.post('/', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const product = await createProduct(productSchema.parse(req.body));
  await audit({ actor: req.user, action: 'product.create', targetType: 'product',
    targetId: product.id, req });
  res.status(201).json({ product });
}));

router.patch('/:id', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const product = await updateProduct(req.params.id, productSchema.partial().parse(req.body));
  await audit({ actor: req.user, action: 'product.update', targetType: 'product',
    targetId: product.id, req });
  res.json({ product });
}));

export default router;
