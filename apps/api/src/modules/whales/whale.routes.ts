import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ok } from '../../lib/http.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { getWhaleFeed, scanWhales } from './whale.service.js';
import { prisma } from '../../lib/prisma.js';

export const whaleRouter = Router();
whaleRouter.use(authenticate);

whaleRouter.get(
  '/',
  validate(z.object({ token: z.string().optional(), limit: z.coerce.number().max(200).default(50) }), 'query'),
  asyncHandler(async (req, res) => {
    ok(res, await getWhaleFeed(req.query.token as string | undefined, Number(req.query.limit)));
  }),
);

// Tracked whale wallets ranked by PnL.
whaleRouter.get(
  '/wallets',
  asyncHandler(async (_req, res) => {
    const wallets = await prisma.whaleWallet.findMany({ orderBy: { totalPnlUsd: 'desc' }, take: 50 });
    ok(res, wallets);
  }),
);

whaleRouter.post(
  '/scan',
  asyncHandler(async (_req, res) => ok(res, { transfers: await scanWhales() })),
);
