/**
 * Public Discord community info + the endpoints the community bot calls.
 *
 * Every POST below is signed by the bot and checked by verifyIngest
 * (middleware/ingestSignature.js). The current bot signs with v2: timestamp,
 * method, path and the whole body, one rule for every endpoint, so what each
 * route reads from req.body is covered without the route saying so.
 *
 * The `canonical…` string next to each route is the OLD signature, kept only
 * for the bot that is still running until it is redeployed (and refused
 * once BOT_LEGACY_SIGNATURES=off). Each covers just the fields its route
 * chose; where a route acts on more than that, the comment says so.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { getServerInfo, claimOutbox, ackOutbox, stampBotSeen, setLiveInviteUrl } from '../services/discordService.js';
import { verifyIngest } from '../middleware/ingestSignature.js';
import { affiliateStats } from '../services/affiliateService.js';
import { config } from '../config/env.js';
import { overview, topProducts } from '../services/analyticsService.js';
import { all, get } from '../db/index.js';
import { launchChecks } from '../services/launchCheckService.js';
import { coinBalance, coinProgress, claimBoosts } from '../services/forgeCoinService.js';
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
// on the hosting side. Reads nothing from the body; it does lease the events
// it hands out, which is why a signature here is good for one poll only.
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
 * already uses, on the table the settings service already owns. Key and value
 * are both inside the signature (old and v2 alike), so a captured write cannot
 * be pointed at a different key or carry a different value — and since a
 * signature works once, it cannot be sent again later to put an older value
 * back either.
 */
const STATE_PREFIX = 'discord_bot_state:';
// Named keys only. Without this an attacker who ever saw one signed request
// could not forge another, but a bug in the bot could still scribble over
// `category_logos` or any other setting sharing this table.
const STATE_KEYS = new Set(['xp', 'giveaways', 'meta']);

/**
 * A copy of the Discord server's shape, sent by the bot.
 *
 * What is worth keeping is the structure, not the chat: the channels, the
 * roles, their order and their permissions overwrites. That is the thing that
 * takes an evening to rebuild after a deletion or a raid, and the thing nobody
 * has written down. Messages are Discord's own and are not this shop's to hold.
 *
 * The old signature covers only the guild id and `takenAt` — not the snapshot,
 * which is the one thing stored (and `takenAt` is not even read). Until
 * BOT_LEGACY_SIGNATURES=off, a request intercepted on its way here could
 * carry any snapshot. v2 covers the snapshot like every other field.
 */
export const canonicalGuildBackup = (b = {}) =>
  `guildbackup:${b.guildId || ''}:${b.takenAt || ''}`;
router.post('/backup',
  verifyIngest(canonicalGuildBackup)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const snapshot = req.body?.snapshot;
    if (!snapshot || typeof snapshot !== 'object') {
      return res.status(400).json({ error: 'no snapshot' });
    }
    const { storeGuildBackup } = await import('../services/backupService.js');
    res.json(await storeGuildBackup(snapshot, { guildId: req.body?.guildId || null }));
  }));

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
 * request cannot be replayed against a different order or with a different link
 * — nor, now that a signature works once, sent again to put back a link the
 * owner had just corrected.
 */
export const canonicalPayLink = (b = {}) => `paylink:${b.number || ''}:${b.url || ''}`;
router.post('/pay-link',
  verifyIngest(canonicalPayLink)(config.discord.paylinkSecret),
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

/**
 * Claim giveaway boosts for the people who entered one draw.
 *
 * The Forge Shop sells "+1 bonus entry in this week's giveaway (claim in
 * Discord)" for 8 coins, and until now that bought nothing — no command, no
 * notification, and a giveaway that stores entrants in a Set, where one extra
 * entry cannot be represented even by a human trying to honour it by hand.
 *
 * The bot calls this as it draws. It consumes at most one boost per entrant and
 * stamps each with the giveaway's message id, which is what makes a retry safe:
 * a bot that reconnects mid-draw and asks again gets back what it already
 * claimed for that giveaway rather than eating a second boost.
 *
 * The giveaway id is bound into the signature, so a captured request cannot be
 * replayed against a different draw.
 *
 * The bot in this repository no longer calls it: its draw gives every entrant
 * one equal chance (discord/src/giveaway.js).
 */
export const canonicalBoosts = (b = {}) =>
  `boosts:${b.giveawayId || ''}:${[...(b.uids || [])].sort().join(',')}`;
router.post('/boosts/claim',
  verifyIngest(canonicalBoosts)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const giveawayId = String(req.body?.giveawayId || '').trim();
    const uids = [...new Set((req.body?.uids || []).map((u) => String(u).trim()).filter(Boolean))]
      .slice(0, 500);
    if (!giveawayId || !uids.length) return res.json({ boosts: {} });

    /* Discord ids are not our user ids. Only entrants who have actually linked
       an account can hold a boost, and the rest are simply absent rather than
       an error — most entrants will not have one. */
    const rows = await all(
      `SELECT provider_uid AS uid, user_id FROM oauth_accounts
        WHERE provider='discord' AND provider_uid = ANY(@uids)`, { uids });
    if (!rows.length) return res.json({ boosts: {} });

    const byUser = Object.fromEntries(rows.map((r) => [r.user_id, r.uid]));
    const claimed = await claimBoosts(rows.map((r) => r.user_id), giveawayId);
    const boosts = {};
    for (const [userId, n] of Object.entries(claimed)) {
      if (byUser[userId] && n > 0) boosts[byUser[userId]] = n;
    }
    res.json({ boosts });
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
    const [progress, credit, loyalty] = await Promise.all([
      coinProgress(acct.user_id), balanceOf(acct.user_id), loyaltyFor(acct.user_id),
    ]);
    res.json({
      linked: true, coins: progress.balance, creditCents: credit,
      tier: loyalty?.tierName || null, spentCents: loyalty?.xp ?? null,
      /* The same answer the account page gets, from the same function — so the
         bot and the website cannot tell a member two different things about how
         far off their next reward is. */
      next: progress.next, boosts: progress.boosts, earned: progress.totals.earned,
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
/* The bot signs the guild id too, so the store can refuse an invite to any
   server but its own — a stranger who added the bot could otherwise point the
   storefront's "Join Discord" at their server. */
export const canonicalInvite = (b = {}) => `invite:${b.url || ''}${b.guildId ? `:${b.guildId}` : ''}`;
router.post('/invite',
  verifyIngest(canonicalInvite)(config.discord.reviewIngestSecret),
  asyncHandler(async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!/^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/.test(url)) {
      return res.status(400).json({ error: 'Not a Discord invite URL' });
    }
    if (config.discord.guildId && String(req.body?.guildId || '') !== config.discord.guildId) {
      return res.status(403).json({ error: 'Invite is not for the configured server' });
    }
    await setLiveInviteUrl(url);
    await stampBotSeen();
    res.json({ ok: true });
  }));

// Staff digest for the bot (/digest, /stock and the weekly Monday post).
// It reads nothing from the body, so the old signature is over the fixed word
// "digest": secret and timestamp, nothing about the request. That much is
// enough here, but it meant one captured signature could fetch the week's
// revenue again and again for five minutes. Now a signature (old or v2) works
// once, and a v2 one names this method and path.
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
