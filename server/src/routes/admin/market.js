/**
 * Admin API for market intelligence.
 *
 * Read endpoints use products.read; anything that decides something uses
 * products.write, because approving a price IS writing to the catalogue even
 * when the write happens one call later.
 *
 * Every mutating endpoint records the acting admin. There is no "system"
 * approval path: the workflow's value is that a named person stands behind each
 * product and each price, and an endpoint that let automation sign for itself
 * would quietly remove that.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { audit } from '../../services/auditService.js';
import { badRequest } from '../../utils/errors.js';
import { config } from '../../config/env.js';
import { sourceStatuses } from '../../services/market/sources.js';
import { recordObservation, observationsFor } from '../../services/market/observations.js';
import { discoveryReport, decideCandidate, runDiscovery, createProductFromCandidate }
  from '../../services/market/discovery.js';
import { validateFormula } from '../../services/market/formula.js';
import { listRates, recordRate } from '../../services/market/fx.js';
import {
  refreshSources, runProductDiscovery, refreshRecommendations, detectStaleData,
  recommendFor, decideRecommendation, publishRecommendation, priceHistory, pricingReport,
} from '../../services/market/engine.js';

const router = Router();
const actorOf = (req) => req.user?.email || req.user?.id || null;

// ── Sources: what we may use, and why not ──────────────────────────────────
router.get('/sources', requirePermission('products.read'), asyncHandler(async (req, res) => {
  const checkRobots = req.query.robots === '1';
  res.json({ sources: await sourceStatuses({ checkRobots }), enabled: config.market.enabledSources });
}));

router.post('/sources/refresh', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const sources = await refreshSources({ checkRobots: true });
  await audit({ actor: req.user, action: 'market.sources_refreshed', metadata: { count: sources.length }, req });
  res.json({ sources });
}));

// ── Observations: the evidence ─────────────────────────────────────────────
/**
 * Record a price a human actually saw. This is the always-legal input path and
 * the one the whole engine is designed to work from: source, URL and timestamp
 * are required, because an observation without them is a rumour.
 */
const observationSchema = z.object({
  source: z.string().min(1).max(60),
  title: z.string().min(2).max(400),
  priceCents: z.number().int().positive(),
  currency: z.string().length(3),
  url: z.string().url(),
  availability: z.enum(['in_stock', 'out_of_stock', 'unknown']).optional(),
  observedAt: z.string().optional(),
  sourceProductId: z.string().max(120).optional(),
  hints: z.object({
    game: z.string().optional(), platform: z.string().optional(), region: z.string().optional(),
    productType: z.string().optional(), edition: z.string().optional(),
    denomination: z.number().optional(), denomUnit: z.string().optional(),
    quantity: z.number().int().positive().optional(),
  }).optional(),
});

router.post('/observations', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const body = observationSchema.parse(req.body);
  try {
    const out = await recordObservation(body.source, body);
    await audit({ actor: req.user, action: 'market.observation_recorded',
      targetType: 'market_product', targetId: out.marketProductId,
      metadata: { source: body.source, url: body.url }, req });
    res.status(201).json(out);
  } catch (err) { throw badRequest(err.message); }
}));

router.get('/observations/:marketProductId', requirePermission('products.read'), asyncHandler(async (req, res) => {
  res.json({ observations: await observationsFor(req.params.marketProductId, { sinceHours: 24 * 30 }) });
}));

// ── Discovery ──────────────────────────────────────────────────────────────
router.get('/discovery', requirePermission('products.read'), asyncHandler(async (_req, res) => {
  res.json(await discoveryReport());
}));

router.post('/discovery/run', requirePermission('products.write'), asyncHandler(async (req, res) => {
  // `classifyOnly` re-runs the matching against our catalogue without asking any
  // external source — useful right after adding a product, and free.
  const out = req.body?.classifyOnly ? await runDiscovery() : await runProductDiscovery({ force: true });
  await audit({ actor: req.user, action: 'market.discovery_run', metadata: { classifyOnly: !!req.body?.classifyOnly }, req });
  res.json(out);
}));

router.post('/candidates/:id/:decision', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const decision = req.params.decision;
  try {
    const out = await decideCandidate(req.params.id, decision, {
      actor: actorOf(req), reason: String(req.body?.reason || ''),
      forgeProductId: req.body?.forgeProductId || null,
    });
    await audit({ actor: req.user, action: `market.candidate_${decision}`,
      targetType: 'market_candidate', targetId: req.params.id, req });
    res.json({ candidate: out });
  } catch (err) { throw badRequest(err.message); }
}));

/**
 * Turn an approved candidate into a real product.
 *
 * Its own endpoint rather than a decision, because it is the only step in the
 * workflow that WRITES to the customer-facing catalogue — and a route that
 * creates products should not be reachable by passing a different word to a
 * state-change endpoint. The product arrives inactive and unpriced; publishing
 * it is a separate decision, and pricing it goes through the recommendation
 * path that already refuses anything unapproved.
 */
router.post('/candidates/:id/create-product', requirePermission('products.write'),
  asyncHandler(async (req, res) => {
    try {
      const out = await createProductFromCandidate(req.params.id, {
        actor: actorOf(req),
        category: req.body?.category ? String(req.body.category).slice(0, 40) : null,
      });
      await audit({ actor: req.user, action: 'market.candidate_product_created',
        targetType: 'product', targetId: out.product.id,
        metadata: { candidateId: req.params.id, created: out.created }, req });
      res.json(out);
    } catch (err) { throw badRequest(err.message); }
  }));

// ── Pricing ────────────────────────────────────────────────────────────────
router.get('/pricing', requirePermission('products.read'), asyncHandler(async (_req, res) => {
  res.json({ recommendations: await pricingReport(), config: config.market });
}));

router.post('/pricing/refresh', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const out = await refreshRecommendations({ force: true });
  await audit({ actor: req.user, action: 'market.pricing_refreshed', metadata: out, req });
  res.json(out);
}));

router.post('/pricing/:marketProductId/recommend', requirePermission('products.write'), asyncHandler(async (req, res) => {
  try {
    res.json(await recommendFor(req.params.marketProductId, { promotional: !!req.body?.promotional }));
  } catch (err) { throw badRequest(err.message); }
}));

router.post('/recommendations/:id/:decision', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const { id, decision } = req.params;
  try {
    if (decision === 'publish') {
      const out = await publishRecommendation(id, { actor: actorOf(req) });
      await audit({ actor: req.user, action: 'market.price_published',
        targetType: 'product', targetId: out.productId,
        metadata: { oldCents: out.oldCents, newCents: out.newCents }, req });
      return res.json(out);
    }
    const out = await decideRecommendation(id, decision, {
      actor: actorOf(req), reason: String(req.body?.reason || ''),
    });
    await audit({ actor: req.user, action: `market.recommendation_${decision}`,
      targetType: 'market_recommendation', targetId: id, req });
    return res.json({ recommendation: out });
  } catch (err) { throw badRequest(err.message); }
}));

router.get('/price-history', requirePermission('products.read'), asyncHandler(async (req, res) => {
  res.json({ history: await priceHistory({ forgeProductId: req.query.productId || null }) });
}));

// ── Configuration and housekeeping ─────────────────────────────────────────
/** Try a formula before it becomes the shop's pricing rule. */
router.post('/formula/validate', requirePermission('products.read'), asyncHandler(async (req, res) => {
  const sample = {
    minimum_profitable_price: 9.26, competitive_market_price: 12.49, target_position: 0.98,
    lowest_competitor_price: 10.99, median_competitor_price: 12.49, highest_competitor_price: 14.99,
    official_price: 14.99, cost: 8.2, target_margin: 0.18, minimum_profit: 0.5,
    payment_fee_percent: 2.9, payment_fixed_fee: 0.29, fulfillment_cost: 0, vat_percent: 0,
    competitor_count: 5,
  };
  res.json({ ...validateFormula(String(req.body?.formula || ''), sample), sample });
}));

router.get('/fx', requirePermission('products.read'), asyncHandler(async (_req, res) => {
  res.json({ rates: await listRates() });
}));

router.post('/fx', requirePermission('products.write'), asyncHandler(async (req, res) => {
  const b = z.object({ base: z.string().length(3), quote: z.string().length(3), rate: z.number().positive() })
    .parse(req.body);
  try {
    const out = await recordRate(b.base, b.quote, b.rate, { source: `admin:${actorOf(req)}` });
    await audit({ actor: req.user, action: 'market.fx_recorded', metadata: out, req });
    res.status(201).json(out);
  } catch (err) { throw badRequest(err.message); }
}));

router.get('/stale', requirePermission('products.read'), asyncHandler(async (_req, res) => {
  res.json(await detectStaleData());
}));

export default router;
