import { ReportType, type SignalBundle } from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { HeuristicStrategy } from '../../services/ai/heuristicStrategy.js';
import { AnthropicStrategy } from '../../services/ai/anthropicStrategy.js';
import type { AiStrategy, BrainContext } from '../../services/ai/strategy.js';
import { getSummary } from '../portfolio/portfolio.service.js';
import { getDiscovery, deriveSignals } from '../discovery/discovery.service.js';
import { getWhaleFeed, getWhaleNetFlow } from '../whales/whale.service.js';
import { assessRisk } from '../risk/risk.service.js';
import { smartMoneyActiveFor } from '../smartmoney/smartmoney.service.js';
import { marketProvider } from '../../services/market/index.js';
import { notFound } from '../../lib/errors.js';

const strategy: AiStrategy = env.ai.provider === 'anthropic' ? new AnthropicStrategy() : new HeuristicStrategy();

/** Aggregate the full signal context the brain reasons over for a user. */
async function buildContext(userId: string): Promise<BrainContext> {
  const [summary, positions, discovery, whales] = await Promise.all([
    getSummary(userId),
    prisma.position.findMany({ where: { wallet: { userId }, status: 'OPEN' }, include: { token: true } }),
    getDiscovery(10),
    getWhaleFeed(undefined, 10),
  ]);

  const perf = positions
    .map((p) => ({ symbol: p.token.symbol, pct: ((p.token.priceUsd - p.entryPriceUsd) / p.entryPriceUsd) * 100 }))
    .sort((a, b) => b.pct - a.pct);

  const riskFlags = positions
    .flatMap((p) => {
      const r = assessRisk({
        address: p.token.address,
        chain: p.token.chain,
        symbol: p.token.symbol,
        name: p.token.name,
        priceUsd: p.token.priceUsd,
        priceChange1h: p.token.priceChange1h,
        priceChange24h: p.token.priceChange24h,
        volume24h: p.token.volume24h,
        liquidityUsd: p.token.liquidityUsd,
        marketCap: p.token.marketCap,
        fdv: p.token.fdv,
        holders: p.token.holders,
        createdAt: p.token.launchedAt.toISOString(),
      });
      return r.warnings.filter((w) => w.severity === 'HIGH' || w.severity === 'CRITICAL').map((w) => ({ symbol: p.token.symbol, level: w.severity, message: w.message }));
    });

  return {
    portfolioValueUsd: summary.totalValueUsd,
    dailyPnlUsd: summary.pnl.dailyUsd,
    totalPnlUsd: summary.pnl.totalUsd,
    openPositions: summary.openPositions,
    bestPerformer: perf[0],
    worstPerformer: perf[perf.length - 1],
    topOpportunities: discovery.map((d) => ({ symbol: d.symbol, opportunity: d.scores.opportunity, risk: d.scores.risk })),
    whaleActivity: whales.map((w) => ({ symbol: w.token.symbol, side: w.side, amountUsd: w.amountUsd })),
    riskFlags,
  };
}

/** Generate (and persist) an AI report of the given type. */
export async function generateReport(userId: string, type: ReportType) {
  const ctx = await buildContext(userId);
  const payload = await strategy.generateReport(type, ctx);
  const report = await prisma.aiReport.create({
    data: { userId, type, title: payload.title, summary: payload.summary, payload: payload as object },
  });
  return { ...report, payload };
}

export async function listReports(userId: string, type?: ReportType) {
  return prisma.aiReport.findMany({
    where: { userId, ...(type ? { type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
}

/** "Why am I up / down" — explain a token's recent move from live signals. */
export async function explainToken(tokenAddress: string) {
  const snap = await marketProvider.getToken(tokenAddress);
  if (!snap) throw notFound('Token not found');
  const [whaleNet, smartActive] = await Promise.all([
    getWhaleNetFlow(tokenAddress).catch(() => 0),
    smartMoneyActiveFor(tokenAddress).catch(() => false),
  ]);
  const signals: SignalBundle = deriveSignals(snap, whaleNet, smartActive);
  const direction: 'up' | 'down' = snap.priceChange24h >= 0 ? 'up' : 'down';
  const reasons = await strategy.explainMove(direction, signals);
  return {
    token: snap,
    direction,
    changePct: snap.priceChange24h,
    title: direction === 'up' ? `Why is ${snap.symbol} up?` : `Why is ${snap.symbol} down?`,
    reasons,
  };
}
