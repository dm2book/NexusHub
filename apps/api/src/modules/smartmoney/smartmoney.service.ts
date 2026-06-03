import { prisma } from '../../lib/prisma.js';

/**
 * SmartMoneyTracker — surfaces high-performing wallets, their ROI, current
 * holdings and recent purchases. In mock mode these are seeded; real mode would
 * derive them from on-chain wallet PnL analysis.
 */
export async function getSmartWallets(limit = 25) {
  const wallets = await prisma.smartWallet.findMany({
    orderBy: { roiPct: 'desc' },
    take: limit,
    include: {
      trades: {
        orderBy: { timestamp: 'desc' },
        take: 5,
        include: { token: { select: { symbol: true, address: true, priceUsd: true } } },
      },
    },
  });
  return wallets.map((w) => ({
    id: w.id,
    address: w.address,
    label: w.label,
    roiPct: w.roiPct,
    winRate: w.winRate,
    totalPnlUsd: w.totalPnlUsd,
    holdings: w.holdingsJson ?? [],
    recentTrades: w.trades.map((t) => ({
      side: t.side,
      amountUsd: t.amountUsd,
      priceUsd: t.priceUsd,
      timestamp: t.timestamp.toISOString(),
      token: t.token,
    })),
  }));
}

/** Whether any smart wallet has recently bought a token (signal for scoring). */
export async function smartMoneyActiveFor(tokenAddress: string, windowMs = 24 * 3_600_000): Promise<boolean> {
  const token = await prisma.token.findUnique({ where: { address: tokenAddress } });
  if (!token) return false;
  const since = new Date(Date.now() - windowMs);
  const count = await prisma.smartTrade.count({
    where: { tokenId: token.id, side: 'BUY', timestamp: { gte: since } },
  });
  return count > 0;
}

/** Recent smart-money buys across all tracked wallets. */
export async function getSmartMoneyBuys(limit = 30) {
  const trades = await prisma.smartTrade.findMany({
    where: { side: 'BUY' },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: { wallet: true, token: true },
  });
  return trades.map((t) => ({
    wallet: t.wallet.address,
    walletLabel: t.wallet.label,
    roiPct: t.wallet.roiPct,
    token: { symbol: t.token.symbol, address: t.token.address, priceUsd: t.token.priceUsd },
    amountUsd: t.amountUsd,
    timestamp: t.timestamp.toISOString(),
  }));
}
