import { TradeSide, WHALE_USD_THRESHOLD, type TokenSnapshot, type WhaleTransfer } from '@memeforge/shared';
import { nanoid } from 'nanoid';
import type { MarketProvider } from './provider.js';

/**
 * MockProvider — a self-contained, lively market simulator so the entire
 * platform runs with zero external API keys. Prices follow a geometric
 * Brownian-motion-ish random walk seeded per token, so they move realistically
 * tick-to-tick (and occasionally pump/dump) while staying internally consistent.
 */

interface MockToken {
  snapshot: TokenSnapshot;
  drift: number; // per-tick drift bias
  volatility: number; // per-tick volatility
  base24hPrice: number; // reference for 24h change
}

const SYMBOLS = [
  ['WIF', 'dogwifhat'],
  ['BONK', 'Bonk'],
  ['POPCAT', 'Popcat'],
  ['MEW', 'cat in a dogs world'],
  ['PNUT', 'Peanut the Squirrel'],
  ['GIGA', 'Gigachad'],
  ['MOODENG', 'Moo Deng'],
  ['FWOG', 'Fwog'],
  ['RETARDIO', 'Retardio'],
  ['BODEN', 'Jeo Boden'],
  ['MICHI', 'Michi'],
  ['SLERF', 'Slerf'],
  ['NEIRO', 'Neiro'],
  ['BRETT', 'Brett'],
  ['TURBO', 'Turbo'],
  ['MUMU', 'Mumu the Bull'],
];

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randAddress(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 44; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

class MockMarket {
  private tokens = new Map<string, MockToken>();
  private order: string[] = [];

  constructor() {
    for (const [symbol, name] of SYMBOLS) this.spawn(symbol!, name!, rand(0, 240));
  }

  private spawn(symbol: string, name: string, ageHours: number): MockToken {
    const address = randAddress();
    const price = rand(0.0000005, 0.05);
    const change24h = rand(-40, 220);
    const base24hPrice = price / (1 + change24h / 100);
    const liquidity = rand(8_000, 2_500_000);
    const snapshot: TokenSnapshot = {
      address,
      chain: 'solana',
      symbol,
      name,
      priceUsd: price,
      priceChange1h: rand(-15, 25),
      priceChange24h: change24h,
      volume24h: liquidity * rand(0.5, 8),
      liquidityUsd: liquidity,
      marketCap: price * rand(1e8, 1e10),
      fdv: price * rand(1e9, 5e10),
      holders: Math.floor(rand(120, 45_000)),
      createdAt: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
    };
    const t: MockToken = {
      snapshot,
      drift: rand(-0.002, 0.004),
      volatility: rand(0.01, 0.06),
      base24hPrice,
    };
    this.tokens.set(address, t);
    this.order.push(address);
    return t;
  }

  /** Advance every token one step. Called by the ticker. */
  tick(): void {
    for (const t of this.tokens.values()) {
      // Occasional regime shifts (pumps / dumps).
      if (Math.random() < 0.01) t.drift = rand(-0.02, 0.03);
      const shock = t.drift + t.volatility * (Math.random() * 2 - 1);
      t.snapshot.priceUsd = Math.max(1e-9, t.snapshot.priceUsd * (1 + shock));
      t.snapshot.priceChange24h = ((t.snapshot.priceUsd - t.base24hPrice) / t.base24hPrice) * 100;
      t.snapshot.priceChange1h += shock * 100;
      t.snapshot.priceChange1h *= 0.85; // decay toward 0
      t.snapshot.volume24h = Math.max(0, t.snapshot.volume24h * rand(0.97, 1.05));
      t.snapshot.liquidityUsd = Math.max(1000, t.snapshot.liquidityUsd * rand(0.995, 1.006));
      if (Math.random() < 0.2) t.snapshot.holders += Math.floor(rand(-2, 12));
    }
    // Occasionally birth a brand-new launch.
    if (Math.random() < 0.05 && this.tokens.size < 60) {
      const [symbol, name] = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]!;
      this.spawn(`${symbol}${Math.floor(rand(2, 99))}`, name!, rand(0, 2));
    }
  }

  all(): TokenSnapshot[] {
    return this.order.map((a) => structuredClone(this.tokens.get(a)!.snapshot));
  }

  get(address: string): TokenSnapshot | null {
    const t = this.tokens.get(address);
    return t ? structuredClone(t.snapshot) : null;
  }
}

// Singleton sim shared by the ticker and the provider.
export const mockMarket = new MockMarket();

export class MockProvider implements MarketProvider {
  readonly name = 'mock';

  async getToken(address: string): Promise<TokenSnapshot | null> {
    return mockMarket.get(address);
  }

  async getTokens(addresses: string[]): Promise<TokenSnapshot[]> {
    return addresses.map((a) => mockMarket.get(a)).filter((t): t is TokenSnapshot => !!t);
  }

  async getTrending(): Promise<TokenSnapshot[]> {
    return mockMarket
      .all()
      .sort((a, b) => b.volume24h * (1 + b.priceChange24h / 100) - a.volume24h * (1 + a.priceChange24h / 100))
      .slice(0, 12);
  }

  async getNewLaunches(): Promise<TokenSnapshot[]> {
    const cutoff = Date.now() - 24 * 3_600_000;
    return mockMarket
      .all()
      .filter((t) => new Date(t.createdAt).getTime() > cutoff)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getVolumeMovers(): Promise<TokenSnapshot[]> {
    return mockMarket.all().sort((a, b) => b.volume24h - a.volume24h).slice(0, 12);
  }

  async getWhaleTransfers(_since: Date): Promise<WhaleTransfer[]> {
    const transfers: WhaleTransfer[] = [];
    for (const token of mockMarket.all()) {
      // Randomly emit whale moves proportional to liquidity.
      if (Math.random() < 0.06) {
        const side = Math.random() < 0.5 ? TradeSide.BUY : TradeSide.SELL;
        const amountUsd = rand(WHALE_USD_THRESHOLD, WHALE_USD_THRESHOLD * 20);
        transfers.push({
          txHash: nanoid(32),
          walletAddress: randAddress(),
          tokenAddress: token.address,
          side,
          amountUsd,
          amountTokens: amountUsd / token.priceUsd,
          timestamp: new Date().toISOString(),
        });
      }
    }
    return transfers;
  }
}
