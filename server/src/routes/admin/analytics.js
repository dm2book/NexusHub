/** Admin analytics dashboard endpoints. */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import * as analytics from '../../services/analyticsService.js';
import * as profit from '../../services/profitService.js';
import { topCustomers, SORT_KEYS, SEGMENT_KEYS, STATUS_KEYS } from '../../services/customerValueService.js';
import * as attribution from '../../services/attributionService.js';
import * as adPerf from '../../services/adPerformanceService.js';
import { adIntelligence } from '../../services/adIntelligenceService.js';
import { generateAdScripts, adScriptProducts } from '../../services/adScriptService.js';
import { generateConcepts, conceptProducts, conceptsMarkdown } from '../../services/adConceptService.js';
import { ugcOptions, buildUgcBoard, UGC_LANGS } from '../../services/ugcStudioService.js';
import { studioOptions, buildStoryboard, synthesizePremium, ANGLES, PLATFORMS, LENGTHS, LANGS, VOICE_PROVIDERS } from '../../services/adStudioService.js';
import { notFound } from '../../utils/errors.js';
import { staticAds, staticProducts, STATIC_LANGS } from '../../services/adStaticsService.js';
import { importCsv, syncAll, syncStatus } from '../../services/adSpendSyncService.js';
import { z } from 'zod';
import { audit } from '../../services/auditService.js';

const router = Router();
router.use(requirePermission('analytics.read'));

/* Growth → Top Customers: lifetime value, retention and VIP score per customer.
   Under analytics.read like the rest of this file — it is the same money, per
   person — and it lists e-mail addresses, so it is not public in any form. */
router.get('/customers', asyncHandler(async (req, res) => {
  const q = z.object({
    sort: z.enum(SORT_KEYS).catch('ltv').default('ltv'),
    segment: z.enum(SEGMENT_KEYS).optional().catch(undefined),
    status: z.enum(STATUS_KEYS).optional().catch(undefined),
    q: z.string().max(100).optional().catch(undefined),
    limit: z.coerce.number().int().min(1).max(200).catch(50).default(50),
  }).parse(req.query || {});
  res.json(await topCustomers(q));
}));

/* Profit, which is a different question from revenue.
   Its own endpoint rather than more fields on /overview: it carries three
   periods, every product, three leaderboards and the coverage each figure was
   computed over, and folding that into the revenue summary would make the one
   number people read depend on a payload they did not ask for. */
router.get('/profit', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  res.json(await profit.profitDashboard({ limit }));
}));

router.get('/overview', asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const [overview, revenueSeries, statusBreakdown] = await Promise.all([
    analytics.overview({ days }),
    analytics.revenueSeries({ days }),
    analytics.statusBreakdown(),
  ]);
  res.json({ overview, revenueSeries, statusBreakdown });
}));

router.get('/top-products', asyncHandler(async (req, res) => {
  res.json({ products: await analytics.topProducts({
    days: Math.min(Number(req.query.days) || 90, 365),
    limit: Math.min(Number(req.query.limit) || 10, 50),
  }) });
}));

router.get('/clv', asyncHandler(async (_req, res) => {
  res.json(await analytics.customerLifetimeValue({ limit: 10 }));
}));

router.get('/retention', asyncHandler(async (_req, res) => {
  res.json(await analytics.retentionMetrics());
}));

router.get('/recovery', asyncHandler(async (req, res) => {
  res.json(await analytics.recoveryMetrics({
    days: Math.min(Number(req.query.days) || 30, 365),
  }));
}));

/**
 * Which advert sold something.
 *
 * One call rather than three: the funnel, the creatives and the campaign
 * rollup are the same report read at three zoom levels, and fetching them
 * separately would let the page render a funnel and a table computed over
 * different windows — which looks like a bug in the funnel.
 */
router.get('/attribution', asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const [funnel, creatives, campaigns] = await Promise.all([
    attribution.funnel({ days }),
    attribution.creativePerformance({ days, limit: Math.min(Number(req.query.limit) || 50, 200) }),
    attribution.campaignPerformance({ days }),
  ]);
  res.json({
    funnel, creatives, campaigns,
    windowDays: attribution.ATTRIBUTION_WINDOW_DAYS,
    // Printed in the report's empty state, so whoever is building a link by
    // hand has the accepted spellings in front of them rather than in a source
    // file they would have to go and find.
    recognisedParams: attribution.RECOGNISED_PARAMS,
  });
}));

/**
 * The ad report: every creative with its platform numbers, graded.
 *
 * Read-only. Nothing here pauses an advert — this shop has no write access to
 * anybody's ad account, and a dashboard that claimed to turn one off would be
 * describing a button that does not exist.
 */
router.get('/ads', asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const minVisits = Math.max(1, Math.min(Number(req.query.minVisits) || 30, 10_000));
  res.json(await adPerf.adPerformance({ days, minVisits }));
}));

/**
 * Growth → Ad Intelligence: the same report per advert and per platform, with
 * the winner, the loser and the highest CTR, revenue and profit picked out.
 */
router.get('/ads/intelligence', asyncHandler(async (req, res) => {
  const { days, minVisits } = z.object({
    days: z.coerce.number().int().min(1).max(365).catch(30).default(30),
    minVisits: z.coerce.number().int().min(1).max(10_000).catch(30).default(30),
  }).parse(req.query || {});
  res.json(await adIntelligence({ days, minVisits }));
}));

/**
 * Growth → Ad Scripts: 10 hooks, scripts and CTAs per product, built only from
 * the product, its real orders, measured deliveries and observed prices.
 */
router.get('/ad-scripts', asyncHandler(async (_req, res) => {
  res.json({ products: await adScriptProducts() });
}));
router.get('/ad-scripts/:productId', asyncHandler(async (req, res) => {
  const out = await generateAdScripts(String(req.params.productId).slice(0, 64));
  if (!out) throw notFound('Product not found');
  res.json(out);
}));

/**
 * Growth → Ad Concepts: 100 TikTok concepts (UGC, Story, POV, Comparison,
 * Meme, Reddit-style, TikTok native) as shooting scripts, filled in from the
 * product's facts and gated like every other advert.
 */
router.get('/ad-concepts', asyncHandler(async (_req, res) => {
  res.json({ products: await conceptProducts() });
}));
router.get('/ad-concepts/:productId', asyncHandler(async (req, res) => {
  const out = await generateConcepts(String(req.params.productId).slice(0, 64));
  if (!out) throw notFound('Product not found');
  res.json(out);
}));
router.get('/ad-concepts/:productId/script.md', asyncHandler(async (req, res) => {
  const md = await conceptsMarkdown(String(req.params.productId).slice(0, 64));
  if (!md) throw notFound('Product not found');
  res.type('text/markdown; charset=utf-8').set('Content-Disposition', 'attachment; filename="tiktok-concepten.md"').send(md);
}));

/**
 * Growth → Ad Studio: the storyboard of a video ad the browser renders.
 * Choose a product, what the ad is for, the platform, length and language.
 */
/* Growth → Static ads: what each still image may say, per product and language;
   the page draws them (src/lib/adStudio/statics.js). */
router.get('/ad-statics', asyncHandler(async (_req, res) => {
  res.json({ products: await staticProducts(), langs: STATIC_LANGS });
}));
/* The catalogue feed: how complete it is, and storing a product's drawn
   1080×1080 catalogue image (JPEG from the Static ads page). */
router.get('/ad-feed', asyncHandler(async (_req, res) => {
  const { feedStatus } = await import('../../services/productFeedService.js');
  res.json(await feedStatus());
}));
router.post('/ad-feed/:productId/image', requirePermission('analytics.write'), asyncHandler(async (req, res) => {
  const { image } = z.object({ image: z.string().regex(/^data:image\/jpeg;base64,/).max(2_500_000) }).parse(req.body || {});
  const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
  const { dimensions, storeImage } = await import('../../services/imageStoreService.js');
  const { width, height } = dimensions('image/jpeg', bytes);
  if (width < 500 || height < 500) return res.status(400).json({ error: { message: 'A catalogue image must be at least 500×500' } });
  const stored = await storeImage('image/jpeg', bytes, { productId: req.params.productId, source: 'ad-feed' });
  const { setFeedImage } = await import('../../services/productFeedService.js');
  if (!(await setFeedImage(req.params.productId, stored.url))) throw notFound('Product not found');
  res.json({ url: stored.url });
}));
router.get('/ad-statics/:productId', asyncHandler(async (req, res) => {
  const lang = STATIC_LANGS.includes(req.query.lang) ? req.query.lang : 'nl';
  const out = await staticAds(req.params.productId, lang);
  if (!out) throw notFound('Product not found');
  res.json(out);
}));

router.get('/ad-studio/options', asyncHandler(async (_req, res) => {
  res.json(await studioOptions());
}));
router.post('/ad-studio/storyboard', asyncHandler(async (req, res) => {
  const body = z.object({
    productId: z.string().min(1).max(64),
    angles: z.array(z.enum(Object.keys(ANGLES))).max(6).optional().default([]),
    platform: z.enum(Object.keys(PLATFORMS)).catch('tiktok').default('tiktok'),
    length: z.coerce.number().int().refine((n) => LENGTHS.includes(n)).catch(30).default(30),
    lang: z.enum(LANGS).catch('nl').default('nl'),
  }).parse(req.body || {});
  const board = await buildStoryboard(body);
  if (!board) throw notFound('Product not found');
  res.json(board);
}));
/* The fifty UGC scripts, read against today's catalogue, and one as a storyboard. */
router.get('/ad-studio/ugc', asyncHandler(async (req, res) => {
  const { lang } = z.object({ lang: z.enum(UGC_LANGS).catch('nl').default('nl') }).parse(req.query || {});
  res.json(await ugcOptions({ lang }));
}));
router.post('/ad-studio/ugc/storyboard', asyncHandler(async (req, res) => {
  const body = z.object({
    scriptId: z.string().regex(/^ugc-\d{2}$/),
    platform: z.enum(Object.keys(PLATFORMS)).catch('tiktok').default('tiktok'),
    lang: z.enum(UGC_LANGS).catch('nl').default('nl'),
  }).parse(req.body || {});
  const board = await buildUgcBoard(body);
  if (!board) throw notFound('Script not found');
  if (board.error) return res.status(409).json({ error: { message: board.error } });
  res.json(board);
}));
/* A premium voice line, with the owner's own ElevenLabs or OpenAI key. It costs
   money per character, so it needs write access, and the text is gated. */
router.post('/ad-studio/voice', requirePermission('analytics.write'), asyncHandler(async (req, res) => {
  const body = z.object({
    text: z.string().min(1).max(600),
    provider: z.enum(VOICE_PROVIDERS),
    lang: z.enum(UGC_LANGS).catch('nl').default('nl'),
    voice: z.string().max(80).nullish(),
  }).parse(req.body || {});
  try {
    const audio = await synthesizePremium(body);
    res.set('Content-Type', 'audio/mpeg').set('Cache-Control', 'no-store').send(audio);
  } catch (e) {
    res.status(e.status || 500).json({ error: { message: e.message } });
  }
}));

/** One measure per day per creative, for the chart. */
router.get('/ads/timeseries', asyncHandler(async (req, res) => {
  const { metric, days } = z.object({
    metric: z.enum(['roas', 'conversion', 'ctr', 'revenue']).optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
  }).parse(req.query || {});
  res.json(await adPerf.adTimeseries({ metric: metric || 'roas', days: days || 30 }));
}));

/**
 * What the platform charged, entered by hand or imported.
 *
 * The only way impressions and spend get into this system: neither is
 * observable from here, and both are required before CTR or ROAS mean anything.
 */
/* The platforms' own numbers, imported from their CSV export or pulled from
   their reporting APIs (adSpendSyncService.js). */
router.get('/ads/sync', asyncHandler(async (_req, res) => { res.json(await syncStatus()); }));
router.post('/ads/sync', requirePermission('analytics.write'), asyncHandler(async (req, res) => {
  const out = await syncAll({ days: 14, deadline: Date.now() + 22_000 });
  await audit({ actor: req.user, action: 'ads.sync', metadata: { meta: out.meta?.written ?? out.meta, tiktok: out.tiktok?.written ?? out.tiktok }, req });
  res.json(out);
}));
router.post('/ads/import', requirePermission('analytics.write'), asyncHandler(async (req, res) => {
  const body = z.object({ network: z.enum(['meta', 'tiktok']), csv: z.string().min(1).max(5_000_000) }).parse(req.body || {});
  try {
    const out = await importCsv(body.csv, { network: body.network });
    await audit({ actor: req.user, action: 'ads.import', metadata: { network: body.network, written: out.written, skipped: out.skippedCount }, req });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: { message: e.message } });
  }
}));

router.post('/ads/spend', requirePermission('analytics.write'), asyncHandler(async (req, res) => {
  const body = z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    network: z.string().min(1).max(40),
    campaign: z.string().max(200).nullish(),
    creative: z.string().max(200).nullish(),
    impressions: z.coerce.number().int().min(0).nullish(),
    clicks: z.coerce.number().int().min(0).nullish(),
    spendCents: z.coerce.number().int().min(0).nullish(),
    note: z.string().max(400).nullish(),
  }).parse(req.body || {});
  try {
    const row = await adPerf.recordSpend({ ...body, source: 'manual' });
    await audit({ actor: req.user, action: 'ads.spend_recorded',
      metadata: { day: body.day, network: body.network, creative: body.creative }, req });
    res.json({ spend: row });
  } catch (e) {
    res.status(400).json({ error: { message: e.message } });
  }
}));

export default router;
