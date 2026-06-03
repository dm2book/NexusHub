import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

export const journalRouter = Router();
journalRouter.use(authenticate);

const entrySchema = z.object({
  tokenSymbol: z.string().min(1),
  tokenAddress: z.string().optional(),
  entryReason: z.string().optional(),
  exitReason: z.string().optional(),
  lesson: z.string().optional(),
  screenshotUrls: z.array(z.string().url()).optional(),
  pnlUsd: z.number().optional(),
  pnlPct: z.number().optional(),
});

journalRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const entries = await prisma.journalEntry.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    ok(res, entries);
  }),
);

// Performance report derived from journal entries.
journalRouter.get(
  '/performance',
  asyncHandler(async (req, res) => {
    const entries = await prisma.journalEntry.findMany({ where: { userId: req.user!.id, pnlUsd: { not: null } } });
    const wins = entries.filter((e) => (e.pnlUsd ?? 0) > 0);
    const losses = entries.filter((e) => (e.pnlUsd ?? 0) <= 0);
    const totalPnl = entries.reduce((s, e) => s + (e.pnlUsd ?? 0), 0);
    ok(res, {
      totalEntries: entries.length,
      wins: wins.length,
      losses: losses.length,
      winRate: entries.length ? (wins.length / entries.length) * 100 : 0,
      totalPnlUsd: totalPnl,
      avgPnlPct: entries.length ? entries.reduce((s, e) => s + (e.pnlPct ?? 0), 0) / entries.length : 0,
      bestTrade: [...entries].sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0] ?? null,
      worstTrade: [...entries].sort((a, b) => (a.pnlUsd ?? 0) - (b.pnlUsd ?? 0))[0] ?? null,
    });
  }),
);

journalRouter.post(
  '/',
  validate(entrySchema),
  asyncHandler(async (req, res) => {
    const entry = await prisma.journalEntry.create({
      data: { userId: req.user!.id, ...req.body, screenshotUrls: req.body.screenshotUrls ?? [] },
    });
    created(res, entry);
  }),
);

journalRouter.patch(
  '/:id',
  validate(entrySchema.partial()),
  asyncHandler(async (req, res) => {
    const updated = await prisma.journalEntry.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: req.body,
    });
    ok(res, { updated: updated.count });
  }),
);

journalRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await prisma.journalEntry.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    ok(res, { success: true });
  }),
);
