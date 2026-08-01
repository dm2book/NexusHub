/** Public storefront routes: browse catalog, place an order, track by number. */
import { Router } from 'express';
import { z } from 'zod';
import { config, manualPayMethods } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { listProducts, getProduct, trendingProducts, priceHistory } from '../services/productService.js';
import { availableCounts, availableCount } from '../services/codeStockService.js';
import { getRewards as getMysteryRewards } from '../services/mysteryBoxService.js';
import { listUpcoming as listUpcomingDrops } from '../services/dropService.js';
import { evaluateCoupon } from '../services/couponService.js';
import { recommendationsFor } from '../services/recommendationService.js';
import { pricedBundles } from '../services/bundleService.js';
import { peekGiftCard } from '../services/giftCardService.js';
import { createOrder, getOrderByNumber, getOrder, markPaymentReceived } from '../services/orderService.js';
import { answer } from '../services/assistantService.js';
import { withCopy } from '../services/productCopy.js';
import { submitProof, getOrderProof } from '../services/paymentProofService.js';
import { listEnabledProviders } from '../services/oauthService.js';
import { isEnabled as stripeEnabled, createCheckoutSession } from '../services/stripeService.js';
import { publicStats } from '../services/publicStatsService.js';
import { recordPageView } from '../services/trackingService.js';
import { getCategoryLogos } from '../services/settingsService.js';
import { addReview, listReviews, addVerifiedReview } from '../services/reviewsService.js';
import { verifyIngest, canonicalReview } from '../middleware/ingestSignature.js';
import { audit } from '../services/auditService.js';
import { ApiError, forbidden } from '../utils/errors.js';

const router = Router();

// Public customer reviews (vouches ingested from Discord). Cached briefly.
let reviewsCache = { at: 0, data: null };

/**
 * Let Vercel's CDN answer instead of the function.
 *
 * Measured on a cold serverless start: ~3.4s importing modules, ~1.2s in
 * ensureReady()'s migrate/seed check, then the query — before Neon has even
 * woken from its idle suspend. That is where "sometimes 10 seconds for the
 * products" comes from, and no amount of query tuning fixes it, because the
 * request never reaches a query.
 *
 * These routes take no user, no cookie and no language: every visitor gets a
 * byte-identical body. So the edge can hold it, and the overwhelming majority
 * of visits never touch the function at all.
 *
 * `stale-while-revalidate` is the important half: once the window passes, the
 * next visitor still gets the cached copy instantly while the CDN refreshes in
 * the background. Nobody ever waits for a cold start.
 *
 * The cost is staleness. `stockLeft` and `instant` can be up to `seconds` old,
 * so a product that sells out keeps showing as in stock for that long. With
 * payments confirmed by hand that is well inside the noise — but it is why the
 * windows are a minute, not an hour, and why anything order-specific or
 * user-specific below is deliberately left uncached.
 */
const publicCache = (res, seconds, swr = seconds * 10) => {
  res.set('Cache-Control', `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${swr}`);
};

router.get('/reviews', asyncHandler(async (_req, res) => {
  publicCache(res, 300);
  if (!reviewsCache.data || Date.now() - reviewsCache.at > 20_000) {
    reviewsCache = { at: Date.now(), data: await listReviews({ limit: 30 }) };
  }
  res.json({ reviews: reviewsCache.data });
}));

// Ingest a review from the Discord bot. Protected by an HMAC signature
// (x-timestamp + x-signature) with replay protection; legacy shared-secret
// header still accepted during rollout.
router.post('/reviews/ingest',
  rateLimit({ bucket: 'review_ingest', windowMs: 60_000, max: 30 }),
  verifyIngest(canonicalReview)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const body = z.object({
      author: z.string().min(1).max(80),
      avatarUrl: z.string().url().optional(),
      stars: z.number().int().min(1).max(5).optional(),
      body: z.string().min(1).max(600),
      product: z.string().max(120).optional(),
      externalId: z.string().max(120).optional(),
    }).parse(req.body);
    const r = await addReview({ ...body, source: 'discord' });
    reviewsCache = { at: 0, data: null }; // bust cache
    if (!r.deduped) {
      await audit({ action: 'review.ingest', actor: { email: body.author }, targetType: 'review',
        targetId: r.id, metadata: { stars: body.stars }, req });
    }
    res.status(201).json({ ok: true, ...r });
  }));

// Anonymous page-view beacon (privacy-friendly: random session id, no PII).
// Powers real unique-visitor counts + true conversion rate. Lenient rate limit.
router.post('/track', rateLimit({ bucket: 'track', windowMs: 60_000, max: 120 }),
  asyncHandler(async (req, res) => {
    const body = z.object({
      sid: z.string().min(8).max(64),
      path: z.string().max(300).optional(),
      ref: z.string().max(300).optional(),
    }).parse(req.body || {});
    await recordPageView({ sessionId: body.sid, path: body.path, referrer: body.ref, userId: req.user?.id });
    res.status(204).end();
  }));

// Public trust stats for the storefront (orders delivered, avg delivery, recent
// deliveries…). Cached briefly so the homepage stays fast under load.
let statsCache = { at: 0, data: null };
router.get('/stats', asyncHandler(async (_req, res) => {
  publicCache(res, 300);
  if (!statsCache.data || Date.now() - statsCache.at > 30_000) {
    statsCache = { at: Date.now(), data: await publicStats() };
  }
  res.json(statsCache.data);
}));

// Which payment path the storefront should use. Manual methods (Tikkie/Revolut/
// PayPal) take priority when configured, then Stripe, then demo.
const manual = manualPayMethods();
const paymentProvider = () =>
  manual.length ? 'manual' : stripeEnabled() ? 'stripe' : config.payments.demoMode ? 'demo' : 'none';

// Public runtime config the SPA can read (feature flags, enabled providers).
router.get('/config', asyncHandler(async (_req, res) => {
  publicCache(res, 60);
  // Owner-set per-category logos (best-effort — never fail config on a DB hiccup).
  const categoryLogos = await getCategoryLogos().catch(() => ({}));
  res.json({
    paymentProvider: paymentProvider(),
    demoPayments: config.payments.demoMode,
    paymentMethods: manual,                 // [{id,label,target,kind}]
    paymentNote: config.payments.manual.note,
    announcement: config.shop.announcement,  // optional promo bar text
    trustpilotUrl: config.shop.trustpilotUrl,  // '' when the shop has no profile yet
    trustpilotReviewUrl: config.shop.trustpilotReviewUrl,  // the form, for surfaces that ask
    oauthProviders: listEnabledProviders(),
    discordEnabled: !!config.discord.inviteUrl || !!config.discord.guildId,
    brand: config.email.fromName,
    categoryLogos,
  });
}));

/**
 * Forge, the storefront assistant.
 *
 * Answers from live data — the same catalog rows the shop renders (including the
 * honest `instant` / `stockLeft` flags) and the same order lookup the track page
 * uses. Nothing here is generated: an assistant that invents a price is worse
 * than one that says it does not know.
 *
 * Rate-limited harder than the rest of /api: it is open to anyone, unauthenticated.
 */
router.post('/chat',
  rateLimit({ windowMs: 60_000, max: 20, bucket: 'chat' }),
  asyncHandler(async (req, res) => {
    const { message, lang } = z.object({
      message: z.string().min(1).max(500),
      lang: z.enum(['nl', 'en']).optional(),
    }).parse(req.body);

    const products = await listProducts({ activeOnly: true }).catch(() => []);
    const counts = await availableCounts(products.map((p) => p.id)).catch(() => ({}));
    const catalog = products.map((p) => ({
      ...p,
      stockLeft: stockLeftFor(p, counts[p.id] || 0),
      instant: instantFor(p, counts[p.id] || 0),
    }));

    const reply = await answer(message, {
      lang: lang || 'en',
      products: catalog,
      // Only the public, non-sensitive fields the track page already exposes.
      lookupOrder: async (number) => {
        const order = await getOrderByNumber(number).catch(() => null);
        if (!order) return null;
        return {
          number: order.number, status: order.status,
          statusLabel: order.statusLabel, totalFormatted: order.totalFormatted,
        };
      },
    });
    res.json(reply);
  }));

// Helper: confirm the requester owns the order (account holder or guest email).
async function assertOwnsOrder(req, order, email) {
  const owns = (req.user && order.email.toLowerCase() === req.user.email.toLowerCase()) ||
    (email && email.toLowerCase() === order.email.toLowerCase());
  if (!owns) throw forbidden('This order is not yours');
}

// Only surface a "left" count for products that actually sell from finite code
// stock (auto delivery). This keeps "almost sold out" honest — manual/made-to-
// order products, and auto products with plenty of stock, show nothing.
const LOW_STOCK = 6;
const stockLeftFor = (product, count) =>
  (product.deliveryMode === 'auto' && count > 0 && count <= LOW_STOCK) ? count : null;
// True only when a code is sitting in stock right now and the product is set to
// auto-deliver — i.e. the one case where "instant" is a promise we can keep.
// Everything else is fulfilled by hand and must say so.
const instantFor = (product, count) => product.deliveryMode === 'auto' && count > 0;

router.get('/products', asyncHandler(async (_req, res) => {
  publicCache(res, 60);
  const products = await listProducts({ activeOnly: true });
  const counts = await availableCounts(products.map((p) => p.id));
  res.json({ products: products.map((p) => withCopy({
    ...p,
    stockLeft: stockLeftFor(p, counts[p.id] || 0),
    instant: instantFor(p, counts[p.id] || 0),
  })) });
}));

// Trending products (most-sold recently). Registered before /products/:id.
let trendingCache = { at: 0, data: null };
router.get('/products/trending', asyncHandler(async (_req, res) => {
  publicCache(res, 300);
  if (!trendingCache.data || Date.now() - trendingCache.at > 60_000) {
    trendingCache = { at: Date.now(), data: await trendingProducts({ days: 14, limit: 8 }) };
  }
  res.json({ products: trendingCache.data });
}));

router.get('/products/:id', asyncHandler(async (req, res) => {
  publicCache(res, 60);
  const p = await getProduct(req.params.id);
  if (!p || !p.active) throw new ApiError(404, 'Product not found');
  const count = await availableCount(p.id);
  res.json({ product: withCopy({ ...p, stockLeft: stockLeftFor(p, count), instant: instantFor(p, count) }) });
}));

// Price history for the product-page chart.
router.get('/products/:id/price-history', asyncHandler(async (req, res) => {
  publicCache(res, 600);
  res.json({ history: await priceHistory(req.params.id) });
}));

// Upcoming drops (restocks / launches / sales) for the storefront calendar.
router.get('/drops', asyncHandler(async (_req, res) => {
  publicCache(res, 120);
  res.json({ drops: await listUpcomingDrops() });
}));

// Mystery-box reward pool — shown on the product page so buyers see what
// prizes are possible, but NOT the odds: the chances stay a mystery on purpose
// (weights are never exposed to the client, not even via devtools).
router.get('/products/:id/mystery', asyncHandler(async (req, res) => {
  const rewards = await getMysteryRewards(req.params.id);
  res.json({
    rewards: rewards.map((r) => ({ label: r.label, credit: r.credit })),
  });
}));

// Validate a discount code (checkout preview). Pass ?subtotal=cents for an exact
// discount + min-spend / limit checks; the order endpoint re-validates server-side.
router.get('/coupons/:code', asyncHandler(async (req, res) => {
  const subtotal = Math.max(0, Number(req.query.subtotal) || 0);
  const r = await evaluateCoupon(req.params.code, { subtotal, userId: req.user?.id, email: req.user?.email });
  if (!r.ok) throw new ApiError(404, r.reason || 'Invalid or expired code');
  res.json({ code: r.code, kind: r.kind, percent: r.percent, value: r.value, discount: r.discount, label: r.label });
}));

// Cross-sell + upsell recommendations for a product.
router.get('/products/:id/recommendations', asyncHandler(async (req, res) => {
  publicCache(res, 300);
  res.json(await recommendationsFor(req.params.id, { limit: 4 }));
}));

// Active bundle offers (resolved products + pricing). Cached briefly.
let bundlesCache = { at: 0, data: null };
router.get('/bundles', asyncHandler(async (_req, res) => {
  publicCache(res, 300);
  if (!bundlesCache.data || Date.now() - bundlesCache.at > 30_000) {
    const bundles = await pricedBundles();
    // Bundles are hand-written promos; the Dutch line is generated from the
    // products in them so a new bundle is never English-only on a Dutch page.
    bundlesCache = { at: Date.now(), data: bundles.map((b) => ({
      ...b,
      descriptionNl: b.descriptionNl
        || `${(b.products || []).map((p) => p.name).join(' + ')} — samen voordeliger.`,
    })) };
  }
  res.json({ bundles: bundlesCache.data });
}));

// Check a gift-card balance (redemption requires being signed in — see account API).
router.get('/gift-cards/:code', asyncHandler(async (req, res) => {
  const g = await peekGiftCard(req.params.code);
  if (!g) throw new ApiError(404, 'Gift card not found');
  res.json(g);
}));

// Place an order. Authenticated users get it linked to their account; guests
// may order by email. Checkout/payment capture would call markPaymentReceived.
router.post('/orders', rateLimit({ bucket: 'checkout', windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const body = z.object({
      email: z.string().email(),
      items: z.array(z.object({
        productId: z.string(),
        quantity: z.number().int().positive().max(999).optional(),
        metadata: z.record(z.any()).optional(),
      })).min(1),
      billing: z.record(z.any()).optional(),
      currency: z.string().length(3).optional(),
      coupon: z.string().max(40).optional(),
      useCredit: z.number().int().nonnegative().max(100_000_00).optional(),
      paymentMethod: z.string().max(20).optional(),
      // Required, and listed here on purpose: zod strips unknown keys, so a
      // field missing from this schema never reaches createOrder no matter what
      // the client sends. The buyer's waiver of the 14-day withdrawal right is
      // the one piece of evidence a chargeback turns on.
      consent: z.literal(true),
      consentText: z.string().max(400).optional(),
    }).parse(req.body);

    const order = await createOrder(
      { ...body, userId: req.user?.id || null },
      { user: req.user, actorId: req.user?.id });
    res.status(201).json({ order });
  }));

// Create a Stripe Checkout Session for an order and return its redirect URL.
router.post('/orders/:id/checkout', rateLimit({ bucket: 'pay', windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    if (!stripeEnabled()) throw new ApiError(400, 'Card payments are not configured');
    const order = await getOrder(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const { email } = z.object({ email: z.string().email().optional() }).parse(req.body || {});
    await assertOwnsOrder(req, order, email);
    if (order.status !== 'pending') return res.json({ alreadyPaid: true });
    const session = await createCheckoutSession(order);
    res.json({ url: session.url });
  }));

// Demo payment — marks an order paid without a real PSP, gated by DEMO_PAYMENTS.
router.post('/orders/:id/pay', rateLimit({ bucket: 'pay', windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    // Demo self-pay is a dev convenience only. Refuse it whenever a real payment
    // method is configured — otherwise a live deploy that forgot NODE_ENV would
    // let any buyer mark their own order paid and auto-receive stock.
    const realPaymentConfigured = manualPayMethods().length > 0 || !!config.payments.stripe.secretKey;
    if (!config.payments.demoMode || realPaymentConfigured) throw new ApiError(404, 'Not found');
    const order = await getOrder(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const { email } = z.object({ email: z.string().email().optional() }).parse(req.body || {});
    await assertOwnsOrder(req, order, email);
    if (order.status !== 'pending') return res.json({ order });
    const updated = await markPaymentReceived(order.id, `demo_${Date.now()}`,
      { actorId: req.user?.id || 'customer', reason: 'Demo payment' });
    res.json({ order: updated });
  }));

// Customer submits proof of payment for a manual-payment order.
router.post('/orders/:id/proof', rateLimit({ bucket: 'proof', windowMs: 60_000, max: 10 }),
  asyncHandler(async (req, res) => {
    const order = await getOrder(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const body = z.object({
      method: z.string().max(20).optional(),
      transactionId: z.string().max(120).optional(),
      // The checkout uploads the buyer's payment screenshot as a resized data
      // URI (Checkout.jsx -> fileToDataUrl), which the old `.url().max(500)` +
      // http(s) rule rejected every single time — the easiest way for someone on
      // a phone to prove they paid always errored. Accept both shapes: a linked
      // image, or an inline one bounded to the same 900 kB the client caps at.
      screenshotUrl: z.string().max(1_400_000)
        .refine((u) => /^https?:\/\//i.test(u) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(u),
          'Must be an http(s) link or an uploaded image')
        .refine((u) => !u.startsWith('data:') || u.length <= 1_300_000,
          'That image is too large — try a smaller screenshot')
        .optional(),
      note: z.string().max(300).optional(),
      email: z.string().email().optional(),
    }).parse(req.body || {});
    await assertOwnsOrder(req, order, body.email);
    const result = await submitProof(order.id, body, { ip: req.ip, user: req.user, req });
    res.status(201).json(result);
  }));

// Current proof status for an order (customer view).
router.get('/orders/:id/proof', asyncHandler(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  await assertOwnsOrder(req, order, req.query.email);
  res.json({ proof: await getOrderProof(order.id), status: order.status });
}));

// Guest review: any buyer can review a DELIVERED order by proving they know the
// order number + the email it was placed with. Deduped per order (one review),
// stored as a verified purchase — closes the review loop for non-Discord buyers.
router.post('/track/:number/review',
  rateLimit({ bucket: 'guest_review', windowMs: 60_000, max: 5 }),
  asyncHandler(async (req, res) => {
    const { email, stars, body, author } = z.object({
      email: z.string().email(),
      stars: z.number().int().min(1).max(5),
      body: z.string().min(3).max(600),
      author: z.string().max(60).optional(),
    }).parse(req.body || {});
    const order = await getOrderByNumber(req.params.number);
    if (!order) throw new ApiError(404, 'Order not found');
    if (order.email !== email.toLowerCase()) throw forbidden('Email does not match this order');
    if (order.status !== 'completed') throw forbidden('You can review an order once it is delivered');
    const result = await addVerifiedReview({
      userId: order.userId || null, email: order.email, orderId: order.id,
      author: (author || order.billing?.full_name?.split(/\s+/)[0] || 'Verified buyer').slice(0, 60),
      stars, body, product: order.items?.[0]?.name || null,
      city: order.billing?.city || null,
    });
    await audit({ action: 'review.create_guest', targetType: 'order', targetId: order.id,
      metadata: { stars }, req });
    res.status(201).json(result);
  }));

// Dynamic sitemap: static pages + every active product, always current.
// vercel.json rewrites /sitemap.xml here (the static file is removed).
router.get('/sitemap.xml', asyncHandler(async (_req, res) => {
  const base = config.appUrl.replace(/\/$/, '');
  const staticPages = ['', '/shop', '/reviews', '/how-it-works', '/faq', '/about',
    '/contact', '/track', '/discord', '/payment-methods', '/refunds', '/trust'];
  const products = await listProducts({ activeOnly: true });
  const urls = [
    ...staticPages.map((p) => ({ loc: `${base}${p}`, prio: p === '' ? '1.0' : '0.7' })),
    ...products.map((p) => ({ loc: `${base}/product/${p.id}`, prio: '0.8', mod: p.updated_at })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) =>
      `  <url><loc>${u.loc}</loc>` +
      (u.mod ? `<lastmod>${String(u.mod).slice(0, 10)}</lastmod>` : '') +
      `<priority>${u.prio}</priority></url>`).join('\n') +
    `\n</urlset>`;
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(xml);
}));

// Public tracking by order number (no PII beyond status timeline).
router.get('/track/:number', asyncHandler(async (req, res) => {
  const order = await getOrderByNumber(req.params.number);
  if (!order) throw new ApiError(404, 'Order not found');
  res.json({
    number: order.number, status: order.status, statusLabel: order.statusLabel,
    total: order.total, totalFormatted: order.totalFormatted, currency: order.currency,
    history: order.history.map((h) => ({ to: h.to_status, at: h.created_at })),
    // The owner can attach a payment request with the exact amount already in
    // it; the buyer's page polls, so it appears without a refresh. Only while
    // the order is unpaid — a pay button on a paid order invites paying twice.
    payLink: order.status === 'pending' ? (order.payLink || null) : null,
    // Resolved server-side with the amount already in each URL where the
    // provider supports it, so the page never has to build a payment link.
    payMethods: order.status === 'pending' ? order.payMethods : [],
    updatedAt: order.updatedAt,
  });
}));

export default router;
