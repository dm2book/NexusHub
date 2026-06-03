import {
  RiskLevel,
  neutralSignals,
  riskScore,
  type RiskWarning,
  type SignalBundle,
  type TokenSnapshot,
} from '@memeforge/shared';
import { prisma } from '../../lib/prisma.js';

/**
 * RiskEngine — analyzes liquidity, holder concentration, age and price action
 * to produce a 0..100 risk score, a level and human-readable warnings.
 */
export function assessRisk(snap: TokenSnapshot, signals?: SignalBundle): {
  score: number;
  level: RiskLevel;
  warnings: RiskWarning[];
} {
  const s = signals ?? neutralSignals(snap);
  const score = riskScore(s);
  const warnings: RiskWarning[] = [];

  if (snap.liquidityUsd < 20_000) {
    warnings.push({
      code: 'LOW_LIQUIDITY',
      message: `Thin liquidity ($${Math.round(snap.liquidityUsd).toLocaleString()}). Exits may slip badly.`,
      severity: snap.liquidityUsd < 8_000 ? RiskLevel.CRITICAL : RiskLevel.HIGH,
    });
  }
  if (snap.holders < 300) {
    warnings.push({
      code: 'HOLDER_CONCENTRATION',
      message: `Only ${snap.holders} holders — supply likely concentrated in few wallets.`,
      severity: snap.holders < 100 ? RiskLevel.HIGH : RiskLevel.MEDIUM,
    });
  }
  const ageHours = (Date.now() - new Date(snap.createdAt).getTime()) / 3_600_000;
  if (ageHours < 6) {
    warnings.push({
      code: 'VERY_NEW',
      message: `Launched ${ageHours.toFixed(1)}h ago — unproven, elevated rug risk.`,
      severity: ageHours < 1 ? RiskLevel.HIGH : RiskLevel.MEDIUM,
    });
  }
  if (snap.priceChange24h > 200) {
    warnings.push({
      code: 'PARABOLIC',
      message: `Up ${snap.priceChange24h.toFixed(0)}% in 24h — parabolic, high reversal risk.`,
      severity: RiskLevel.MEDIUM,
    });
  }
  if (s.whaleNetUsd < -10_000) {
    warnings.push({
      code: 'WHALE_DISTRIBUTION',
      message: 'Whales are net sellers — distribution in progress.',
      severity: RiskLevel.HIGH,
    });
  }
  if (snap.fdv > 0 && snap.liquidityUsd / snap.fdv < 0.01) {
    warnings.push({
      code: 'LIQ_TO_FDV',
      message: 'Liquidity is tiny relative to FDV — price is fragile.',
      severity: RiskLevel.MEDIUM,
    });
  }

  return { score, level: levelFor(score), warnings };
}

export function levelFor(score: number): RiskLevel {
  if (score >= 80) return RiskLevel.CRITICAL;
  if (score >= 60) return RiskLevel.HIGH;
  if (score >= 35) return RiskLevel.MEDIUM;
  return RiskLevel.LOW;
}

/** Persist a risk assessment for a token. */
export async function persistRisk(tokenId: string, snap: TokenSnapshot, signals?: SignalBundle) {
  const { score, level, warnings } = assessRisk(snap, signals);
  return prisma.riskAssessment.create({
    data: { tokenId, score, level, warnings: warnings as object },
  });
}
