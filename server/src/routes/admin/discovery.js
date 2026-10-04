/**
 * Admin → Product Discovery (services/discovery).
 *
 * Reading is products.read; anything that asks a partner API, writes a
 * candidate or adds a product is products.write. Scans are rate-limited here
 * as well as per host inside the pipeline: a button is not a crawler.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { catalogueAudit } from '../../services/discovery/catalogAuditService.js';
import {
  discoveryList, addCandidate, addAllSafe, rejectCandidate, editCandidate,
  scanCategories, rescanCandidate, evaluateCandidates,
} from '../../services/discovery/discoveryPipeline.js';
import { sourceStatuses } from '../../services/market/sources.js';

const router = Router();
const actorOf = (req) => req.user?.email || req.user?.id || 'admin';
const fail = (res, e) => res.status(e.status || 400).json({ error: { message: e.message } });
const scanLimit = rateLimit({ bucket: 'discovery-scan', windowMs: 10 * 60_000, max: 6 });

router.get('/', requirePermission('products.read'), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const [list, sources] = await Promise.all([discoveryList({ gate: req.query.gate || null }), sourceStatuses().catch(() => [])]);
  res.json({ ...list, sources: sources.map((s) => ({ key: s.key, label: s.label, status: s.status, reason: s.statusReason })) });
}));

router.get('/audit', requirePermission('products.read'), asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await catalogueAudit());
}));

router.post('/scan', requirePermission('products.write'), scanLimit, asyncHandler(async (req, res) => {
  const { categories } = z.object({ categories: z.array(z.string().max(60)).max(30).optional() }).parse(req.body || {});
  res.json(await scanCategories({ categories: categories?.length ? categories : null }));
}));

router.post('/evaluate', requirePermission('products.write'), scanLimit, asyncHandler(async (_req, res) => {
  const out = await evaluateCandidates();
  res.json({ evaluated: out.length });
}));

router.post('/add-safe', requirePermission('products.write'), asyncHandler(async (req, res) => {
  res.json(await addAllSafe({ actor: actorOf(req) }));
}));

router.post('/:id/rescan', requirePermission('products.write'), scanLimit, asyncHandler(async (req, res) => {
  try { res.json(await rescanCandidate(req.params.id)); } catch (e) { fail(res, e); }
}));

router.post('/:id/add', requirePermission('products.write'), asyncHandler(async (req, res) => {
  try { res.json(await addCandidate(req.params.id, { actor: actorOf(req) })); } catch (e) { fail(res, e); }
}));

router.post('/:id/reject', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body || {});
  try { res.json(await rejectCandidate(req.params.id, { actor: actorOf(req), reason })); } catch (e) { fail(res, e); }
}));

router.patch('/:id', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const body = z.object({ title: z.string().min(2).max(120).optional(), category: z.string().min(1).max(60).optional(),
    priceCents: z.number().int().positive().max(1_000_000).optional() }).parse(req.body || {});
  try {
    const edits = await editCandidate(req.params.id, body, { actor: actorOf(req) });
    const [result] = await evaluateCandidates({ ids: [req.params.id] });
    res.json({ edits, result });
  } catch (e) { fail(res, e); }
}));

export default router;
