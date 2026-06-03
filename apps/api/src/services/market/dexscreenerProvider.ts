import type { TokenSnapshot, WhaleTransfer } from '@memeforge/shared';
import type { MarketProvider } from './provider.js';
import { logger } from '../../lib/logger.js';

/**
 * Real DexScreener adapter. Uses the public DexScreener API. Whale transfers
 * are not exposed by DexScreener, so that method returns [] (use Birdeye/Helius
 * for on-chain whale data). This is a thin, production-shaped adapter.
 */
const BASE = 'https://api.dexscreener.com';

interface DexPair {
  chainId: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceChange?: { h1?: number; h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

function toSnapshot(p: DexPair): TokenSnapshot {
  return {
    address: p.baseToken.address,
    chain: p.chainId,
    symbol: p.baseToken.symbol,
    name: p.baseToken.name,
    priceUsd: Number(p.priceUsd ?? 0),
    priceChange1h: p.priceChange?.h1 ?? 0,
    priceChange24h: p.priceChange?.h24 ?? 0,
    volume24h: p.volume?.h24 ?? 0,
    liquidityUsd: p.liquidity?.usd ?? 0,
    marketCap: p.marketCap ?? 0,
    fdv: p.fdv ?? 0,
    holders: 0, // not provided by DexScreener
    createdAt: new Date(p.pairCreatedAt ?? Date.now()).toISOString(),
    imageUrl: p.info?.imageUrl,
  };
}

export class DexScreenerProvider implements MarketProvider {
  readonly name = 'dexscreener';

  private async fetchPairs(path: string): Promise<DexPair[]> {
    try {
      const res = await fetch(`${BASE}${path}`);
      if (!res.ok) return [];
      const json = (await res.json()) as { pairs?: DexPair[] };
      return json.pairs ?? [];
    } catch (err) {
      logger.warn({ err, path }, 'DexScreener request failed');
      return [];
    }
  }

  async getToken(address: string): Promise<TokenSnapshot | null> {
    const pairs = await this.fetchPairs(`/latest/dex/tokens/${address}`);
    const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return best ? toSnapshot(best) : null;
  }

  async getTokens(addresses: string[]): Promise<TokenSnapshot[]> {
    if (addresses.length === 0) return [];
    const pairs = await this.fetchPairs(`/latest/dex/tokens/${addresses.join(',')}`);
    const byAddr = new Map<string, TokenSnapshot>();
    for (const p of pairs) {
      const snap = toSnapshot(p);
      const existing = byAddr.get(snap.address);
      if (!existing || snap.liquidityUsd > existing.liquidityUsd) byAddr.set(snap.address, snap);
    }
    return [...byAddr.values()];
  }

  async getTrending(): Promise<TokenSnapshot[]> {
    const pairs = await this.fetchPairs('/latest/dex/search?q=solana');
    return pairs
      .map(toSnapshot)
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 12);
  }

  async getNewLaunches(): Promise<TokenSnapshot[]> {
    const pairs = await this.fetchPairs('/latest/dex/search?q=solana');
    const cutoff = Date.now() - 24 * 3_600_000;
    return pairs
      .map(toSnapshot)
      .filter((t) => new Date(t.createdAt).getTime() > cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getVolumeMovers(): Promise<TokenSnapshot[]> {
    return this.getTrending();
  }

  async getWhaleTransfers(_since: Date): Promise<WhaleTransfer[]> {
    return []; // requires an on-chain source (Helius/Birdeye)
  }
}
