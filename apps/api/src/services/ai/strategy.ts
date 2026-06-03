import type { AiReportPayload, ReportType, SignalBundle } from '@memeforge/shared';

export interface BrainContext {
  portfolioValueUsd: number;
  dailyPnlUsd: number;
  totalPnlUsd: number;
  openPositions: number;
  bestPerformer?: { symbol: string; pct: number };
  worstPerformer?: { symbol: string; pct: number };
  topOpportunities: Array<{ symbol: string; opportunity: number; risk: number }>;
  whaleActivity: Array<{ symbol: string; side: string; amountUsd: number }>;
  riskFlags: Array<{ symbol: string; level: string; message: string }>;
}

export interface AiStrategy {
  readonly name: string;
  generateReport(type: ReportType, ctx: BrainContext): Promise<AiReportPayload>;
  explainMove(direction: 'up' | 'down', signals: SignalBundle): Promise<string[]>;
}
