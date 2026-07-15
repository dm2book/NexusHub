/** Admin supplier management + connector configuration + sync controls. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as suppliers from '../../services/supplier/supplierService.js';
import { supplierMetrics } from '../../services/supplier/supplierMetricsService.js';
import { availableKinds } from '../../services/supplier/registry.js';
import { audit } from '../../services/auditService.js';
import { notFound } from '../../utils/errors.js';

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

router.get('/:id', requirePermission('suppliers.read'), asyncHandler(async (req, res) => {
  const supplier = await suppliers.getSupplier(req.params.id);
  if (!supplier) throw notFound('Supplier not found');
  res.json({ supplier, syncRuns: await suppliers.listSyncRuns(req.params.id) });
}));

router.post('/', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const body = z.object({
    name: z.string().min(1),
    connectorKind: z.enum(['api', 'csv', 'manual']),
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
      cost: z.number().int().optional(),
      priority: z.number().int().optional(),
    }).parse(req.body);
    const mapping = await suppliers.mapSupplierProduct({ supplierId: req.params.id, ...body });
    await audit({ actor: req.user, action: 'supplier.map_product', targetType: 'supplier',
      targetId: req.params.id, metadata: { productId: body.productId, sku: body.supplierSku }, req });
    res.status(201).json({ mapping });
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
