/**
 * Customer account routes — backs the customer dashboard:
 * orders, purchases, downloads/digital deliveries, support tickets, refunds,
 * invoices, saved billing details, notifications, and profile settings.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { run, get, all } from '../db/index.js';
import { notFound, forbidden } from '../utils/errors.js';
import { listOrders, getOrder } from '../services/orderService.js';
import { updateProfile, updatePreferences } from '../services/userService.js';
import * as notif from '../services/notificationService.js';
import * as billing from '../services/billingService.js';
import * as support from '../services/supportService.js';
import { audit } from '../services/auditService.js';

const router = Router();
router.use(requireAuth);

// Ensure the order belongs to the current user (by id or email).
async function ownedOrder(req, orderId) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  const mine = order.userId === req.user.id ||
    order.email.toLowerCase() === req.user.email.toLowerCase();
  if (!mine) throw forbidden('This order is not on your account');
  return order;
}

function dedupe(orders) {
  const seen = new Map();
  for (const o of orders) seen.set(o.id, o);
  return [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ── Dashboard summary ──────────────────────────────────────────────────────
router.get('/dashboard', asyncHandler(async (req, res) => {
  const [byId, byEmail, downloads, tickets, unread] = await Promise.all([
    listOrders({ userId: req.user.id, limit: 100 }),
    listOrders({ email: req.user.email, limit: 100 }),
    all(`SELECT d.* FROM deliveries d JOIN orders o ON o.id=d.order_id
          WHERE o.user_id=@u OR o.email=@e ORDER BY d.created_at DESC`,
        { u: req.user.id, e: req.user.email }),
    support.listTickets({ userId: req.user.id, status: 'open' }),
    notif.unreadCount(req.user.id),
  ]);
  const merged = dedupe([...byId.orders, ...byEmail.orders]);
  const completed = merged.filter((o) => o.status === 'completed');
  res.json({
    stats: {
      orders: merged.length,
      purchases: completed.length,
      downloads: downloads.length,
      openTickets: tickets.length,
      unreadNotifications: unread,
    },
    recentOrders: merged.slice(0, 5),
  });
}));

// ── Orders & tracking ────────────────────────────────────────────────────
router.get('/orders', asyncHandler(async (req, res) => {
  const byId = (await listOrders({ userId: req.user.id, limit: 100 })).orders;
  const byEmail = (await listOrders({ email: req.user.email, limit: 100 })).orders;
  res.json({ orders: dedupe([...byId, ...byEmail]) });
}));

router.get('/orders/:id', asyncHandler(async (req, res) => {
  res.json({ order: await ownedOrder(req, req.params.id) });
}));

router.get('/orders/:id/track', asyncHandler(async (req, res) => {
  const order = await ownedOrder(req, req.params.id);
  res.json({
    status: order.status, statusLabel: order.statusLabel,
    history: order.history, deliveries: order.deliveries,
    updatedAt: order.updatedAt,
  });
}));

// ── Downloads / digital deliveries ───────────────────────────────────────
router.get('/downloads', asyncHandler(async (req, res) => {
  const rows = await all(`SELECT d.*, o.number AS order_number FROM deliveries d
                      JOIN orders o ON o.id=d.order_id
                     WHERE o.user_id=@u OR o.email=@e ORDER BY d.created_at DESC`,
                   { u: req.user.id, e: req.user.email });
  res.json({ deliveries: rows.map((d) => ({
    id: d.id, orderId: d.order_id, orderNumber: d.order_number, type: d.type,
    filename: d.filename, downloadCount: d.download_count, maxDownloads: d.max_downloads,
    createdAt: d.created_at,
  })) });
}));

router.get('/deliveries/:id', asyncHandler(async (req, res) => {
  const d = await get('SELECT * FROM deliveries WHERE id=@id', { id: req.params.id });
  if (!d) throw notFound('Delivery not found');
  await ownedOrder(req, d.order_id); // authorization
  if (d.max_downloads != null && d.download_count >= d.max_downloads) {
    throw forbidden('Download limit reached');
  }
  await run('UPDATE deliveries SET download_count = download_count + 1 WHERE id=@id', { id: d.id });
  res.json({ delivery: { id: d.id, type: d.type, content: d.content, filename: d.filename } });
}));

router.get('/orders/:id/invoice', asyncHandler(async (req, res) => {
  await ownedOrder(req, req.params.id);
  res.type('html').send(await billing.renderInvoice(req.params.id));
}));

// ── Refund requests ────────────────────────────────────────────────────────
router.post('/orders/:id/refund-request', asyncHandler(async (req, res) => {
  const order = await ownedOrder(req, req.params.id);
  const { reason } = z.object({ reason: z.string().max(2000).optional() }).parse(req.body);
  const r = await support.requestRefund({ orderId: order.id, userId: req.user.id, reason });
  await audit({ actor: req.user, action: 'refund.request', targetType: 'order', targetId: order.id, req });
  res.status(201).json({ refundRequest: r });
}));

// ── Support tickets ──────────────────────────────────────────────────────
router.get('/tickets', asyncHandler(async (req, res) => {
  res.json({ tickets: await support.listTickets({ userId: req.user.id }) });
}));

router.post('/tickets', asyncHandler(async (req, res) => {
  const body = z.object({
    subject: z.string().min(3), message: z.string().min(1),
    category: z.enum(['general', 'refund', 'delivery', 'billing']).optional(),
    orderId: z.string().optional(),
  }).parse(req.body);
  const ticket = await support.openTicket({ ...body, userId: req.user.id });
  res.status(201).json({ ticket });
}));

router.get('/tickets/:id', asyncHandler(async (req, res) => {
  const t = await support.getTicket(req.params.id);
  if (!t || t.user_id !== req.user.id) throw notFound('Ticket not found');
  res.json({ ticket: t });
}));

router.post('/tickets/:id/reply', asyncHandler(async (req, res) => {
  const t = await support.getTicket(req.params.id);
  if (!t || t.user_id !== req.user.id) throw notFound('Ticket not found');
  const { body } = z.object({ body: z.string().min(1) }).parse(req.body);
  res.json({ ticket: await support.replyTicket(req.params.id,
    { authorId: req.user.id, authorKind: 'customer', body }) });
}));

// ── Notifications ──────────────────────────────────────────────────────────
router.get('/notifications', asyncHandler(async (req, res) => {
  const [notifications, unread] = await Promise.all([
    notif.listNotifications(req.user.id), notif.unreadCount(req.user.id),
  ]);
  res.json({ notifications, unread });
}));
router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
  await notif.markRead(req.user.id, req.params.id); res.json({ ok: true });
}));
router.post('/notifications/read-all', asyncHandler(async (req, res) => {
  await notif.markAllRead(req.user.id); res.json({ ok: true });
}));

// ── Billing details ────────────────────────────────────────────────────────
router.get('/billing', asyncHandler(async (req, res) => {
  res.json({ billing: await billing.listBilling(req.user.id) });
}));
router.post('/billing', asyncHandler(async (req, res) => {
  const d = z.object({
    label: z.string().optional(), fullName: z.string().optional(),
    email: z.string().email().optional(), line1: z.string().optional(),
    line2: z.string().optional(), city: z.string().optional(),
    postalCode: z.string().optional(), country: z.string().optional(),
    vatNumber: z.string().optional(), isDefault: z.boolean().optional(),
  }).parse(req.body);
  res.status(201).json({ billing: await billing.saveBilling(req.user.id, d) });
}));
router.delete('/billing/:id', asyncHandler(async (req, res) => {
  await billing.deleteBilling(req.user.id, req.params.id); res.json({ ok: true });
}));

// ── Profile & settings ─────────────────────────────────────────────────────
router.patch('/profile', asyncHandler(async (req, res) => {
  const { displayName, avatarUrl } = z.object({
    displayName: z.string().min(1).max(80).optional(),
    avatarUrl: z.string().url().optional(),
  }).parse(req.body);
  res.json({ user: await updateProfile(req.user.id, { displayName, avatarUrl }) });
}));

router.patch('/preferences', asyncHandler(async (req, res) => {
  const prefs = z.object({
    emailOrderUpdates: z.boolean().optional(),
    emailMarketing: z.boolean().optional(),
    locale: z.string().optional(),
  }).parse(req.body);
  res.json({ preferences: await updatePreferences(req.user.id, prefs) });
}));

export default router;
