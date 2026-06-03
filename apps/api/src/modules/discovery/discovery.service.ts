import {
  scoreToken,
  type SignalBundle,
  type TokenScores,
  type TokenSnapshot,
} from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { marketProvider } from '../../services/market/index.js';
import { upsertToken } from '../../services/token.repo.js';
import { realtime } from '../../realtime/hub.js';
import { assessRisk } from '../risk/risk.service.js';

/** Derive a signal bundle from a snapshot using available heuristics. */
export function deriveSignals(snap: TokenSnapshot, whaleNetUsd = 0, smartMoneyActive = false): SignalBundle {
  return {
    token: snap,
    volumeTrend: snap.liquidityUsd > 0 ? Math.min(8, snap.volume24h / Math.max(snap.liquidityUsd, 1)) : 1,
    liquidityTrend: 1,
    socialScore: Math.min(100, 40 + Math.max(0, snap.priceChange24h) * 0.3),
    whaleNetUsd,
    smartMoneyActive,
    holderGrowth24h: Math.max(0, snap.priceChange24h * 0.05),
  };
}

export interface ScoredToken extends TokenSnapshot {
  scores: TokenScores;
  risk: { score: number; level: string };
  reason: string;
}

function buildReason(snap: TokenSnapshot, scores: TokenScores): string {
  const bits: string[] = [];
  if (scores.momentum >= 70) bits.push('strong momentum');
  if (snap.priceChange24h > 50) bits.push(`+${snap.priceChange24h.toFixed(0)}% 24h`);
  const ageH = (Date.now() - new Date(snap.createdAt).getTime()) / 3_600_000;
  if (ageH < 24) bits.push('fresh launch');
  if (scores.opportunity >= 70) bits.push('high opportunity');
  if (scores.risk >= 70) bits.push('elevated risk');
  if (scores.confidence >= 70) bits.push('high confidence');
  return bits.length ? bits.join(', ') : 'tracking';
}

export function scoreSnapshot(snap: TokenSnapshot, signals?: SignalBundle): ScoredToken {
  const sig = signals ?? deriveSignals(snap);
  const scores = scoreToken(sig);
  const risk = assessRisk(snap, sig);
  return { ...snap, scores, risk: { score: risk.score, level: risk.level }, reason: buildReason(snap, scores) };
}

/**
 * Run a discovery scan: pull new launches, trending and volume movers, score
 * them all, persist scans + risk assessments, and emit a realtime update.
 */
export async function runDiscoveryScan(): Promise<ScoredToken[]> {
  const [launches, trending, movers] = await Promise.all([
    marketProvider.getNewLaunches(),
    marketProvider.getTrending(),
    marketProvider.getVolumeMovers(),
  ]);

  const byAddress = new Map<string, TokenSnapshot>();
  for (const s of [...launches, ...trending, ...movers]) byAddress.set(s.address, s);

  const scored: ScoredToken[] = [];
  for (const snap of byAddress.values()) {
    const result = scoreSnapshot(snap);
    scored.push(result);
    const token = await upsertToken(snap);
    await prisma.discoveryScan.create({
      data: {
        tokenId: token.id,
        momentumScore: result.scores.momentum,
        opportunityScore: result.scores.opportunity,
        riskScore: result.scores.risk,
        confidenceScore: result.scores.confidence,
        reason: result.reason,
      },
    });
  }

  scored.sort((a, b) => b.scores.opportunity - a.scores.opportunity);
  realtime.publish('discovery', { tokens: scored.slice(0, 20) });
  logger.debug({ count: scored.length }, 'Discovery scan complete');
  return scored;
}

/** Latest scored discovery snapshot (computed live). */
export async function getDiscovery(limit = 30): Promise<ScoredToken[]> {
  const trending = await marketProvider.getTrending();
  const launches = await marketProvider.getNewLaunches();
  const byAddress = new Map<string, TokenSnapshot>();
  for (const s of [...launches, ...trending]) byAddress.set(s.address, s);
  return [...byAddress.values()].map((s) => scoreSnapshot(s)).sort((a, b) => b.scores.opportunity - a.scores.opportunity).slice(0, limit);
}
