import { Router } from 'express';
import { z } from 'zod';
import { WatchlistSection } from '@memeforge/shared';
import { asyncHandler, created, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { notFound } from '../../lib/errors.js';
import { marketProvider } from '../../services/market/index.js';
import { tokenToSnapshot, upsertToken } from '../../services/token.repo.js';
import { scoreSnapshot } from '../discovery/discovery.service.js';

export const watchlistRouter = Router();
watchlistRouter.use(authenticate);

// Get the watchlist grouped by section with live scores.
watchlistRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await prisma.watchlistItem.findMany({
      where: { userId: req.user!.id },
      include: { token: true },
      orderBy: { createdAt: 'desc' },
    });
    const grouped: Record<string, unknown[]> = {};
    for (const section of Object.values(WatchlistSection)) grouped[section] = [];
    for (const item of items) {
      grouped[item.section]!.push({
        id: item.id,
        note: item.note,
        addedAt: item.createdAt.toISOString(),
        ...scoreSnapshot(tokenToSnapshot(item.token)),
      });
    }
    ok(res, grouped);
  }),
);

// Add a token to a watchlist section.
watchlistRouter.post(
  '/',
  validate(
    z.object({
      tokenAddress: z.string().min(4),
      section: z.nativeEnum(WatchlistSection).default(WatchlistSection.FAVORITES),
      note: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    let token = await prisma.token.findUnique({ where: { address: req.body.tokenAddress } });
    if (!token) {
      const snap = await marketProvider.getToken(req.body.tokenAddress);
      if (!snap) throw notFound('Token not found');
      token = await upsertToken(snap);
    }
    const item = await prisma.watchlistItem.upsert({
      where: { userId_tokenId_section: { userId: req.user!.id, tokenId: token.id, section: req.body.section } },
      update: { note: req.body.note },
      create: { userId: req.user!.id, tokenId: token.id, section: req.body.section, note: req.body.note },
    });
    created(res, item);
  }),
);

watchlistRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await prisma.watchlistItem.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    ok(res, { success: true });
  }),
);
