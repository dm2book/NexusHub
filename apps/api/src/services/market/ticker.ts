import type { TokenSnapshot } from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { realtime } from '../../realtime/hub.js';
import { marketProvider } from './index.js';
import { mockMarket } from './mockProvider.js';
import { env } from '../../config/env.js';
import { upsertToken } from '../token.repo.js';
import { evaluateAlerts } from '../../modules/alerts/alert.service.js';
import { evaluateAutomation } from '../../modules/automation/automation.service.js';

/**
 * The PriceTicker is the platform's heartbeat. On every interval it:
 *   1. advances the mock market (if using the mock provider)
 *   2. fetches fresh snapshots for all tracked + watched tokens
 *   3. persists the latest state + a price candle
 *   4. emits realtime price diffs
 *   5. feeds the AlertEngine and AutomationEngine
 */
class PriceTicker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(intervalMs = 5000) {
    if (this.timer) return;
    logger.info(`PriceTicker starting (every ${intervalMs}ms)`);
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async trackedAddresses(): Promise<string[]> {
    const [positions, watch] = await Promise.all([
      prisma.position.findMany({ where: { status: 'OPEN' }, select: { token: { select: { address: true } } } }),
      prisma.watchlistItem.findMany({ select: { token: { select: { address: true } } } }),
    ]);
    const set = new Set<string>();
    for (const p of positions) set.add(p.token.address);
    for (const w of watch) set.add(w.token.address);
    return [...set];
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (env.dataProvider === 'mock') mockMarket.tick();

      const tracked = await this.trackedAddresses();
      let snapshots: TokenSnapshot[] = [];

      if (env.dataProvider === 'mock') {
        // Mock provider can return everything cheaply.
        snapshots = await marketProvider.getTrending();
        const extra = await marketProvider.getTokens(tracked);
        const merged = new Map(snapshots.map((s) => [s.address, s]));
        for (const e of extra) merged.set(e.address, e);
        snapshots = [...merged.values()];
      } else if (tracked.length) {
        snapshots = await marketProvider.getTokens(tracked);
      }
      if (snapshots.length === 0) return;

      // Persist latest + candle.
      await Promise.all(
        snapshots.map(async (s) => {
          const token = await upsertToken(s);
          await prisma.priceCandle
            .create({
              data: {
                tokenId: token.id,
                interval: '1m',
                open: s.priceUsd,
                high: s.priceUsd,
                low: s.priceUsd,
                close: s.priceUsd,
                volume: s.volume24h,
                timestamp: new Date(Math.floor(Date.now() / 60_000) * 60_000),
              },
            })
            .catch(() => undefined); // ignore duplicate-per-minute
        }),
      );

      // Emit realtime price diffs.
      realtime.publish(
        'prices',
        snapshots.map((s) => ({
          address: s.address,
          symbol: s.symbol,
          priceUsd: s.priceUsd,
          priceChange24h: s.priceChange24h,
          volume24h: s.volume24h,
        })),
      );

      // Feed downstream engines.
      await evaluateAlerts(snapshots);
      await evaluateAutomation();

      // Push fresh portfolio summaries to connected owners.
      await this.pushPortfolios();
    } catch (err) {
      logger.error({ err }, 'PriceTicker tick failed');
    } finally {
      this.running = false;
    }
  }

  private async pushPortfolios() {
    const users = await prisma.user.findMany({ where: { role: { in: ['OWNER', 'ADMIN'] } }, select: { id: true } });
    const { getSummary } = await import('../../modules/portfolio/portfolio.service.js');
    for (const u of users) {
      try {
        realtime.publish('portfolio', { kind: 'summary', summary: await getSummary(u.id) }, u.id);
      } catch {
        /* ignore */
      }
    }
  }
}

export const priceTicker = new PriceTicker();
