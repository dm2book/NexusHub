import { TradeSide, WHALE_USD_THRESHOLD, type WhaleTransfer } from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { marketProvider } from '../../services/market/index.js';
import { tokenToSnapshot, upsertToken } from '../../services/token.repo.js';
import { fireWhaleAlert } from '../alerts/alert.service.js';

let lastScan = new Date(Date.now() - 60_000);

/**
 * Whale scanner — pulls large transfers from the provider, persists them,
 * tracks net flow per token and fires instant alerts on big moves.
 */
export async function scanWhales(): Promise<WhaleTransfer[]> {
  const transfers = await marketProvider.getWhaleTransfers(lastScan);
  lastScan = new Date();
  if (transfers.length === 0) return [];

  for (const tr of transfers) {
    const snap = await marketProvider.getToken(tr.tokenAddress);
    if (!snap) continue;
    const token = await upsertToken(snap);

    // Track the whale wallet (upsert by address).
    const whale = await prisma.whaleWallet.upsert({
      where: { address: tr.walletAddress },
      update: {},
      create: { address: tr.walletAddress, label: `Whale ${tr.walletAddress.slice(0, 4)}` },
    });

    await prisma.whaleTransfer
      .create({
        data: {
          whaleId: whale.id,
          tokenId: token.id,
          txHash: tr.txHash,
          side: tr.side,
          amountUsd: tr.amountUsd,
          amountTokens: tr.amountTokens,
          timestamp: new Date(tr.timestamp),
        },
      })
      .catch(() => undefined); // ignore dup tx

    if (tr.amountUsd >= WHALE_USD_THRESHOLD) {
      await fireWhaleAlert(tr.side === TradeSide.BUY ? 'BUY' : 'SELL', snap, tr.amountUsd);
    }
  }

  logger.debug({ count: transfers.length }, 'Whale scan complete');
  return transfers;
}

/** Recent whale activity feed (optionally filtered by token). */
export async function getWhaleFeed(tokenAddress?: string, limit = 50) {
  const transfers = await prisma.whaleTransfer.findMany({
    where: tokenAddress ? { token: { address: tokenAddress } } : {},
    include: { token: true, whale: true },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
  return transfers.map((t) => ({
    id: t.id,
    side: t.side,
    amountUsd: t.amountUsd,
    amountTokens: t.amountTokens,
    timestamp: t.timestamp.toISOString(),
    wallet: t.whale?.address ?? 'unknown',
    walletLabel: t.whale?.label,
    token: tokenToSnapshot(t.token),
  }));
}

/** Net USD flow per token over a recent window (positive = accumulation). */
export async function getWhaleNetFlow(tokenAddress: string, windowMs = 24 * 3_600_000): Promise<number> {
  const token = await prisma.token.findUnique({ where: { address: tokenAddress } });
  if (!token) return 0;
  const since = new Date(Date.now() - windowMs);
  const transfers = await prisma.whaleTransfer.findMany({
    where: { tokenId: token.id, timestamp: { gte: since } },
  });
  return transfers.reduce((sum, t) => sum + (t.side === TradeSide.BUY ? t.amountUsd : -t.amountUsd), 0);
}
