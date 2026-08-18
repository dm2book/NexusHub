/** Public storefront routes: browse catalog, place an order, track by number. */
import { Router } from 'express';
import { z } from 'zod';
import { config, manualPayMethods, commerceBlockers } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { publicCache } from '../utils/httpCache.js';
import { requireLaunched, launchAtIso } from '../services/launchGateService.js';
import { subscribe } from '../services/newsletterService.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { listProducts, getProduct, trendingProducts, priceHistory } from '../services/productService.js';
import { availableCounts, availableCount } from '../services/codeStockService.js';
import { getRewards as getMysteryRewards } from '../services/mysteryBoxService.js';
import { listUpcoming as listUpcomingDrops } from '../services/dropService.js';
import { evaluateCoupon } from '../services/couponService.js';
import { recommendationsFor } from '../services/recommendationService.js';
import { pricedBundles } from '../services/bundleService.js';
import { peekGiftCard } from '../services/giftCardService.js';
import { createOrder, getOrderByNumber, getOrder, markPaymentReceived, getPspPayment } from '../services/orderService.js';
import { requestRefund, getRefundRequestForOrder } from '../services/supportService.js';
import { answer } from '../services/assistantService.js';
import { withCopy } from '../services/productCopy.js';
import { submitProof, getOrderProof } from '../services/paymentProofService.js';
import { listEnabledProviders } from '../services/oauthService.js';
import { isEnabled as stripeEnabled, createCheckoutSession } from '../services/stripeService.js';
import { isEnabled as mollieEnabled, SUPPORTED_METHODS as MOLLIE_METHODS } from '../services/mollieService.js';
import { countryOf } from '../utils/netRisk.js';
import { holdMessage } from '../services/fraudService.js';
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
// Shared with every other public route — see utils/httpCache.js.

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
      // The author's Discord account id. Optional so an older bot keeps working
      // exactly as before — but it is the only thing that ties a /vouch to an
      // account here, and therefore the only way a vouch can earn a role.
      discordUid: z.string().max(32).optional(),
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

/**
 * Which payment path the storefront should use.
 *
 * Mollie comes first when it is configured, and deliberately outranks the manual
 * links even if both are set up. It is the only path where the money confirms
 * itself: iDEAL settles in seconds, the webhook marks the order paid, and stock
 * dispenses without anyone reading a bank app. A manual link means the buyer
 * waits for a human — worth having as a fallback, not worth preferring.
 *
 * Then manual, then Stripe, then demo.
 */
const manual = manualPayMethods();
const paymentProvider = () =>
  mollieEnabled() ? 'mollie'
    : manual.length ? 'manual'
      : stripeEnabled() ? 'stripe'
        : config.payments.demoMode ? 'demo' : 'none';

// Public runtime config the SPA can read (feature flags, enabled providers).
/**
 * "Tell me when you open."
 *
 * Deliberately NOT behind the launch gate — it is the one thing a pre-launch
 * visitor is here to do, and it keeps working afterwards for anyone who wants
 * the drops. Rate limited per IP because it writes, and shared so the limit
 * means the same thing on every instance.
 */
router.post('/newsletter',
  rateLimit({ bucket: 'newsletter', windowMs: 60_000, max: 5, shared: true }),
  asyncHandler(async (req, res) => {
    const body = z.object({
      email: z.string().email().max(200),
      // The sentence the visitor actually agreed to. Marketing consent has to be
      // provable and the wording is the evidence, so it is stored rather than
      // reconstructed later from whatever the form says today.
      consentText: z.string().max(400).optional(),
      source: z.string().max(40).optional(),
    }).parse(req.body || {});
    const r = await subscribe(body.email, { source: body.source || 'prelaunch', consentText: body.consentText });
    // Same answer either way: a different one would turn this into a way to ask
    // whether an address is already on the list.
    res.status(201).json({ ok: true, subscribed: true, alreadySubscribed: r.alreadySubscribed });
  }));

router.get('/config', asyncHandler(async (_req, res) => {
  publicCache(res, 60);
  // Owner-set per-category logos (best-effort — never fail config on a DB hiccup).
  const categoryLogos = await getCategoryLogos().catch(() => ({}));
  res.json({
    /* The launch MOMENT, not a "we are closed" flag.
       This response is held at the edge for a minute, and a cached verdict would
       still be saying "not open yet" after the shop opened. A timestamp cannot
       go stale that way: the browser compares it to its own clock, so the banner
       and the countdown flip at exactly the right second on a copy that was
       cached a minute earlier. Null once there is nothing left to wait for. */
    launchAt: launchAtIso(),
    paymentProvider: paymentProvider(),
    // True when the shop cannot currently honour an order, so the storefront can
    // say so up front instead of letting someone fill a cart and hit a wall at
    // the last step. The reasons themselves name env vars and stay server-side.
    orderingPaused: commerceBlockers().length > 0,
    demoPayments: config.payments.demoMode,
    paymentMethods: manual,                 // [{id,label,target,kind}]
    // What the buyer may end up seeing on Mollie's page. Which of these is
    // actually offered depends on the amount and the country, so the checkout
    // asks /api/mollie/methods for the real list once it knows the total —
    // this is only the shop-level "we accept these" statement.
    mollieMethods: mollieEnabled() ? MOLLIE_METHODS : [],
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
export async function assertOwnsOrder(req, order, email) {
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
// The first wall a burst meets, and the one worth being able to move without a
// deploy — see LIMIT_CHECKOUT_PER_MINUTE in config/env.js for why.
router.post('/orders',
  /* Before the commerce blockers below, on purpose. Both refuse the order, but
     they are not equally true: before launch the honest answer is "we open on
     the 24th", and a visitor who reads "ordering is paused, try again shortly"
     will come back in an hour and find it still paused. The more specific
     reason wins. `createOrder` carries the same check as a backstop, so a route
     added later cannot slip past it. */
  requireLaunched('The checkout', { money: true }),
  rateLimit({
    bucket: 'checkout', windowMs: 60_000,
    max: config.security.checkoutPerMinute, shared: true,
  }),
  asyncHandler(async (req, res) => {
    // Refuse the order rather than the whole site. See commerceBlockers(): a
    // shop that cannot deliver must not take the money, but it can still be
    // browsed, still show existing orders, and still let its owner sign in to
    // fix the setting that is blocking it.
    const blockers = commerceBlockers();
    if (blockers.length) {
      // The reasons name unset environment variables, so they go to the log the
      // owner reads, not to whoever is standing at the checkout.
      console.error('[checkout] refused — cannot fulfil an order:', blockers.join('; '));
      throw new ApiError(503,
        'Ordering is paused right now. Nothing has been charged — please try again shortly.',
        'commerce_paused');
    }
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

    // The IP and country are the only fraud signals that exist solely at the
    // edge — by the time an order reaches the service layer there is nothing
    // left to read them from, which is why they are threaded through here
    // rather than looked up later.
    const order = await createOrder(
      { ...body, userId: req.user?.id || null },
      { user: req.user, actorId: req.user?.id, ip: req.ip || null, country: countryOf(req) });
    res.status(201).json({ order });
  }));

// Create a Stripe Checkout Session for an order and return its redirect URL.
router.post('/orders/:id/checkout', requireLaunched('Payment', { money: true }),
  rateLimit({ bucket: 'pay', windowMs: 60_000, max: 30, shared: true }),
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
router.post('/orders/:id/pay', rateLimit({ bucket: 'pay', windowMs: 60_000, max: 30, shared: true }),
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
router.post('/orders/:id/proof', rateLimit({ bucket: 'proof', windowMs: 60_000, max: 10, shared: true }),
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
  // Priority is a hint about relative importance WITHIN this site, not a ranking
  // lever — search engines have said so for years. It is set from what the page
  // is for: the shop and the catalogue earn money, the legal pages earn trust,
  // and the community page is a link.
  const staticPages = [
    ['', '1.0', 'daily'],
    ['/shop', '0.9', 'daily'],
    // The keyword landing pages — the ones this shop is actually searched for.
    // Ranked just under the shop itself: each is a real page with its own copy,
    // not a filtered view.
    ['/robux', '0.9', 'daily'],
    ['/v-bucks', '0.9', 'daily'],
    ['/valorant-points', '0.9', 'daily'],
    ['/giftcards', '0.9', 'daily'],
    ['/game-currency', '0.8', 'weekly'],
    ['/how-it-works', '0.7', 'monthly'],
    ['/payment-methods', '0.7', 'monthly'],
    ['/reviews', '0.7', 'weekly'],
    ['/faq', '0.7', 'monthly'],
    ['/track', '0.6', 'monthly'],
    ['/about', '0.6', 'monthly'],
    ['/contact', '0.6', 'monthly'],
    ['/trust', '0.6', 'monthly'],
    ['/drops', '0.5', 'weekly'],
    ['/discord', '0.5', 'monthly'],
    // The pages a buyer checks before trusting a shop they have never heard of,
    // and the ones a search engine reads to decide this is a real business.
    // They were missing from the sitemap entirely.
    ['/refunds', '0.5', 'yearly'],
    ['/terms', '0.4', 'yearly'],
    ['/privacy', '0.4', 'yearly'],
    ['/cookies', '0.4', 'yearly'],
  ];
  const products = await listProducts({ activeOnly: true });
  const urls = [
    ...staticPages.map(([p, prio, freq]) => ({ loc: `${base}${p}`, prio, freq })),
    // Products carry a real lastmod so a price change is re-crawled rather than
    // waiting for the whole site to be revisited.
    ...products.map((p) => ({
      loc: `${base}/product/${p.id}`, prio: '0.8', freq: 'weekly', mod: p.updated_at,
    })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) =>
      `  <url><loc>${u.loc}</loc>` +
      (u.mod ? `<lastmod>${String(u.mod).slice(0, 10)}</lastmod>` : '') +
      (u.freq ? `<changefreq>${u.freq}</changefreq>` : '') +
      `<priority>${u.prio}</priority></url>`).join('\n') +
    `\n</urlset>`;
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(xml);
}));

/**
 * Request a refund with only an order number and the email it was placed with.
 *
 * The refund policy — which forms part of the terms — tells buyers: "Open your
 * order page and request a refund there. You only need your order number, no
 * account." That was not true. The only refund route was under /api/account and
 * required a session, so a guest — the DEFAULT path on a shop that advertises
 * ordering without an account — had no way to do the thing the terms promised.
 *
 * Both the number and the email are required. The number alone is already the
 * public handle for a status, but a refund request creates work for a person and
 * lands in a queue, so it asks for something only the buyer knows. Wrong email,
 * same answer as an unknown order: this must not become a way to test whether an
 * address ever bought here.
 */
router.post('/track/:number/refund-request',
  rateLimit({ bucket: 'refund_request', windowMs: 60_000, max: 5, shared: true }),
  asyncHandler(async (req, res) => {
    const { email, reason } = z.object({
      email: z.string().email(),
      reason: z.string().max(2000).optional(),
    }).parse(req.body || {});

    const order = await getOrderByNumber(req.params.number).catch(() => null);
    // One message for both cases on purpose — see above.
    if (!order || order.email.toLowerCase() !== email.toLowerCase()) {
      throw new ApiError(404, 'We could not find an order with that number and email address.');
    }
    if (['refunded', 'cancelled'].includes(order.status)) {
      return res.json({ alreadyClosed: true, status: order.status });
    }
    // Nothing was ever charged, so there is nothing to give back. Putting this in
    // the queue would have someone open a refund for an order that never took
    // money — and leave the buyer waiting for a transfer that cannot arrive.
    if (['pending', 'failed'].includes(order.status)) {
      return res.json({ notPaid: true, status: order.status });
    }

    const existing = await getRefundRequestForOrder(order.id).catch(() => null);
    if (existing) return res.json({ alreadyRequested: true, requestedAt: existing.created_at });

    const r = await requestRefund({ orderId: order.id, userId: order.userId || null, reason });
    await audit({
      action: 'refund.request', actor: { email: order.email }, targetType: 'order',
      targetId: order.id, metadata: { guest: !order.userId }, req,
    }).catch(() => {});
    res.status(201).json({ ok: true, id: r.id });
  }));

// Public tracking by order number (no PII beyond status timeline).
router.get('/track/:number', asyncHandler(async (req, res) => {
  const order = await getOrderByNumber(req.params.number);
  if (!order) throw new ApiError(404, 'Order not found');
  res.json({
    // The id lets a restored or shared pay link offer the payment-proof form.
    // The order NUMBER is the credential that got you here, and every write by
    // id still goes through assertOwnsOrder(email), so this grants nothing extra.
    id: order.id,
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
    // The Mollie checkout page for an unpaid order, so a buyer who closed the
    // tab, ran out of battery or bounced off their banking app can pick the
    // payment straight back up. Same trust model as payLink above: the order
    // number is what got you here, and the page it opens only accepts money.
    // Cleared the moment the order stops being pending.
    payUrl: order.status === 'pending' ? (await getPspPayment(order.id)
      .then((p) => (p?.provider === 'mollie' && ['open', 'pending'].includes(p.status || '') ? p.checkoutUrl : null))
      .catch(() => null)) : null,
    // A held order is paid and normal on every other measure, so without this it
    // would show "payment confirmed, we're on it" while nothing is being
    // prepared at all. The buyer is owed the truth about why their code has not
    // arrived; what they are NOT told is which signal caught them, because that
    // is a free tuning loop for the next attempt.
    onHold: !!order.fraudHold,
    onHoldMessage: order.fraudHold ? holdMessage() : null,
    updatedAt: order.updatedAt,
  });
}));

export default router;
