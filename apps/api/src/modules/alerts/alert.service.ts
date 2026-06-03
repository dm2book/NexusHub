import {
  AlertType,
  ALERT_EMOJI,
  PRICE_DOWN_THRESHOLDS,
  PRICE_UP_THRESHOLDS,
  VOLUME_SPIKE_MULTIPLE,
  type TokenSnapshot,
} from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';
import { notifications } from '../notifications/notification.service.js';
import { realtime } from '../../realtime/hub.js';
import { logger } from '../../lib/logger.js';

// Trailing volume averages per token for spike detection (in-memory).
const volumeAvg = new Map<string, number>();

const COOLDOWN_MS = 5 * 60_000;

function withinCooldown(lastFiredAt: Date | null): boolean {
  return Boolean(lastFiredAt && Date.now() - lastFiredAt.getTime() < COOLDOWN_MS);
}

/** Evaluate user-defined + threshold alerts for a batch of fresh snapshots. */
export async function evaluateAlerts(snapshots: TokenSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;
  const byAddress = new Map(snapshots.map((s) => [s.address, s]));

  // Update volume trailing averages + detect spikes.
  for (const s of snapshots) {
    const prev = volumeAvg.get(s.address) ?? s.volume24h;
    const next = prev * 0.9 + s.volume24h * 0.1;
    volumeAvg.set(s.address, next);
  }

  // Pull active alerts whose token we have a snapshot for.
  const tokens = await prisma.token.findMany({
    where: { address: { in: [...byAddress.keys()] } },
    select: { id: true, address: true },
  });
  const tokenIdToAddress = new Map(tokens.map((t) => [t.id, t.address]));

  const alerts = await prisma.alert.findMany({
    where: { enabled: true, OR: [{ tokenId: { in: tokens.map((t) => t.id) } }, { tokenId: null }] },
  });

  for (const alert of alerts) {
    if (withinCooldown(alert.lastFiredAt)) continue;
    const address = alert.tokenId ? tokenIdToAddress.get(alert.tokenId) : undefined;
    const candidates = address ? [byAddress.get(address)!].filter(Boolean) : snapshots;

    for (const snap of candidates) {
      const hit = matchAlert(alert.type as AlertType, alert.threshold, snap, volumeAvg.get(snap.address) ?? snap.volume24h);
      if (!hit) continue;
      await fire(alert.id, alert.userId, alert.type as AlertType, snap, hit);
      if (alert.oneShot) await prisma.alert.update({ where: { id: alert.id }, data: { enabled: false } });
      break;
    }
  }
}

interface AlertHit {
  message: string;
  value: number;
  emoji: string;
}

function matchAlert(
  type: AlertType,
  threshold: number | null,
  snap: TokenSnapshot,
  avgVolume: number,
): AlertHit | null {
  switch (type) {
    case AlertType.PRICE_UP: {
      const t = threshold ?? 0;
      if (snap.priceChange24h >= t) {
        return { message: `${snap.symbol} up ${snap.priceChange24h.toFixed(1)}% (24h)`, value: snap.priceChange24h, emoji: ALERT_EMOJI.up };
      }
      return null;
    }
    case AlertType.PRICE_DOWN: {
      const t = threshold ?? 0;
      if (snap.priceChange24h <= -t) {
        return { message: `${snap.symbol} down ${snap.priceChange24h.toFixed(1)}% (24h)`, value: snap.priceChange24h, emoji: ALERT_EMOJI.down };
      }
      return null;
    }
    case AlertType.VOLUME_SPIKE: {
      const mult = threshold ?? VOLUME_SPIKE_MULTIPLE;
      if (avgVolume > 0 && snap.volume24h / avgVolume >= mult) {
        return { message: `${snap.symbol} volume spike (${(snap.volume24h / avgVolume).toFixed(1)}x avg)`, value: snap.volume24h, emoji: ALERT_EMOJI.trending };
      }
      return null;
    }
    default:
      return null;
  }
}

async function fire(alertId: string, userId: string, type: AlertType, snap: TokenSnapshot, hit: AlertHit) {
  await prisma.alertEvent.create({ data: { alertId, message: hit.message, value: hit.value } });
  await prisma.alert.update({ where: { id: alertId }, data: { lastFiredAt: new Date() } });
  await notifications.dispatch(userId, {
    type,
    emoji: hit.emoji,
    title: hit.message,
    body: `Price $${snap.priceUsd.toPrecision(4)} · Vol $${Math.round(snap.volume24h).toLocaleString()} · Liq $${Math.round(snap.liquidityUsd).toLocaleString()}`,
    tokenAddress: snap.address,
  });
  realtime.publish('alerts', { type, message: hit.message, token: snap }, userId);
  logger.debug({ type, symbol: snap.symbol }, 'Alert fired');
}

/** Fire a whale alert (called by the whale scanner). */
export async function fireWhaleAlert(
  side: 'BUY' | 'SELL',
  snap: TokenSnapshot,
  amountUsd: number,
): Promise<void> {
  const emoji = ALERT_EMOJI.whaleBuy;
  const title = `🐋 Whale ${side.toLowerCase()}: ${snap.symbol}`;
  const body = `$${Math.round(amountUsd).toLocaleString()} ${side === 'BUY' ? 'bought' : 'sold'} at $${snap.priceUsd.toPrecision(4)}`;
  void emoji;
  await notifications.dispatchToOwners({
    type: side === 'BUY' ? AlertType.WHALE_BUY : AlertType.WHALE_SELL,
    emoji: ALERT_EMOJI.whaleBuy,
    title,
    body,
    tokenAddress: snap.address,
  });
  realtime.publish('whales', { side, token: snap, amountUsd });
}
