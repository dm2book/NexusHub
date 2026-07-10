/** Public storefront routes: browse catalog, place an order, track by number. */
import { Router } from 'express';
import { z } from 'zod';
import { config, manualPayMethods } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { listProducts, getProduct, trendingProducts, priceHistory } from '../services/productService.js';
import { getRewards as getMysteryRewards } from '../services/mysteryBoxService.js';
import { listUpcoming as listUpcomingDrops } from '../services/dropService.js';
import { evaluateCoupon } from '../services/couponService.js';
import { recommendationsFor } from '../services/recommendationService.js';
import { pricedBundles } from '../services/bundleService.js';
import { peekGiftCard } from '../services/giftCardService.js';
import { createOrder, getOrderByNumber, getOrder, markPaymentReceived } from '../services/orderService.js';
import { submitProof, getOrderProof } from '../services/paymentProofService.js';
import { listEnabledProviders } from '../services/oauthService.js';
import { isEnabled as stripeEnabled, createCheckoutSession } from '../services/stripeService.js';
import { publicStats } from '../services/publicStatsService.js';
import { recordPageView } from '../services/trackingService.js';
import { addReview, listReviews, addVerifiedReview } from '../services/reviewsService.js';
import { verifyIngest, canonicalReview } from '../middleware/ingestSignature.js';
import { audit } from '../services/auditService.js';
import { ApiError, forbidden } from '../utils/errors.js';

const router = Router();

// Public customer reviews (vouches ingested from Discord). Cached briefly.
let reviewsCache = { at: 0, data: null };
router.get('/reviews', asyncHandler(async (_req, res) => {
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
router.get('/config', (_req, res) => {
  res.json({
    paymentProvider: paymentProvider(),
    demoPayments: config.payments.demoMode,
    paymentMethods: manual,                 // [{id,label,target,kind}]
    paymentNote: config.payments.manual.note,
    announcement: config.shop.announcement,  // optional promo bar text
    oauthProviders: listEnabledProviders(),
    discordEnabled: !!config.discord.inviteUrl || !!config.discord.guildId,
    brand: config.email.fromName,
  });
});

// Helper: confirm the requester owns the order (account holder or guest email).
async function assertOwnsOrder(req, order, email) {
  const owns = (req.user && order.email.toLowerCase() === req.user.email.toLowerCase()) ||
    (email && email.toLowerCase() === order.email.toLowerCase());
  if (!owns) throw forbidden('This order is not yours');
}

router.get('/products', asyncHandler(async (_req, res) => {
  res.json({ products: await listProducts({ activeOnly: true }) });
}));

// Trending products (most-sold recently). Registered before /products/:id.
let trendingCache = { at: 0, data: null };
router.get('/products/trending', asyncHandler(async (_req, res) => {
  if (!trendingCache.data || Date.now() - trendingCache.at > 60_000) {
    trendingCache = { at: Date.now(), data: await trendingProducts({ days: 14, limit: 8 }) };
  }
  res.json({ products: trendingCache.data });
}));

router.get('/products/:id', asyncHandler(async (req, res) => {
  const p = await getProduct(req.params.id);
  if (!p || !p.active) throw new ApiError(404, 'Product not found');
  res.json({ product: p });
}));

// Price history for the product-page chart.
router.get('/products/:id/price-history', asyncHandler(async (req, res) => {
  res.json({ history: await priceHistory(req.params.id) });
}));

// Upcoming drops (restocks / launches / sales) for the storefront calendar.
router.get('/drops', asyncHandler(async (_req, res) => {
  res.json({ drops: await listUpcomingDrops() });
}));

// Mystery-box reward pool with odds — shown on the product page so buyers see
// exactly what's inside and the real chances (transparency = trust).
router.get('/products/:id/mystery', asyncHandler(async (req, res) => {
  const rewards = await getMysteryRewards(req.params.id);
  const total = rewards.reduce((s, r) => s + Math.max(1, r.weight), 0) || 1;
  res.json({
    rewards: rewards.map((r) => ({
      label: r.label, credit: r.credit,
      odds: Math.round((Math.max(1, r.weight) / total) * 1000) / 10, // one decimal %
    })),
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
  res.json(await recommendationsFor(req.params.id, { limit: 4 }));
}));

// Active bundle offers (resolved products + pricing). Cached briefly.
let bundlesCache = { at: 0, data: null };
router.get('/bundles', asyncHandler(async (_req, res) => {
  if (!bundlesCache.data || Date.now() - bundlesCache.at > 30_000) {
    bundlesCache = { at: Date.now(), data: await pricedBundles() };
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
    if (!config.payments.demoMode) throw new ApiError(404, 'Not found');
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
      screenshotUrl: z.string().url().max(500).optional(),
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
    updatedAt: order.updatedAt,
  });
}));

export default router;
