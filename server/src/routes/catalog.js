/** Public storefront routes: browse catalog, place an order, track by number. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { listProducts, getProduct } from '../services/productService.js';
import { createOrder, getOrderByNumber } from '../services/orderService.js';
import { ApiError } from '../utils/errors.js';

const router = Router();

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
