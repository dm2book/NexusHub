// Platform-wide constants. These define the default alert ladders, auto-sell
// ladders and profit-lock options described in the product spec.

/** Default upward price-move alert thresholds (percent). */
export const PRICE_UP_THRESHOLDS = [5, 10, 25, 50, 100, 250, 500] as const;

/** Default downward price-move alert thresholds (percent, positive magnitude). */
export const PRICE_DOWN_THRESHOLDS = [5, 10, 20, 30, 50] as const;

/** Default laddered auto-sell rules: at +trigger%, sell sell% of the position. */
export const DEFAULT_AUTO_SELL_LADDER: Array<{ triggerPct: number; sellPct: number }> = [
  { triggerPct: 50, sellPct: 10 },
  { triggerPct: 100, sellPct: 25 },
  { triggerPct: 200, sellPct: 25 },
  { triggerPct: 500, sellPct: 25 },
];

/** Trailing-stop defaults: arm once a position is up `armAtPct`, then sell
 *  `sellPct` if it retraces `dropPct` from its peak. */
export const DEFAULT_TRAILING_STOP = {
  armAtPct: 200,
  dropPct: 15,
  sellPct: 100,
};

/** Profit-lock reserve sweep options (percent of realized daily profit). */
export const PROFIT_LOCK_OPTIONS = [25, 50, 75] as const;

/** Whale classification: a transfer above this USD value is a "whale" move. */
export const WHALE_USD_THRESHOLD = 25_000;

/** Volume spike: current volume vs trailing average multiple. */
export const VOLUME_SPIKE_MULTIPLE = 3;

/** Liquidity spike multiple. */
export const LIQUIDITY_SPIKE_MULTIPLE = 2;

/** Realtime WebSocket channels. */
export const WS_CHANNELS = [
  'portfolio',
  'prices',
  'alerts',
  'whales',
  'discovery',
  'notifications',
] as const;
export type WsChannel = (typeof WS_CHANNELS)[number];

/** Discord alert emojis. */
export const ALERT_EMOJI = {
  up: '🚀',
  down: '📉',
  whaleBuy: '🐋',
  whaleSell: '🐋',
  risk: '⚠️',
  autoSell: '💰',
  trending: '🔥',
} as const;
