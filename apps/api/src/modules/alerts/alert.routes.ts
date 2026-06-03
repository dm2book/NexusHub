import { Router } from 'express';
import { z } from 'zod';
import { AlertType, PRICE_DOWN_THRESHOLDS, PRICE_UP_THRESHOLDS } from '@memeforge/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
import { Role } from '@memeforge/shared';
import { validate } from '../../middleware/validate.js';

export const alertRouter = Router();
alertRouter.use(authenticate);

alertRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const alerts = await prisma.alert.findMany({
      where: { userId: req.user!.id },
      include: { token: { select: { symbol: true, address: true } }, events: { take: 5, orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
    ok(res, alerts);
  }),
);

alertRouter.get(
  '/defaults',
  asyncHandler(async (_req, res) =>
    ok(res, { priceUp: PRICE_UP_THRESHOLDS, priceDown: PRICE_DOWN_THRESHOLDS }),
  ),
);

alertRouter.post(
  '/',
  requireRole(Role.ADMIN),
  validate(
    z.object({
      type: z.nativeEnum(AlertType),
      tokenAddress: z.string().optional(),
      threshold: z.number().optional(),
      oneShot: z.boolean().default(false),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { type, tokenAddress, threshold, oneShot } = req.body;
    let tokenId: string | undefined;
    if (tokenAddress) {
      const token = await prisma.token.findUnique({ where: { address: tokenAddress } });
      tokenId = token?.id;
    }
    const alert = await prisma.alert.create({
      data: { userId: req.user!.id, type, tokenId, threshold, oneShot },
    });
    created(res, alert);
  }),
);

// Bulk-create the default price ladder alerts for a token.
alertRouter.post(
  '/ladder',
  requireRole(Role.ADMIN),
  validate(z.object({ tokenAddress: z.string() })),
  asyncHandler(async (req, res) => {
    const token = await prisma.token.findUnique({ where: { address: req.body.tokenAddress } });
    if (!token) return ok(res, { error: 'token not found' }, 404);
    const data = [
      ...PRICE_UP_THRESHOLDS.map((t) => ({ type: AlertType.PRICE_UP, threshold: t })),
      ...PRICE_DOWN_THRESHOLDS.map((t) => ({ type: AlertType.PRICE_DOWN, threshold: t })),
    ].map((a) => ({ ...a, userId: req.user!.id, tokenId: token.id }));
    await prisma.alert.createMany({ data });
    created(res, { count: data.length });
  }),
);

alertRouter.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate(z.object({ enabled: z.boolean().optional(), threshold: z.number().optional() })),
  asyncHandler(async (req, res) => {
    const alert = await prisma.alert.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: req.body,
    });
    ok(res, { updated: alert.count });
  }),
);

alertRouter.delete(
  '/:id',
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.alert.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    ok(res, { success: true });
  }),
);
