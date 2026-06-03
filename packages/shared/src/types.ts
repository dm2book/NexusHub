import type {
  AlertType,
  NotificationChannel,
  PositionStatus,
  ReportType,
  RiskLevel,
  Role,
  TradeSide,
  TradeSource,
  WatchlistSection,
} from './enums.js';

/** A point-in-time market snapshot for a token (provider-normalized). */
export interface TokenSnapshot {
  address: string;
  chain: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  liquidityUsd: number;
  marketCap: number;
  fdv: number;
  holders: number;
  createdAt: string; // ISO — token launch time
  imageUrl?: string;
}

/** A detected large transfer (whale move). */
export interface WhaleTransfer {
  txHash: string;
  walletAddress: string;
  tokenAddress: string;
  side: TradeSide;
  amountUsd: number;
  amountTokens: number;
  timestamp: string;
}

/** The signal bundle the AI brain reasons over. */
export interface SignalBundle {
  token: TokenSnapshot;
  volumeTrend: number; // multiple vs trailing average
  liquidityTrend: number;
  socialScore: number; // 0..100
  whaleNetUsd: number; // positive = accumulation
  smartMoneyActive: boolean;
  holderGrowth24h: number; // percent
}

/** The four canonical scores produced for every discovered token. */
export interface TokenScores {
  momentum: number; // 0..100
  opportunity: number; // 0..100
  risk: number; // 0..100 (higher = riskier)
  confidence: number; // 0..100
}

export interface RiskWarning {
  code: string;
  message: string;
  severity: RiskLevel;
}

export interface PortfolioSummary {
  totalValueUsd: number;
  reserveUsd: number;
  pnl: {
    dailyUsd: number;
    weeklyUsd: number;
    monthlyUsd: number;
    totalUsd: number;
    dailyPct: number;
    weeklyPct: number;
    monthlyPct: number;
    totalPct: number;
  };
  openPositions: number;
  closedPositions: number;
}

export interface PositionView {
  id: string;
  token: TokenSnapshot;
  status: PositionStatus;
  entryPriceUsd: number;
  currentPriceUsd: number;
  sizeTokens: number;
  sizeUsd: number;
  peakPriceUsd: number;
  profitPct: number;
  profitUsd: number;
  realizedUsd: number;
  openedAt: string;
  closedAt?: string;
  timeHeldMs: number;
}

export interface JwtUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** A normalized event the NotificationBus fans out to channels. */
export interface NotificationEvent {
  type: AlertType | 'AUTO_SELL' | 'REPORT' | 'SYSTEM';
  title: string;
  body: string;
  emoji?: string;
  tokenAddress?: string;
  meta?: Record<string, unknown>;
  channels?: NotificationChannel[];
}

export interface AiReportPayload {
  type: ReportType;
  title: string;
  summary: string;
  sections: Array<{ heading: string; body: string; bullets?: string[] }>;
  generatedAt: string;
}

export type {
  AlertType,
  NotificationChannel,
  PositionStatus,
  ReportType,
  RiskLevel,
  Role,
  TradeSide,
  TradeSource,
  WatchlistSection,
};
