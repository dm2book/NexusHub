/** Public storefront routes: browse catalog, place an order, track by number. */
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config/env.js';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { listProducts, getProduct } from '../services/productService.js';
import { createOrder, getOrderByNumber, getOrder, markPaymentReceived } from '../services/orderService.js';
import { listEnabledProviders } from '../services/oauthService.js';
import { ApiError, forbidden } from '../utils/errors.js';

const router = Router();

// Public runtime config the SPA can read (feature flags, enabled providers).
router.get('/config', (_req, res) => {
  res.json({
    demoPayments: config.payments.demoMode,
    oauthProviders: listEnabledProviders(),
    discordEnabled: !!config.discord.inviteUrl || !!config.discord.guildId,
    brand: config.email.fromName,
  });
});

router.get('/products', asyncHandler(async (_req, res) => {
  res.json({ products: await listProducts({ activeOnly: true }) });
}));

router.get('/products/:id', asyncHandler(async (req, res) => {
  const p = await getProduct(req.params.id);
  if (!p || !p.active) throw new ApiError(404, 'Product not found');
  res.json({ product: p });
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
    }).parse(req.body);

    const order = await createOrder(
      { ...body, userId: req.user?.id || null },
      { user: req.user, actorId: req.user?.id });
    res.status(201).json({ order });
  }));

// Demo payment — marks an order paid without a real PSP, gated by DEMO_PAYMENTS.
// Authorised by ownership: the requester must be the order's account holder or
// supply the matching order email (guest checkout).
router.post('/orders/:id/pay', rateLimit({ bucket: 'pay', windowMs: 60_000, max: 30 }),
  asyncHandler(async (req, res) => {
    if (!config.payments.demoMode) throw new ApiError(404, 'Not found');
    const order = await getOrder(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');
    const { email } = z.object({ email: z.string().email().optional() }).parse(req.body || {});
    const owns = (req.user && order.email.toLowerCase() === req.user.email.toLowerCase()) ||
      (email && email.toLowerCase() === order.email.toLowerCase());
    if (!owns) throw forbidden('This order is not yours');
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
    history: order.history.map((h) => ({ to: h.to_status, at: h.created_at })),
    updatedAt: order.updatedAt,
  });
}));

export default router;
