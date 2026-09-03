/** Admin product catalog management. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { listProducts, getProduct, createProduct, updateProduct } from '../../services/productService.js';
import { addProductCodes, availableCounts, availableCount } from '../../services/codeStockService.js';
import { getRewards, setRewards } from '../../services/mysteryBoxService.js';
import { audit } from '../../services/auditService.js';
import { assertSafeImageValue, resolveImageUrl } from '../../utils/imageUrl.js';
import { normalizeImageValue } from '../../services/imageStoreService.js';

const router = Router();

// Reject an unsafe image before it reaches the DB (create/patch/bulk all share this).
const guardImage = (metadata) => {
  const img = metadata?.image;
  if (img != null && img !== '') assertSafeImageValue(img);
};

/**
 * An upload never reaches products.metadata as base64.
 *
 * The store and the migration existed before this line did, and that was the
 * hole: the 45 embedded photos on the live shop were cleaned up by a script
 * while the upload form quietly put fresh ones back. A one-off migration that
 * fixes a problem the write path keeps recreating is not a fix.
 *
 * Anything that is not a data: URI — a path, a link the owner pasted — comes
 * back untouched, because it is already a URL and not ours to rewrite.
 */
const storeUpload = async (metadata, productId = null) => {
  if (!metadata || typeof metadata.image !== 'string' || !metadata.image) return metadata;
  const { value } = await normalizeImageValue(metadata.image, { productId, source: 'upload' });
  return value === metadata.image ? metadata : { ...metadata, image: value };
};

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
  kind: z.enum(['digital', 'physical', 'mystery']).optional(),
  stock: z.number().int().nullable().optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

router.post('/', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const body = productSchema.parse(req.body);
  guardImage(body.metadata);
  if (body.metadata) body.metadata = await storeUpload(body.metadata);
  const product = await createProduct(body);
  await audit({ actor: req.user, action: 'product.create', targetType: 'product',
    targetId: product.id, req });
  res.status(201).json({ product });
}));

router.patch('/:id', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const body = productSchema.partial().parse(req.body);
  guardImage(body.metadata);
  if (body.metadata) body.metadata = await storeUpload(body.metadata, req.params.id);
  const product = await updateProduct(req.params.id, body);
  await audit({ actor: req.user, action: 'product.update', targetType: 'product',
    targetId: product.id, req });
  res.json({ product });
}));

// Turn a page link (Pinterest pin, tweet, article…) into the direct image URL
// behind it, so the owner can paste "the link" instead of hunting for the raw
// image. Already-direct image links pass straight through.
router.post('/resolve-image', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const { url } = z.object({ url: z.string().min(1).max(2000) }).parse(req.body);
  res.json({ url: await resolveImageUrl(url) });
}));

// Bulk action across many products at once — activate/hide, feature, or switch
// delivery mode (auto/manual) for a whole selection in one call. Metadata keys
// are merged so unrelated settings (sale price, cost, image) are preserved.
router.post('/bulk', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const { ids, action, value } = z.object({
    ids: z.array(z.string()).min(1).max(500),
    action: z.enum(['active', 'featured', 'deliveryMode', 'image']),
    value: z.union([z.boolean(), z.enum(['auto', 'manual']), z.string()]),
  }).parse(req.body);

  // Set (or clear) the same product image across a whole selection — e.g. one
  // logo for every Robux / V-Bucks variant at once. Accepts a link or upload.
  if (action === 'image') {
    let url = String(value || '').trim();
    if (url) assertSafeImageValue(url);
    /* Stored once for the whole selection rather than per product: the same
       picture across forty variants is one row, not forty. */
    if (url) ({ value: url } = await normalizeImageValue(url, { source: 'upload' }));
    let updated = 0;
    for (const id of ids) {
      const p = await getProduct(id);
      if (!p) continue;
      const metadata = { ...p.metadata };
      if (url) metadata.image = url; else delete metadata.image;
      await updateProduct(id, { metadata });
      updated++;
    }
    await audit({ actor: req.user, action: 'product.bulk_update', metadata: { action, count: updated }, req });
    return res.json({ updated });
  }

  let updated = 0;
  for (const id of ids) {
    const p = await getProduct(id);
    if (!p) continue;
    if (action === 'active') {
      await updateProduct(id, { active: !!value });
    } else if (action === 'featured') {
      await updateProduct(id, { metadata: { ...p.metadata, featured: !!value } });
    } else if (action === 'deliveryMode') {
      const metadata = { ...p.metadata };
      if (value === 'manual') metadata.deliveryMode = 'manual';
      else delete metadata.deliveryMode; // 'auto' is the default → keep metadata clean
      await updateProduct(id, { metadata });
    }
    updated++;
  }
  await audit({ actor: req.user, action: 'product.bulk_update', metadata: { action, value, count: updated }, req });
  res.json({ updated });
}));

// Mystery-box reward pool (for kind='mystery' products).
router.get('/:id/mystery', requirePermission('orders.read'), asyncHandler(async (req, res) => {
  res.json({ rewards: await getRewards(req.params.id) });
}));
router.put('/:id/mystery', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const { rewards } = z.object({
    rewards: z.array(z.object({
      label: z.string().min(1).max(80),
      weight: z.number().int().min(1).max(100000),
      credit: z.number().int().min(0).max(1_000_000),
    })).max(40),
  }).parse(req.body || {});
  await audit({ actor: req.user, action: 'product.mystery_rewards', targetType: 'product', targetId: req.params.id, req });
  res.json({ rewards: await setRewards(req.params.id, rewards) });
}));

export default router;
