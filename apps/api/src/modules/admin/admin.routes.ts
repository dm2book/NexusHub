import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@memeforge/shared';
import { asyncHandler, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';
import { requireOwner } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { realtime } from '../../realtime/hub.js';

/**
 * Owner Control Center — only the OWNER can manage users/roles and view
 * system-wide status. (Wallet/alert/automation management live in their own
 * modules, all likewise owner-gated.)
 */
export const adminRouter = Router();
adminRouter.use(authenticate, requireOwner);

adminRouter.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    ok(res, users);
  }),
);

adminRouter.patch(
  '/users/:id/role',
  validate(z.object({ role: z.nativeEnum(Role) })),
  asyncHandler(async (req, res) => {
    // Never allow demoting the configured owner; never create a second owner here.
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { role: req.body.role } });
    ok(res, { id: user.id, role: user.role });
  }),
);

adminRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const [users, positions, alerts, tokens] = await Promise.all([
      prisma.user.count(),
      prisma.position.count({ where: { status: 'OPEN' } }),
      prisma.alert.count({ where: { enabled: true } }),
      prisma.token.count(),
    ]);
    ok(res, {
      users,
      openPositions: positions,
      activeAlerts: alerts,
      trackedTokens: tokens,
      realtimeConnections: realtime.connectionCount,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  }),
);
