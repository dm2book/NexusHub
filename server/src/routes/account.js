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
import { addVerifiedReview } from '../services/reviewsService.js';
import { updateProfile, updatePreferences, publicUser } from '../services/userService.js';
import { loyaltyFor } from '../services/loyaltyService.js';
import { affiliateStats } from '../services/affiliateService.js';
import { getMembership } from '../services/membershipService.js';
import { walletSummary } from '../services/walletService.js';
import { requestPhoneOtp } from '../services/authService.js';
import { normalizePhone, isValidPhone } from '../services/smsService.js';
import { sha256, safeEqual } from '../utils/crypto.js';
import { nowIso } from '../db/index.js';
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

// ── Rewards: loyalty tier, affiliate program, Forge+ membership ──────────────
router.get('/rewards', asyncHandler(async (req, res) => {
  const [loyalty, affiliate, membership] = await Promise.all([
    loyaltyFor(req.user.id),
    affiliateStats(req.user.id, req.user.email),
    getMembership(req.user.id),
  ]);
  res.json({ loyalty, affiliate, membership });
}));

// ── Wallet / store credit ────────────────────────────────────────────────────
router.get('/wallet', asyncHandler(async (req, res) => {
  res.json(await walletSummary(req.user.id));
}));

// ── Phone number (add + verify via SMS OTP) ──────────────────────────────────
router.post('/phone/request', asyncHandler(async (req, res) => {
  const { phone } = z.object({ phone: z.string().min(5).max(40) }).parse(req.body || {});
  const p = normalizePhone(phone);
  if (!isValidPhone(p)) throw badRequest('Enter a valid phone number (e.g. +31612345678)');
  const taken = await get('SELECT id FROM users WHERE phone=@p AND phone_verified=1 AND id<>@me', { p, me: req.user.id });
  if (taken) throw badRequest('That phone number is already in use.');
  const r = await requestPhoneOtp(p, { ip: req.ip, userAgent: req.get('user-agent'), req });
  res.json({ sent: true, cooldownSeconds: r.cooldownSeconds });
}));

router.post('/phone/verify', asyncHandler(async (req, res) => {
  const { phone, code } = z.object({ phone: z.string().min(5).max(40), code: z.string().min(4).max(8) }).parse(req.body || {});
  const p = normalizePhone(phone);
  const rows = await all(
    `SELECT * FROM sms_verifications WHERE phone=@p AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 10`, { p });
  const live = rows.filter((x) => new Date(x.expires_at) >= new Date());
  if (!live.length) throw badRequest('Code expired or not found. Request a new one.');
  const match = live.find((x) => safeEqual(x.code_hash, sha256(String(code).trim())));
  if (!match) {
    await run('UPDATE sms_verifications SET attempts = attempts + 1 WHERE id=@id', { id: live[0].id });
    throw badRequest('Incorrect code');
  }
  const taken = await get('SELECT id FROM users WHERE phone=@p AND phone_verified=1 AND id<>@me', { p, me: req.user.id });
  if (taken) throw badRequest('That phone number is already in use.');
  await run('UPDATE sms_verifications SET consumed_at=@at WHERE id=@id', { at: nowIso(), id: match.id });
  await run('UPDATE users SET phone=@p, phone_verified=1, updated_at=@at WHERE id=@id',
    { p, at: nowIso(), id: req.user.id });
  await audit({ actor: req.user, action: 'profile.phone_verified', targetType: 'user', targetId: req.user.id, req });
  res.json({ user: await publicUser(req.user.id) });
}));

router.delete('/phone', asyncHandler(async (req, res) => {
  await run('UPDATE users SET phone=NULL, phone_verified=0, updated_at=@at WHERE id=@id',
    { at: nowIso(), id: req.user.id });
  res.json({ user: await publicUser(req.user.id) });
}));

// ── Dashboard summary ──────────────────────────────────────────────────────
// Group order statuses into the four customer-facing buckets.
const STATUS_BUCKET = {
  pending: 'pending', payment_received: 'pending',
  processing: 'processing', awaiting_fulfillment: 'processing',
  completed: 'delivered',
  refunded: 'refunded', cancelled: 'refunded',
};

router.get('/dashboard', asyncHandler(async (req, res) => {
  const [byId, byEmail, downloads, tickets, unread, wallet, affiliate] = await Promise.all([
    listOrders({ userId: req.user.id, limit: 100 }),
    listOrders({ email: req.user.email, limit: 100 }),
    all(`SELECT d.* FROM deliveries d JOIN orders o ON o.id=d.order_id
          WHERE o.user_id=@u OR o.email=@e ORDER BY d.created_at DESC`,
        { u: req.user.id, e: req.user.email }),
    support.listTickets({ userId: req.user.id, status: 'open' }),
    notif.unreadCount(req.user.id),
    walletSummary(req.user.id),
    affiliateStats(req.user.id, req.user.email),
  ]);
  const merged = dedupe([...byId.orders, ...byEmail.orders]);
  const buckets = { pending: 0, processing: 0, delivered: 0, refunded: 0 };
  for (const o of merged) { const b = STATUS_BUCKET[o.status]; if (b) buckets[b] += 1; }
  res.json({
    stats: {
      orders: merged.length,
      purchases: buckets.delivered,
      downloads: downloads.length,
      openTickets: tickets.length,
      unreadNotifications: unread,
      walletBalance: wallet.balance,
      referralEarnings: affiliate.totalCommission,
      referrals: affiliate.referrals,
    },
    ordersByStatus: buckets,
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

// ── Verified-buyer reviews ───────────────────────────────────────────────────
// Whether the current user has already reviewed this (owned) order.
router.get('/orders/:id/review', asyncHandler(async (req, res) => {
  await ownedOrder(req, req.params.id);
  const r = await get(
    `SELECT id, stars, body, created_at AS createdAt FROM reviews WHERE order_id=@o`,
    { o: req.params.id });
  res.json({ review: r || null });
}));

// Leave a verified review on a completed order. Anti-spam: must own the order,
// it must be delivered, and only one review per order (enforced in the service).
router.post('/orders/:id/review', asyncHandler(async (req, res) => {
  const order = await ownedOrder(req, req.params.id);
  if (order.status !== 'completed') throw forbidden('You can review an order once it is delivered.');
  const { stars, body, city } = z.object({
    stars: z.number().int().min(1).max(5),
    body: z.string().min(3).max(600),
    city: z.string().max(40).optional(),
  }).parse(req.body || {});
  const author = req.user.displayName || order.billing?.full_name?.split(/\s+/)[0] || 'Verified buyer';
  const product = order.items?.[0]?.name || null;
  const result = await addVerifiedReview({
    userId: req.user.id, email: order.email, orderId: order.id,
    author, stars, body, product, city: city || order.billing?.city || null,
  });
  await audit({ actor: req.user, action: 'review.create', targetType: 'order', targetId: order.id,
    metadata: { stars }, req });
  res.status(201).json(result);
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
