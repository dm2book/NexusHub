import type { TokenSnapshot, WhaleTransfer } from '@memeforge/shared';
import { env } from '../../config/env.js';
import type { MarketProvider } from './provider.js';
import { logger } from '../../lib/logger.js';

/**
 * Real Birdeye adapter (Solana). Requires BIRDEYE_API_KEY. Shaped for the
 * Birdeye public defi endpoints; falls back to empty results on failure.
 */
const BASE = 'https://public-api.birdeye.so';

export class BirdeyeProvider implements MarketProvider {
  readonly name = 'birdeye';

  private headers() {
    return { 'X-API-KEY': env.birdeyeApiKey, 'x-chain': 'solana' } as Record<string, string>;
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${BASE}${path}`, { headers: this.headers() });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: T };
      return json.data ?? null;
    } catch (err) {
      logger.warn({ err, path }, 'Birdeye request failed');
      return null;
    }
  }

  async getToken(address: string): Promise<TokenSnapshot | null> {
    const d = await this.get<Record<string, number | string>>(
      `/defi/token_overview?address=${address}`,
    );
    if (!d) return null;
    return {
      address,
      chain: 'solana',
      symbol: String(d.symbol ?? ''),
      name: String(d.name ?? ''),
      priceUsd: Number(d.price ?? 0),
      priceChange1h: Number(d.priceChange1hPercent ?? 0),
      priceChange24h: Number(d.priceChange24hPercent ?? 0),
      volume24h: Number(d.v24hUSD ?? 0),
      liquidityUsd: Number(d.liquidity ?? 0),
      marketCap: Number(d.mc ?? 0),
      fdv: Number(d.fdv ?? 0),
      holders: Number(d.holder ?? 0),
      createdAt: new Date().toISOString(),
      imageUrl: d.logoURI ? String(d.logoURI) : undefined,
    };
  }

  async getTokens(addresses: string[]): Promise<TokenSnapshot[]> {
    const out = await Promise.all(addresses.map((a) => this.getToken(a)));
    return out.filter((t): t is TokenSnapshot => !!t);
  }

  async getTrending(): Promise<TokenSnapshot[]> {
    const d = await this.get<{ tokens?: Array<Record<string, number | string>> }>(
      '/defi/token_trending?sort_by=volume24hUSD&sort_type=desc&limit=12',
    );
    return (d?.tokens ?? []).map((t) => ({
      address: String(t.address ?? ''),
      chain: 'solana',
      symbol: String(t.symbol ?? ''),
      name: String(t.name ?? ''),
      priceUsd: Number(t.price ?? 0),
      priceChange1h: 0,
      priceChange24h: Number(t.price24hChangePercent ?? 0),
      volume24h: Number(t.volume24hUSD ?? 0),
      liquidityUsd: Number(t.liquidity ?? 0),
      marketCap: Number(t.marketcap ?? 0),
      fdv: Number(t.fdv ?? 0),
      holders: 0,
      createdAt: new Date().toISOString(),
      imageUrl: t.logoURI ? String(t.logoURI) : undefined,
    }));
  }

  async getNewLaunches(): Promise<TokenSnapshot[]> {
    const d = await this.get<Array<Record<string, number | string>>>(
      '/defi/v2/tokens/new_listing?limit=20',
    );
    return (d ?? []).map((t) => ({
      address: String(t.address ?? ''),
      chain: 'solana',
      symbol: String(t.symbol ?? ''),
      name: String(t.name ?? ''),
      priceUsd: 0,
      priceChange1h: 0,
      priceChange24h: 0,
      volume24h: 0,
      liquidityUsd: Number(t.liquidity ?? 0),
      marketCap: 0,
      fdv: 0,
      holders: 0,
      createdAt: new Date(Number(t.liquidityAddedAt ?? Date.now())).toISOString(),
    }));
  }

  async getVolumeMovers(): Promise<TokenSnapshot[]> {
    return this.getTrending();
  }

  async getWhaleTransfers(_since: Date): Promise<WhaleTransfer[]> {
    // Real implementation would page /defi/txs/* and filter by USD size.
    return [];
  }
}
