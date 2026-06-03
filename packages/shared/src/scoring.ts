import type { SignalBundle, TokenScores, TokenSnapshot } from './types.js';

const clamp = (n: number, min = 0, max = 100): number =>
  Math.max(min, Math.min(max, n));

const ageHours = (createdAtIso: string): number =>
  (Date.now() - new Date(createdAtIso).getTime()) / 3_600_000;

/**
 * Momentum: how strongly the token is moving right now. Blends short-term
 * price change, volume trend and holder growth.
 */
export function momentumScore(s: SignalBundle): number {
  const priceComponent = clamp(50 + s.token.priceChange1h * 1.5 + s.token.priceChange24h * 0.3);
  const volumeComponent = clamp(s.volumeTrend * 18); // 3x trend ≈ 54
  const holderComponent = clamp(50 + s.holderGrowth24h * 2);
  return Math.round(clamp(priceComponent * 0.5 + volumeComponent * 0.3 + holderComponent * 0.2));
}

/**
 * Opportunity: how attractive an entry looks. Rewards early-stage tokens with
 * rising volume/liquidity, social heat and smart-money presence; penalizes
 * tokens that already ran very far.
 */
export function opportunityScore(s: SignalBundle): number {
  const age = ageHours(s.token.createdAt);
  const freshness = clamp(100 - age * 1.2); // newer = more upside
  const liquidity = clamp(Math.log10(Math.max(s.token.liquidityUsd, 1)) * 14);
  const social = clamp(s.socialScore);
  const smart = s.smartMoneyActive ? 100 : 40;
  const overextended = clamp(100 - Math.max(0, s.token.priceChange24h - 150) * 0.3);
  return Math.round(
    clamp(
      freshness * 0.25 +
        liquidity * 0.2 +
        social * 0.2 +
        smart * 0.2 +
        overextended * 0.15,
    ),
  );
}

/**
 * Risk: higher = riskier. Driven by thin liquidity, extreme youth, low holder
 * counts and parabolic moves (rug/dump risk).
 */
export function riskScore(s: SignalBundle): number {
  const age = ageHours(s.token.createdAt);
  const lowLiquidity = clamp(80 - Math.log10(Math.max(s.token.liquidityUsd, 1)) * 14);
  const youth = clamp(70 - age * 1.5);
  const fewHolders = clamp(80 - Math.log10(Math.max(s.token.holders, 1)) * 18);
  const parabolic = clamp(Math.max(0, s.token.priceChange24h - 100) * 0.25);
  const whaleDumpRisk = s.whaleNetUsd < 0 ? clamp(Math.abs(s.whaleNetUsd) / 2000) : 0;
  return Math.round(
    clamp(
      lowLiquidity * 0.3 +
        youth * 0.2 +
        fewHolders * 0.2 +
        parabolic * 0.15 +
        whaleDumpRisk * 0.15,
    ),
  );
}

/**
 * Confidence: how much we trust the above signals. Higher with deeper
 * liquidity, more holders, smart-money confirmation and consistent volume.
 */
export function confidenceScore(s: SignalBundle): number {
  const liquidity = clamp(Math.log10(Math.max(s.token.liquidityUsd, 1)) * 16);
  const holders = clamp(Math.log10(Math.max(s.token.holders, 1)) * 20);
  const smart = s.smartMoneyActive ? 90 : 55;
  const volumeStability = clamp(60 + (s.volumeTrend - 1) * 10);
  return Math.round(clamp(liquidity * 0.3 + holders * 0.3 + smart * 0.2 + volumeStability * 0.2));
}

export function scoreToken(s: SignalBundle): TokenScores {
  return {
    momentum: momentumScore(s),
    opportunity: opportunityScore(s),
    risk: riskScore(s),
    confidence: confidenceScore(s),
  };
}

/** Convenience: profit percentage of a position relative to its entry. */
export function profitPct(entry: number, current: number): number {
  if (entry <= 0) return 0;
  return ((current - entry) / entry) * 100;
}

/** Build a default signal bundle from a snapshot with neutral derived signals. */
export function neutralSignals(token: TokenSnapshot): SignalBundle {
  return {
    token,
    volumeTrend: 1,
    liquidityTrend: 1,
    socialScore: 50,
    whaleNetUsd: 0,
    smartMoneyActive: false,
    holderGrowth24h: 0,
  };
}
