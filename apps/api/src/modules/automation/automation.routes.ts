import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_AUTO_SELL_LADDER, DEFAULT_TRAILING_STOP } from '@memeforge/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';
import { requireOwner } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { assertOwnsPosition } from '../portfolio/portfolio.service.js';
import { runProfitLock } from './automation.service.js';

export const automationRouter = Router();
automationRouter.use(authenticate);

// ── Auto-sell rules (owner only) ──
automationRouter.get(
  '/positions/:id/rules',
  asyncHandler(async (req, res) => {
    await assertOwnsPosition(req.user!.id, req.params.id);
    const rules = await prisma.autoSellRule.findMany({ where: { positionId: req.params.id } });
    ok(res, rules);
  }),
);

automationRouter.post(
  '/positions/:id/rules',
  requireOwner,
  validate(z.object({ triggerPct: z.number().positive(), sellPct: z.number().min(1).max(100) })),
  asyncHandler(async (req, res) => {
    await assertOwnsPosition(req.user!.id, req.params.id);
    const rule = await prisma.autoSellRule.create({
      data: { positionId: req.params.id, triggerPct: req.body.triggerPct, sellPct: req.body.sellPct },
    });
    created(res, rule);
  }),
);

// Apply the default laddered take-profit set to a position.
automationRouter.post(
  '/positions/:id/rules/default-ladder',
  requireOwner,
  asyncHandler(async (req, res) => {
    await assertOwnsPosition(req.user!.id, req.params.id);
    await prisma.autoSellRule.createMany({
      data: DEFAULT_AUTO_SELL_LADDER.map((r) => ({ positionId: req.params.id, ...r })),
    });
    const rules = await prisma.autoSellRule.findMany({ where: { positionId: req.params.id } });
    created(res, rules);
  }),
);

automationRouter.delete(
  '/rules/:ruleId',
  requireOwner,
  asyncHandler(async (req, res) => {
    const rule = await prisma.autoSellRule.findUnique({ where: { id: req.params.ruleId } });
    if (rule) {
      await assertOwnsPosition(req.user!.id, rule.positionId);
      await prisma.autoSellRule.delete({ where: { id: req.params.ruleId } });
    }
    ok(res, { success: true });
  }),
);

// ── Trailing stop (owner only) ──
automationRouter.put(
  '/positions/:id/trailing-stop',
  requireOwner,
  validate(
    z.object({
      armAtPct: z.number().positive().default(DEFAULT_TRAILING_STOP.armAtPct),
      dropPct: z.number().positive().default(DEFAULT_TRAILING_STOP.dropPct),
      sellPct: z.number().min(1).max(100).default(DEFAULT_TRAILING_STOP.sellPct),
      enabled: z.boolean().default(true),
    }),
  ),
  asyncHandler(async (req, res) => {
    await assertOwnsPosition(req.user!.id, req.params.id);
    const ts = await prisma.trailingStop.upsert({
      where: { positionId: req.params.id },
      update: { ...req.body, armed: false, triggeredAt: null },
      create: { positionId: req.params.id, ...req.body },
    });
    ok(res, ts);
  }),
);

// ── Profit lock config (owner only) ──
automationRouter.get(
  '/profit-lock',
  asyncHandler(async (req, res) => {
    const cfg = await prisma.profitLockConfig.upsert({
      where: { userId: req.user!.id },
      update: {},
      create: { userId: req.user!.id },
    });
    ok(res, cfg);
  }),
);

automationRouter.put(
  '/profit-lock',
  requireOwner,
  validate(z.object({ enabled: z.boolean().optional(), sweepPct: z.number().min(0).max(100).optional() })),
  asyncHandler(async (req, res) => {
    const cfg = await prisma.profitLockConfig.upsert({
      where: { userId: req.user!.id },
      update: req.body,
      create: { userId: req.user!.id, ...req.body },
    });
    ok(res, cfg);
  }),
);

// Trigger profit lock immediately (owner only) — useful for testing/manual EOD.
automationRouter.post(
  '/profit-lock/run',
  requireOwner,
  asyncHandler(async (_req, res) => {
    await runProfitLock();
    ok(res, { success: true });
  }),
);
