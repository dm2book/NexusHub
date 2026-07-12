/** Public Discord community info + the bot's staff digest endpoint. */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { getServerInfo, claimOutbox, stampBotSeen } from '../services/discordService.js';
import { verifyIngest } from '../middleware/ingestSignature.js';
import { config } from '../config/env.js';
import { overview, topProducts } from '../services/analyticsService.js';
import { all, get } from '../db/index.js';
import { launchChecks } from '../services/launchCheckService.js';
import { coinBalance } from '../services/forgeCoinService.js';
import { balanceOf } from '../services/walletService.js';
import { loyaltyFor } from '../services/loyaltyService.js';

const router = Router();

router.get('/server', asyncHandler(async (_req, res) => {
  res.json({ server: await getServerInfo() });
}));

// Relay outbox: the bot polls this for queued events (sales pings, drops,
// stock alerts, delivery DMs) so Discord automation needs NO Discord secrets
// on the hosting side. Same HMAC scheme as the digest.
export const canonicalOutbox = () => 'outbox';
router.post('/outbox',
  verifyIngest(canonicalOutbox)(config.discord.reviewIngestSecret),
  asyncHandler(async (_req, res) => {
    const events = await claimOutbox(20);
    await stampBotSeen();
    res.json({ events });
  }));

// Member balance for the bot's /saldo command: given a Discord user id, return
// the linked account's Forge Coins, store credit and loyalty tier. The uid is
// bound into the signature so a request can't be replayed for another member.
export const canonicalBalance = (b = {}) => `balance:${b.uid || ''}`;
router.post('/balance',
  verifyIngest(canonicalBalance)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const uid = String(req.body?.uid || '').trim();
    const acct = uid
      ? await get(`SELECT user_id FROM oauth_accounts WHERE provider='discord' AND provider_uid=@uid LIMIT 1`, { uid })
      : null;
    if (!acct) return res.json({ linked: false });
    const [coins, credit, loyalty] = await Promise.all([
      coinBalance(acct.user_id), balanceOf(acct.user_id), loyaltyFor(acct.user_id),
    ]);
    res.json({
      linked: true, coins, creditCents: credit,
      tier: loyalty?.tierName || null, spentCents: loyalty?.xp ?? null,
    });
  }));

// Staff digest for the bot (/digest, /stock and the weekly Monday post).
// Same HMAC scheme as review ingest; canonical string is the fixed word
// "digest" so the signature still binds to timestamp + secret.
export const canonicalDigest = () => 'digest';
router.post('/digest',
  verifyIngest(canonicalDigest)(config.discord.reviewIngestSecret),
  asyncHandler(async (_req, res) => {
    const [week, top, lowStock, pending, launch] = await Promise.all([
      overview({ days: 7 }),
      topProducts({ days: 7, limit: 5 }),
      // Products low on pre-loaded codes (same threshold as the alerts).
      all(`SELECT p.id, p.name,
                  COUNT(c.id) FILTER (WHERE c.status = 'available') AS available
             FROM products p
             LEFT JOIN product_codes c ON c.product_id = p.id
            WHERE p.active = 1
            GROUP BY p.id, p.name
           HAVING COUNT(c.id) FILTER (WHERE c.status = 'available') < @thr
              AND COUNT(c.id) > 0
            ORDER BY available ASC LIMIT 10`,
          { thr: config.discord.lowStockThreshold }),
      all(`SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'`),
      launchChecks(),
    ]);
    res.json({
      week,                      // revenue/orders/conversion for the last 7 days
      topProducts: top,
      lowStock: lowStock.map((r) => ({ id: r.id, name: r.name, available: Number(r.available) })),
      pendingOrders: Number(pending[0]?.n || 0),
      launch,
    });
  }));

export default router;
