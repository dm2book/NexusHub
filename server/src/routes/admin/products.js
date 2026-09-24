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
import { backfillArt, proposedCategories, artFor } from '../../services/productFitService.js';
import { findPhotos, photoQueue, photoGap } from '../../services/supplier/supplierImageService.js';
import { importCosts } from '../../services/costImportService.js';

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

/**
 * Move every embedded photo out of the product rows, from the admin.
 *
 * The same work scripts/migrate-product-images.mjs does, reachable without a
 * terminal or a database URL — which matters because the person who needs it
 * is the one who cannot run either. No browser needed: this only moves bytes
 * between tables. Re-encoding to WebP still needs the script, because a Vercel
 * function has no canvas.
 *
 * Idempotent: images are addressed by content hash, so a second run finds the
 * rows the first one wrote and changes nothing.
 */
/**
 * Art for products that have none.
 *
 * Dry by default: `?apply=1` is the decision, a report is not. Matched art is
 * the shop's own artwork for that exact product; a drawn tile is a placeholder
 * that states the product's real name and amount rather than borrowing another
 * product's artwork, which would print the wrong number on the card.
 */
router.post('/art/backfill', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const apply = String(req.query.apply || req.body?.apply || '') === '1'
    || req.body?.apply === true;
  res.json(await backfillArt({ apply, actor: req.user }));
}));

/**
 * Real photos, from the suppliers' own listings.
 *
 * `queue` lists every active product still showing a placeholder or nothing
 * (without the nightly sweep's two-week back-off: a person pressing the button
 * wants all of them), and the page walks it four at a time, because each
 * product is a search at every supplier and a request that dies at the
 * function timeout leaves nothing. See supplierImageService for which listing
 * a picture may come from and what it never replaces.
 */
router.get('/images/queue', requirePermission('suppliers.manage'), asyncHandler(async (_req, res) => {
  res.json({ ...(await photoGap()), ids: await photoQueue({ limit: 1000, ignoreBackoff: true }) });
}));

router.post('/images/find', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const { productIds, apply } = z.object({
    productIds: z.array(z.string()).min(1).max(4),
    apply: z.boolean().optional(),
  }).parse(req.body || {});
  res.set('Cache-Control', 'no-store');
  res.json(await findPhotos(productIds, { apply: apply === true, actor: req.user }));
}));

/**
 * Cost prices, pasted as a table.
 *
 * Dry unless `apply` is true, and the report is the same shape either way — so
 * what the owner approves is what they already read. The numbers are theirs;
 * the hour of clicking was not.
 */
router.post('/costs/import', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const { text, apply } = z.object({
    text: z.string().max(200_000),
    apply: z.boolean().optional(),
  }).parse(req.body || {});
  res.json(await importCosts(text, { apply: apply === true, actor: req.user }));
}));

/** Which shelves the discovered products would need that the shop has not got. */
router.get('/categories/proposed', requirePermission('orders.read'), asyncHandler(async (_req, res) => {
  res.json({ proposed: await proposedCategories({ limit: 25 }) });
}));

router.post('/images/migrate', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const dry = req.body?.dry === true;
  const rows = await listProducts();
  let moved = 0, freedBytes = 0;
  const failed = [];

  for (const p of rows) {
    const image = p.metadata?.image;
    if (typeof image !== 'string' || !image.startsWith('data:')) continue;
    freedBytes += image.length;
    if (dry) { moved += 1; continue; }
    try {
      const { value } = await normalizeImageValue(image, { productId: p.id, source: 'migrated' });
      const next = { ...p.metadata, image: value };
      delete next.imageLegacy;    // never keep a base64 copy — that is the problem
      await updateProduct(p.id, { metadata: next });
      moved += 1;
    } catch (err) { failed.push({ name: p.name, error: err.message }); }
  }

  if (!dry && moved) {
    await audit({ actor: req.user, action: 'product.images_migrated',
      metadata: { moved, freedBytes }, req });
  }
  res.json({ moved, freedBytes, dry, failed, examined: rows.length });
}));

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
  let product = await createProduct(body);
  /* Never a blank tile. A product added by hand with no picture used to show
     its category's icon, and nothing at all for a category without one. It
     now gets the shop's own artwork for that exact product when one exists,
     and a drawn tile with its real name and amount when not — which the
     nightly sweep then upgrades to the supplier's photo where one fits. */
  if (!product.image) {
    const art = artFor(product);
    if (art.image) {
      product = await updateProduct(product.id, { metadata: {
        ...product.metadata, image: art.image, imageSource: art.source, imageReason: art.reason,
      } }) || product;
    }
  }
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
