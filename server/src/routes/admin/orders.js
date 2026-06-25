/**
 * Admin order dashboard endpoints.
 * Columns: Order ID, Customer, Product, Amount, Date, Status.
 * Actions: View, Fulfill, Mark Complete, Refund, Contact Customer.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import {
  listOrders, getOrder, transitionOrder, markPaymentReceived, setOrderNotes, deliverOrder,
} from '../../services/orderService.js';
import { fulfillOrder, listFulfillment, listFulfillmentLogs } from '../../services/fulfillmentService.js';
import { sendEmail } from '../../services/emailService.js';
import { notify } from '../../services/notificationService.js';
import { audit } from '../../services/auditService.js';
import { config } from '../../config/env.js';
import { notFound } from '../../utils/errors.js';

const router = Router();
const actor = (req) => ({ actorId: req.user.id, user: req.user });

// List / filter orders for the dashboard table.
router.get('/', requirePermission('orders.read'), asyncHandler(async (req, res) => {
  const { status, search, limit, offset } = req.query;
  res.json(await listOrders({
    status, search,
    limit: Math.min(Number(limit) || 50, 200),
    offset: Number(offset) || 0,
  }));
}));

router.get('/:id', requirePermission('orders.read'), asyncHandler(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) throw notFound('Order not found');
  const [fulfillment, fulfillmentLogs] = await Promise.all([
    listFulfillment(order.id), listFulfillmentLogs(order.id),
  ]);
  res.json({ order, fulfillment, fulfillmentLogs });
}));

// Confirm payment (e.g. webhook reconciliation / manual).
router.post('/:id/payment-received', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    const { paymentRef } = z.object({ paymentRef: z.string().optional() }).parse(req.body);
    const order = await markPaymentReceived(req.params.id, paymentRef, actor(req));
    await audit({ actor: req.user, action: 'order.payment_received', targetType: 'order',
      targetId: order.id, req });
    res.json({ order });
  }));

// Fulfill Order — runs the fulfillment engine (auto or manual per item).
router.post('/:id/fulfill', requirePermission('orders.fulfill'),
  asyncHandler(async (req, res) => {
    const summary = await fulfillOrder(req.params.id, actor(req));
    await audit({ actor: req.user, action: 'order.fulfill', targetType: 'order',
      targetId: req.params.id, metadata: { auto: summary.auto, manual: summary.manual }, req });
    res.json({ order: await getOrder(req.params.id), summary });
  }));

// Deliver codes & complete — enter the code(s); they're e-mailed to the customer.
router.post('/:id/deliver', requirePermission('orders.complete'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      deliveries: z.array(z.object({
        content: z.string().min(1).max(2000),
        type: z.string().max(20).optional(),
        orderItemId: z.string().optional(),
      })).min(1),
    }).parse(req.body);
    const order = await deliverOrder(req.params.id, body.deliveries,
      { ...actor(req), reason: 'Codes delivered by staff' });
    await audit({ actor: req.user, action: 'order.deliver', targetType: 'order',
      targetId: order.id, metadata: { count: body.deliveries.length }, req });
    res.json({ order });
  }));

// Mark Complete — the big "Complete Order" action (confirmed in UI).
router.post('/:id/complete', requirePermission('orders.complete'),
  asyncHandler(async (req, res) => {
    const order = await transitionOrder(req.params.id, 'completed',
      { ...actor(req), reason: 'Marked complete by staff' });
    await audit({ actor: req.user, action: 'order.complete', targetType: 'order',
      targetId: order.id, req });
    res.json({ order });
  }));

// Refund.
router.post('/:id/refund', requirePermission('orders.refund'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
    const order = await transitionOrder(req.params.id, 'refunded',
      { ...actor(req), reason: reason || 'Refunded by staff' });
    await audit({ actor: req.user, action: 'order.refund', targetType: 'order',
      targetId: order.id, metadata: { reason }, req });
    res.json({ order });
  }));

// Cancel.
router.post('/:id/cancel', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
    const order = await transitionOrder(req.params.id, 'cancelled',
      { ...actor(req), reason: reason || 'Cancelled by staff' });
    await audit({ actor: req.user, action: 'order.cancel', targetType: 'order',
      targetId: order.id, req });
    res.json({ order });
  }));

// Generic guarded transition (for the status dropdown).
router.post('/:id/transition', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    const { to, reason } = z.object({ to: z.string(), reason: z.string().optional() })
      .parse(req.body);
    const order = await transitionOrder(req.params.id, to, { ...actor(req), reason });
    await audit({ actor: req.user, action: 'order.transition', targetType: 'order',
      targetId: order.id, metadata: { to, reason }, req });
    res.json({ order });
  }));

// Internal notes.
router.put('/:id/notes', requirePermission('orders.update'), asyncHandler(async (req, res) => {
  const { notes } = z.object({ notes: z.string().max(5000) }).parse(req.body);
  res.json({ order: await setOrderNotes(req.params.id, notes) });
}));

// Contact Customer — sends an email + in-app notification.
router.post('/:id/contact', requirePermission('orders.contact'),
  asyncHandler(async (req, res) => {
    const { subject, message } = z.object({
      subject: z.string().min(1), message: z.string().min(1),
    }).parse(req.body);
    const order = await getOrder(req.params.id);
    if (!order) throw notFound('Order not found');

    await sendEmail('custom_message', order.email, {
      user: { name: order.billing?.full_name || order.email.split('@')[0] },
      subject,
      message,
      order: { number: order.number, total: order.totalFormatted, status: order.statusLabel,
        url: `${config.appUrl}/account/orders/${order.id}` },
    }).catch(() => {});
    if (order.userId) {
      await notify(order.userId, { type: 'support', title: subject, body: message,
        link: `/account/orders/${order.id}` });
    }
    await audit({ actor: req.user, action: 'order.contact_customer', targetType: 'order',
      targetId: order.id, metadata: { subject }, req });
    res.json({ ok: true });
  }));

export default router;
