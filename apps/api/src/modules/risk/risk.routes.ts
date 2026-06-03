import { Router } from 'express';
import { asyncHandler, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { marketProvider } from '../../services/market/index.js';
import { tokenToSnapshot } from '../../services/token.repo.js';
import { assessRisk } from './risk.service.js';

export const riskRouter = Router();
riskRouter.use(authenticate);

// Live risk assessment for any token address.
riskRouter.get(
  '/:address',
  asyncHandler(async (req, res) => {
    const token = await prisma.token.findUnique({ where: { address: req.params.address } });
    const snap = token ? tokenToSnapshot(token) : await marketProvider.getToken(req.params.address);
    if (!snap) throw notFound('Token not found');
    ok(res, { token: snap, risk: assessRisk(snap) });
  }),
);

// History of stored assessments.
riskRouter.get(
  '/:address/history',
  asyncHandler(async (req, res) => {
    const token = await prisma.token.findUnique({ where: { address: req.params.address } });
    if (!token) throw notFound('Token not found');
    const history = await prisma.riskAssessment.findMany({
      where: { tokenId: token.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    ok(res, history);
  }),
);
