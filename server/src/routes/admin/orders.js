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
  exportOrdersCsv, orderUrlFor, setOrderPayLink, clearOrderPayLink, getPspPayment,
} from '../../services/orderService.js';
import { refundPayment, isEnabled as mollieEnabled } from '../../services/mollieService.js';
import { PayLinkError } from '../../utils/payLink.js';
import { fulfillOrder, listFulfillment, listFulfillmentLogs } from '../../services/fulfillmentService.js';
import * as analytics from '../../services/analyticsService.js';
import { listPendingProofs, confirmProof, rejectProof } from '../../services/paymentProofService.js';
import { sendEmail } from '../../services/emailService.js';
import { notify } from '../../services/notificationService.js';
import { audit } from '../../services/auditService.js';
import { notFound, badRequest } from '../../utils/errors.js';

const router = Router();
const actor = (req) => ({ actorId: req.user.id, user: req.user });

// List / filter / sort orders for the dashboard table.
router.get('/', requirePermission('orders.read'), asyncHandler(async (req, res) => {
  const { status, statuses, search, sort, dir, limit, offset } = req.query;
  res.json(await listOrders({
    status, statuses, search, sort, dir,
    limit: Math.min(Number(limit) || 50, 200),
    offset: Number(offset) || 0,
  }));
}));

// Fulfillment KPIs (revenue / orders / conversion / top products) — scoped to
// orders.read so fulfillment staff see them without the analytics permission.
router.get('/stats', requirePermission('orders.read'), asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 365);
  const [overview, topProducts, revenueSeries] = await Promise.all([
    analytics.overview({ days }),
    analytics.topProducts({ days, limit: 5 }),
    analytics.revenueSeries({ days }),
  ]);
  res.json({ overview, topProducts, revenueSeries });
}));

// ── CSV export (bookkeeping) ─────────────────────────────────────────────────
// Streams the (filtered) order list as a spreadsheet-ready CSV. Amounts are in
// euros with a decimal point; use your spreadsheet's import settings if your
// locale expects commas. Mounted before /:id so "export.csv" never matches it.
router.get('/export.csv', requirePermission('orders.read'), asyncHandler(async (req, res) => {
  const { status, statuses, search, from, to } = req.query;
  const csv = await exportOrdersCsv({ status, statuses, search, from, to });
  await audit({ actor: req.user, action: 'order.export_csv', metadata: { status, statuses, search, from, to }, req });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="forgemarket-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

// ── Payment verification queue ───────────────────────────────────────────────
router.get('/payment/queue', requirePermission('orders.update'), asyncHandler(async (_req, res) => {
  res.json({ proofs: await listPendingProofs() });
}));

router.post('/payment/proofs/:id/confirm', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    const order = await confirmProof(req.params.id, { user: req.user, req });
    res.json({ order });
  }));

router.post('/payment/proofs/:id/reject', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body || {});
    await rejectProof(req.params.id, reason, { user: req.user, req });
    res.json({ ok: true });
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

/**
 * Refund.
 *
 * When the money came in through a PSP it has to go back out the same way.
 * Flipping the status to `refunded` while Mollie still holds the funds tells the
 * buyer, the dashboard and the bookkeeping a thing that is not true — so the
 * refund is sent first, and the status only follows once it is accepted.
 *
 * If the API call fails nothing changes: better a visible error the owner can
 * retry than an order that claims to be refunded and never was. Orders paid
 * manually (bank transfer) have no PSP payment and are marked refunded directly,
 * because the owner sends those back by hand.
 */
router.post('/:id/refund', requirePermission('orders.refund'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
    const existing = await getOrder(req.params.id);
    if (!existing) throw notFound('Order not found');

    let refund = null;
    const psp = await getPspPayment(existing.id);
    if (psp?.provider === 'mollie' && mollieEnabled()) {
      try {
        refund = await refundPayment(psp.paymentId, {
          cents: existing.total,
          currency: existing.currency || 'EUR',
          description: `Refund ${existing.number}`,
        });
      } catch (e) {
        await audit({ actor: req.user, action: 'order.refund_failed', targetType: 'order',
          targetId: existing.id, metadata: { paymentId: psp.paymentId, error: e.message }, req });
        throw badRequest(`Mollie refused the refund: ${e.message}`);
      }
    }

    const order = await transitionOrder(req.params.id, 'refunded',
      { ...actor(req), reason: reason || 'Refunded by staff' });
    await audit({ actor: req.user, action: 'order.refund', targetType: 'order',
      targetId: order.id,
      metadata: { reason, provider: psp?.provider || 'manual', refundId: refund?.id || null }, req });
    res.json({ order, refund });
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
/**
 * Attach a payment link with the exact amount to one order.
 *
 * Payment is manual here, and the shared checkout link cannot carry an amount —
 * the buyer types it, and a wrong cent becomes the owner matching payments by
 * hand. The owner makes a request in their bank app and pastes it here; the
 * buyer's live status page picks it up.
 */
router.post('/:id/pay-link', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    const { url } = z.object({ url: z.string().min(1).max(500) }).parse(req.body);
    try {
      const result = await setOrderPayLink(req.params.id, url, actor(req));
      await audit({ actor: req.user, action: 'order.pay_link_set', targetType: 'order',
        targetId: req.params.id, metadata: { host: new URL(result.payLink).hostname }, req });
      res.json(result);
    } catch (e) {
      // A rejected link is owner error, not a server fault — say what is wrong.
      if (e instanceof PayLinkError) throw badRequest(e.message);
      throw e;
    }
  }));

router.delete('/:id/pay-link', requirePermission('orders.update'),
  asyncHandler(async (req, res) => {
    await clearOrderPayLink(req.params.id);
    await audit({ actor: req.user, action: 'order.pay_link_clear', targetType: 'order',
      targetId: req.params.id, req });
    res.json({ ok: true });
  }));

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
        url: orderUrlFor(order) },
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
