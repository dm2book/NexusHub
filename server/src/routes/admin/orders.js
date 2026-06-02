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
  listOrders, getOrder, transitionOrder, markPaymentReceived, setOrderNotes,
} from '../../services/orderService.js';
import { fulfillOrder, listFulfillment, listFulfillmentLogs } from '../../services/fulfillmentService.js';
import { sendEmail } from '../../services/emailService.js';
import { notify } from '../../services/notificationService.js';
import { audit } from '../../services/auditService.js';
import { config } from '../../config/env.js';

const router = Router();
const actor = (req) => ({ actorId: req.user.id, user: req.user });

// List / filter orders for the dashboard table.
router.get('/', requirePermission('orders.read'), (req, res) => {
  const { status, search, limit, offset } = req.query;
  res.json(listOrders({
    status, search,
    limit: Math.min(Number(limit) || 50, 200),
    offset: Number(offset) || 0,
  }));
});

router.get('/:id', requirePermission('orders.read'), asyncHandler(async (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: { message: 'Order not found' } });
  res.json({
    order,
    fulfillment: listFulfillment(order.id),
    fulfillmentLogs: listFulfillmentLogs(order.id),
  });
}));

// Confirm payment (e.g. webhook reconciliation / manual).
router.post('/:id/payment-received', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    const { paymentRef } = z.object({ paymentRef: z.string().optional() }).parse(req.body);
    const order = markPaymentReceived(req.params.id, paymentRef, actor(req));
    audit({ actor: req.user, action: 'order.payment_received', targetType: 'order',
      targetId: order.id, req });
    res.json({ order });
  }));

// Fulfill Order — runs the fulfillment engine (auto or manual per item).
router.post('/:id/fulfill', requirePermission('orders.fulfill'),
  asyncHandler(async (req, res) => {
    const summary = await fulfillOrder(req.params.id, actor(req));
    audit({ actor: req.user, action: 'order.fulfill', targetType: 'order',
      targetId: req.params.id, metadata: summary, req });
    res.json({ order: getOrder(req.params.id), summary });
  }));

// Mark Complete — the big "Complete Order" action (confirmed in UI).
router.post('/:id/complete', requirePermission('orders.complete'),
  asyncHandler(async (req, res) => {
    const order = transitionOrder(req.params.id, 'completed',
      { ...actor(req), reason: 'Marked complete by staff' });
    audit({ actor: req.user, action: 'order.complete', targetType: 'order',
      targetId: order.id, req });
    res.json({ order });
  }));

// Refund.
router.post('/:id/refund', requirePermission('orders.refund'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
    const order = transitionOrder(req.params.id, 'refunded',
      { ...actor(req), reason: reason || 'Refunded by staff' });
    audit({ actor: req.user, action: 'order.refund', targetType: 'order',
      targetId: order.id, metadata: { reason }, req });
    res.json({ order });
  }));

// Cancel.
router.post('/:id/cancel', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
    const order = transitionOrder(req.params.id, 'cancelled',
      { ...actor(req), reason: reason || 'Cancelled by staff' });
    audit({ actor: req.user, action: 'order.cancel', targetType: 'order',
      targetId: order.id, req });
    res.json({ order });
  }));

// Generic guarded transition (for the status dropdown).
router.post('/:id/transition', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    const { to, reason } = z.object({ to: z.string(), reason: z.string().optional() })
      .parse(req.body);
    const order = transitionOrder(req.params.id, to, { ...actor(req), reason });
    audit({ actor: req.user, action: 'order.transition', targetType: 'order',
      targetId: order.id, metadata: { to, reason }, req });
    res.json({ order });
  }));

// Internal notes.
router.put('/:id/notes', requirePermission('orders.update'), asyncHandler(async (req, res) => {
  const { notes } = z.object({ notes: z.string().max(5000) }).parse(req.body);
  res.json({ order: setOrderNotes(req.params.id, notes) });
}));

// Contact Customer — sends an email + in-app notification.
router.post('/:id/contact', requirePermission('orders.contact'),
  asyncHandler(async (req, res) => {
    const { subject, message } = z.object({
      subject: z.string().min(1), message: z.string().min(1),
    }).parse(req.body);
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: { message: 'Order not found' } });

    // Reuse the branded layout via a transient template-less send.
    await sendEmail('order_processing', order.email, {
      user: { name: order.email.split('@')[0] },
      order: { number: order.number, total: order.totalFormatted, status: order.statusLabel,
        url: `${config.appUrl}/account/orders/${order.id}` },
      message,
    }).catch(() => {});
    if (order.userId) {
      notify(order.userId, { type: 'support', title: subject, body: message,
        link: `/account/orders/${order.id}` });
    }
    audit({ actor: req.user, action: 'order.contact_customer', targetType: 'order',
      targetId: order.id, metadata: { subject }, req });
    res.json({ ok: true });
  }));

export default router;
