/** Admin supplier management + connector configuration + sync controls. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as suppliers from '../../services/supplier/supplierService.js';
import { supplierMetrics } from '../../services/supplier/supplierMetricsService.js';
import { supplierDashboard } from '../../services/supplier/supplierDashboardService.js';
import { availableKinds, createConnector } from '../../services/supplier/registry.js';
import { searchTermsFor } from '../../services/supplier/SupplierConnector.js';
import { audit } from '../../services/auditService.js';
import { notFound } from '../../utils/errors.js';
import { get } from '../../db/index.js';

const router = Router();

router.get('/connector-kinds', requirePermission('suppliers.read'), (_req, res) => {
  res.json({ kinds: availableKinds() });
});

router.get('/', requirePermission('suppliers.read'), asyncHandler(async (_req, res) => {
  res.json({ suppliers: await suppliers.listSuppliers() });
}));

// Performance dashboard: margin, reliability, fulfillment speed per supplier.
router.get('/metrics', requirePermission('suppliers.read'), asyncHandler(async (_req, res) => {
  res.json({ metrics: await supplierMetrics() });
}));

/* Product-first supply view: who supplies what, at what cost, with how much on
   the shelf. Declared ABOVE `/:id` — Express matches in order, and a dashboard
   route below it is read as a supplier whose id is the word "dashboard". */
router.get('/dashboard', requirePermission('suppliers.read'), asyncHandler(async (_req, res) => {
  res.json(await supplierDashboard());
}));

router.get('/:id', requirePermission('suppliers.read'), asyncHandler(async (req, res) => {
  const supplier = await suppliers.getSupplier(req.params.id);
  if (!supplier) throw notFound('Supplier not found');
  res.json({ supplier, syncRuns: await suppliers.listSyncRuns(req.params.id) });
}));

router.post('/', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    /* The kinds the REGISTRY actually has, not a copy of them.
       This was hardcoded to ['api','csv','manual'] while the registry had six
       and the admin dropdown offered all six — so picking Kinguin, G2A or
       Eldorado and pressing Create answered
         "Invalid enum value. Expected 'api' | 'csv' | 'manual'"
       The three integrations that auto-buy and auto-deliver were unreachable
       through the only screen that creates a supplier, and the error blamed
       the person typing. Derived here so a registerConnector() call is enough
       to make a kind usable, which is what the registry says it is for. */
    connectorKind: z.enum(availableKinds()),
    config: z.record(z.any()).optional(),
    credentialsRef: z.string().optional(),
  }).parse(req.body);
  const supplier = await suppliers.createSupplier(body);
  await audit({ actor: req.user, action: 'supplier.create', targetType: 'supplier',
    targetId: supplier.id, metadata: { kind: body.connectorKind }, req });
  res.status(201).json({ supplier });
}));

router.patch('/:id', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().optional(),
    status: z.enum(['active', 'paused', 'error']).optional(),
    config: z.record(z.any()).optional(),
    credentialsRef: z.string().optional(),
  }).parse(req.body);
  const supplier = await suppliers.updateSupplier(req.params.id, body);
  await audit({ actor: req.user, action: 'supplier.update', targetType: 'supplier',
    targetId: supplier.id, req });
  res.json({ supplier });
}));

router.delete('/:id', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  await suppliers.deleteSupplier(req.params.id);
  await audit({ actor: req.user, action: 'supplier.delete', targetType: 'supplier',
    targetId: req.params.id, req });
  res.json({ ok: true });
}));

router.post('/:id/test', requirePermission('suppliers.read'), asyncHandler(async (req, res) => {
  res.json(await suppliers.testSupplier(req.params.id));
}));

// Map a supplier catalog item to one of our products.
router.get('/:id/products', requirePermission('suppliers.read'),
  asyncHandler(async (req, res) => {
    res.json({ mappings: await suppliers.listSupplierProducts(req.params.id) });
  }));

router.post('/:id/products', requirePermission('suppliers.manage'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      productId: z.string(),
      supplierSku: z.string(),
      supplierUrl: z.string().url().max(500).optional(),
      cost: z.number().int().optional(),
      priority: z.number().int().optional(),
    }).parse(req.body);
    const mapping = await suppliers.mapSupplierProduct({ supplierId: req.params.id, ...body });
    await audit({ actor: req.user, action: 'supplier.map_product', targetType: 'supplier',
      targetId: req.params.id, metadata: { productId: body.productId, sku: body.supplierSku }, req });
    res.status(201).json({ mapping });
  }));

/**
 * Search a supplier's catalogue, for the Map-products picker.
 *
 * This exists because mapping a product asked for a supplier SKU that could
 * not be looked up anywhere in this admin. For Kinguin that SKU is a numeric
 * kinguinId, so the only way to fill the field was to go hunting on their
 * website and retype a number — seventy-one times, with seventy-one chances to
 * map a product to the wrong listing and sell somebody the wrong thing.
 *
 * When `productId` is given, every result also carries what mapping it would
 * MEAN: the margin against that product's price, and whether the auto-buy
 * guard would refuse it. That guard (fulfillmentService: cost >= effective
 * revenue → never auto-buy) is silent by design, so a mapping made at a loss
 * looks fine here and simply never delivers. Better to say so while choosing.
 */
router.get('/:id/search', requirePermission('suppliers.read'), asyncHandler(async (req, res) => {
  const { q, limit, productId } = z.object({
    q: z.string().min(3, 'Type at least 3 characters').max(120),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    productId: z.string().optional(),
  }).parse(req.query);

  const supplier = await suppliers.getSupplier(req.params.id);
  if (!supplier) throw notFound('Supplier not found');

  const connector = createConnector(supplier);

  /* Try the term, then shorter ones, and stop at the first that finds
     something. A shop writes "1,000 Robux" and a supplier lists "Roblox 1000
     Robux Card": measured against a live catalogue the shop's own product name
     returned 0 hits and "1000 Robux" returned 1. Every product here is named
     with a thousands separator, so without this the picker comes back empty for
     the whole catalogue and reads as "they do not carry any of it". */
  const terms = searchTermsFor(q);
  let results = [];
  let searchedFor = terms[0] || q;
  const tried = [];
  for (const term of terms) {
    tried.push(term);
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential: each
    // is a request to somebody else's API and we stop at the first that works.
    results = await connector.searchCatalog(term, { limit: limit || 25 });
    if (results.length) { searchedFor = term; break; }
  }

  /* The product's own price, so the margin shown is against what this shop
     actually charges rather than against nothing. */
  const product = productId
    ? await get('SELECT id, name, price FROM products WHERE id = @id', { id: productId })
    : null;

  res.json({
    supplier: { id: supplier.id, name: supplier.name, kind: supplier.connector_kind },
    /* What was actually asked, which is often not what was typed. Saying so
       stops "no results" being read as "this supplier has nothing" when the
       real answer is "we searched for the wrong string". */
    searchedFor,
    tried,
    /* Said out loud: a connector without server-side search filtered whatever
       fetchCatalog happened to return, which is not the same promise. */
    serverSide: !!connector.supportsSearch,
    product: product ? { id: product.id, name: product.name, priceCents: Number(product.price) } : null,
    results: results.map((r) => {
      const price = product ? Number(product.price) : null;
      const marginCents = price != null && r.cost != null ? price - r.cost : null;
      return {
        ...r,
        marginCents,
        marginPct: marginCents != null && price > 0
          ? Math.round((marginCents / price) * 1000) / 10 : null,
        /* The exact condition fulfillmentService refuses on, so the warning
           here and the behaviour later cannot disagree. */
        wouldRefuseAutoBuy: price != null && r.cost != null ? r.cost >= price : null,
      };
    }),
  });
}));

// Trigger a sync (inventory | price | status | full).
router.post('/:id/sync', requirePermission('suppliers.sync'), asyncHandler(async (req, res) => {
  const { type } = z.object({
    type: z.enum(['inventory', 'price', 'status', 'full']).optional(),
  }).parse(req.body || {});
  const run = await suppliers.syncSupplier(req.params.id, type || 'full');
  await audit({ actor: req.user, action: 'supplier.sync', targetType: 'supplier',
    targetId: req.params.id, metadata: { type: type || 'full', status: run.status }, req });
  res.json({ run });
}));

export default router;
