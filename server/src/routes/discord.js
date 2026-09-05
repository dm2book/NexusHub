/** Public Discord community info + the bot's staff digest endpoint. */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { getServerInfo, claimOutbox, ackOutbox, stampBotSeen, setLiveInviteUrl } from '../services/discordService.js';
import { verifyIngest } from '../middleware/ingestSignature.js';
import { affiliateStats } from '../services/affiliateService.js';
import { config } from '../config/env.js';
import { overview, topProducts } from '../services/analyticsService.js';
import { all, get } from '../db/index.js';
import { launchChecks } from '../services/launchCheckService.js';
import { coinBalance } from '../services/forgeCoinService.js';
import { balanceOf } from '../services/walletService.js';
import { loyaltyFor } from '../services/loyaltyService.js';
import { getOrderByNumber, setOrderPayLink } from '../services/orderService.js';
import { getSetting, setSetting } from '../services/settingsService.js';

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

// The bot reports back which events it actually delivered. Anything it does not
// acknowledge stays queued and is offered again once the lease expires, so a
// failed send costs a retry instead of the event.
export const canonicalAck = (body) =>
  `ack:${[...new Set((body?.ids || []).map(String))].sort().join(',')}`;
router.post('/outbox/ack',
  verifyIngest(canonicalAck)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    res.json({ acked: await ackOutbox(req.body?.ids || []) });
  }));

/**
 * Where the bot keeps what it cannot afford to lose.
 *
 * The bot persisted XP, running giveaways and its weekly-leaderboard bookkeeping
 * to JSON files next to its own source — and the comments next to those writes
 * say "so it survives a restart". It survives a process restart. It does not
 * survive a DEPLOY: the documented target is Railway (see discord/railway.json),
 * where the container filesystem is the build image and every push replaces it.
 *
 * So every code change silently reset every member's level, desynced the level
 * roles that were granted from it, and dropped every running giveaway on the
 * floor — entrants had entered something that no longer existed and no prize was
 * ever drawn.
 *
 * This is the store the shop already has, reached over the channel the bot
 * already uses, on the table the settings service already owns. The key is
 * bound into the signature, so a captured write cannot be replayed against a
 * different key.
 */
const STATE_PREFIX = 'discord_bot_state:';
// Named keys only. Without this an attacker who ever saw one signed request
// could not forge another, but a bug in the bot could still scribble over
// `category_logos` or any other setting sharing this table.
const STATE_KEYS = new Set(['xp', 'giveaways', 'meta']);

export const canonicalStateGet = (b = {}) => `state:get:${b.key || ''}`;
router.post('/state/get',
  verifyIngest(canonicalStateGet)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const key = String(req.body?.key || '');
    if (!STATE_KEYS.has(key)) return res.status(400).json({ error: 'unknown state key' });
    res.json({ key, value: await getSetting(STATE_PREFIX + key, null) });
  }));

export const canonicalStateSet = (b = {}) =>
  `state:set:${b.key || ''}:${JSON.stringify(b.value ?? null)}`;
router.post('/state/set',
  verifyIngest(canonicalStateSet)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const key = String(req.body?.key || '');
    if (!STATE_KEYS.has(key)) return res.status(400).json({ error: 'unknown state key' });
    await setSetting(STATE_PREFIX + key, req.body?.value ?? null);
    res.json({ ok: true });
  }));

/**
 * The bot's /paylink command: attach a payment request with the exact amount to
 * one order, from the owner's phone.
 *
 * The owner already confirms every payment by hand and gets a Discord ping the
 * moment an order lands. Making the payment request in the bank app and pasting
 * it back is ten seconds — and it removes the whole class of "typed the wrong
 * amount / forgot the reference" problems.
 *
 * Both the order number and the URL are bound into the signature, so a captured
 * request cannot be replayed against a different order or with a different link.
 */
export const canonicalPayLink = (b = {}) => `paylink:${b.number || ''}:${b.url || ''}`;
router.post('/pay-link',
  verifyIngest(canonicalPayLink)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const number = String(req.body?.number || '').trim().toUpperCase();
    const url = String(req.body?.url || '').trim();
    const order = await getOrderByNumber(number);
    if (!order) return res.status(404).json({ error: `No order ${number}` });
    try {
      const result = await setOrderPayLink(order.id, url, { actorId: 'discord' });
      res.json({ ok: true, number: result.number, total: order.totalFormatted });
    } catch (e) {
      // Bad link or wrong order state — the bot shows this to the owner as-is.
      res.status(400).json({ error: e.message });
    }
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

/**
 * A member's referral code, link and earnings, for /ref in Discord.
 *
 * The affiliate program has existed server-side the whole time — one code per
 * user, ?ref= attribution on arrival, a commission recorded on every paid order
 * the referred customer places — and Discord, which is where this shop's
 * community actually is, had no idea. There was no way to find your own code
 * without opening the site, and nothing ever told you when a referral paid.
 *
 * Same shape as /balance: HMAC-signed with the uid bound into the signature, so
 * a member cannot ask for someone else's earnings. An unlinked member gets
 * {linked:false} rather than an error, because "link your account first" is a
 * useful answer and a 404 is not.
 */
export const canonicalReferral = (b = {}) => `referral:${b.uid || ''}`;
router.post('/referral',
  verifyIngest(canonicalReferral)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const uid = String(req.body?.uid || '').trim();
    const acct = uid
      ? await get(`SELECT user_id FROM oauth_accounts WHERE provider='discord' AND provider_uid=@uid LIMIT 1`, { uid })
      : null;
    if (!acct) return res.json({ linked: false });
    const u = await get('SELECT email FROM users WHERE id=@id', { id: acct.user_id });
    const stats = await affiliateStats(acct.user_id, u?.email || '');
    res.json({
      linked: true,
      code: stats.code,
      url: `${config.appUrl}/?ref=${encodeURIComponent(stats.code)}`,
      commissionPercent: stats.commissionPercent,
      referrals: stats.referrals,
      orders: stats.orders,
      pendingCents: stats.pendingCommission,
      paidCents: stats.paidCommission,
      totalCents: stats.totalCommission,
    });
  }));

// The bot maintains a PERMANENT server invite (maxAge 0) and pushes it here so
// the storefront never shows an expired link. The URL is bound into the HMAC
// signature, and only real Discord invite URLs are accepted.
export const canonicalInvite = (b = {}) => `invite:${b.url || ''}`;
router.post('/invite',
  verifyIngest(canonicalInvite)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!/^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/.test(url)) {
      return res.status(400).json({ error: 'Not a Discord invite URL' });
    }
    await setLiveInviteUrl(url);
    await stampBotSeen();
    res.json({ ok: true });
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
