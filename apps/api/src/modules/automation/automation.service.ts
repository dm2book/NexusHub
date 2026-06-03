import {
  PositionStatus,
  TradeSource,
  profitPct,
  Role,
} from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { sellPosition } from '../portfolio/portfolio.service.js';
import { notifications } from '../notifications/notification.service.js';
import { realtime } from '../../realtime/hub.js';

/**
 * AutomationEngine — the only producer of automated SELL intents. There is no
 * buy path anywhere in this engine; auto-buy is impossible by construction.
 *
 * It runs three strategies per tick:
 *   1. Auto-sell ladder   (+trigger% → sell sell%)
 *   2. Trailing stop       (arm at +X%, sell on Y% retrace from peak)
 *   3. (Profit lock runs on a daily schedule, see runProfitLock)
 */

interface AutoSellExecution {
  positionId: string;
  symbol: string;
  reason: string;
  sellPct: number;
  pnlUsd: number;
  amountUsd: number;
  source: TradeSource;
}

/** Evaluate all open positions and execute any due sell automation. */
export async function evaluateAutomation(): Promise<AutoSellExecution[]> {
  if (!env.flags.automation) return [];

  const positions = await prisma.position.findMany({
    where: { status: PositionStatus.OPEN },
    include: {
      token: true,
      autoSellRules: { where: { enabled: true, triggeredAt: null } },
      trailingStop: true,
      wallet: { include: { user: true } },
    },
  });

  const executions: AutoSellExecution[] = [];

  for (const p of positions) {
    // Only the OWNER's positions can be auto-managed (defensive guard).
    if (p.wallet.user.role !== Role.OWNER) continue;

    const price = p.token.priceUsd;
    const gain = profitPct(p.entryPriceUsd, price);

    // Keep peak up to date for trailing logic.
    if (price > p.peakPriceUsd) {
      await prisma.position.update({ where: { id: p.id }, data: { peakPriceUsd: price } });
      p.peakPriceUsd = price;
    }

    // ── 1. Auto-sell ladder ──
    for (const rule of p.autoSellRules.sort((a, b) => a.triggerPct - b.triggerPct)) {
      if (gain >= rule.triggerPct) {
        const result = await sellPosition(p.id, {
          sellPct: rule.sellPct,
          source: TradeSource.AUTO_SELL,
          note: `Auto-sell @ +${rule.triggerPct}%`,
        });
        await prisma.autoSellRule.update({ where: { id: rule.id }, data: { triggeredAt: new Date() } });
        if (result) {
          executions.push({
            positionId: p.id,
            symbol: p.token.symbol,
            reason: `+${rule.triggerPct}% trigger`,
            sellPct: rule.sellPct,
            pnlUsd: result.pnlUsd,
            amountUsd: result.amountUsd,
            source: TradeSource.AUTO_SELL,
          });
        }
        break; // one ladder rung per tick
      }
    }

    // ── 2. Trailing stop ──
    const ts = p.trailingStop;
    if (ts?.enabled && !ts.triggeredAt) {
      let armed = ts.armed;
      if (!armed && gain >= ts.armAtPct) {
        armed = true;
        await prisma.trailingStop.update({ where: { id: ts.id }, data: { armed: true } });
      }
      if (armed) {
        const dropFromPeak = ((p.peakPriceUsd - price) / p.peakPriceUsd) * 100;
        if (dropFromPeak >= ts.dropPct) {
          const result = await sellPosition(p.id, {
            sellPct: ts.sellPct,
            source: TradeSource.TRAILING_STOP,
            note: `Trailing stop: -${ts.dropPct}% from peak`,
          });
          await prisma.trailingStop.update({ where: { id: ts.id }, data: { triggeredAt: new Date() } });
          if (result) {
            executions.push({
              positionId: p.id,
              symbol: p.token.symbol,
              reason: `Trailing stop (-${dropFromPeak.toFixed(1)}% from peak)`,
              sellPct: ts.sellPct,
              pnlUsd: result.pnlUsd,
              amountUsd: result.amountUsd,
              source: TradeSource.TRAILING_STOP,
            });
          }
        }
      }
    }
  }

  // Notify on every execution.
  for (const ex of executions) {
    const userId = await ownerOf(ex.positionId);
    const event = {
      type: 'AUTO_SELL' as const,
      emoji: '💰',
      title: `Auto-sell executed: ${ex.symbol}`,
      body: `${ex.reason} → sold ${ex.sellPct}% for $${ex.amountUsd.toFixed(2)} (PnL $${ex.pnlUsd.toFixed(2)})`,
      meta: { ...ex },
    };
    if (userId) {
      await notifications.dispatch(userId, event);
      realtime.publish('portfolio', { kind: 'auto-sell', execution: ex }, userId);
    }
  }

  if (executions.length) logger.info({ count: executions.length }, 'Automation executed sells');
  return executions;
}

async function ownerOf(positionId: string): Promise<string | null> {
  const p = await prisma.position.findUnique({
    where: { id: positionId },
    select: { wallet: { select: { userId: true } } },
  });
  return p?.wallet.userId ?? null;
}

/**
 * Profit lock — at end of day, sweep a configurable percentage of the day's
 * realized profit into the Reserve ledger. This NEVER withdraws funds; it only
 * records a reserve allocation. Withdrawals remain manual.
 */
export async function runProfitLock(): Promise<void> {
  if (!env.flags.automation) return;
  const configs = await prisma.profitLockConfig.findMany({ where: { enabled: true }, include: { user: true } });
  const since = new Date(Date.now() - 24 * 3_600_000);

  for (const cfg of configs) {
    const wallets = await prisma.wallet.findMany({ where: { userId: cfg.userId } });
    for (const wallet of wallets) {
      const dayTrades = await prisma.trade.findMany({
        where: { side: 'SELL', position: { walletId: wallet.id }, createdAt: { gte: since } },
      });
      const realized = dayTrades.reduce((s, t) => s + t.pnlUsd, 0);
      if (realized <= 0) continue;
      const sweep = (realized * cfg.sweepPct) / 100;
      await prisma.reserveLedger.create({
        data: {
          walletId: wallet.id,
          amountUsd: sweep,
          reason: `Daily profit lock (${cfg.sweepPct}% of $${realized.toFixed(2)} realized)`,
        },
      });
      await notifications.dispatch(cfg.userId, {
        type: 'SYSTEM',
        emoji: '🔒',
        title: 'Profit locked to reserve',
        body: `Moved $${sweep.toFixed(2)} (${cfg.sweepPct}% of $${realized.toFixed(2)} realized today) into reserve. Withdrawals remain manual.`,
      });
    }
  }
}
