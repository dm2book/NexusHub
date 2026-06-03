// Cross-cutting enums mirrored from the Prisma schema so the web/bot can use
// them without importing the Prisma client.

export enum Role {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  VIEWER = 'VIEWER',
}

export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum TradeSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum TradeSource {
  MANUAL = 'MANUAL',
  AUTO_SELL = 'AUTO_SELL',
  TRAILING_STOP = 'TRAILING_STOP',
}

export enum AlertType {
  PRICE_UP = 'PRICE_UP',
  PRICE_DOWN = 'PRICE_DOWN',
  VOLUME_SPIKE = 'VOLUME_SPIKE',
  LIQUIDITY_SPIKE = 'LIQUIDITY_SPIKE',
  WHALE_BUY = 'WHALE_BUY',
  WHALE_SELL = 'WHALE_SELL',
  RISK = 'RISK',
}

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
  DISCORD = 'DISCORD',
  TELEGRAM = 'TELEGRAM',
  PUSH = 'PUSH',
}

export enum ReportType {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MARKET = 'MARKET',
  RISK = 'RISK',
  OPPORTUNITY = 'OPPORTUNITY',
}

export enum WatchlistSection {
  FAVORITES = 'FAVORITES',
  TRENDING = 'TRENDING',
  NEW_LAUNCHES = 'NEW_LAUNCHES',
  VOLUME_MOVERS = 'VOLUME_MOVERS',
  WHALE_ACTIVITY = 'WHALE_ACTIVITY',
  SMART_MONEY = 'SMART_MONEY',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}
