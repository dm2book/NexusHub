import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, ok } from '../../lib/http.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

// List in-app notifications.
notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const unread = items.filter((n) => !n.readAt).length;
    ok(res, { items, unread });
  }),
);

// Mark one / all read.
notificationRouter.post(
  '/read',
  validate(z.object({ id: z.string().optional(), all: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { id, all } = req.body as { id?: string; all?: boolean };
    if (all) {
      await prisma.notification.updateMany({
        where: { userId: req.user!.id, readAt: null },
        data: { readAt: new Date() },
      });
    } else if (id) {
      await prisma.notification.updateMany({
        where: { id, userId: req.user!.id },
        data: { readAt: new Date() },
      });
    }
    ok(res, { success: true });
  }),
);

// Get / update channel preferences.
notificationRouter.get(
  '/prefs',
  asyncHandler(async (req, res) => {
    const pref = await prisma.notificationPref.upsert({
      where: { userId: req.user!.id },
      update: {},
      create: { userId: req.user!.id },
    });
    ok(res, pref);
  }),
);

notificationRouter.put(
  '/prefs',
  validate(
    z.object({
      inApp: z.boolean().optional(),
      email: z.boolean().optional(),
      discord: z.boolean().optional(),
      telegram: z.boolean().optional(),
      push: z.boolean().optional(),
      thresholds: z.record(z.any()).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const pref = await prisma.notificationPref.upsert({
      where: { userId: req.user!.id },
      update: req.body,
      create: { userId: req.user!.id, ...req.body },
    });
    ok(res, pref);
  }),
);

// Web-push: expose VAPID public key + register a subscription.
notificationRouter.get(
  '/push/key',
  asyncHandler(async (_req, res) => ok(res, { publicKey: env.vapid.publicKey })),
);

notificationRouter.post(
  '/push/subscribe',
  validate(
    z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string(), auth: z.string() }),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { endpoint, keys } = req.body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };
    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh: keys.p256dh, auth: keys.auth, userId: req.user!.id },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId: req.user!.id },
    });
    ok(res, { id: sub.id });
  }),
);
