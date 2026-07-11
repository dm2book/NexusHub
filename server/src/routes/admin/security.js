/** Admin security: audit logs, fraud review, users & role management. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { all } from '../../db/index.js';
import { listAuditLogs, audit } from '../../services/auditService.js';
import { listFlaggedOrders } from '../../services/fraudService.js';
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
  res.json({ flagged: await listFlaggedOrders() });
}));

// ── Users & roles ──────────────────────────────────────────────────────────
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
    const { roles } = z.object({ roles: z.array(z.string()).min(1) }).parse(req.body);
    if (!(await getUserById(req.params.id))) throw notFound('User not found');
    if (roles.includes('owner') && !(req.user.roles || []).includes('owner')) {
      throw badRequest('Only an Owner can grant the Owner role');
    }
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

// Grant or deduct store credit for a user (e.g. goodwill, manual payout).
router.post('/users/:id/credit', requirePermission('wallet.manage'),
  asyncHandler(async (req, res) => {
    const { amount, description } = z.object({
      amount: z.number().int(),            // cents, positive = grant, negative = deduct
      description: z.string().max(200).optional(),
    }).parse(req.body || {});
    if (!(await getUserById(req.params.id))) throw notFound('User not found');
    if (amount === 0) throw badRequest('Amount cannot be zero');
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
