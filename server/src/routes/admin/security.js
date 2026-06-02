/** Admin security: audit logs, fraud review, users & role management. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { requirePermission } from '../../middleware/rbac.js';
import { all } from '../../db/index.js';
import { listAuditLogs } from '../../services/auditService.js';
import { listFlaggedOrders } from '../../services/fraudService.js';
import {
  publicUser, setUserRoles, getUserById,
} from '../../services/userService.js';
import { audit } from '../../services/auditService.js';
import { notFound, badRequest } from '../../utils/errors.js';

const router = Router();

// ── Audit logs ─────────────────────────────────────────────────────────────
router.get('/audit', requirePermission('audit.read'), (req, res) => {
  res.json({ logs: listAuditLogs({
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
    action: req.query.action, targetId: req.query.targetId,
  }) });
});

// ── Fraud review queue ─────────────────────────────────────────────────────
router.get('/fraud', requirePermission('security.manage'), (_req, res) => {
  res.json({ flagged: listFlaggedOrders() });
});

// ── Users & roles ──────────────────────────────────────────────────────────
router.get('/roles', requirePermission('users.read'), (_req, res) => {
  const roles = all(`SELECT r.*,
    (SELECT GROUP_CONCAT(permission_id) FROM role_permissions WHERE role_id=r.id) AS perms
    FROM roles r ORDER BY rank DESC`);
  res.json({ roles: roles.map((r) => ({ ...r, perms: r.perms ? r.perms.split(',') : [] })) });
});

router.get('/users', requirePermission('users.read'), (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : '%';
  const rows = all(`SELECT id FROM users WHERE email LIKE @q OR display_name LIKE @q
                    ORDER BY created_at DESC LIMIT 200`, { q: search });
  res.json({ users: rows.map((r) => publicUser(r.id)) });
});

router.get('/users/:id', requirePermission('users.read'), (req, res) => {
  const u = publicUser(req.params.id);
  if (!u) return res.status(404).json({ error: { message: 'User not found' } });
  res.json({ user: u });
});

// Assign roles. Only owners may grant the owner role.
router.put('/users/:id/roles', requirePermission('users.manage'),
  asyncHandler(async (req, res) => {
    const { roles } = z.object({ roles: z.array(z.string()).min(1) }).parse(req.body);
    if (!getUserById(req.params.id)) throw notFound('User not found');
    if (roles.includes('owner') && !(req.user.roles || []).includes('owner')) {
      throw badRequest('Only an Owner can grant the Owner role');
    }
    setUserRoles(req.params.id, roles, req.user.id);
    audit({ actor: req.user, action: 'user.roles_update', targetType: 'user',
      targetId: req.params.id, metadata: { roles }, req });
    res.json({ user: publicUser(req.params.id) });
  }));

export default router;
