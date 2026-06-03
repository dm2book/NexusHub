import type { TokenSnapshot } from '@memeforge/shared';
import { prisma } from '../lib/prisma.js';
import type { Token } from '@prisma/client';

/** Upsert a provider snapshot into the Token table (denormalized latest state). */
export async function upsertToken(snap: TokenSnapshot): Promise<Token> {
  return prisma.token.upsert({
    where: { address: snap.address },
    update: {
      symbol: snap.symbol,
      name: snap.name,
      imageUrl: snap.imageUrl,
      priceUsd: snap.priceUsd,
      priceChange1h: snap.priceChange1h,
      priceChange24h: snap.priceChange24h,
      volume24h: snap.volume24h,
      liquidityUsd: snap.liquidityUsd,
      marketCap: snap.marketCap,
      fdv: snap.fdv,
      holders: snap.holders,
    },
    create: {
      address: snap.address,
      chain: snap.chain,
      symbol: snap.symbol,
      name: snap.name,
      imageUrl: snap.imageUrl,
      priceUsd: snap.priceUsd,
      priceChange1h: snap.priceChange1h,
      priceChange24h: snap.priceChange24h,
      volume24h: snap.volume24h,
      liquidityUsd: snap.liquidityUsd,
      marketCap: snap.marketCap,
      fdv: snap.fdv,
      holders: snap.holders,
      launchedAt: new Date(snap.createdAt),
    },
  });
}

/** Convert a Token row back into a TokenSnapshot. */
export function tokenToSnapshot(t: Token): TokenSnapshot {
  return {
    address: t.address,
    chain: t.chain,
    symbol: t.symbol,
    name: t.name,
    priceUsd: t.priceUsd,
    priceChange1h: t.priceChange1h,
    priceChange24h: t.priceChange24h,
    volume24h: t.volume24h,
    liquidityUsd: t.liquidityUsd,
    marketCap: t.marketCap,
    fdv: t.fdv,
    holders: t.holders,
    createdAt: t.launchedAt.toISOString(),
    imageUrl: t.imageUrl ?? undefined,
  };
}
