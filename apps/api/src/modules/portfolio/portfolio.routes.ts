import { Router } from 'express';
import { z } from 'zod';
import { PositionStatus, TradeSource } from '@memeforge/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';
import { requireOwner } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import {
  assertOwnsPosition,
  getPosition,
  getSummary,
  listPositions,
  openPosition,
  sellPosition,
} from './portfolio.service.js';
import { notifications } from '../notifications/notification.service.js';
import { realtime } from '../../realtime/hub.js';

export const portfolioRouter = Router();
portfolioRouter.use(authenticate);

// Summary (value, PnL windows, reserve).
portfolioRouter.get(
  '/summary',
  asyncHandler(async (req, res) => ok(res, await getSummary(req.user!.id))),
);

// Wallets.
portfolioRouter.get(
  '/wallets',
  asyncHandler(async (req, res) => {
    const wallets = await prisma.wallet.findMany({ where: { userId: req.user!.id } });
    ok(res, wallets);
  }),
);

portfolioRouter.post(
  '/wallets',
  requireOwner,
  validate(z.object({ label: z.string().min(1), address: z.string().min(4), chain: z.string().default('solana') })),
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.create({ data: { ...req.body, userId: req.user!.id } });
    created(res, wallet);
  }),
);

// Positions.
portfolioRouter.get(
  '/positions',
  validate(z.object({ status: z.nativeEnum(PositionStatus).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    ok(res, await listPositions(req.user!.id, req.query.status as PositionStatus | undefined));
  }),
);

portfolioRouter.get(
  '/positions/:id',
  asyncHandler(async (req, res) => ok(res, await getPosition(req.user!.id, req.params.id))),
);

// Open a tracked position (owner only — NOT an automated buy).
portfolioRouter.post(
  '/positions',
  requireOwner,
  validate(
    z.object({
      walletId: z.string().optional(),
      tokenAddress: z.string().min(4),
      sizeUsd: z.number().positive(),
      entryReason: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const view = await openPosition(req.user!.id, req.body);
    realtime.publish('portfolio', { kind: 'opened', position: view }, req.user!.id);
    created(res, view);
  }),
);

// Sell (partial/full) — owner only.
portfolioRouter.post(
  '/positions/:id/sell',
  requireOwner,
  validate(z.object({ sellPct: z.number().min(1).max(100), note: z.string().optional() })),
  asyncHandler(async (req, res) => {
    await assertOwnsPosition(req.user!.id, req.params.id);
    const result = await sellPosition(req.params.id, {
      sellPct: req.body.sellPct,
      source: TradeSource.MANUAL,
      note: req.body.note,
    });
    if (result) {
      await notifications.dispatch(req.user!.id, {
        type: 'AUTO_SELL',
        emoji: '💰',
        title: 'Manual sell executed',
        body: `Sold ${req.body.sellPct}% for $${result.amountUsd.toFixed(2)} (PnL $${result.pnlUsd.toFixed(2)})`,
      });
      realtime.publish('portfolio', { kind: 'sold', positionId: req.params.id, result }, req.user!.id);
    }
    ok(res, result);
  }),
);

// Reserve ledger (profit lock destination).
portfolioRouter.get(
  '/reserve',
  asyncHandler(async (req, res) => {
    const ledger = await prisma.reserveLedger.findMany({
      where: { wallet: { userId: req.user!.id } },
      orderBy: { createdAt: 'desc' },
    });
    const balance = ledger.reduce((s, l) => s + l.amountUsd, 0);
    ok(res, { balance, ledger });
  }),
);

// Manual reserve withdrawal (owner only — there are NO automatic withdrawals).
portfolioRouter.post(
  '/reserve/withdraw',
  requireOwner,
  validate(z.object({ walletId: z.string(), amountUsd: z.number().positive(), reason: z.string().default('Manual withdrawal') })),
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findFirst({ where: { id: req.body.walletId, userId: req.user!.id } });
    if (!wallet) return ok(res, { error: 'wallet not found' }, 404);
    const entry = await prisma.reserveLedger.create({
      data: { walletId: wallet.id, amountUsd: -Math.abs(req.body.amountUsd), reason: req.body.reason },
    });
    ok(res, entry);
  }),
);
