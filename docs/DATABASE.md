# MemeForge — Database Schema

PostgreSQL via Prisma. Canonical source: `apps/api/prisma/schema.prisma`.

## Entity map

```
User ─┬─< Session
      ├─< OtpCode
      ├─< OAuthAccount
      ├─< NotificationPref (1:1)
      ├─< PushSubscription
      ├─< Notification
      ├─< Wallet ─┬─< Position ─┬─< Trade
      │           │             └─< AutoSellRule
      │           │             └─< TrailingStop
      │           └─< ReserveLedger
      ├─< Alert ─< AlertEvent
      ├─< WatchlistItem
      ├─< JournalEntry
      └─< AiReport

Token ─┬─< Position
       ├─< PriceCandle
       ├─< WhaleTransfer
       ├─< DiscoveryScan
       └─< RiskAssessment

WhaleWallet ─< WhaleTransfer
SmartWallet ─< SmartTrade
```

## Tables

### Identity & access
| Table | Purpose |
|-------|---------|
| `User` | Single-owner account model with `role` (OWNER/ADMIN/VIEWER) |
| `Session` | Refresh-token sessions (rotating, revocable) |
| `OtpCode` | Email OTP login codes (hashed, single-use, TTL) |
| `OAuthAccount` | Linked Google/Discord identities |

### Notifications
| Table | Purpose |
|-------|---------|
| `NotificationPref` | Per-channel toggles + alert thresholds |
| `PushSubscription` | Web-push (VAPID) endpoints |
| `Notification` | In-app notification feed (read/unread) |

### Portfolio
| Table | Purpose |
|-------|---------|
| `Wallet` | A tracked wallet (chain address + label) |
| `Token` | Canonical token metadata + latest market snapshot |
| `Position` | Open/closed holdings with entry, size, realized/unrealized PnL, peak price |
| `Trade` | Individual buy/sell executions (audit trail) |
| `ReserveLedger` | Profit-lock reserve movements (deposits only; withdrawal is manual) |

### Automation
| Table | Purpose |
|-------|---------|
| `AutoSellRule` | Laddered take-profit rules (`triggerPct → sellPct`) |
| `TrailingStop` | Peak-tracking stop config + state |
| `ProfitLockConfig` | EOD realized-profit sweep percentage |

### Market intelligence
| Table | Purpose |
|-------|---------|
| `PriceCandle` | OHLCV history per token |
| `Alert` | User-defined alert rules |
| `AlertEvent` | Fired alert instances |
| `DiscoveryScan` | Scored discovery results (momentum/opportunity/risk/confidence) |
| `WhaleWallet` / `WhaleTransfer` | Tracked whales + their detected transfers |
| `SmartWallet` / `SmartTrade` | Smart-money wallets + their trades + ROI |
| `RiskAssessment` | Per-token risk score + warnings |
| `WatchlistItem` | Saved tokens grouped by section |
| `JournalEntry` | Trade journal (reasons, lessons, screenshots) |
| `AiReport` | Generated AI reports (daily/weekly/market/risk/opportunity) |

## Key enums

- `Role`: `OWNER | ADMIN | VIEWER`
- `PositionStatus`: `OPEN | CLOSED`
- `TradeSide`: `BUY | SELL`
- `TradeSource`: `MANUAL | AUTO_SELL | TRAILING_STOP`
- `AlertType`: `PRICE_UP | PRICE_DOWN | VOLUME_SPIKE | LIQUIDITY_SPIKE | WHALE_BUY | WHALE_SELL | RISK`
- `NotificationChannel`: `IN_APP | EMAIL | DISCORD | TELEGRAM | PUSH`
- `ReportType`: `DAILY | WEEKLY | MARKET | RISK | OPPORTUNITY`
- `WatchlistSection`: `FAVORITES | TRENDING | NEW_LAUNCHES | VOLUME_MOVERS | WHALE_ACTIVITY | SMART_MONEY`

See the Prisma schema for full field definitions, indexes and relations.
