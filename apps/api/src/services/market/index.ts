import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import type { MarketProvider } from './provider.js';
import { MockProvider } from './mockProvider.js';
import { DexScreenerProvider } from './dexscreenerProvider.js';
import { BirdeyeProvider } from './birdeyeProvider.js';

function build(): MarketProvider {
  switch (env.dataProvider) {
    case 'birdeye':
      if (env.birdeyeApiKey) return new BirdeyeProvider();
      logger.warn('DATA_PROVIDER=birdeye but BIRDEYE_API_KEY is empty — using mock');
      return new MockProvider();
    case 'dexscreener':
      return new DexScreenerProvider();
    case 'mock':
    default:
      return new MockProvider();
  }
}

export const marketProvider: MarketProvider = build();
logger.info(`Market provider: ${marketProvider.name}`);

export type { MarketProvider } from './provider.js';
