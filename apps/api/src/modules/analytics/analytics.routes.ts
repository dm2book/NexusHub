import { Router } from 'express';
import { TradeSide } from '@memeforge/shared';
import { asyncHandler, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.js';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

/**
 * Analytics — profit analytics, win rate, average return, best/worst trades and
 * the portfolio growth curve, derived from realized SELL trades + positions.
 */
analyticsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const [sells, positions, reserves] = await Promise.all([
      prisma.trade.findMany({
        where: { side: TradeSide.SELL, position: { wallet: { userId } } },
        include: { position: { include: { token: { select: { symbol: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.position.findMany({ where: { wallet: { userId } }, include: { token: true } }),
      prisma.reserveLedger.findMany({ where: { wallet: { userId } } }),
    ]);

    const wins = sells.filter((t) => t.pnlUsd > 0);
    const losses = sells.filter((t) => t.pnlUsd <= 0);
    const realizedPnl = sells.reduce((s, t) => s + t.pnlUsd, 0);

    const ranked = [...sells].sort((a, b) => b.pnlUsd - a.pnlUsd);
    const mapTrade = (t: (typeof sells)[number] | undefined) =>
      t
        ? { symbol: t.position.token.symbol, pnlUsd: t.pnlUsd, amountUsd: t.amountUsd, at: t.createdAt.toISOString() }
        : null;

    // Cumulative realized PnL growth curve.
    let cumulative = 0;
    const growthCurve = sells.map((t) => {
      cumulative += t.pnlUsd;
      return { t: t.createdAt.toISOString(), pnl: cumulative };
    });

    const unrealized = positions
      .filter((p) => p.status === 'OPEN')
      .reduce((s, p) => {
        const cost = (p.costBasisUsd * p.sizeTokens) / Math.max(p.initialTokens, 1e-9);
        return s + (p.sizeTokens * p.token.priceUsd - cost);
      }, 0);

    ok(res, {
      winRate: sells.length ? (wins.length / sells.length) * 100 : 0,
      totalTrades: sells.length,
      wins: wins.length,
      losses: losses.length,
      realizedPnlUsd: realizedPnl,
      unrealizedPnlUsd: unrealized,
      avgReturnUsd: sells.length ? realizedPnl / sells.length : 0,
      avgWinUsd: wins.length ? wins.reduce((s, t) => s + t.pnlUsd, 0) / wins.length : 0,
      avgLossUsd: losses.length ? losses.reduce((s, t) => s + t.pnlUsd, 0) / losses.length : 0,
      bestTrades: ranked.slice(0, 5).map(mapTrade),
      worstTrades: ranked.slice(-5).reverse().map(mapTrade),
      reserveUsd: reserves.reduce((s, r) => s + r.amountUsd, 0),
      growthCurve,
    });
  }),
);
