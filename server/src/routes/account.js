/**
 * Customer account routes — backs the customer dashboard:
 * orders, purchases, downloads/digital deliveries, support tickets, refunds,
 * invoices, saved billing details, notifications, and profile settings.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { config } from '../config/env.js';
import { linkStatus, unlinkDiscord } from '../services/discordLinkService.js';
import { earnedRolesFor, syncMemberRoles } from '../services/discordRolesService.js';
import { run, get, all, tx } from '../db/index.js';
import { notFound, forbidden, badRequest } from '../utils/errors.js';
import { listOrders, getOrder } from '../services/orderService.js';
import { addVerifiedReview } from '../services/reviewsService.js';
import { updateProfile, updatePreferences, publicUser } from '../services/userService.js';
import { loyaltyFor } from '../services/loyaltyService.js';
import { affiliateStats } from '../services/affiliateService.js';
import { coinBalance, coinHistory, redeemReward, forgeShopCatalog, spendCoins } from '../services/forgeCoinService.js';
import { pullsForOrder, rerollPull } from '../services/mysteryBoxService.js';
import { getMembership, grantMembership, FORGE_PLUS, MEMBERSHIP_DAYS } from '../services/membershipService.js';
import { saveCart, getCart } from '../services/cartService.js';
import { walletSummary, balanceOf, debit } from '../services/walletService.js';
import { redeemGiftCard } from '../services/giftCardService.js';
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
  const [loyalty, affiliate, membership, walletBalance, coins] = await Promise.all([
    loyaltyFor(req.user.id),
    affiliateStats(req.user.id, req.user.email),
    getMembership(req.user.id),
    balanceOf(req.user.id),
    coinBalance(req.user.id),
  ]);
  res.json({ loyalty, affiliate, membership, walletBalance, coins });
}));

// Buy / extend Forge+ (30 days) with store credit or Forge Coins — instant, no
// external payment needed. grantMembership extends from the current expiry, so
// buying again stacks another 30 days.
router.post('/membership/purchase', asyncHandler(async (req, res) => {
  const { method } = z.object({ method: z.enum(['credit', 'coins']) }).parse(req.body || {});
  const uid = req.user.id;
  // Charge and grant in ONE transaction (tx is re-entrant, so the debit/spend
  // and grantMembership share it): if the grant fails the charge rolls back, and
  // if the charge fails the grant never runs. No "charged without membership".
  const membership = await tx(async () => {
    if (method === 'credit') {
      await debit(uid, FORGE_PLUS.priceCents, 'spend', `${FORGE_PLUS.name} membership (${MEMBERSHIP_DAYS} days)`);
    } else {
      await spendCoins(uid, FORGE_PLUS.coinPrice, 'membership', 'forge_plus');
    }
    return grantMembership(uid, MEMBERSHIP_DAYS);
  });
  await audit({ actor: req.user, action: 'membership.purchase', targetType: 'user', targetId: uid,
    metadata: { method }, req });
  await notif.notify(uid, {
    type: 'system', title: `${FORGE_PLUS.name} is active 👑`,
    body: `You now get ${FORGE_PLUS.discountPercent}% off every order. Enjoy!`,
    link: '/account/rewards',
  }).catch(() => {});
  res.json({ membership });
}));

// ── Saved cart (mirrors the storefront cart for logged-in shoppers) ──────────
router.get('/cart', asyncHandler(async (req, res) => {
  res.json({ items: await getCart(req.user.id) });
}));
router.put('/cart', asyncHandler(async (req, res) => {
  const { items } = z.object({ items: z.array(z.any()).max(50) }).parse(req.body || {});
  res.json({ items: await saveCart(req.user.id, items) });
}));

// ── Wallet / store credit ────────────────────────────────────────────────────
// ── Discord ────────────────────────────────────────────────────────────────
// The account side of the ecosystem: whether this account is connected, which
// roles it has earned, and the ability to disconnect. The link itself is started
// from /api/auth/oauth/discord/link/start, because it is an OAuth redirect
// rather than an API call.

router.get('/discord', asyncHandler(async (req, res) => {
  const status = await linkStatus(req.user.id);
  // What they have earned, whether or not Discord can currently be reached.
  // Showing the roles from our own records means the page still tells the truth
  // when the bot is offline or the member has not joined the server yet.
  const { earned, why } = await earnedRolesFor(req.user.id);
  res.json({
    ...status,
    inviteUrl: config.discord.inviteUrl,
    serverName: config.discord.serverName,
    roles: [...earned],
    reasons: why,
  });
}));

/**
 * Force a re-sync from the account page.
 *
 * Roles arrive on their own — on payment, on review, and from the maintenance
 * sweep — but "I just joined the server, where is my role" is the one moment
 * where waiting up to an hour feels broken. Rate-limited because each call is
 * several Discord API requests.
 */
router.post('/discord/sync',
  rateLimit({ bucket: 'discord_sync', windowMs: 60_000, max: 6 }),
  asyncHandler(async (req, res) => {
    const result = await syncMemberRoles(req.user.id, { reason: 'requested by member' });
    res.json(result);
  }));

router.delete('/discord', asyncHandler(async (req, res) => {
  res.json(await unlinkDiscord(req.user.id));
}));

router.get('/wallet', asyncHandler(async (req, res) => {
  res.json(await walletSummary(req.user.id));
}));

// Redeem a gift card → credited to the wallet.
router.post('/wallet/redeem', asyncHandler(async (req, res) => {
  const { code } = z.object({ code: z.string().min(4).max(40) }).parse(req.body || {});
  const r = await redeemGiftCard(code, req.user.id);
  await audit({ actor: req.user, action: 'giftcard.redeem', targetType: 'user', targetId: req.user.id,
    metadata: { amount: r.amount }, req });
  res.json({ redeemed: r.amount, balance: await balanceOf(req.user.id) });
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
  const [byId, byEmail, downloads, tickets, unread, wallet, affiliate, loyalty] = await Promise.all([
    listOrders({ userId: req.user.id, limit: 100 }),
    listOrders({ email: req.user.email, limit: 100 }),
    all(`SELECT d.* FROM deliveries d JOIN orders o ON o.id=d.order_id
          WHERE o.user_id=@u OR o.email=@e ORDER BY d.created_at DESC`,
        { u: req.user.id, e: req.user.email }),
    support.listTickets({ userId: req.user.id, status: 'open' }),
    notif.unreadCount(req.user.id),
    walletSummary(req.user.id),
    affiliateStats(req.user.id, req.user.email),
    loyaltyFor(req.user.id),
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
    loyalty,
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

// Mystery-box winnings for an owned order (shown on the order page).
router.get('/orders/:id/mystery', asyncHandler(async (req, res) => {
  await ownedOrder(req, req.params.id);
  res.json({ pulls: await pullsForOrder(req.params.id) });
}));

// Reroll one box once (risk-free — keep the higher prize).
router.post('/orders/:id/mystery/:pullId/reroll', asyncHandler(async (req, res) => {
  await ownedOrder(req, req.params.id);
  const result = await rerollPull(req.user.id, req.params.id, req.params.pullId);
  res.json({ ...result, pulls: await pullsForOrder(req.params.id) });
}));

// ── Forge Coins + Forge Shop ─────────────────────────────────────────────────
router.get('/coins', asyncHandler(async (req, res) => {
  const [balance, history, shop] = await Promise.all([
    coinBalance(req.user.id), coinHistory(req.user.id), forgeShopCatalog(),
  ]);
  res.json({ balance, history, shop });
}));

router.post('/coins/redeem', asyncHandler(async (req, res) => {
  const { rewardId } = z.object({ rewardId: z.string().min(1) }).parse(req.body || {});
  const result = await redeemReward(req.user.id, rewardId);
  res.json({ ...result, balance: await coinBalance(req.user.id) });
}));

// Completed orders that don't have a review yet — powers the "write a review"
// box on the public Reviews page.
router.get('/reviewable', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT o.id, o.number,
            (SELECT name FROM order_items WHERE order_id = o.id LIMIT 1) AS item
       FROM orders o
      WHERE o.user_id = @u AND o.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id)
      ORDER BY o.created_at DESC LIMIT 10`, { u: req.user.id });
  res.json({ orders: rows });
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
