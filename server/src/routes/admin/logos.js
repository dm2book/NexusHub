/** Admin: the Logo Library (services/logoDiscoveryService.js). */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/auditService.js';
import { run, get } from '../../db/index.js';
import { library, discoverBrand, addSource, chooseBest, BRANDS, TIERS, LOGO_TYPES } from '../../services/logoDiscoveryService.js';

const router = Router();
const brandKey = z.enum(Object.keys(BRANDS));

router.get('/', requirePermission('suppliers.read'), asyncHandler(async (_req, res) => {
  res.json({ ...(await library()), tiers: TIERS, logoTypes: LOGO_TYPES });
}));

/* Look again now — one brand, or every brand. Within one request's budget. */
router.post('/refresh', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const { brand } = z.object({ brand: brandKey.optional() }).parse(req.body || {});
  const keys = brand ? [brand] : Object.keys(BRANDS);
  const deadline = Date.now() + 22_000; const done = []; const errors = [];
  for (const k of keys) {
    if (Date.now() >= deadline) break;
    try { await discoverBrand(k); done.push(k); } catch (e) { errors.push({ brand: k, error: e.message }); }
  }
  await audit({ actor: req.user, action: 'logos.refresh', metadata: { brands: done.length, errors: errors.length }, req });
  res.json({ done, errors, remaining: keys.filter((k) => !done.includes(k) && !errors.some((e) => e.brand === k)) });
}));

/* An official file the owner found (after accepting the brand's terms). */
router.post('/sources', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const body = z.object({
    brand: brandKey, tier: z.enum(['brand_assets', 'press_kit', 'developer_portal']),
    url: z.string().url().max(1000), license: z.string().max(300).optional(), guidelines: z.string().url().max(1000).optional(),
    logoType: z.enum(LOGO_TYPES).optional(),
  }).parse(req.body || {});
  const sources = await addSource({ ...body, actor: req.user.id });
  const chosen = await discoverBrand(body.brand).catch((e) => ({ error: e.message }));
  await audit({ actor: req.user, action: 'logos.source_added', metadata: { brand: body.brand, tier: body.tier, url: body.url }, req });
  res.json({ sources, chosen });
}));
router.delete('/sources/:id', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const s = await get(`SELECT brand, url FROM logo_sources WHERE id=@id`, { id: req.params.id });
  if (!s) return res.status(404).json({ error: { message: 'Source not found' } });
  await run(`DELETE FROM logo_sources WHERE id=@id`, { id: req.params.id });
  await run(`DELETE FROM brand_logos WHERE brand=@b AND source_url=@u`, { b: s.brand, u: s.url });
  await chooseBest(s.brand);
  res.json({ ok: true });
}));

/* The owner prefers another logo than the score picked. */
router.post('/:id/choose', requirePermission('suppliers.manage'), asyncHandler(async (req, res) => {
  const row = await get(`SELECT brand, status FROM brand_logos WHERE id=@id`, { id: req.params.id });
  if (!row || row.status !== 'ok') return res.status(400).json({ error: { message: 'Only a logo that passed the quality rules can be chosen' } });
  await run(`UPDATE brand_logos SET chosen = CASE WHEN id=@id THEN 1 ELSE 0 END WHERE brand=@b`, { id: req.params.id, b: row.brand });
  await audit({ actor: req.user, action: 'logos.chosen', metadata: { brand: row.brand, id: req.params.id }, req });
  res.json({ ok: true });
}));

export default router;
