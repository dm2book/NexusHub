/** Admin security: audit logs, fraud review, users & role management. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { all } from '../../db/index.js';
import { listAuditLogs, audit } from '../../services/auditService.js';
import { listFlaggedOrders, heldOrderCount } from '../../services/fraudService.js';
import {
  releaseFraudHold, rejectFraudHold, getOrder, getOrderByNumber, getPspPayment, transitionOrder,
} from '../../services/orderService.js';
import { recordChargeback, listChargebacks, chargebackSummary } from '../../services/chargebackService.js';
import { currentLimits } from '../../services/orderLimitService.js';
import { roleDiagnostics, ensureRolesExist, sweepMemberRoles } from '../../services/discordRolesService.js';
import { refundPayment, isEnabled as mollieEnabled } from '../../services/mollieService.js';
import { publicUser, setUserRoles, getUserById } from '../../services/userService.js';
import { grantCoins } from '../../services/forgeCoinService.js';
import { grantMembership, cancelMembership } from '../../services/membershipService.js';
import { addEntry, balanceOf, walletSummary } from '../../services/walletService.js';
import { notify } from '../../services/notificationService.js';
import { notFound, badRequest } from '../../utils/errors.js';

const router = Router();

// ── Audit logs ─────────────────────────────────────────────────────────────
router.get('/audit', requirePermission('audit.read'), asyncHandler(async (req, res) => {
  res.json({ logs: await listAuditLogs({
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
    action: req.query.action, targetId: req.query.targetId,
  }) });
}));

// ── Fraud review queue ─────────────────────────────────────────────────────
router.get('/fraud', requirePermission('security.manage'), asyncHandler(async (_req, res) => {
  const [flagged, held, chargebacks, cbSummary] = await Promise.all([
    listFlaggedOrders(),
    heldOrderCount(),
    listChargebacks({ limit: 50 }),
    chargebackSummary(),
  ]);
  res.json({ flagged, held, chargebacks, chargebackSummary: cbSummary, limits: currentLimits() });
}));

/**
 * Approve a held order — release it and deliver.
 *
 * The consequential half of the queue: this hands over a code that cannot be
 * recalled. Audited with who did it, because if this order charges back in six
 * weeks that decision is the thing worth being able to look back at.
 */
router.post('/fraud/:id/approve', requirePermission('security.manage'),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body || {});
    const result = await releaseFraudHold(req.params.id,
      { actorId: req.user.id, user: req.user, reason });
    res.json(result);
  }));

/**
 * Reject a held order — refund it and keep it held.
 *
 * The refund runs first and through the PSP, so the money genuinely goes back
 * rather than the order merely being labelled. A refund that Mollie refuses
 * leaves everything untouched and says so, instead of quietly marking an order
 * refunded while the shop still holds the money.
 */
router.post('/fraud/:id/reject', requirePermission('security.manage'),
  asyncHandler(async (req, res) => {
    const { reason, refund = true } = z.object({
      reason: z.string().max(300).optional(),
      refund: z.boolean().optional(),
    }).parse(req.body || {});

    const order = await getOrder(req.params.id);
    if (!order) throw notFound('Order not found');

    let refunded = null;
    // Only when money actually arrived. Rejecting an unpaid order is just a
    // refusal — there is nothing to send back.
    if (refund && !['pending', 'refunded', 'cancelled', 'failed'].includes(order.status)) {
      const psp = await getPspPayment(order.id);
      if (psp?.provider === 'mollie' && mollieEnabled()) {
        try {
          refunded = await refundPayment(psp.paymentId, {
            cents: order.total, currency: order.currency || 'EUR',
            description: `Refund ${order.number}`,
          });
        } catch (e) {
          throw badRequest(`Mollie refused the refund: ${e.message}`);
        }
      }
      await transitionOrder(order.id, 'refunded',
        { actorId: req.user.id, user: req.user, reason: reason || 'Rejected in fraud review' });
    }

    const updated = await rejectFraudHold(req.params.id,
      { actorId: req.user.id, user: req.user, reason });
    res.json({ order: updated, refund: refunded });
  }));

// ── Chargebacks ────────────────────────────────────────────────────────────
// Recorded automatically from the PSP webhook; this is for the ones that reach
// the owner by email or by bank letter instead, which is most of them for a
// shop small enough not to have a disputes dashboard.
router.post('/chargebacks', requirePermission('security.manage'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      orderNumber: z.string().min(1).max(40),
      amount: z.number().int().positive().optional(),
      reason: z.string().max(300).optional(),
    }).parse(req.body);

    const order = await getOrderByNumber(body.orderNumber);
    if (!order) throw notFound(`No order ${body.orderNumber}`);

    const result = await recordChargeback({
      order,
      amount: body.amount ?? order.total,
      currency: order.currency,
      provider: order.pspProvider || 'manual',
      paymentId: order.pspPaymentId || null,
      reason: body.reason || null,
      source: 'staff',
      actor: req.user,
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  }));

// ── Discord ────────────────────────────────────────────────────────────────
/**
 * Why the roles are or are not working.
 *
 * Role automation fails silently on purpose — a missing role must never break an
 * order — which makes it almost impossible to debug from the outside. This says
 * which managed roles exist in the guild, which do not, and whether the bot sits
 * high enough in the hierarchy to assign them. That last one is the mistake
 * everybody makes once and nobody guesses.
 */
router.get('/discord', requirePermission('security.manage'), asyncHandler(async (_req, res) => {
  res.json(await roleDiagnostics());
}));

/** Create any managed role that is missing. Existing roles are left untouched. */
router.post('/discord/roles', requirePermission('security.manage'),
  asyncHandler(async (req, res) => {
    const result = await ensureRolesExist();
    await audit({ actor: req.user, action: 'discord.roles_created',
      metadata: { created: result.created }, req });
    res.json(result);
  }));

/** Reconcile everyone now, rather than waiting for the hourly sweep. */
router.post('/discord/sync', requirePermission('security.manage'),
  asyncHandler(async (req, res) => {
    const result = await sweepMemberRoles({ limit: Math.min(Number(req.body?.limit) || 100, 500) });
    res.json(result);
  }));

// ── Users & roles ──────────────────────────────────────────────────────────
/**
 * Owner alerts, including the ones that never arrived.
 *
 * The point of recording alerts is that a failure is visible somewhere. Without
 * this the table was write-only: a page that no channel accepted, or one folded
 * into a storm summary, existed only as a row nobody could reach.
 *
 * Ordered by what is wrong first — anything not delivered, then the rest by
 * time — because that is the order this is read in.
 */
router.get('/alerts', requirePermission('security.manage'), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await all(
    `SELECT id, event, dedupe_key, priority, title, lines, url, status, attempts,
            last_error, channels, next_try_at, created_at
       FROM owner_alerts
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
               created_at DESC
      LIMIT @limit`, { limit });
  const counts = await all(
    `SELECT status, COUNT(*) AS n FROM owner_alerts GROUP BY status`);
  res.json({
    alerts: rows.map((r) => ({
      ...r,
      lines: (() => { try { return JSON.parse(r.lines || '[]'); } catch { return []; } })(),
      channels: (() => { try { return JSON.parse(r.channels || '[]'); } catch { return []; } })(),
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
  });
}));

router.get('/roles', requirePermission('users.read'), asyncHandler(async (_req, res) => {
  const roles = await all(`SELECT r.*,
    (SELECT string_agg(permission_id, ',') FROM role_permissions WHERE role_id=r.id) AS perms
    FROM roles r ORDER BY rank DESC`);
  res.json({ roles: roles.map((r) => ({ ...r, perms: r.perms ? r.perms.split(',') : [] })) });
}));

router.get('/users', requirePermission('users.read'), asyncHandler(async (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : '%';
  const rows = await all(`SELECT id FROM users WHERE email ILIKE @q OR display_name ILIKE @q
                    ORDER BY created_at DESC LIMIT 200`, { q: search });
  const users = await Promise.all(rows.map((r) => publicUser(r.id)));
  res.json({ users });
}));

router.get('/users/:id', requirePermission('users.read'), asyncHandler(async (req, res) => {
  const u = await publicUser(req.params.id);
  if (!u) throw notFound('User not found');
  res.json({ user: u });
}));

// Assign roles. Only owners may grant the owner role.
router.put('/users/:id/roles', requirePermission('users.manage'),
  asyncHandler(async (req, res) => {
    const { roles } = z.object({ roles: z.array(z.string()).min(1).max(10) }).parse(req.body);
    if (!(await getUserById(req.params.id))) throw notFound('User not found');
    const known = new Set((await all('SELECT id FROM roles')).map((r) => r.id));
    const unknown = roles.filter((r) => !known.has(r));
    if (unknown.length) throw badRequest(`Unknown role: ${unknown.join(', ')}`);
    const actorIsOwner = (req.user.roles || []).includes('owner');
    const current = (await all('SELECT role_id FROM user_roles WHERE user_id=@u', { u: req.params.id })).map((r) => r.role_id);
    /* Granting owner was guarded; taking it away was not — an admin could set
       the owner to plain customer. Only an owner changes an owner, and the
       last owner cannot be removed. */
    if ((roles.includes('owner') || current.includes('owner')) && !actorIsOwner) {
      throw badRequest('Only an Owner can grant or remove the Owner role');
    }
    if (current.includes('owner') && !roles.includes('owner')) {
      const owners = await all(`SELECT DISTINCT user_id FROM user_roles WHERE role_id='owner'`);
      if (owners.length <= 1) throw badRequest('This is the last Owner — add another Owner first');
    }
    if (req.params.id === req.user.id && !actorIsOwner) throw badRequest('You cannot change your own roles');
    await setUserRoles(req.params.id, roles, req.user.id);
    await audit({ actor: req.user, action: 'user.roles_update', targetType: 'user',
      targetId: req.params.id, metadata: { roles }, req });
    res.json({ user: await publicUser(req.params.id) });
  }));

// Grant / extend / cancel Forge+ membership for a user.
router.post('/users/:id/membership', requirePermission('users.manage'),
  asyncHandler(async (req, res) => {
    const { days, cancel } = z.object({ days: z.number().int().min(1).max(3650).optional(), cancel: z.boolean().optional() })
      .parse(req.body || {});
    if (!(await getUserById(req.params.id))) throw notFound('User not found');
    const membership = cancel ? await cancelMembership(req.params.id) : await grantMembership(req.params.id, days || 30);
    await audit({ actor: req.user, action: cancel ? 'membership.cancel' : 'membership.grant',
      targetType: 'user', targetId: req.params.id, metadata: { days }, req });
    res.json({ membership });
  }));

// Grant (or deduct) Forge Coins for a user.
router.post('/users/:id/coins', requirePermission('users.manage'),
  asyncHandler(async (req, res) => {
    const { amount } = z.object({ amount: z.number().int().min(-1000).max(1000) }).parse(req.body || {});
    if (!(await getUserById(req.params.id))) throw notFound('User not found');
    const result = await grantCoins(req.params.id, amount, req.user.id);
    await audit({ actor: req.user, action: 'coins.grant', targetType: 'user',
      targetId: req.params.id, metadata: { amount }, req });
    res.json(result);
  }));

// A user's store-credit balance + recent ledger (admin view).
router.get('/users/:id/wallet', requirePermission('wallet.manage'),
  asyncHandler(async (req, res) => {
    if (!(await getUserById(req.params.id))) throw notFound('User not found');
    res.json(await walletSummary(req.params.id));
  }));

/* The most one grant may give: €100 for staff, €1,000 for an owner (env STAFF_CREDIT_MAX_CENTS). */
const MAX_GRANT = 100_000;
const staffGrantCap = () => Number(process.env.STAFF_CREDIT_MAX_CENTS || 10_000);

// Grant or deduct store credit for a user (e.g. goodwill, manual payout).
router.post('/users/:id/credit', requirePermission('wallet.manage'),
  asyncHandler(async (req, res) => {
    const { amount, description } = z.object({
      /* Cents, positive = grant, negative = deduct. Capped: a typo — or an
         admin crediting themselves €999,999 — is not a goodwill gesture. */
      amount: z.number().int().min(-50_000).max(MAX_GRANT),
      description: z.string().max(200).optional(),
    }).parse(req.body || {});
    if (!(await getUserById(req.params.id))) throw notFound('User not found');
    if (amount === 0) throw badRequest('Amount cannot be zero');
    if (req.params.id === req.user.id && amount > 0) throw badRequest('You cannot grant store credit to yourself');
    if (amount > staffGrantCap() && !(req.user.roles || []).includes('owner')) {
      throw badRequest(`Grants above €${(staffGrantCap() / 100).toFixed(2)} need the Owner`);
    }
    const entry = await addEntry({
      userId: req.params.id, amount, type: amount > 0 ? 'grant' : 'adjustment',
      description: description || (amount > 0 ? 'Store credit granted' : 'Store credit adjustment'),
      createdBy: req.user.id,
    });
    await notify(req.params.id, {
      type: 'system', title: amount > 0 ? 'Store credit added' : 'Store credit adjusted',
      body: `${amount > 0 ? '+' : ''}${(amount / 100).toFixed(2)} — ${description || 'by support'}.`,
      link: '/account/wallet',
    }).catch(() => {});
    await audit({ actor: req.user, action: 'wallet.adjust', targetType: 'user', targetId: req.params.id,
      metadata: { amount }, req });
    res.json({ balance: await balanceOf(req.params.id), entry });
  }));

export default router;
