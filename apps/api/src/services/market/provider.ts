import type { TokenSnapshot, WhaleTransfer } from '@memeforge/shared';

/**
 * The single interface every market data source implements. Swap providers via
 * the DATA_PROVIDER env var without touching the rest of the platform.
 */
export interface MarketProvider {
  readonly name: string;
  getToken(address: string): Promise<TokenSnapshot | null>;
  getTokens(addresses: string[]): Promise<TokenSnapshot[]>;
  getTrending(): Promise<TokenSnapshot[]>;
  getNewLaunches(): Promise<TokenSnapshot[]>;
  getVolumeMovers(): Promise<TokenSnapshot[]>;
  getWhaleTransfers(since: Date): Promise<WhaleTransfer[]>;
}
