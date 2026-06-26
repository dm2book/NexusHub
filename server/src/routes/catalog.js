/** Public storefront routes: browse catalog, place an order, track by number. */
import { Router } from 'express';
import { z } from 'zod';
import { config, manualPayMethods, couponFor } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { listProducts, getProduct } from '../services/productService.js';
import { createOrder, getOrderByNumber, getOrder, markPaymentReceived } from '../services/orderService.js';
import { listEnabledProviders } from '../services/oauthService.js';
import { isEnabled as stripeEnabled, createCheckoutSession } from '../services/stripeService.js';
import { publicStats } from '../services/publicStatsService.js';
import { ApiError, forbidden } from '../utils/errors.js';

const router = Router();

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

router.get('/products/:id', asyncHandler(async (req, res) => {
  const p = await getProduct(req.params.id);
  if (!p || !p.active) throw new ApiError(404, 'Product not found');
  res.json({ product: p });
}));

// Validate a discount code (checkout preview).
router.get('/coupons/:code', (req, res) => {
  const c = couponFor(req.params.code);
  if (!c) throw new ApiError(404, 'Invalid or expired code');
  res.json(c);
});

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
