/** Admin product catalog management. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { listProducts, getProduct, createProduct, updateProduct } from '../../services/productService.js';
import { addProductCodes, availableCounts, availableCount } from '../../services/codeStockService.js';
import { audit } from '../../services/auditService.js';

const router = Router();

router.get('/', requirePermission('orders.read'), asyncHandler(async (_req, res) => {
  const products = await listProducts();
  const stock = await availableCounts(products.map((p) => p.id));
  res.json({ products: products.map((p) => ({ ...p, codesAvailable: stock[p.id] || 0 })) });
}));

// Add a batch of codes (newline/comma separated) to a product's auto-delivery stock.
router.post('/:id/codes', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const { codes } = z.object({ codes: z.string().min(1) }).parse(req.body);
  const list = codes.split(/[\r\n,]+/).map((c) => c.trim()).filter(Boolean);
  const added = await addProductCodes(req.params.id, list);
  await audit({ actor: req.user, action: 'product.codes_add', targetType: 'product',
    targetId: req.params.id, metadata: { added }, req });
  res.json({ added, available: await availableCount(req.params.id) });
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
