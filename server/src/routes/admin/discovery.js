/**
 * Admin → Product Discovery (services/discovery).
 *
 * Reading is products.read; anything that asks a partner API, writes a
 * candidate or adds a product is products.write. Scans are rate-limited here
 * as well as per host inside the pipeline: a button is not a crawler.
 */
import { Router } from 'express';
import { z } from 'zod';
import { httpUrl } from '../../utils/httpUrl.js';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { catalogueAudit } from '../../services/discovery/catalogAuditService.js';
import {
  discoveryList, addCandidate, addAllSafe, rejectCandidate, editCandidate,
  scanCategories, rescanCandidate, evaluateCandidates, startFullScan, fullScanStep, fullScanStatus,
  addReferenceDenominations, VENDOR_OF, addAllReview,
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

/* The complete scan, in steps (see fullScanStep). Start once; the page then
   calls /full/step until the answer says done. Not under the scan rate limit:
   each step is bounded by its own budget and the per-host spacing. */
const brief = (st) => (st ? { ...st, queries: undefined, candidates: undefined, classifyIds: undefined,
  totalQueries: st.queries?.length ?? st.totalQueries, totalCandidates: st.candidates?.length ?? st.totalCandidates ?? null } : { phase: 'idle' });
router.get('/full', requirePermission('products.read'), asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(brief(await fullScanStatus()));
}));
router.post('/full/start', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const { restart, categories } = z.object({ restart: z.boolean().optional(), categories: z.array(z.string().max(60)).max(30).optional() }).parse(req.body || {});
  res.json(brief(await startFullScan({ actor: actorOf(req), restart: restart === true, categories: categories?.length ? categories : null })));
}));
router.post('/full/step', requirePermission('products.write'), asyncHandler(async (_req, res) => {
  res.json(await fullScanStep({ budgetMs: 18_000 }));
}));

router.post('/evaluate', requirePermission('products.write'), scanLimit, asyncHandler(async (_req, res) => {
  const out = await evaluateCandidates({ deadline: Date.now() + 22_000 });
  res.json({ evaluated: out.length });
}));

router.post('/add-safe', requirePermission('products.write'), asyncHandler(async (req, res) => {
  res.json(await addAllSafe({ actor: actorOf(req) }));
}));

/* Every review product at once, priced from the shop's own prices. In steps:
   call again until `remaining` is 0. */
router.post('/add-review', requirePermission('products.write'), asyncHandler(async (req, res) => {
  res.json(await addAllReview({ actor: actorOf(req), deadline: Date.now() + 18_000 }));
}));

router.post('/:id/rescan', requirePermission('products.write'), scanLimit, asyncHandler(async (req, res) => {
  try { res.json(await rescanCandidate(req.params.id)); } catch (e) { fail(res, e); }
}));

router.post('/:id/add', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const { manualCostCents } = z.object({ manualCostCents: z.number().int().positive().max(1_000_000).optional() }).parse(req.body || {});
  try { res.json(await addCandidate(req.params.id, { actor: actorOf(req), manualCostCents })); } catch (e) { fail(res, e); }
}));

/* Official denominations the owner read on a publisher's store. */
router.get('/reference/games', requirePermission('products.read'), asyncHandler(async (_req, res) => {
  const { GAMES } = await import('../../services/market/normalize.js');
  res.json({ games: GAMES.map((g) => ({ key: g.key, label: g.label, unit: g.unit, platformBound: !g.defaultPlatform && g.unit !== 'EUR', vendor: VENDOR_OF[g.key] || null })) });
}));
router.post('/reference', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const body = z.object({
    game: z.string().max(40), region: z.enum(['eu', 'nl', 'global']),
    platforms: z.array(z.enum(['playstation', 'xbox', 'pc', 'nintendo', 'ios', 'android', 'mobile', 'any', 'unknown'])).min(1).max(8),
    amounts: z.array(z.object({ denomination: z.number().positive().max(1_000_000), priceCents: z.number().int().positive().max(1_000_000) })).min(1).max(30),
    sourceUrl: httpUrl(500),
  }).parse(req.body || {});
  try { res.json(await addReferenceDenominations({ ...body, currency: 'EUR', actor: actorOf(req) })); } catch (e) { fail(res, e); }
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
