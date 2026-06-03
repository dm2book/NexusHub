import {
  PositionStatus,
  TradeSide,
  TradeSource,
  profitPct,
  type PortfolioSummary,
  type PositionView,
} from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { tokenToSnapshot, upsertToken } from '../../services/token.repo.js';
import { marketProvider } from '../../services/market/index.js';
import type { Position, Token } from '@prisma/client';

const DAY = 24 * 3_600_000;

type PositionWithToken = Position & { token: Token };

/** Build a rich view (current price, PnL, time held) for a position. */
export function toPositionView(p: PositionWithToken): PositionView {
  const current = p.token.priceUsd;
  const sizeUsd = p.sizeTokens * current;
  const unrealizedCost = (p.costBasisUsd * p.sizeTokens) / Math.max(p.initialTokens, 1e-9);
  const unrealizedPnl = sizeUsd - unrealizedCost;
  const profit = profitPct(p.entryPriceUsd, current);
  const closedAt = p.closedAt ?? undefined;
  return {
    id: p.id,
    token: tokenToSnapshot(p.token),
    status: p.status as PositionStatus,
    entryPriceUsd: p.entryPriceUsd,
    currentPriceUsd: current,
    sizeTokens: p.sizeTokens,
    sizeUsd,
    peakPriceUsd: p.peakPriceUsd,
    profitPct: profit,
    profitUsd: unrealizedPnl + p.realizedUsd,
    realizedUsd: p.realizedUsd,
    openedAt: p.openedAt.toISOString(),
    closedAt: closedAt?.toISOString(),
    timeHeldMs: (closedAt ?? new Date()).getTime() - p.openedAt.getTime(),
  };
}

export async function listPositions(userId: string, status?: PositionStatus) {
  const positions = await prisma.position.findMany({
    where: { wallet: { userId }, ...(status ? { status } : {}) },
    include: { token: true },
    orderBy: { openedAt: 'desc' },
  });
  return positions.map(toPositionView);
}

export async function getPosition(userId: string, id: string) {
  const p = await prisma.position.findFirst({
    where: { id, wallet: { userId } },
    include: { token: true, trades: { orderBy: { createdAt: 'desc' } }, autoSellRules: true, trailingStop: true },
  });
  if (!p) throw notFound('Position not found');
  return { ...toPositionView(p), trades: p.trades, autoSellRules: p.autoSellRules, trailingStop: p.trailingStop };
}

/** Compute the full portfolio summary (value + multi-window PnL + reserve). */
export async function getSummary(userId: string): Promise<PortfolioSummary> {
  const [positions, reserves, trades] = await Promise.all([
    prisma.position.findMany({ where: { wallet: { userId } }, include: { token: true } }),
    prisma.reserveLedger.findMany({ where: { wallet: { userId } } }),
    prisma.trade.findMany({
      where: { position: { wallet: { userId } }, side: TradeSide.SELL },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const open = positions.filter((p) => p.status === PositionStatus.OPEN);
  const closed = positions.filter((p) => p.status === PositionStatus.CLOSED);

  const openValue = open.reduce((sum, p) => sum + p.sizeTokens * p.token.priceUsd, 0);
  const reserveUsd = reserves.reduce((s, r) => s + r.amountUsd, 0);

  // Unrealized PnL on open positions.
  const unrealized = open.reduce((sum, p) => {
    const cost = (p.costBasisUsd * p.sizeTokens) / Math.max(p.initialTokens, 1e-9);
    return sum + (p.sizeTokens * p.token.priceUsd - cost);
  }, 0);
  const realizedTotal = positions.reduce((s, p) => s + p.realizedUsd, 0);

  const now = Date.now();
  const realizedSince = (ms: number) =>
    trades.filter((t) => now - t.createdAt.getTime() <= ms).reduce((s, t) => s + t.pnlUsd, 0);

  const totalValue = openValue + reserveUsd;
  const totalCost = positions.reduce((s, p) => s + p.costBasisUsd, 0) || 1;
  const totalPnl = realizedTotal + unrealized;

  const pct = (pnl: number) => (totalCost > 0 ? (pnl / totalCost) * 100 : 0);

  return {
    totalValueUsd: totalValue,
    reserveUsd,
    pnl: {
      dailyUsd: realizedSince(DAY) + unrealized,
      weeklyUsd: realizedSince(7 * DAY) + unrealized,
      monthlyUsd: realizedSince(30 * DAY) + unrealized,
      totalUsd: totalPnl,
      dailyPct: pct(realizedSince(DAY)),
      weeklyPct: pct(realizedSince(7 * DAY)),
      monthlyPct: pct(realizedSince(30 * DAY)),
      totalPct: pct(totalPnl),
    },
    openPositions: open.length,
    closedPositions: closed.length,
  };
}

/**
 * Open a position. NOTE: this records a tracked holding (entry) — it is NOT an
 * automated buy. Owner action only; the automation engine never calls this.
 */
export async function openPosition(
  userId: string,
  input: { walletId?: string; tokenAddress: string; sizeUsd: number; entryReason?: string },
) {
  const wallet = input.walletId
    ? await prisma.wallet.findFirst({ where: { id: input.walletId, userId } })
    : await prisma.wallet.findFirst({ where: { userId, isActive: true } });
  if (!wallet) throw badRequest('No wallet found');

  const snap = await marketProvider.getToken(input.tokenAddress);
  if (!snap) throw notFound('Token not found on market provider');
  const token = await upsertToken(snap);

  const sizeTokens = input.sizeUsd / snap.priceUsd;
  const position = await prisma.position.create({
    data: {
      walletId: wallet.id,
      tokenId: token.id,
      entryPriceUsd: snap.priceUsd,
      peakPriceUsd: snap.priceUsd,
      sizeTokens,
      initialTokens: sizeTokens,
      costBasisUsd: input.sizeUsd,
      trades: {
        create: {
          side: TradeSide.BUY,
          source: TradeSource.MANUAL,
          priceUsd: snap.priceUsd,
          amountTokens: sizeTokens,
          amountUsd: input.sizeUsd,
          note: input.entryReason,
        },
      },
    },
    include: { token: true },
  });
  return toPositionView(position);
}

/**
 * Execute a SELL on a position (partial or full). The single sell path used by
 * both manual sells and the automation engine. There is deliberately no buy
 * counterpart — auto-buy is impossible by construction.
 */
export async function sellPosition(
  positionId: string,
  opts: { sellPct: number; source?: TradeSource; note?: string },
): Promise<{ pnlUsd: number; amountUsd: number; closed: boolean } | null> {
  const sellFraction = Math.min(Math.max(opts.sellPct, 0), 100) / 100;
  if (sellFraction <= 0) return null;

  return prisma.$transaction(async (tx) => {
    const p = await tx.position.findUnique({ where: { id: positionId }, include: { token: true } });
    if (!p || p.status === PositionStatus.CLOSED) return null;

    const tokensToSell = p.sizeTokens * sellFraction;
    const price = p.token.priceUsd;
    const proceeds = tokensToSell * price;
    const costPortion = (p.costBasisUsd * tokensToSell) / Math.max(p.initialTokens, 1e-9);
    const pnl = proceeds - costPortion;

    const remaining = p.sizeTokens - tokensToSell;
    const willClose = remaining / p.initialTokens < 0.001;

    await tx.trade.create({
      data: {
        positionId: p.id,
        side: TradeSide.SELL,
        source: opts.source ?? TradeSource.MANUAL,
        priceUsd: price,
        amountTokens: tokensToSell,
        amountUsd: proceeds,
        pnlUsd: pnl,
        note: opts.note,
      },
    });

    await tx.position.update({
      where: { id: p.id },
      data: {
        sizeTokens: willClose ? 0 : remaining,
        realizedUsd: { increment: pnl },
        status: willClose ? PositionStatus.CLOSED : PositionStatus.OPEN,
        closedAt: willClose ? new Date() : null,
      },
    });

    return { pnlUsd: pnl, amountUsd: proceeds, closed: willClose };
  });
}

export async function assertOwnsPosition(userId: string, positionId: string) {
  const p = await prisma.position.findFirst({ where: { id: positionId, wallet: { userId } } });
  if (!p) throw forbidden('Not your position');
  return p;
}
