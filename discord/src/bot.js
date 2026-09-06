/**
 * ForgeMarket community bot — runtime automation.
 *
 * - Greets new members and routes them to verification.
 * - Verify button → grants "Verified Customer" and unlocks the server.
 * - Ticket buttons → private ticket channels, staff routing, transcript on close.
 * - AI assistant in #ask-the-bot and via /ask + /recommend: answers FAQs,
 *   recommends products from the live catalog, asks qualifying questions, and
 *   logs buying intent as leads. Falls back to rule-based FAQ without an API key.
 *
 *   npm run start
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  Client, GatewayIntentBits, Partials, Events, PermissionFlagsBits, ChannelType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageType,
} from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import { FAQ, GAME_ROLES, NOTIFY_ROLES, LEVEL_ROLES, DELIVERY_INFO, CATEGORY_GAME_ROLE,
} from './config.js';
import { orderStatusView } from './orderStatus.js';
import { buildPanels, panelNeedsUpdate } from './panels.js';
import { log, reportEnv, startHealthServer, loginWithRetry } from './runtime.js';
import { scamReason } from './scamGuard.js';

// Delivery explanation for a product category (falls back to a generic one).
const deliveryFor = (category) => DELIVERY_INFO[category] || DELIVERY_INFO.default;

const SELF_ROLES = [...GAME_ROLES, ...NOTIFY_ROLES];
const STAFF_ROLE_NAMES = ['Owner', 'Admin', 'Moderator', 'Support'];
const isStaff = (member) => member?.permissions?.has?.(PermissionFlagsBits.ManageMessages)
  || member?.roles?.cache?.some((r) => STAFF_ROLE_NAMES.includes(r.name));

/**
 * A narrower gate than isStaff, for the commands that expose money or reach the
 * whole server.
 *
 * The first person given the Support role will be a friend helping with tickets.
 * isStaff() also let them read weekly revenue and margins, publish discount
 * codes and announce to everyone — none of which answering a ticket requires.
 */
const isOwnerLevel = (member) => member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)
  || member?.roles?.cache?.some((r) => ['Owner', 'Admin'].includes(r.name));
const OWNER_ONLY = { content: 'That one is owner/admin only.', ephemeral: true };

// A support ticket, detected reliably by its topic (which survives the channel
// being renamed to "✋-…" when staff claims it) — falling back to the name
// prefix for the brief moment before the topic is cached. Used to exempt
// tickets from auto-moderation and XP so a private support chat is never
// policed or gamified.
const isTicketChannel = (ch) =>
  ch?.topic?.startsWith('ticket-owner:') || /(^|-)ticket-/.test(ch?.name || '');

/**
 * Durable state for the things a restart must not erase.
 *
 * These used to be JSON files next to this source, and the comments said "so it
 * survives a restart". They survive a process restart. They do not survive a
 * DEPLOY: the target is Railway (discord/railway.json), where the container
 * filesystem is the build image and every push replaces it. So every code
 * change silently reset every member's level, desynced the level roles granted
 * from it, and dropped every running giveaway — entrants had entered something
 * that no longer existed and no prize was ever drawn.
 *
 * The store keeps it now, over the signed channel this bot already uses. The
 * local file stays as the fallback: a bot pointed at no site still works, and a
 * site that is briefly unreachable costs nothing, because the file is written
 * too and read when the store has nothing to say.
 */
async function stateGet(key, file) {
  if (FORGEMARKET_API_URL && REVIEW_INGEST_SECRET) {
    try {
      const ts = String(Date.now());
      const signature = createHmac('sha256', REVIEW_INGEST_SECRET)
        .update(`${ts}.state:get:${key}`).digest('hex');
      const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/discord/state/get`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signature },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        const { value } = await res.json();
        if (value !== null && value !== undefined) return value;
      } else if (res.status !== 404) {
        console.error(`[state] get ${key}: ${res.status}`);
      }
    } catch (e) { console.error(`[state] get ${key} failed:`, e.message); }
  }
  // Nothing stored yet (or no store at all) — fall back to the file, which is
  // also how an existing bot's state migrates on its first boot after this.
  try { if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')); } catch { /* ignore */ }
  return null;
}

async function stateSet(key, value, file) {
  // The file first: it is instant, and it is what makes a site outage free.
  try { if (file) writeFileSync(file, JSON.stringify(value)); } catch { /* ignore */ }
  if (!FORGEMARKET_API_URL || !REVIEW_INGEST_SECRET) return;
  try {
    const ts = String(Date.now());
    const signature = createHmac('sha256', REVIEW_INGEST_SECRET)
      .update(`${ts}.state:set:${key}:${JSON.stringify(value ?? null)}`).digest('hex');
    const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/discord/state/set`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signature },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok && res.status !== 404) console.error(`[state] set ${key}: ${res.status}`);
  } catch (e) { console.error(`[state] set ${key} failed:`, e.message); }
}

// Giveaway store — persisted to giveaways.json so active giveaways (and their
// entries) survive a bot restart; timers are re-armed on boot.
const GIVEAWAYS = new Map(); // messageId -> { prize, entries:Set, endsAt, channelId, msgId, winnersCount, hostId, guildId }
const ENDED = new Map();     // messageId -> { prize, entries:[], channelId }  (kept ~1h for /reroll)
const GW_FILE = new URL('../giveaways.json', import.meta.url);
let gwSaveTimer = null;
function saveGiveaways() {
  clearTimeout(gwSaveTimer);
  gwSaveTimer = setTimeout(() => {
    try {
      const data = [...GIVEAWAYS.entries()].map(([id, g]) => ({ ...g, msgId: id, entries: [...g.entries] }));
      stateSet('giveaways', data, GW_FILE);
    } catch { /* ignore */ }
  }, 1500);
}
async function restoreGiveaways(c) {
  const data = (await stateGet('giveaways', GW_FILE)) || [];
  if (!Array.isArray(data)) return;
  for (const g of data) {
    const guild = c.guilds.cache.get(g.guildId) || c.guilds.cache.first();
    if (!guild) continue;
    GIVEAWAYS.set(g.msgId, { ...g, entries: new Set(g.entries || []) });
    const msLeft = Math.max(0, (g.endsAt || 0) - Date.now());
    const ch = guild.channels.cache.get(g.channelId);
    const finish = async () => {
      const msg = await ch?.messages?.fetch(g.msgId).catch(() => null);
      endGiveaway(guild, g.msgId, msg);
    };
    if (msLeft === 0) finish();               // ended while offline → resolve now
    // Cap re-armed timers below the 32-bit overflow (~24.8 days) — a longer
    // wait is re-armed again on the next restart, never fired early.
    else setTimeout(finish, Math.min(msLeft, 20160 * 60_000));
    console.log(`[giveaway] restored "${g.prize}" (${Math.round(msLeft / 60000)} min left, ${(g.entries || []).length} entries)`);
  }
}

// ── Leveling / XP (persisted to xp.json so it survives restarts) ─────────────
const XP_FILE = new URL('../xp.json', import.meta.url);
let XP = {};
/* Loaded on ready rather than at import: the store is a network call, and a
   module that awaits one at import time delays the login it is racing. Until it
   lands XP is empty, which costs at most the first few seconds of chat — and
   loses nothing, because the merge below never drops a stored score. */
async function loadXP() {
  const stored = await stateGet('xp', XP_FILE);
  if (!stored || typeof stored !== 'object') return;
  // Anything earned in those first seconds is kept: the higher of the two wins,
  // so a boot-time race cannot roll somebody's level backwards.
  for (const [uid, rec] of Object.entries(stored)) {
    const live = XP[uid];
    XP[uid] = !live || (rec?.xp || 0) >= (live.xp || 0) ? rec : live;
  }
}
/* Two cadences, because they cost different things.
   The file is local and instant, so it can be written on every lull in the
   conversation. The store is a signed HTTP round trip carrying the WHOLE map —
   on a busy server a four-second debounce would mean posting every member's
   score again and again, all day. A minute is often enough: the only thing at
   risk in between is a minute of chat XP, and the flush on shutdown below
   covers the one moment that actually erases things. */
let xpFileTimer = null;
let xpStoreAt = 0;
function saveXP() {
  clearTimeout(xpFileTimer);
  xpFileTimer = setTimeout(() => {
    try { writeFileSync(XP_FILE, JSON.stringify(XP)); } catch { /* ignore */ }
    if (Date.now() - xpStoreAt > 60_000) { xpStoreAt = Date.now(); stateSet('xp', XP, null); }
  }, 4000);
}
const levelFor = (xp) => Math.floor(0.18 * Math.sqrt(xp));
const xpForLevel = (lvl) => Math.ceil((lvl / 0.18) ** 2);
const xpCooldown = new Map();

// Anti-scam detection lives in its own module so it can be tested without a
// Discord token — see discord/test/scam-guard.test.mjs.
const SCAM_HOST_BASE = (() => {
  try { return new URL(STORE_URL).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return 'forgemarket.nl'; }
})();
const scamReasonFor = (content, { mentionCount = 0, mentionsEveryone = false } = {}) =>
  scamReason(content, { storeHost: SCAM_HOST_BASE, mentionCount, mentionsEveryone });

const {
  DISCORD_TOKEN, ANTHROPIC_API_KEY, AI_MODEL = 'claude-sonnet-4-6',
  REVIEW_INGEST_SECRET = '',
} = process.env;
// URL envs, hardened: an EMPTY value in .env (`STORE_URL=`) must fall back to
// the default just like a missing one, and a bare domain gets https:// added.
const cleanUrl = (v, fallback = '') => {
  let u = String(v || '').trim() || fallback;
  if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '');
};
const STORE_URL = cleanUrl(process.env.STORE_URL, 'https://forgemarket.nl');
// The store and its API live on the same domain, so default the API URL to the
// store URL — /order, /digest and the live price list then work out of the box.
const FORGEMARKET_API_URL = cleanUrl(process.env.FORGEMARKET_API_URL, STORE_URL);
// Public Trustpilot profile. No default on purpose: an unset value must mean
// "we have no profile yet" everywhere, so the bot stays silent about it rather
// than sending a buyer who went to check the reviews to a 404.
const TRUSTPILOT_URL = cleanUrl(process.env.TRUSTPILOT_URL, '');
/**
 * Where to send someone we are ASKING for a review, as opposed to someone
 * going to read them. Trustpilot spells that /evaluate/ instead of /review/,
 * and every click between the ask and the box costs reviews.
 *
 * Derived from the profile so the owner fills in one variable, not two nearly
 * identical ones. Anything we do not recognise falls through to the profile,
 * which always carries a "Write a review" button — a longer route beats a
 * broken one. Mirrors trustpilotWriteUrl() in the server's config.
 */
const TRUSTPILOT_REVIEW_URL = cleanUrl(process.env.TRUSTPILOT_REVIEW_URL, '') || (() => {
  if (!TRUSTPILOT_URL) return '';
  try {
    const u = new URL(TRUSTPILOT_URL);
    if (!/(^|\.)trustpilot\.com$/i.test(u.hostname) || !/^\/review\//i.test(u.pathname)) return TRUSTPILOT_URL;
    u.pathname = u.pathname.replace(/^\/review\//i, '/evaluate/');
    return u.toString().replace(/\/+$/, '');
  } catch { return TRUSTPILOT_URL; }
})();

// Push a /vouch to the website so it appears on the storefront reviews section.
// Signed with HMAC-SHA256 (x-timestamp + x-signature) so the API can verify
// authenticity and reject replays — must match the server's canonicalReview().
async function pushReviewToSite({ author, avatarUrl, stars, body, externalId, discordUid }) {
  if (!FORGEMARKET_API_URL || !REVIEW_INGEST_SECRET) return;
  try {
    const payload = { author, avatarUrl, stars, body, externalId, ...(discordUid ? { discordUid } : {}) };
    const ts = String(Date.now());
    // NUL separator — must byte-match the server's canonicalReview() exactly,
    // or the HMAC never verifies and vouches fall back to the legacy header.
    //
    // The Discord id is appended ONLY when present, matching the server: that
    // keeps this compatible both ways during a rollout, and it puts the id that
    // decides who gets the reviewer role inside the signature rather than
    // beside it.
    const parts = [author, stars ?? 5, body, externalId || ''];
    if (discordUid) parts.push(String(discordUid));
    const canonical = parts.join('\u0000');
    const signature = createHmac('sha256', REVIEW_INGEST_SECRET).update(`${ts}.${canonical}`).digest('hex');
    await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/reviews/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-timestamp': ts,
        'x-signature': signature,
        // Signed path only — never send the raw shared secret over the wire.
      },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.error('[review->site]', e?.message || e); }
}

/**
 * Is the shop open for business yet, and what should a button therefore say?
 *
 * Every link the bot posts pointed at the shop and said "Buy now" or "Open the
 * shop". Before launch that is a promise the site refuses to keep: the
 * catalogue is browsable on purpose, but the checkout is closed, so a member
 * who followed the call to action arrived somewhere that would not sell to
 * them. A dead end at the end of the funnel is worse than no funnel.
 *
 * The store already publishes the launch MOMENT on /api/config (launchAt) —
 * unsigned, edge-cached, and the same value the storefront banner counts down
 * to. Read it here so both sides say the same thing on the same day, without
 * anyone editing the bot on the 24th.
 *
 * Unreachable store, or no launch date set? Then the shop is open — that is the
 * post-launch state and the default the site itself uses, and being wrong in
 * that direction shows a working shop rather than hiding one.
 */
let launchCache = { at: 0, openAt: null };
async function shopOpensAt() {
  if (Date.now() - launchCache.at < 300_000) return launchCache.openAt;
  let openAt = null;
  try {
    const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/config`,
      { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const cfg = await res.json();
      const t = cfg?.launchAt ? Date.parse(cfg.launchAt) : NaN;
      openAt = Number.isFinite(t) ? t : null;
    }
  } catch { /* unreachable — treated as open, see above */ }
  launchCache = { at: Date.now(), openAt };
  return openAt;
}

const shopIsOpen = async () => {
  const at = await shopOpensAt();
  return at === null || Date.now() >= at;
};

/**
 * What the shop button says, and where it goes.
 *
 * `productUrl` deep-links a specific product when we know which one they asked
 * about — sending someone who typed `/price robux` to a grid of seventy-two
 * products is a step they should never have had to take.
 */
/**
 * Tag a shop link with where in the server the click came from.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The site has carried a full attribution system since it was built: it reads
 * utm_*, source, campaign and content off the landing URL, follows the visit to
 * an order, and the admin has a view showing which creative produced purchases.
 * Every link this bot handed out went in BARE — the join DM, the verify success
 * message, /shop, /price, /recommend, every panel button, every drop
 * announcement. So the largest owned traffic source this shop has was the one
 * source it could never measure, and "does Discord bring paying customers" —
 * the whole reason the server exists — had no answer in the data.
 *
 * `content` is the SURFACE, not the campaign: join-dm, verify, price, drop.
 * That is the useful cut. Knowing Discord converts is worth something; knowing
 * the join DM converts and the drop announcements do not is worth acting on.
 *
 * Never appended to a link that already carries a ref or utm — a referral link
 * a member shared is theirs, and overwriting its attribution would take the
 * credit for their sale.
 */
function tagged(url, surface) {
  try {
    const u = new URL(url);
    if ([...u.searchParams.keys()].some((k) => /^(utm_|ref$|source$|src$)/i.test(k))) return url;
    u.searchParams.set('utm_source', 'discord');
    u.searchParams.set('utm_medium', 'community');
    if (surface) u.searchParams.set('utm_content', surface);
    return u.toString();
  } catch { return url; }
}

async function shopCta(productUrl = null, surface = 'bot') {
  const open = await shopIsOpen();
  const at = await shopOpensAt();
  const when = at
    ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    : null;
  return {
    open,
    url: tagged(productUrl || `${STORE_URL}/shop`, surface),
    // Before launch the label describes what the page actually does.
    label: open ? (productUrl ? 'Buy now' : 'Open the shop')
      : (productUrl ? 'See it on the site' : 'Browse the catalogue'),
    note: open ? null : `🗓️ Opens ${when || 'soon'} — have a look around in the meantime.`,
  };
}

/** The shop button, labelled for whether the shop is actually open. */
async function shopButton(productUrl = null, surface = 'bot') {
  const cta = await shopCta(productUrl, surface);
  return new ButtonBuilder().setLabel(`\u{1F6CD}\uFE0F ${cta.label}`)
    .setStyle(ButtonStyle.Link).setURL(cta.url);
}

/** A markdown link that tells the truth about what happens when it is clicked. */
async function shopLink(productUrl = null, surface = 'bot') {
  const cta = await shopCta(productUrl, surface);
  return `[${cta.label}](${cta.url})${cta.note ? `\n${cta.note}` : ''}`;
}

// ── Permanent invite ─────────────────────────────────────────────────────────
// Default Discord invites expire after 7 days; a dead link on the storefront
// silently kills sign-ups. On boot (and daily) we make sure a NON-expiring
// invite exists (maxAge 0, unlimited uses) and push it to the site, which
// serves it everywhere an invite is shown.
const FALLBACK_INVITE = process.env.DISCORD_INVITE_URL || 'https://discord.gg/CrAfqENsSV';
let PERMANENT_INVITE = null;

async function ensurePermanentInvite(guild) {
  try {
    let invite = null;
    // Prefer an existing permanent invite (needs Manage Server to list them).
    try {
      const invites = await guild.invites.fetch();
      invite = invites.find((i) => i.maxAge === 0 && i.maxUses === 0) || null;
    } catch { /* no Manage Server perm — we'll create our own below */ }
    if (!invite) {
      // Create one on the most public channel the bot can invite from.
      const chans = ['welcome', 'rules', 'general'];
      const target = chans.map((n) => findChannel(guild, n)).find((ch) =>
        ch?.isTextBased?.() && ch.permissionsFor(guild.members.me)?.has(P.CreateInstantInvite))
        || guild.channels.cache.find((ch) =>
          ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me)?.has(P.CreateInstantInvite));
      if (!target) { console.warn('[invite] no channel with Create Invite permission'); return; }
      invite = await target.createInvite({ maxAge: 0, maxUses: 0, unique: false,
        reason: 'Permanent storefront invite (never expires)' });
    }
    PERMANENT_INVITE = invite.url;
    // Push the live link to the site (HMAC-signed; URL bound into the signature).
    if (FORGEMARKET_API_URL && REVIEW_INGEST_SECRET) {
      const ts = String(Date.now());
      const signature = createHmac('sha256', REVIEW_INGEST_SECRET)
        .update(`${ts}.invite:${invite.url}`).digest('hex');
      await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/discord/invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signature },
        body: JSON.stringify({ url: invite.url }),
        signal: AbortSignal.timeout(8000),
      }).catch((e) => console.error('[invite->site]', e?.message));
    }
    console.log(`[invite] permanent invite ready: ${invite.url}`);
  } catch (e) { console.error('[invite]', e?.message || e); }
}

const P = PermissionFlagsBits;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// Brand assets, hosted by the storefront (public/discord/*).
// ?v=2 busts Discord's media-proxy cache: a panel posted while the site briefly
// served no image (e.g. mid domain-switch) would otherwise keep showing the
// stale/blank cached copy. Bump this whenever the banner artwork changes.
const BANNER = (n) => `${STORE_URL}/discord/banner-${n}.png?v=2`;
/** #name → a real clickable mention, or plain #name if that channel is missing.
 *  Discord only linkifies <#id>; a name in those brackets renders as raw text. */
const chanRef = (guild, name) => {
  const ch = guild?.channels?.cache?.find((c) => c.name === name);
  return ch ? `<#${ch.id}>` : `#${name}`;
};
const BRAND_ICON = `${STORE_URL}/icon-512.png`;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates, // voice XP + voice presence
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const STAR_THRESHOLD = 3;            // ⭐ reactions needed to hit the starboard
// Starboard dedup — persisted in bot-meta.json so a restart can't repost.
const starred = {
  has: (id) => (META.starred || []).includes(id),
  add: (id) => { META.starred = [...(META.starred || []), id].slice(-500); saveMeta(); },
};

// ── helpers ──────────────────────────────────────────────────────────────
const findRole = (g, name) => g.roles.cache.find((r) => r.name === name);
const findChannel = (g, name) => g.channels.cache.find((c) => c.name === name);

let catalogCache = { at: 0, items: [] };
async function getProducts() {
  if (!FORGEMARKET_API_URL) return [];
  if (Date.now() - catalogCache.at < 60_000) return catalogCache.items;
  try {
    // Hard timeout: a *hanging* (not refusing) API would otherwise stall every
    // /price, /ask and price-list refresh for minutes and pile up sockets.
    const res = await fetch(`${FORGEMARKET_API_URL}/api/products`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    catalogCache = { at: Date.now(), items: data.products || [] };
  } catch {
    catalogCache.at = Date.now(); // keep stale items, but back off for a minute
  }
  return catalogCache.items;
}

const money = (cents, cur = 'EUR') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format((cents || 0) / 100);

/**
 * What a buyer can actually expect, from the store's own flags.
 * `instant` is true only when a code is in stock and the product auto-delivers,
 * which is the one case where "straight away" is a promise we can keep.
 */
function availabilityLine(p) {
  const left = Number(p?.stockLeft);
  if (p?.instant) {
    return Number.isFinite(left) && left > 0
      ? `✅ In stock — sent automatically once your payment is confirmed. **Only ${left} left.**`
      : '✅ In stock — sent automatically once your payment is confirmed.';
  }
  return '🕐 Delivered by hand after your payment is confirmed — usually within a few hours during the day.';
}

function leadLog(guild, text) {
  const ch = findChannel(guild, 'leads');
  if (ch) ch.send(text).catch(() => {});
}

// ── AI ─────────────────────────────────────────────────────────────────────
async function askAI(question, products) {
  if (!anthropic) return ruleBasedAnswer(question, products);
  const catalog = products.slice(0, 40).map((p) => `- ${p.name} (${p.category}) — ${money(p.price, p.currency)}`).join('\n')
    || '(catalog unavailable — point users to the store)';
  const system = [
    {
      type: 'text',
      text:
        "You are Forge, the friendly, professional assistant for ForgeMarket, a premium gaming top-up marketplace " +
        "(game currency, gift cards, subscriptions). Voice: helpful, concise, trustworthy — never pushy.\n\n" +
        "Rules:\n" +
        "- Keep replies short (Discord). Use light formatting and at most a couple emojis.\n" +
        "- Recommend ONLY products from the catalog below. Never invent prices or items.\n" +
        "- If the request is vague, ask ONE qualifying question (game, amount, budget).\n" +
        "- For order/payment problems, tell them to open a ticket in #open-a-ticket.\n" +
        "- Be honest about delivery: in-stock items go out automatically, the rest is delivered by hand within a few hours.\n" +
        "- Mention money-back-if-undelivered and real-order reviews when relevant. Never promise instant delivery.\n" +
        `- The store is at ${STORE_URL}. Encourage joining giveaways/community when natural.\n\n` +
        `FAQ:\n${FAQ.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n')}\n\n` +
        `CATALOG:\n${catalog}`,
      cache_control: { type: 'ephemeral' }, // prompt caching: catalog/FAQ reused across users
    },
  ];
  try {
    const res = await anthropic.messages.create({
      model: AI_MODEL, max_tokens: 400, system,
      messages: [{ role: 'user', content: question.slice(0, 800) }],
    });
    return res.content.map((b) => ('text' in b ? b.text : '')).join('').trim()
      || ruleBasedAnswer(question, products);
  } catch (e) {
    console.error('[ai]', e.message);
    return ruleBasedAnswer(question, products);
  }
}

function ruleBasedAnswer(q, products) {
  const t = q.toLowerCase();
  const hit = FAQ.find((f) => f.q.toLowerCase().split(' ').some((w) => w.length > 4 && t.includes(w)));
  if (hit) return `**${hit.q}**\n${hit.a}`;
  const match = products.find((p) => t.includes(p.category) || t.includes(p.name.toLowerCase().split(' ')[0]));
  if (match) return `Check out **${match.name}** — ${money(match.price, match.currency)}. Browse more at ${tagged(`${STORE_URL}/shop`, 'ask')} 🎮`;
  return `I can help with top-ups, prices, delivery and orders! Tell me the game and amount, browse ${tagged(`${STORE_URL}/shop`, 'ask')}, or open a ticket in #open-a-ticket for order help.`;
}

const BUY_INTENT = /\b(buy|price|cheap|how much|robux|v-?bucks|vp|cp|gems|crystals|apex|order|top.?up)\b/i;

// ── Live server-stats voice channels (auto-managed by the bot) ───────────────
async function ensureStat(guild, cat, emoji, label, value) {
  const name = `${emoji} ${label}: ${value}`;
  let ch = guild.channels.cache.find((c) => c.parentId === cat.id && c.type === ChannelType.GuildVoice && c.name.startsWith(emoji));
  try {
    if (!ch) {
      await guild.channels.create({
        name, type: ChannelType.GuildVoice, parent: cat.id,
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [P.Connect] }],
      });
    } else if (ch.name !== name) {
      await ch.setName(name); // Discord rate-limits to ~2 renames / 10 min per channel
    }
  } catch (e) { /* rate-limited or perms — ignore */ }
}
async function updateServerStats(guild) {
  try {
    let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === '📊 SERVER STATS');
    if (!cat) {
      cat = await guild.channels.create({
        name: '📊 SERVER STATS', type: ChannelType.GuildCategory, position: 0,
        permissionOverwrites: [{ id: guild.roles.everyone.id, allow: [P.ViewChannel], deny: [P.Connect] }],
      });
    }
    await ensureStat(guild, cat, '👥', 'Members', guild.memberCount);
    await ensureStat(guild, cat, '💎', 'Boosts', guild.premiumSubscriptionCount || 0);
  } catch (e) { console.error('[stats]', e.message); }
}

// ── Auto-updated #price-list (live catalog → pinned embed) ───────────────────
async function updatePriceList(guild) {
  try {
    const ch = findChannel(guild, 'price-list');
    if (!ch) return;
    const products = await getProducts();
    if (!products.length) return;

    const byCat = {};
    for (const p of products) (byCat[p.category || 'other'] ||= []).push(p);
    // Discord caps embeds at 25 fields AND 6000 chars total — exceed either and
    // the send/edit throws, silently freezing the "live" list. Stop adding
    // fields once we near the total budget.
    let totalChars = 0;
    const fields = [];
    for (const [cat, list] of Object.entries(byCat).sort(([a], [b]) => a.localeCompare(b))) {
      if (fields.length >= 24) break;
      const name = `🎮 ${cat.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}`;
      const value = list
        .sort((a, b) => a.price - b.price)
        .map((p) => `${p.name} — **${money(p.price, p.currency)}**`)
        .join('\n').slice(0, 1024);
      if (totalChars + name.length + value.length > 5300) break;
      totalChars += name.length + value.length;
      fields.push({ name, value });
    }

    const embed = new EmbedBuilder().setColor(0x6366f1)
      .setTitle('🏷️ Live price list')
      .setThumbnail(BRAND_ICON)
      .setImage(BANNER('products'))
      .setDescription('Prices sync automatically from the store, so this list is always current.')
      .addFields(fields)
      .setFooter({ text: 'ForgeMarket · auto-updated every 10 min' })
      .setTimestamp();
    const shopRow = new ActionRowBuilder().addComponents(
      await shopButton());

    // Edit our previous price-list message so the channel stays clean.
    const msgs = await ch.messages.fetch({ limit: 25 }).catch(() => null);
    const mine = msgs?.find((m) => m.author.id === client.user.id && m.embeds[0]?.title?.includes('price list'));
    if (mine) await mine.edit({ embeds: [embed], components: [shopRow] });
    else await ch.send({ embeds: [embed], components: [shopRow] });
  } catch (e) { console.error('[price-list]', e.message); }
}

// ── Self-healing panel banners ────────────────────────────────────────────────
// setup.js posts the panels, but banners were added later — instead of asking
// the owner to re-run setup, the bot upgrades its own panels in place on boot:
// it finds each marker message and EDITS the embed to add the banner + colour.
const PANEL_BANNERS = {
  welcome: ['welcome', 0x7c5cff],
  rules: ['rules', 0x94a3b8],
  verify: ['verify', 0x22c55e],
  'open-a-ticket': ['support', 0x3b82f6],
  'support-info': ['support', 0x3b82f6],
  products: ['products', 0x6366f1],
  'price-list': ['products', 0x6366f1],
  deals: ['deals', 0xef4444],
  'discount-codes': ['deals', 0xec4899],
  reviews: ['vouches', 0x22c55e],
  vouches: ['vouches', 0x22c55e],
  giveaways: ['giveaways', 0xa855f7],
};

async function syncPanelBanners(guild) {
  let edited = 0;
  const missing = [];
  for (const [chName, [banner, color]] of Object.entries(PANEL_BANNERS)) {
    try {
      const ch = findChannel(guild, chName);
      if (!ch || typeof ch.messages?.fetch !== 'function') continue;
      const msgs = await ch.messages.fetch({ limit: 30 }).catch(() => null);
      const mine = msgs?.find((m) => m.author.id === client.user.id
        && m.embeds[0]?.footer?.text === 'forgemarket-setup');
      if (!mine) { missing.push(chName); continue; }
      const url = BANNER(banner);
      if (mine.embeds[0].image?.url === url) { edited += 0; continue; } // already current
      const e = EmbedBuilder.from(mine.embeds[0]).setImage(url).setColor(color);
      await mine.edit({ embeds: [e] });
      edited++;
    } catch (e) { console.error('[panel-sync]', chName, e.message); }
  }
  if (edited) console.log(`🖼️  [panel-sync] banners added/refreshed on ${edited} panel(s)`);
  if (missing.length) console.log(`ℹ️  [panel-sync] no setup panel found in: ${missing.join(', ')} — run \`REPOST=1 npm run setup\` once to create them`);
}

/**
 * Keep the pinned panels' TEXT current.
 *
 * setup.js posts each panel once and then reports "exists" forever, so every
 * later copy fix — including corrections to what we promise customers — used to
 * sit in the repo and never reach the live server unless someone remembered to
 * re-run setup with REPOST=1 (which deletes and re-pins everything, losing the
 * message history and every pin position).
 *
 * On boot we now rebuild each panel from config and edit only the ones whose
 * text actually changed. Buttons are preserved: editing `embeds` alone leaves
 * `components` untouched.
 */
async function syncPanelCopy(guild) {
  let edited = 0;
  try {
    const channelIdByName = {};
    guild.channels.cache.forEach((c) => { if (c.name) channelIdByName[c.name] = c.id; });
    const panels = buildPanels({
      storeUrl: STORE_URL, guildName: guild.name, channelIdByName, trustpilotUrl: TRUSTPILOT_URL,
    });

    for (const [chName, panel] of Object.entries(panels)) {
      const ch = findChannel(guild, chName);
      if (!ch || typeof ch.messages?.fetch !== 'function') continue;
      const msgs = await ch.messages.fetch({ limit: 30 }).catch(() => null);
      const mine = msgs?.find((m) => m.author.id === client.user.id
        && m.embeds[0]?.footer?.text === 'forgemarket-setup');
      if (!mine) continue;                       // not built yet — setup.js posts it
      if (!panelNeedsUpdate(mine.embeds[0], panel)) continue;
      const e = EmbedBuilder.from(mine.embeds[0])
        .setTitle(panel.title).setDescription(panel.description);
      await mine.edit({ embeds: [e] }).catch(() => {});
      edited++;
      console.log(`  · [panel-copy] #${chName} updated`);
    }
  } catch (e) { console.error('[panel-copy]', e.message); }
  if (edited) console.log(`📝 [panel-copy] refreshed ${edited} panel(s) from config`);
  return edited;
}

// Startup self-check: are the brand banners actually reachable AND actually
// images? A stale/misconfigured site deploy answers /discord/banner-*.png with
// the SPA's index.html (HTTP 200, but text/html) — Discord then shows a blank
// embed. A plain HEAD 200 would hide that, so we GET and inspect the content
// type: only a real image/* response counts as "live".
async function checkBrandAssets() {
  try {
    const res = await fetch(BANNER('welcome'));
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.startsWith('image/')) {
      console.log(`✅ Brand banners live at ${STORE_URL}/discord/`);
      return true;
    }
    if (res.ok) {
      console.warn(`⚠️  Banner check: ${BANNER('welcome')} returned ${type || 'non-image'} instead of an image.\n` +
        `   Your site is serving its app HTML for that path — the banner files aren't in the live build.\n` +
        `   Fix: deploy the LATEST site build to ${STORE_URL} (the banners live under public/discord/). ` +
        'Panels will stay blank until then.');
    } else {
      console.warn(`⚠️  Banner check: ${BANNER('welcome')} → HTTP ${res.status}.\n   Panels/embeds will show WITHOUT images until the site serves them.\n   Fix: make sure the latest site deploy is live and STORE_URL (${STORE_URL}) is your real site URL.`);
    }
    return false;
  } catch (e) {
    console.warn(`⚠️  Banner check failed (${e.message}) — is STORE_URL correct? (${STORE_URL})`);
    return false;
  }
}

// ── Anti-scam: staff impersonation detection ─────────────────────────────────
// Normalizes lookalike characters (0→o, 1→l, …) so "F0rgeSupp0rt" matches
// "ForgeSupport". Alerts land in #scam-warning (falls back to #mod-log).
const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  .replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a')
  .replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b');

function staffNameSet(guild) {
  const names = new Set([normalizeName(guild.name), normalizeName(client.user?.username)]);
  for (const m of guild.members.cache.values()) {
    if (!isStaff(m) || m.user.bot) continue;
    names.add(normalizeName(m.user.username));
    names.add(normalizeName(m.displayName));
    if (m.user.globalName) names.add(normalizeName(m.user.globalName));
  }
  names.delete('');
  return names;
}

async function checkImpersonation(member) {
  try {
    if (member.user.bot || member.id === client.user.id || isStaff(member)) return;
    const staff = staffNameSet(member.guild);
    const candidates = [member.user.username, member.displayName, member.user.globalName]
      .map(normalizeName).filter(Boolean);
    const hit = candidates.find((c) => staff.has(c));
    if (!hit) return;
    // Staff-only on purpose: a name can match by coincidence, and publicly
    // accusing the wrong member is its own harm. #mod-log is where staff decide.
    const ch = findChannel(member.guild, 'mod-log') || findChannel(member.guild, 'staff-chat');
    if (!ch) return;
    await ch.send({ embeds: [new EmbedBuilder().setColor(0xef4444)
      .setTitle('🚨 Possible staff impersonation')
      .setDescription(
        `<@${member.id}> (\`${member.user.tag}\`) uses a name matching a staff member or the brand.\n` +
        'Review their profile and ban if fake. Reminder for everyone: **staff will never DM you first.**')
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp()] });
  } catch (e) { console.error('[impersonation]', e.message); }
}

client.on(Events.GuildMemberUpdate, (oldM, newM) => {
  if (oldM.displayName !== newM.displayName) checkImpersonation(newM);
});

// ── ready ────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`✅ ${c.user.tag} online — AI: ${anthropic ? 'on' : 'rule-based'} · API: ${FORGEMARKET_API_URL || 'sample'}`);
  c.user.setPresence({ activities: [{ name: '/order · check your order status' }], status: 'online' });
  const refresh = () => c.guilds.cache.forEach((g) => updateServerStats(g));
  refresh();
  setInterval(refresh, 6 * 60_000); // respect channel-rename rate limits

  // Cache members once so staff-impersonation checks see the full roster.
  c.guilds.cache.forEach((g) => g.members.fetch().catch(() => {}));

  // Live price list: refresh now + every 10 minutes.
  const prices = () => c.guilds.cache.forEach((g) => updatePriceList(g));
  prices();
  setInterval(prices, 10 * 60_000);

  // Ticket hygiene: warn idle tickets after 24h, auto-close 24h later.
  const sweep = () => c.guilds.cache.forEach((g) => sweepIdleTickets(g));
  setTimeout(sweep, 60_000); // let caches warm up first
  setInterval(sweep, 30 * 60_000);

  // Weekly XP leaderboard (Mondays 17:00+ UTC, once per week).
  setInterval(() => c.guilds.cache.forEach((g) => {
    maybePostWeeklyLeaderboard(g);
    maybePostWeeklyDigest(g);
  }), 60 * 60_000);

  /* Pull back everything a deploy would otherwise have erased, then resume any
     giveaways that were live before it. XP and the weekly bookkeeping load in
     parallel; none of them gate the rest of boot. */
  loadXP();
  loadMeta();
  restoreGiveaways(c);

  // Self-heal the channel panels: verify banner URLs, then edit banners into
  // the existing setup messages (no manual re-run of setup needed).
  checkBrandAssets().then((ok) => {
    if (ok) c.guilds.cache.forEach((g) => syncPanelBanners(g));
    // Copy sync runs regardless of the banner check — the text matters even when
    // the images are unreachable.
    c.guilds.cache.forEach((g) => syncPanelCopy(g));
  });

  // Daily vouch spotlight → #general (checked hourly, posts once a day).
  setInterval(() => c.guilds.cache.forEach((g) => maybeVouchSpotlight(g)), 60 * 60_000);

  // Relay the store's queued Discord events (sales, drops, alerts, DMs).
  setInterval(() => pollOutbox(c), 60_000);
  setTimeout(() => pollOutbox(c), 10_000);

  // Keep a never-expiring invite alive + mirrored on the site (re-checked daily
  // so even a manually-deleted invite heals itself within a day).
  const invites = () => c.guilds.cache.forEach((g) => ensurePermanentInvite(g));
  setTimeout(invites, 20_000); // after channel caches warm up
  setInterval(invites, 24 * 60 * 60_000);

  // Site watchdog: every 15 min; alerts staff on downtime + recovery.
  setInterval(() => c.guilds.cache.forEach((g) => checkSiteHealth(g)), 15 * 60_000);
  setTimeout(() => c.guilds.cache.forEach((g) => checkSiteHealth(g)), 30_000);
  setTimeout(() => c.guilds.cache.forEach((g) => maybeVouchSpotlight(g)), 90_000);
});

// ── greet new members (with anti-scam warning) ─────────────────────────────
client.on(Events.GuildMemberAdd, async (member) => {
  const dm = new EmbedBuilder().setColor(0x7c5cff)
    .setTitle(`Welcome to ${member.guild.name} ⚡`)
    .setThumbnail(BRAND_ICON)
    .setImage(BANNER('welcome'))
    // One instruction, then what unlocks after it. Real channel mentions, so the
    // links are tappable — and the three channels that are still locked are
    // named as such instead of sending the member to a door they can't open.
    .setDescription(
      `Hey ${member.user.username}! Glad you're here.\n\n` +
      `**Step 1 — verify.** Tap ${chanRef(member.guild, 'verify')} and press the green button. ` +
      'That unlocks the shop channels, giveaways and support.\n\n' +
      `Already curious? ${chanRef(member.guild, 'how-to-buy')} and ${chanRef(member.guild, 'faq')} ` +
      'are readable right now, no verification needed.\n\n' +
      "🛡️ **Stay safe:** our staff will **NEVER** DM you first and will never ask for your password. " +
      'We only sell through the official store link. Anyone who DMs you a "deal" is a scammer — report them.\n\n' +
      "Money back if it never arrives · a real person on support · no account needed to buy.")
    .setFooter({ text: 'ForgeMarket · game top-ups & gift cards' });
  const dmButtons = new ActionRowBuilder().addComponents(
    await shopButton(null, 'join-dm'),
    new ButtonBuilder().setLabel('📦 Track an order').setStyle(ButtonStyle.Link)
      .setURL(tagged(`${STORE_URL}/track`, 'join-dm')));
  /* A DM that never arrives is the most expensive silence in the funnel.
     Most Discord accounts have DMs from server members switched off, and this
     was `.catch(() => {})` — so the one message that tells a new member how to
     verify and where the shop is went nowhere, and the only thing left was a
     public greeting that deletes itself after ten minutes. Somebody who joined
     a shop's server is the highest-intent visitor it will ever get. */
  const dmDelivered = await member.send({ embeds: [dm], components: [dmButtons] })
    .then(() => true).catch(() => false);
  if (!dmDelivered) leadLog(member.guild, `✉️ DMs closed for <@${member.id}> — greeted in #welcome instead.`);
  leadLog(member.guild, `🟢 New member joined: <@${member.id}> (${member.guild.memberCount} total)`);
  checkImpersonation(member); // scam guard: flag staff-lookalike names on join
  trackJoinForRaid(member.guild); // raid guard: alert staff on join spikes
  celebrateMilestone(member.guild); // 🎉 every 100 members
  // Public greeting — skipped during join spikes so a raid can't flood #general.
  if (recentJoins.length < 5) {
    // #welcome, not #general: an unverified member cannot see #general, so the
    // one message meant to greet them was posted where they could never read it.
    const ch = findChannel(member.guild, 'welcome') || findChannel(member.guild, 'general');
    const verifyCh = findChannel(member.guild, 'verify');
    const hello = `👋 Welcome <@${member.id}>! Verify in ${verifyCh ? `<#${verifyCh.id}>` : '#verify'} to unlock everything, and say hi 💜`;
    if (dmDelivered) {
      // They already have the full version in their DMs; this is just a wave.
      ch?.send(hello)
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 10 * 60_000))
        .catch(() => {});
    } else {
      /* The DM bounced, so this message is now the ONLY thing they get — it
         carries the shop button and it does not self-destruct. */
      ch?.send({
        content: `${hello}\n\nYour DMs are closed, so here is the short version: `
          + 'verify above, then everything unlocks. Money back if an order never arrives, '
          + 'a real person answers support, and no account is needed to buy.',
        components: [new ActionRowBuilder().addComponents(
          await shopButton(null, 'welcome-public'),
          new ButtonBuilder().setLabel('📦 Track an order').setStyle(ButtonStyle.Link)
            .setURL(tagged(`${STORE_URL}/track`, 'welcome-public')))],
      }).catch(() => {});
    }
  }
});

// ── interactions: buttons + slash ──────────────────────────────────────────
client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isButton()) return await handleButton(i);
    // The ticket panel is a select menu now — eight things support needs to
    // tell apart do not fit in a row of five buttons.
    if (i.isStringSelectMenu?.() && i.customId === 'ticket:pick') {
      return await openTicketModal(i, i.values?.[0] || 'general');
    }
    if (i.isModalSubmit() && i.customId.startsWith('tmodal:')) {
      return await openTicket(i, i.customId.split(':')[1], {
        orderNumber: (i.fields.fields.get('ordernum')?.value || '').trim(),
        details: (i.fields.getTextInputValue('details') || '').trim(),
      });
    }
    if (i.isChatInputCommand()) return await handleCommand(i);
  } catch (e) {
    console.error('[interaction]', e?.stack || e?.message || e);
    // Never leave the user staring at "interaction failed".
    const msg = { content: '⚠️ Something went wrong — please try again in a moment.', ephemeral: true };
    try {
      if (i.isRepliable?.()) {
        if (i.deferred || i.replied) await i.followUp(msg).catch(() => {});
        else await i.reply(msg).catch(() => {});
      }
    } catch { /* ignore */ }
  }
});

async function handleButton(i) {
  if (i.customId === 'verify') {
    // Step 1: show the rules + a green "I agree" button (ephemeral, only to them).
    const role = findRole(i.guild, 'Verified Customer');
    if (role && i.member.roles.cache.has(role.id)) {
      return i.reply({ content: 'You’re already verified ✅', ephemeral: true });
    }
    // Built from the same source as the #rules panel: a member must consent to
    // the rules that are actually posted, not to a copy that drifted from them.
    const channelIdByName = {};
    i.guild.channels.cache.forEach((c) => { if (c.name) channelIdByName[c.name] = c.id; });
    const rulesCopy = buildPanels({
      storeUrl: STORE_URL, guildName: i.guild.name, channelIdByName, trustpilotUrl: TRUSTPILOT_URL,
    }).rules;
    const rules = new EmbedBuilder().setColor(0x6366f1)
      .setTitle('📜 Read & accept the rules')
      .setDescription(`${rulesCopy.description}\n\nPress the green button below to accept and unlock the server.`)
      .setFooter({ text: 'ForgeMarket • verification' });
    const agree = new ButtonBuilder().setCustomId('verify:agree').setLabel('I agree — verify me')
      .setEmoji('✅').setStyle(ButtonStyle.Success);
    return i.reply({ embeds: [rules], components: [new ActionRowBuilder().addComponents(agree)], ephemeral: true });
  }

  if (i.customId === 'verify:agree') {
    // Step 2: they accepted → grant the Verified Customer role.
    const role = findRole(i.guild, 'Verified Customer');
    if (!role) return i.reply({ content: 'Verification role missing — ask an admin to run setup.', ephemeral: true });
    if (i.member.roles.cache.has(role.id)) {
      return i.update({ content: 'You’re already verified ✅', embeds: [], components: [] }).catch(() => {});
    }
    // Never claim success we did not achieve. If the bot's own role sits below
    // "Verified Customer", Discord refuses the grant — and swallowing that told
    // every new member they were verified while they still saw an empty server.
    try {
      await i.member.roles.add(role);
    } catch (e) {
      console.error('[verify] role grant failed:', e.message);
      leadLog(i.guild, `⚠️ Verification FAILED for <@${i.user.id}>: ${e.message} — drag my role above **${role.name}**.`);
      return i.update({
        content: '⚠️ I couldn’t give you the Verified role — my own role is ranked below it, so Discord blocked me. ' +
          'This is on us, not you: an admin has been notified and it takes them 10 seconds to fix. Try again after that.',
        embeds: [], components: [],
      }).catch(() => {});
    }
    leadLog(i.guild, `\u2705 Verified: <@${i.user.id}>`);
    /* The step after verifying used to be two channel names and nothing else.
       A member who has just proved they are here to buy something was handed a
       reading list; the route to the thing they came for was a search away. The
       buttons are the same ones the rest of the server uses, and they say what
       the site will actually do today. */
    const cta = await shopCta(null, 'verify');
    return i.update({
      content: `\u2705 **Verified!** Welcome in \u2014 the full server is now unlocked.\n`
        + `${cta.note ? `${cta.note}\n` : ''}`
        + `Ask me anything in ${chanRef(i.guild, 'ask-the-bot')}, or browse `
        + `${chanRef(i.guild, 'products')} and pick your games in ${chanRef(i.guild, 'roles')} `
        + 'so you hear about restocks first. \u{1F3AE}',
      embeds: [],
      components: [new ActionRowBuilder().addComponents(
        await shopButton(null, 'verify'),
        new ButtonBuilder().setLabel('\u{1F4E6} Track an order')
          .setStyle(ButtonStyle.Link).setURL(tagged(`${STORE_URL}/track`, 'verify')))],
    }).catch(() => {});
  }

  if (i.customId.startsWith('role:')) return toggleRole(i, i.customId.split(':')[1]);
  if (i.customId === 'ticket:close') return closeTicket(i);
  if (i.customId === 'ticket:close:yes') return confirmClose(i);
  if (i.customId === 'ticket:close:no') {
    return i.update({
      embeds: [new EmbedBuilder().setColor(0x10b981).setDescription('\u{1F44D} Left open.')],
      components: [],
    }).catch(() => {});
  }
  if (i.customId === 'ticket:claim') return claimTicket(i);
  if (i.customId.startsWith('ticket:')) return openTicketModal(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('rate:')) {
    const [, n, ticket] = i.customId.split(':');
    return rateSupport(i, Number(n), ticket || null);
  }
  if (i.customId.startsWith('gw:enter:')) return enterGiveaway(i, i.customId.split(':')[2]);
  if (i.customId.startsWith('sug:')) return voteSuggestion(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('sugmod:')) return moderateSuggestion(i, i.customId.split(':')[1]);
}

// Step 1 of a ticket: a small form. An order number up front means staff can
// help immediately instead of opening with "what's your order number?".

async function openTicketModal(i, type) {
  // One open ticket per member — check BEFORE showing the form.
  const existing = i.guild.channels.cache.find((c) => isOwnedBy(c.topic, i.user.id));
  if (existing) return i.reply({ content: `You already have an open ticket: <#${existing.id}>`, ephemeral: true });

  const spec = ticketType(type);
  const modal = new ModalBuilder().setCustomId(`tmodal:${type}`)
    .setTitle(ticketLabel(type).slice(0, 45));
  if (spec?.order) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('ordernum').setLabel('Order number (e.g. FM-2026-XXXX)')
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(30)
        .setPlaceholder('Leave empty if you don’t have one')));
  }
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('details').setLabel('What can we help you with?')
      .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(900)
      .setPlaceholder('Describe the issue in a few sentences…')));
  return i.showModal(modal);
}

async function toggleRole(i, key) {
  const def = SELF_ROLES.find((r) => r.key === key);
  if (!def) return i.reply({ content: 'Unknown role.', ephemeral: true });
  const role = i.guild.roles.cache.find((r) => r.name === def.label);
  if (!role) return i.reply({ content: 'That role is missing — ask an admin to run setup.', ephemeral: true });
  const has = i.member.roles.cache.has(role.id);
  await (has ? i.member.roles.remove(role) : i.member.roles.add(role)).catch(() => {});
  return i.reply({ content: `${has ? '➖ Removed' : '➕ Added'} **${def.label}**`, ephemeral: true });
}

async function claimTicket(i) {
  if (!i.channel?.topic?.startsWith('ticket-owner:')) {
    return i.reply({ content: 'This isn’t a ticket channel.', ephemeral: true });
  }
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can claim tickets.', ephemeral: true });
  if (parseTopic(i.channel.topic)?.claimedBy) {
    return i.reply({ content: 'This ticket is already claimed.', ephemeral: true });
  }
  await i.deferUpdate().catch(() => {});
  // Record the claimer in the topic, rename the channel, and disable the button.
  await i.channel.setTopic(`${i.channel.topic} · claimed:${i.user.id}`).catch(() => {});
  await i.channel.setName(`✋-${i.channel.name}`.slice(0, 95)).catch(() => {});
  const rows = i.message.components.map((row) => {
    const r = ActionRowBuilder.from(row);
    r.components.forEach((c) => { if (c.data?.custom_id === 'ticket:claim') c.setDisabled(true).setLabel('Claimed'); });
    return r;
  });
  await i.message.edit({ components: rows }).catch(() => {});
  await i.channel.send({ embeds: [new EmbedBuilder().setColor(0x10b981)
    .setDescription(`🛠️ Ticket claimed by <@${i.user.id}> — they’ll help you from here.`)] }).catch(() => {});
}

async function enterGiveaway(i, messageId) {
  const gw = GIVEAWAYS.get(messageId);
  if (!gw) return i.reply({ content: 'This giveaway has ended.', ephemeral: true });
  // Verified-only entry (ties into the verification gate).
  const verified = findRole(i.guild, 'Verified Customer');
  if (verified && !i.member.roles.cache.has(verified.id)) {
    return i.reply({ content: `Please verify in ${chanRef(i.guild, 'verify')} first to enter giveaways. ✅`, ephemeral: true });
  }
  if (gw.entries.has(i.user.id)) {
    gw.entries.delete(i.user.id);
    updateGwCount(i.guild, gw);
    saveGiveaways();
    return i.reply({ content: 'You left the giveaway. 👋', ephemeral: true });
  }
  gw.entries.add(i.user.id);
  updateGwCount(i.guild, gw);
  saveGiveaways();
  return i.reply({ content: `🎉 You’re in! **${gw.entries.size}** entries. (Tap again to leave.)`, ephemeral: true });
}

// Live-update the "Entries" field on the giveaway message.
function updateGwCount(guild, gw) {
  const ch = guild.channels.cache.get(gw.channelId);
  ch?.messages?.fetch(gw.msgId).then((msg) => {
    const emb = EmbedBuilder.from(msg.embeds[0]).setFields({ name: 'Entries', value: `🎟️ ${gw.entries.size}`, inline: true });
    msg.edit({ embeds: [emb] }).catch(() => {});
  }).catch(() => {});
}

async function openTicket(i, type, { orderNumber = '', details = '' } = {}) {
  await i.deferReply({ ephemeral: true });
  // Tickets get their own staff-gated category; falls back to the panel's
  // category on servers that haven't re-run setup yet.
  const support = findChannel(i.guild, 'open-a-ticket');
  const category = i.guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === '🎫 TICKETS') || support?.parent;

  // One open ticket per member.
  const existing = i.guild.channels.cache.find((c) => isOwnedBy(c.topic, i.user.id));
  if (existing) return i.editReply(`You already have an open ticket: <#${existing.id}>`);

  const staffRoles = ['Support', 'Admin', 'Moderator'].map((n) => findRole(i.guild, n)).filter(Boolean);
  // Member tiers can view the SUPPORT category, so explicitly hide each ticket
  // from them — only the owner, staff and bot should ever see it.
  const memberRoles = ['Verified Customer', 'VIP Customer', 'Partner'].map((n) => findRole(i.guild, n)).filter(Boolean);
  let channel;
  try {
    channel = await i.guild.channels.create({
      name: ticketChannelName(type, i.user.username),
      type: ChannelType.GuildText, parent: category?.id,
      topic: buildTopic({ ownerId: i.user.id, type, openedAt: Date.now() }),
      permissionOverwrites: [
        { id: i.guild.roles.everyone.id, deny: [P.ViewChannel] },
        ...memberRoles.map((r) => ({ id: r.id, deny: [P.ViewChannel] })),
        // The bot itself — guarantees it can manage/close the ticket without Admin.
        { id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.ManageMessages, P.ReadMessageHistory] },
        { id: i.user.id, allow: [P.ViewChannel, P.SendMessages, P.AttachFiles, P.ReadMessageHistory] },
        ...staffRoles.map((r) => ({ id: r.id, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ReadMessageHistory] })),
      ],
    });
  } catch (e) {
    console.error('[ticket] create failed:', e.message);
    return i.editReply('⚠️ I couldn’t create your ticket — make sure my role has **Manage Channels** and is high in the list. Ask an admin.');
  }

  const label = ticketLabel(type);
  const prio = priorityOf(type);
  const embed = new EmbedBuilder()
    .setColor(prio.key === 'high' ? 0xef4444 : prio.key === 'normal' ? 0x6366f1 : 0x64748b)
    .setTitle(`${label}`)
    .setDescription(
      `Hi <@${i.user.id}>, thanks for reaching out! A team member will be with you shortly. ⚡` +
      (details ? `\n\n**Their message:**\n> ${details.slice(0, 800).replace(/\n/g, '\n> ')}` : '') +
      (orderNumber ? `\n\n**Order number:** \`${orderNumber}\`` : '') +
      (!details && !orderNumber
        ? '\n\n**To speed things up, please share:**\n• Your **order number** (if any)\n• A short description of the issue\n• Screenshots if relevant'
        : '\n\nFeel free to add screenshots if relevant.'))
    .setFooter({ text: 'ForgeMarket Support • use the buttons below' }).setTimestamp();
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setEmoji('🛠️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));
  /* The Support ping is spent only where waiting costs the buyer money — an
     order that never arrived, a payment that went wrong, a bank reversal. A
     ping on every ticket is a ping nobody reads, and then the one that mattered
     sits in the same pile as "which pack should I buy". */
  const supportPing = ticketType(type)?.ping ? findRole(i.guild, 'Support') : null;
  await channel.send({
    content: supportPing ? `<@&${supportPing.id}> \u2014 ${prio.dot} ${prio.label}` : '',
    embeds: [embed], components: [controls],
  }).catch(() => {});

  /* Log the OPEN, not only the close.
     #ticket-logs held transcripts and nothing else, so a ticket still running
     left no trace outside its own channel — and one deleted before it was
     archived (a staff member removing the channel by hand) left none at all. */
  const openLog = findChannel(i.guild, 'ticket-logs');
  if (openLog) {
    await openLog.send({ embeds: [new EmbedBuilder()
      .setColor(prio.key === 'high' ? 0xef4444 : 0x6366f1)
      .setTitle(`${prio.dot} Ticket opened \u00b7 ${label}`)
      .addFields(
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Member', value: `<@${i.user.id}>`, inline: true },
        { name: 'Priority', value: `${prio.dot} ${prio.label}`, inline: true },
        ...(orderNumber ? [{ name: 'Order', value: `\`${orderNumber.slice(0, 40)}\``, inline: true }] : []))
      .setTimestamp()] }).catch(() => {});
  }
  // Order number in the form? Post the live status right away, before staff arrive.
  const num = orderNumber.match(ORDER_RE)?.[0]?.toUpperCase();
  if (num) {
    orderStatusEmbed(num).then((e) => { if (e) channel.send({ embeds: [e] }).catch(() => {}); });
  }
  leadLog(i.guild, `🎫 Ticket opened by <@${i.user.id}> — **${label}** → <#${channel.id}>`);
  return i.editReply(`✅ Your ticket is ready: <#${channel.id}>`);
}

/**
 * Shared ticket teardown: transcript → #ticket-logs, transcript + rating DM to
 * the owner, then delete the channel. Used by /close, the Close button AND the
 * inactivity auto-closer.
 */
async function archiveTicket(ch, closedByText, dmLabel = null) {
  // Build a readable transcript including attachments.
  const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
  const lines = msgs ? [...msgs.values()].reverse().map((m) => {
    const when = new Date(m.createdTimestamp).toISOString();
    const atts = m.attachments.size ? ` [attachments: ${[...m.attachments.values()].map((a) => a.url).join(', ')}]` : '';
    const emb = m.embeds.length ? ` [embed: ${m.embeds[0].title || ''} ${m.embeds[0].description || ''}]` : '';
    return `[${when}] ${m.author.tag}: ${m.content}${emb}${atts}`;
  }).join('\n') : 'No messages.';

  const meta = parseTopic(ch.topic) || {};
  const { ownerId, openedAt, type: ticketKind, claimedBy } = meta;
  const mins = openedAt ? Math.max(1, Math.round((Date.now() - openedAt) / 60000)) : null;
  const file = new AttachmentBuilder(Buffer.from(lines, 'utf8'), { name: `${ch.name}.txt` });

  const logs = findChannel(ch.guild, 'ticket-logs');
  if (logs) {
    const logEmbed = new EmbedBuilder().setColor(0x6366f1).setTitle('📄 Ticket closed')
      .addFields(
        { name: 'Channel', value: `#${ch.name}`, inline: true },
        { name: 'Owner', value: ownerId ? `<@${ownerId}>` : 'unknown', inline: true },
        { name: 'Closed by', value: closedByText, inline: true },
        ...(ticketKind ? [{ name: 'About', value: ticketLabel(ticketKind), inline: true }] : []),
        ...(claimedBy ? [{ name: 'Claimed by', value: `<@${claimedBy}>`, inline: true }] : []),
        ...(mins ? [{ name: 'Open for', value: `${mins} min`, inline: true }] : []))
      .setTimestamp();
    await logs.send({ embeds: [logEmbed], files: [file] }).catch(() => {});
  }
  // DM the owner their transcript + a quick rating prompt.
  if (ownerId) {
    const owner = await ch.guild.members.fetch(ownerId).catch(() => null);
    if (owner) {
      const stars = new ActionRowBuilder().addComponents(
        /* The ticket travels with the rating. Without it the log read
           "Support rated 3/5 by @someone" with nothing to attach it to — and
           since these buttons live in a DM that stays in the member's history,
           an old transcript could be rated again months later and land in the
           log as if it were about whatever had just closed. */
        ...[1, 2, 3, 4, 5].map((n) => new ButtonBuilder()
          .setCustomId(`rate:${n}:${ch.name}`.slice(0, 100))
          .setLabel('\u2B50'.repeat(n)).setStyle(n >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary)));
      await owner.send({
        content: `Here’s the transcript of your ForgeMarket ticket (closed by ${dmLabel || 'our team'}).\n\n**How was our support?** Tap a rating below 👇`,
        files: [file], components: [stars],
      }).catch(() => {});
    }
  }
  setTimeout(() => ch.delete().catch(() => {}), 5000);
}

/**
 * Ask before destroying the channel.
 *
 * Close was a single red button that deleted the channel five seconds later.
 * It sits next to Claim, it is the last thing in the row, and a misclick took
 * the conversation with it — the transcript is saved, but the room the customer
 * was mid-sentence in is gone and cannot be reopened.
 *
 * The confirmation is ephemeral, so it does not clutter the ticket for the
 * person on the other side of it.
 */
async function closeTicket(i) {
  const ch = i.channel;
  const t = parseTopic(ch?.topic);
  if (!t) return i.reply({ content: 'This isn\u2019t a ticket channel.', ephemeral: true });
  const rows = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close:yes').setLabel('Yes, close it')
      .setEmoji('\u{1F512}').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket:close:no').setLabel('Keep it open')
      .setStyle(ButtonStyle.Secondary));
  return i.reply({
    ephemeral: true,
    embeds: [new EmbedBuilder().setColor(0xf59e0b)
      .setTitle('Close this ticket?')
      .setDescription('The channel is deleted a few seconds after closing. '
        + `${t.ownerId ? `<@${t.ownerId}> gets` : 'The member gets'} the transcript by DM, `
        + 'and a copy goes to #ticket-logs \u2014 but the conversation cannot be reopened here.')],
    components: [rows],
  });
}

/** They meant it. */
async function confirmClose(i) {
  const ch = i.channel;
  if (!parseTopic(ch?.topic)) {
    return i.update({ content: 'This isn\u2019t a ticket channel.', embeds: [], components: [] }).catch(() => {});
  }
  await i.update({
    embeds: [new EmbedBuilder().setColor(0xef4444).setDescription('\u{1F512} Closing\u2026')],
    components: [],
  }).catch(() => {});
  await ch.send({ embeds: [new EmbedBuilder().setColor(0xef4444)
    .setDescription(`\u{1F512} Ticket closed by <@${i.user.id}> \u2014 saving a transcript. `
      + 'The channel disappears in a few seconds.')] }).catch(() => {});
  await archiveTicket(ch, `<@${i.user.id}>`, i.user.tag);
}

/**
 * Inactivity sweep (every 30 min): a ticket idle for 24h gets one "still
 * there?" warning; 24h after the warning it auto-closes with a transcript.
 * State lives in the channel topic, so it survives bot restarts.
 */
async function sweepIdleTickets(guild) {
  for (const ch of guild.channels.cache.values()) {
    try {
      const meta = parseTopic(ch.topic);
      if (ch.type !== ChannelType.GuildText || !meta) continue;
      const msgs = await ch.messages.fetch({ limit: 1 }).catch(() => null);
      const lastTs = msgs?.first()?.createdTimestamp || meta.openedAt || Date.now();
      const idleHours = (Date.now() - lastTs) / 3_600_000;
      if (idleHours < 24) continue;

      if (meta.idleWarned) {
        // Warned 24h+ ago and still silence → close it (warning was the last message).
        await ch.send({ embeds: [new EmbedBuilder().setColor(0xef4444)
          .setDescription('🔒 Closing this ticket due to inactivity. You can always open a new one in #open-a-ticket.')] }).catch(() => {});
        await archiveTicket(ch, 'Auto-close (inactive)');
      } else {
        const ownerId = meta.ownerId;
        await ch.setTopic(`${ch.topic} · idlewarned`).catch(() => {});
        await ch.send({
          content: ownerId ? `<@${ownerId}>` : '',
          embeds: [new EmbedBuilder().setColor(0xf59e0b)
            .setTitle('⏰ Still need help?')
            .setDescription('This ticket has been quiet for a day. Reply to keep it open — otherwise it closes automatically in **24 hours** (you’ll get the transcript by DM).')],
        }).catch(() => {});
      }
    } catch (e) { console.error('[ticket-sweep]', e.message); }
  }
}

async function rateSupport(i, stars, ticket) {
  // Runs from a DM, so search the bot's guilds for the log channel.
  let logs = null;
  for (const g of i.client.guilds.cache.values()) {
    const c = g.channels.cache.find((ch) => ch.name === 'ticket-logs');
    if (c) { logs = c; break; }
  }
  await i.update({ content: `Thanks for your feedback — you rated us ${'⭐'.repeat(stars)} (${stars}/5)! 💜`, components: [] }).catch(() => {});
  if (logs) await logs.send({ embeds: [new EmbedBuilder().setColor(stars >= 4 ? 0x10b981 : 0xf5b324)
    .setDescription(`\u2B50 Support rated **${stars}/5** by <@${i.user.id}>`
      + (ticket ? ` \u2014 ticket \`${ticket}\`` : ''))
    .setTimestamp()] }).catch(() => {});
}

/**
 * Commands an unverified account may still use.
 *
 * Everything else waits until they pass the gate: an account that has not done
 * the human check could otherwise burn Anthropic credit on /ask, or publish to
 * the server, straight from the public welcome channels. /order stays open on
 * purpose — order tracking is deliberately account-free everywhere else too.
 */
const PRE_VERIFY_COMMANDS = new Set(['help', 'order', 'shop', 'invite']);

async function handleCommand(i) {
  if (!PRE_VERIFY_COMMANDS.has(i.commandName) && i.guild) {
    const verified = findRole(i.guild, 'Verified Customer');
    if (verified && !i.member?.roles?.cache?.has(verified.id) && !isStaff(i.member)) {
      return i.reply({
        content: `Verify first in ${chanRef(i.guild, 'verify')} — it takes one tap and unlocks everything. ` +
          'Tracking an order? `/order` works right away.',
        ephemeral: true,
      });
    }
  }
  if (i.commandName === 'help') {
    // Buyers first, and only staff see the staff block — a shopper asking for
    // help should not have to read past /flashsale and /clearpins to find
    // "where is my order?".
    const e = new EmbedBuilder().setColor(0x6366f1)
      .setAuthor({ name: 'ForgeMarket — what I can do', iconURL: BRAND_ICON })
      .setDescription('Everything below is a slash command: type `/` and pick it.')
      .addFields(
        { name: '📦 Your order',
          value: '`/order` — live status of an order (works without an account)\n' +
                 '`/delivery` — how a product is delivered and redeemed\n' +
                 '`/price` — current price of any product' },
        { name: '🛒 Shopping',
          value: '`/ask` — ask me anything about products or prices\n' +
                 '`/shop` — open the store\n' +
                 '`/drops` — upcoming drops & restocks\n' +
                 /* The one command that turns a member into a salesperson, and it
                    was in no list of what the bot can do — mentioned once, in one
                    panel, in one channel. A referral programme nobody knows the
                    command for pays out nothing. */
                 '`/ref` — your referral link: 5% of every order it brings, as store credit' },
        { name: '💬 Community',
          value: '`/vouch` — leave a vouch after a purchase\n' +
                 '`/suggest` — suggest an idea (the server votes)\n' +
                 '`/rank` · `/daily` · `/leaderboard` — XP, streaks and the top members\n' +
                 '`/balance` — your Forge Coins & store credit\n' +
                 '`/poll` · `/invite` · `/stats` · `/serverinfo`' },
        { name: '🆘 Something wrong?',
          value: 'Open a ticket in **#open-a-ticket** with your order number — a real person answers. ' +
                 'If an order never arrives, you get your money back.\n\n' +
                 '🛡️ Staff will **never** DM you first and never ask for your password.' },
      )
      .setFooter({ text: 'Chat and voice both earn XP — level roles are automatic' });
    if (isStaff(i.member)) {
      e.addFields({ name: '🛠️ Staff only',
        value: '`/paylink` — attach a payment link with the exact amount to an order\n' +
               '`/close` · `/giveaway` · `/reroll` · `/coupon` · `/flashsale`\n' +
               '`/digest` — live store numbers · `/stock` — low stock · `/launch` — ready-to-sell check\n' +
               '`/announce` · `/clearpins`' });
    }
    const row = new ActionRowBuilder().addComponents(
      await shopButton(),
      new ButtonBuilder().setLabel('Track an order').setStyle(ButtonStyle.Link).setURL(`${STORE_URL}/track`),
    );
    return i.reply({ ephemeral: true, embeds: [e], components: [row] });
  }
  if (i.commandName === 'order') return lookupOrder(i);
  if (i.commandName === 'price') return priceCmd(i);
  if (i.commandName === 'delivery') return deliveryCmd(i);
  if (i.commandName === 'drops') return dropsCmd(i);
  if (i.commandName === 'poll') return pollCmd(i);
  if (i.commandName === 'daily') return dailyCmd(i);
  if (i.commandName === 'vouch') return postVouch(i);
  if (i.commandName === 'giveaway') return startGiveaway(i);
  if (i.commandName === 'reroll') return rerollGiveaway(i);
  if (i.commandName === 'rank') return rankCmd(i);
  if (i.commandName === 'balance') return balanceCmd(i);
  if (i.commandName === 'ref' || i.commandName === 'referral') return refCmd(i);
  if (i.commandName === 'leaderboard') return leaderboardCmd(i);
  if (i.commandName === 'suggest') return postSuggestion(i);
  if (i.commandName === 'digest') return digestCmd(i);
  if (i.commandName === 'launch') return launchCmd(i);
  if (i.commandName === 'stock') return stockCmd(i);
  if (i.commandName === 'coupon') return postCoupon(i);
  if (i.commandName === 'paylink') return payLinkCmd(i);
  if (i.commandName === 'flashsale') return flashSale(i);
  if (i.commandName === 'announce') return postAnnounce(i);
  if (i.commandName === 'clearpins') return clearPinsCmd(i);
  if (i.commandName === 'serverinfo') {
    const g = i.guild;
    const e = new EmbedBuilder().setColor(0x6366f1).setTitle(`📊 ${g.name}`)
      .setThumbnail(g.iconURL() || null)
      .addFields(
        { name: '👥 Members', value: `${g.memberCount}`, inline: true },
        { name: '💎 Boosts', value: `${g.premiumSubscriptionCount || 0}`, inline: true },
        { name: '😀 Emojis', value: `${g.emojis.cache.size}`, inline: true },
        { name: '💬 Channels', value: `${g.channels.cache.size}`, inline: true },
        { name: '🎭 Roles', value: `${g.roles.cache.size}`, inline: true },
        { name: '📅 Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true })
      .setFooter({ text: 'ForgeMarket Community' });
    return i.reply({ embeds: [e] });
  }
  if (i.commandName === 'close') {
    if (!i.channel?.topic?.startsWith('ticket-owner:')) {
      return i.reply({ content: 'Use this inside a ticket channel.', ephemeral: true });
    }
    if (!isStaff(i.member)) return i.reply({ content: 'Only staff can close tickets.', ephemeral: true });
    return closeTicket(i);
  }
  if (i.commandName === 'shop') {
    return i.reply({ ephemeral: true, content: `\u{1F6CD}\uFE0F ${await shopLink()}` });
  }
  if (i.commandName === 'invite') {
    return i.reply({ ephemeral: true, content: `📨 Invite friends with this link: ${PERMANENT_INVITE || FALLBACK_INVITE}` });
  }
  if (i.commandName === 'stats') {
    const g = i.guild;
    const e = new EmbedBuilder().setColor(0x6366f1).setTitle(`📊 ${g.name}`)
      .addFields(
        { name: '👥 Members', value: `${g.memberCount}`, inline: true },
        { name: '💬 Channels', value: `${g.channels.cache.size}`, inline: true },
        { name: '🎭 Roles', value: `${g.roles.cache.size}`, inline: true })
      .setThumbnail(g.iconURL() || null).setFooter({ text: 'ForgeMarket' });
    return i.reply({ embeds: [e] });
  }
  if (i.commandName === 'ask' || i.commandName === 'recommend') {
    await i.deferReply();
    const products = await getProducts();
    const q = i.commandName === 'recommend'
      ? `Recommend a product. Game: ${i.options.getString('game') || 'any'}. Budget: ${i.options.getString('budget') || 'any'}.`
      : i.options.getString('question');
    const answer = await askAI(q, products);
    if (BUY_INTENT.test(q)) leadLog(i.guild, `💡 Buying intent from <@${i.user.id}>: "${q.slice(0, 120)}"`);
    return i.editReply(answer.slice(0, 1900));
  }
}

// ── Suggestions 2.0 ───────────────────────────────────────────────────────────
// /suggest → embed with live ✅/❌ vote buttons + a discussion thread. Staff get
// Approve / Planned / Decline buttons; a decision recolors the card and DMs the
// author. Votes persist in bot-meta.json so a restart never loses them.
const SUG_STATUS = {
  approve: { label: '✅ Approved', color: 0x10b981 },
  planned: { label: '🚧 Planned', color: 0xf59e0b },
  decline: { label: '❌ Declined', color: 0xef4444 },
};
const sugStore = () => (META.suggestions ||= {});
function sugRows(rec) {
  const votes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sug:up').setLabel(`✅ ${rec.up.length}`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('sug:down').setLabel(`❌ ${rec.down.length}`).setStyle(ButtonStyle.Secondary));
  const mod = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sugmod:approve').setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sugmod:planned').setLabel('Planned').setEmoji('🚧').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('sugmod:decline').setLabel('Decline').setEmoji('❌').setStyle(ButtonStyle.Secondary));
  return rec.status ? [votes] : [votes, mod];
}

async function postSuggestion(i) {
  const text = i.options.getString('idea');
  const ch = findChannel(i.guild, 'suggestions');
  if (!ch) return i.reply({ content: 'No #suggestions channel — ask an admin to run setup.', ephemeral: true });
  // ACK first: posting the embed + opening a thread is two Discord round-trips,
  // which can blow past the 3s interaction deadline under load and throw
  // "Unknown interaction" even though the suggestion was posted fine.
  await i.deferReply({ ephemeral: true });
  const e = new EmbedBuilder().setColor(0x6366f1).setTitle('💡 New suggestion')
    .setDescription(text).setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
    .setFooter({ text: 'Vote below · staff review every idea' }).setTimestamp();
  const rec = { author: i.user.id, up: [], down: [], status: null };
  const msg = await ch.send({ embeds: [e], components: sugRows(rec) });
  const store = sugStore();
  store[msg.id] = rec;
  // Cap the store so bot-meta.json can't grow forever.
  const ids = Object.keys(store);
  if (ids.length > 200) for (const id of ids.slice(0, ids.length - 200)) delete store[id];
  saveMeta();
  await msg.startThread({ name: `💡 ${text.slice(0, 80)}` }).catch(() => {});
  leadLog(i.guild, `💡 Suggestion from <@${i.user.id}>: "${text.slice(0, 120)}"`);
  return i.editReply({ content: `✅ Posted your suggestion in <#${ch.id}> — votes & staff review happen there!` });
}

async function voteSuggestion(i, dir) {
  const rec = sugStore()[i.message.id];
  if (!rec) return i.reply({ content: 'This suggestion is too old to vote on.', ephemeral: true });
  const mine = dir === 'up' ? rec.up : rec.down;
  const other = dir === 'up' ? rec.down : rec.up;
  const had = mine.includes(i.user.id);
  if (had) mine.splice(mine.indexOf(i.user.id), 1);          // tap again = remove vote
  else {
    mine.push(i.user.id);
    const idx = other.indexOf(i.user.id);                    // switch sides
    if (idx !== -1) other.splice(idx, 1);
  }
  saveMeta();
  await i.update({ components: sugRows(rec) }).catch(() => {});
}

async function moderateSuggestion(i, action) {
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can decide on suggestions.', ephemeral: true });
  const rec = sugStore()[i.message.id];
  const status = SUG_STATUS[action];
  if (!rec || !status) return i.reply({ content: 'This suggestion is too old to update.', ephemeral: true });
  rec.status = action;
  saveMeta();
  const e = EmbedBuilder.from(i.message.embeds[0]).setColor(status.color)
    .setTitle(`💡 Suggestion · ${status.label}`)
    .setFooter({ text: `Decided by ${i.user.username} · ✅ ${rec.up.length} / ❌ ${rec.down.length}` });
  await i.update({ embeds: [e], components: sugRows(rec) }).catch(() => {});
  // Tell the author their idea got a decision.
  i.guild.members.fetch(rec.author).then((m) => m.send(
    `${status.label.split(' ')[0]} Your ForgeMarket suggestion was marked **${status.label.slice(2).trim()}**:\n> ${
      (i.message.embeds[0]?.description || '').slice(0, 200)}\n\nThanks for helping shape the store! 💜`,
  ).catch(() => {})).catch(() => {});
}

// ── Starboard (⭐ reactions repost the best messages) ─────────────────────────
client.on(Events.MessageReactionAdd, async (reaction) => {
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.emoji.name !== '⭐') return;
    const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    if (!msg.guild || msg.author?.bot) return;
    if (reaction.count < STAR_THRESHOLD || starred.has(msg.id)) return;
    const board = findChannel(msg.guild, 'starboard');
    if (!board || board.id === msg.channel.id) return;
    starred.add(msg.id);
    const e = new EmbedBuilder().setColor(0xf5b324)
      .setAuthor({ name: msg.author.username, iconURL: msg.author.displayAvatarURL() })
      .setDescription(msg.content || '*(no text)*')
      .addFields({ name: '​', value: `[Jump to message](${msg.url}) · in <#${msg.channel.id}>` })
      .setFooter({ text: `⭐ ${reaction.count}` }).setTimestamp(msg.createdTimestamp);
    const img = msg.attachments.find((a) => a.contentType?.startsWith('image/'));
    if (img) e.setImage(img.url);
    await board.send({ content: `⭐ **${reaction.count}**`, embeds: [e] });
  } catch (e) { console.error('[starboard]', e.message); }
});

// ── AI in #ask-the-bot ──────────────────────────────────────────────────────
client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot || m.channel.name !== 'ask-the-bot') return;
  await m.channel.sendTyping().catch(() => {});
  const products = await getProducts();
  const answer = await askAI(m.content, products);
  if (BUY_INTENT.test(m.content)) leadLog(m.guild, `💡 Buying intent from <@${m.author.id}>: "${m.content.slice(0, 120)}"`);
  m.reply(answer.slice(0, 1900)).catch(() => {});
});

// ── Auto-moderation: remove invites / scam promos (non-staff, outside tickets) ─
client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot || !m.guild) return;
  if (isTicketChannel(m.channel)) return;
  if (isStaff(m.member)) return;

  const hit = scamReasonFor(m.content, {
    mentionCount: m.mentions?.users?.size || 0,
    mentionsEveryone: !!m.mentions?.everyone,
  });
  if (!hit) return;
  const reason = hit.label;

  await m.delete().catch(() => {});
  const notice = hit.kind === 'lookalike'
    ? `⚠️ <@${m.author.id}> that link is **not** our shop. The only official address is ${STORE_URL} — anything else is someone trying to take your money.`
    : hit.kind === 'solicit'
      ? `⚠️ <@${m.author.id}> no selling or buying by DM here. **Staff never DM you first**, and deals in DMs are how people get scammed.`
      : `⚠️ <@${m.author.id}> invites, mass pings & "free" offers aren't allowed. **Staff never DM you first** — stay safe.`;
  const warn = await m.channel.send(notice).catch(() => null);
  setTimeout(() => warn?.delete().catch(() => {}), 12_000);

  const log = findChannel(m.guild, 'mod-log');
  if (log) {
    log.send({ embeds: [new EmbedBuilder().setColor(0xef4444)
      .setTitle('🚫 Message auto-removed')
      .setDescription(`**Reason:** ${reason}\n**Member:** <@${m.author.id}> (\`${m.author.tag}\`)\n` +
        `**Channel:** <#${m.channel.id}>\n**Account age:** <t:${Math.floor(m.author.createdTimestamp / 1000)}:R>`)
      .addFields({ name: 'Content', value: `\`\`\`${m.content.slice(0, 900).replace(/```/g, "'''")}\`\`\`` })
      .setTimestamp()] }).catch(() => {});
  }
});

// ── Ticket activity: a human reply re-arms the inactivity timer ──────────────
client.on(Events.MessageCreate, (m) => {
  if (m.author.bot || !m.guild) return;
  const ch = m.channel;
  if (ch.topic?.startsWith('ticket-owner:') && ch.topic.includes(' · idlewarned')) {
    ch.setTopic(ch.topic.replace(' · idlewarned', '')).catch(() => {});
  }
});

// ── Member leave logging ────────────────────────────────────────────────────
client.on(Events.GuildMemberRemove, (member) => {
  const log = findChannel(member.guild, 'mod-log');
  if (log) log.send(`🔴 ${member.user?.tag || member.id} left the server.`).catch(() => {});
});

// Level roles: keep exactly the highest earned tier on the member's profile.
// Returns the newly-unlocked role name when this level-up crossed a threshold.
async function syncLevelRoles(member, lvl) {
  if (!member) return null;
  const earned = LEVEL_ROLES.filter((r) => lvl >= r.level);
  const target = earned[earned.length - 1] || null;
  let unlocked = null;
  for (const def of LEVEL_ROLES) {
    const role = findRole(member.guild, def.name);
    if (!role) continue;
    const has = member.roles.cache.has(role.id);
    if (def === target && !has) {
      await member.roles.add(role).catch(() => {});
      unlocked = def.name;
    } else if (def !== target && has) {
      await member.roles.remove(role).catch(() => {});
    }
  }
  return unlocked;
}

async function announceLevelUp(guild, user, member, lvl, fallbackCh) {
  const unlocked = await syncLevelRoles(member, lvl);
  const ch = findChannel(guild, 'general') || fallbackCh;
  ch?.send({ embeds: [new EmbedBuilder().setColor(0xf5b324)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setDescription(`🎉 GG <@${user.id}> — you reached **Level ${lvl}**!` +
      (unlocked ? `\n🏅 Role unlocked: **${unlocked}**` : '') +
      ' Keep chatting, hang out in voice and claim your `/daily` to level up. ⚡')] })
    .catch(() => {});
}

// ── Leveling: award XP per message (60s cooldown), announce level-ups ─────────
client.on(Events.MessageCreate, (m) => {
  if (m.author.bot || !m.guild) return;
  if (isTicketChannel(m.channel)) return;
  const now = Date.now();
  if (now - (xpCooldown.get(m.author.id) || 0) < 60_000) return;
  xpCooldown.set(m.author.id, now);
  const rec = XP[m.author.id] || (XP[m.author.id] = { xp: 0, lvl: 0 });
  const before = rec.lvl;
  rec.xp += 15 + Math.floor(Math.random() * 11);
  rec.lvl = levelFor(rec.xp);
  saveXP();
  if (rec.lvl > before && rec.lvl > 0) announceLevelUp(m.guild, m.author, m.member, rec.lvl, m.channel);
});

// ── Voice XP: 5 XP per minute in voice, capped at 2h/session ─────────────────
// Joining AFK (or going solo-deaf in AFK) earns nothing; switching rooms keeps
// the session running. Awarded when the member leaves voice.
const voiceSessions = new Map(); // userId -> { since, guildId }
const inRealVoice = (state) => !!state.channelId && state.channelId !== state.guild.afkChannelId;
client.on(Events.VoiceStateUpdate, (oldS, newS) => {
  try {
    if (newS.member?.user?.bot) return;
    const was = inRealVoice(oldS), is = inRealVoice(newS);
    if (!was && is) { voiceSessions.set(newS.id, { since: Date.now(), guildId: newS.guild.id }); return; }
    if (was && !is) {
      const s = voiceSessions.get(newS.id);
      voiceSessions.delete(newS.id);
      if (!s) return;
      const minutes = Math.min(120, Math.floor((Date.now() - s.since) / 60_000));
      if (minutes < 1) return;
      const rec = XP[newS.id] || (XP[newS.id] = { xp: 0, lvl: 0 });
      const before = rec.lvl;
      rec.xp += minutes * 5;
      rec.lvl = levelFor(rec.xp);
      saveXP();
      if (rec.lvl > before && rec.lvl > 0) {
        announceLevelUp(newS.guild, newS.member.user, newS.member, rec.lvl, null);
      }
    }
  } catch (e) { console.error('[voice-xp]', e.message); }
});

function rankCmd(i) {
  const rec = XP[i.user.id] || { xp: 0, lvl: 0 };
  const cur = xpForLevel(rec.lvl), next = xpForLevel(rec.lvl + 1);
  const prog = Math.max(0, Math.min(1, (rec.xp - cur) / Math.max(1, next - cur)));
  const bar = '█'.repeat(Math.round(prog * 14)).padEnd(14, '░');
  const sorted = Object.entries(XP).sort((a, b) => b[1].xp - a[1].xp);
  const rankN = sorted.findIndex(([id]) => id === i.user.id) + 1;
  const e = new EmbedBuilder().setColor(0xa855f7)
    .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
    .setTitle(`Level ${rec.lvl}`)
    .setDescription(`**Rank:** #${rankN || '—'}\n**XP:** ${rec.xp} / ${next}\n\`${bar}\` ${Math.round(prog * 100)}%`);
  return i.reply({ embeds: [e] });
}
function leaderboardCmd(i) {
  const top = Object.entries(XP).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
  const lines = top.map(([id, r], n) => `**${['🥇', '🥈', '🥉'][n] || `${n + 1}.`}** <@${id}> — Level ${r.lvl} · ${r.xp} XP`).join('\n') || 'No one has chatted yet — be the first!';
  const e = new EmbedBuilder().setColor(0xa855f7).setTitle('🏆 XP Leaderboard').setDescription(lines).setFooter({ text: 'Chat to earn XP' });
  return i.reply({ embeds: [e] });
}

// ── Outbox relay ──────────────────────────────────────────────────────────────
// The store queues Discord events (sales pings, drops, stock alerts, delivery
// DMs) when it has no webhooks/bot token of its own; we poll the signed
// endpoint every 60s and post them. This is what makes 'Discord automation'
// work with zero Vercel-side secrets.
const OUTBOX_CHANNEL = {
  leads: ['leads', 'staff-announcements'],
  deals: ['deals', 'restocks', 'announcements'],
  // #reviews has always claimed it fills itself after real orders; the store now
  // actually emits them, so route them there (falling back to #vouches).
  reviews: ['reviews', 'vouches'],
  // Public delivery proof. Falls back to #reviews so a server built before this
  // channel existed still shows them rather than silently dropping the event.
  proof: ['proof-of-delivery', 'reviews', 'vouches'],
};
/** Notification roles the bot may ping when relaying a store event. */
const OUTBOX_PING = { deals: ['Deals', 'Drops & Restocks'] };

/**
 * The game role for a store event, when it is about one game.
 *
 * A restock carries its product's category (fmPing.category from the store).
 * Someone who ticked "Roblox" in #roles gets the Robux restock; someone who did
 * not, does not. Without this every restock pinged everyone who opted into any
 * drop, which is the fastest way to teach a server to mute a role.
 *
 * The broad Drops & Restocks role still gets everything — that is what it says
 * on the tin, and it is a separate tick box.
 */
function gameRoleFor(guild, body) {
  const category = body?.fmPing?.category;
  if (!category) return null;
  const key = CATEGORY_GAME_ROLE[String(category).toLowerCase()];
  if (!key) return null;
  const spec = GAME_ROLES.find((g) => g.key === key);
  return spec ? findRole(guild, spec.label) : null;
}

/** Tell the store which events really landed, so the rest can be retried. */
async function ackOutbox(ids) {
  try {
    const ts = String(Date.now());
    const canonical = `ack:${[...new Set(ids.map(String))].sort().join(',')}`;
    const signature = createHmac('sha256', REVIEW_INGEST_SECRET).update(`${ts}.${canonical}`).digest('hex');
    const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/discord/outbox/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signature },
      body: JSON.stringify({ ids }),
    });
    // A store that has not deployed the ack endpoint yet returns 404. Say so
    // once rather than silently: without it every event is retried forever.
    if (!res.ok) console.error(`[outbox] ack ${res.status} — events will be re-offered`);
  } catch (e) { console.error('[outbox] ack failed:', e.message); }
}
async function pollOutbox(c) {
  if (!FORGEMARKET_API_URL || !REVIEW_INGEST_SECRET) return;
  try {
    const ts = String(Date.now());
    const signature = createHmac('sha256', REVIEW_INGEST_SECRET).update(`${ts}.outbox`).digest('hex');
    const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/discord/outbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signature },
      body: '{}',
    });
    if (!res.ok) throw new Error(`outbox ${res.status}`);
    const { events = [] } = await res.json();
    // Only ids that genuinely reached Discord are acknowledged. Anything that
    // throws, or has no channel to go to, stays queued on the store side and is
    // offered again once its lease expires — order pings ride this queue, and a
    // silently dropped one means a paid order nobody hears about.
    const delivered = [];
    for (const ev of events) {
      try {
        if (ev.channel === 'dm') {
          const { discordUserId, ...body } = ev.body || {};
          if (!discordUserId) { delivered.push(ev.id); continue; } // nothing to send to
          // A member with DMs closed will never accept this one; retrying it every
          // lease forever is worse than letting it go, so it counts as handled.
          await c.users.send(discordUserId, body)
            .then(() => delivered.push(ev.id))
            .catch((e) => {
              if (e?.code === 50007) { delivered.push(ev.id); return; } // cannot DM this user
              console.error('[outbox] dm failed:', e.message);
            });
          continue;
        }
        const guild = c.guilds.cache.first();
        if (!guild) continue;
        const names = OUTBOX_CHANNEL[ev.channel] || ['leads'];
        const ch = names.map((n) => findChannel(guild, n)).find(Boolean);
        if (!ch) continue;
        // Members opt into "Drops & Restocks" / "Deals" in #roles and, until now,
        // nothing ever pinged those roles — the opt-in led nowhere. The roles are
        // not mentionable by members, so this ping is ours alone to make.
        const game = gameRoleFor(guild, ev.body);
        const pingRoles = [
          ...(OUTBOX_PING[ev.channel] || []).map((n) => findRole(guild, n)),
          game,
        ].filter(Boolean);
        // De-duplicated by id: a role that is both the broad one and the game
        // one would otherwise be mentioned twice in the same line.
        const pingIds = [...new Set(pingRoles.map((r) => r.id))];
        // `fmPing` is ours; Discord never sees it.
        const { fmPing, ...payload } = ev.body || {};
        const body = pingIds.length
          ? { ...payload,
              content: [...pingIds.map((id) => `<@&${id}>`), payload.content].filter(Boolean).join(' '),
              allowedMentions: { roles: pingIds } }
          : payload;
        const sent = await ch.send(body).catch((e) => {
          console.error(`[outbox] #${ch.name} send failed:`, e.message);
          return null;
        });
        if (sent) delivered.push(ev.id);
        // #announcements is an announcement channel; publishing is the only
        // reason to use that type, and nothing was ever crossposted.
        if (sent && ch.type === ChannelType.GuildAnnouncement) await sent.crosspost().catch(() => {});
      } catch (e) { console.error('[outbox] event failed:', e.message); }
    }
    if (delivered.length) await ackOutbox(delivered);
    if (events.length) {
      const stuck = events.length - delivered.length;
      console.log(`📮 [outbox] relayed ${delivered.length}/${events.length} store event(s)` +
        (stuck ? ` · ${stuck} left queued for retry` : ''));
    }
  } catch (e) {
    // 404 = the store hasn't deployed the outbox yet; stay quiet about it.
    if (!/outbox 404/.test(e.message)) console.error('[outbox]', e.message);
  }
}

// ── Order status (shared by /order, ticket auto-lookup and the ticket form) ──
async function orderStatusEmbed(num) {
  if (!FORGEMARKET_API_URL) return null;
  try {
    const res = await fetch(`${FORGEMARKET_API_URL}/api/track/${encodeURIComponent(num)}`);
    if (!res.ok) return null;
    const v = orderStatusView(await res.json(), { money });
    return new EmbedBuilder().setColor(v.color)
      .setAuthor({ name: v.author, iconURL: BRAND_ICON })
      .setTitle(v.title).setDescription(v.description || null)
      .addFields(...v.fields)
      .setFooter({ text: 'Live from the store' }).setTimestamp();
  } catch { return null; }
}

async function lookupOrder(i) {
  await i.deferReply({ ephemeral: true });
  const num = i.options.getString('number').trim();
  if (!FORGEMARKET_API_URL) return i.editReply('Order lookup isn’t configured yet.');
  const e = await orderStatusEmbed(num);
  if (!e) {
    return i.editReply(`No order found for \`${num}\`. Order numbers look like \`FM-2026-XXXXXXXX\` — ` +
      'check the confirmation email, or open a ticket in #open-a-ticket and we’ll look it up for you.');
  }
  // The track page is the live version of this embed and needs no account, so
  // the buyer never has to come back and re-run the command to refresh.
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Live status page').setStyle(ButtonStyle.Link)
      .setURL(`${STORE_URL}/track?number=${encodeURIComponent(num)}`),
  );
  return i.editReply({ embeds: [e], components: [row] });
}

// ── /vouch → posts to #vouches ────────────────────────────────────────────────
const vouchLastAt = new Map(); // userId → ts of their last vouch (anti-spam)
async function postVouch(i) {
  // A vouch is mirrored onto the storefront, where the page promises reviews
  // come from real customers. A brand-new unverified account must not be able
  // to write there — that is how a review section stops meaning anything.
  const verified = findRole(i.guild, 'Verified Customer');
  if (verified && !i.member?.roles?.cache?.has(verified.id) && !isStaff(i.member)) {
    return i.reply({
      content: `Verify first in ${chanRef(i.guild, 'verify')} before leaving a vouch 💚`,
      ephemeral: true,
    });
  }
  const message = i.options.getString('message');
  const stars = Math.min(5, Math.max(1, i.options.getInteger('stars') || 5));
  // One vouch per user per hour — keeps #vouches and the site honest.
  const last = vouchLastAt.get(i.user.id) || 0;
  if (Date.now() - last < 3_600_000) {
    return i.reply({ content: 'You already vouched recently — thank you! You can vouch again in a bit. 💚', ephemeral: true });
  }
  vouchLastAt.set(i.user.id, Date.now());
  const ch = findChannel(i.guild, 'vouches') || findChannel(i.guild, 'vouchers');
  const e = new EmbedBuilder().setColor(0x22c55e)
    .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
    .setDescription(`${'⭐'.repeat(stars)}\n\n${message}`)
    .setFooter({ text: 'Community vouch' }).setTimestamp();
  if (ch) await ch.send({ embeds: [e] }).catch(() => {});
  // Mirror the vouch onto the website's reviews section. externalId is keyed to
  // the USER (not the interaction), so the server-side dedup allows at most one
  // site review per Discord member — repeat /vouch spam can never flood the
  // storefront with fake ratings.
  pushReviewToSite({
    author: i.user.username,
    avatarUrl: i.user.displayAvatarURL({ extension: 'png', size: 128 }),
    stars, body: message, externalId: `vouch:${i.user.id}`,
    // Ties this vouch to a ForgeMarket account, which is what earns the
    // reviewer role on the site. Signed along with the rest of the payload.
    discordUid: i.user.id,
  });
  // Someone who just wrote something nice is the only person who will ever
  // bother writing it twice. Asking here — and only here — is why this line is
  // in the vouch reply rather than pinned somewhere nobody reads.
  /* Staff have to be told, or nothing happens.
     A vouch arrives on the site as PENDING and waits for a person to publish
     it. Nothing anywhere said one was waiting, so they accumulate in an admin
     list nobody opens while the storefront keeps saying "no reviews yet" — on a
     shop whose single biggest conversion problem is having none. */
  leadLog(i.guild, `⭐ New vouch from <@${i.user.id}> (${stars}/5) — waiting to be published: `
    + `${tagged(`${STORE_URL}/admin/social`, 'vouch')}`);

  /* And tell the member what actually happened.
     This said "posted in #vouchers AND on the website". It is posted in
     #vouchers; on the website it is pending review. Somebody who just wrote
     something nice and then went to look for it would have found nothing, which
     is the worst possible thing to do to the one person willing to advocate. */
  return i.reply({
    ephemeral: true,
    content: 'Thanks for the vouch! 💚 It is up in #vouchers now, and it goes on the website '
      + 'once a person has read it — reviews there only ever come from real people, so each one is checked.'
      + (TRUSTPILOT_REVIEW_URL ? `\n\n⭐ Would you put it on Trustpilot too? It helps more than you'd think: ${TRUSTPILOT_REVIEW_URL}` : ''),
  });
}

// ── /price → live price lookup from the real catalog ─────────────────────────
async function priceCmd(i) {
  await i.deferReply({ ephemeral: true });
  const q = i.options.getString('product').toLowerCase().trim();
  const products = await getProducts();
  if (!products.length) return i.editReply(`I can’t reach the catalog right now — browse ${tagged(`${STORE_URL}/shop`, 'price')} 🛍️`);
  const scored = products
    .map((p) => {
      const name = p.name.toLowerCase();
      let score = 0;
      if (name === q) score = 100;
      else if (name.includes(q)) score = 60 + q.length;
      else score = q.split(/\s+/).filter((w) => w.length > 1 && name.includes(w)).length * 20;
      if ((p.category || '').includes(q.replace(/\s+/g, '-'))) score += 15;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    return i.editReply(`No product matching **${q}** — see the full list in #price-list or at ${tagged(`${STORE_URL}/shop`, 'price')}`);
  }
  const top = scored.slice(0, 5);
  const best = top[0].p;
  const d = deliveryFor(best.category);
  const cta = await shopLink(`${STORE_URL}/product/${best.id}`);
  const e = new EmbedBuilder().setColor(0x6366f1)
    .setTitle(`🏷️ ${best.name}`)
    .setDescription(
      `**${money(best.price, best.currency)}**\n${cta}` +
      /* The other matches were plain text.
         Someone who typed /price robux and wanted the 2,000 pack could see it
         listed, with its price, and then had to go and find it themselves —
         one search away from a product we had already identified for them. */
      (top.length > 1
        ? `\n\n**Also matching:**\n${top.slice(1).map(({ p }) =>
          `• [${p.name}](${STORE_URL}/product/${p.id}) — ${money(p.price, p.currency)}`).join('\n')}`
        : ''))
    // The store already computes an honest availability flag per product —
    // `instant` is true only when a code is in stock AND the product
    // auto-delivers. Showing it here answers the question behind /price
    // ("when do I get it?") with the same answer the product page gives.
    .addFields({ name: '⏱️ When you get it', value: availabilityLine(best) })
    .addFields({ name: '📦 How it’s delivered', value: d.method.slice(0, 1024) })
    .setFooter({ text: 'Live prices from the store · use /delivery for full steps' });
  return i.editReply({ embeds: [e] });
}

// ── /delivery → full per-category delivery explanation ───────────────────────
async function deliveryCmd(i) {
  const q = (i.options.getString('product') || '').toLowerCase().trim();
  // Match a category by keyword; default to Robux (our most-asked product).
  const map = { robux: 'robux', roblox: 'robux', vbucks: 'v-bucks', 'v-bucks': 'v-bucks', fortnite: 'v-bucks' };
  const key = Object.keys(map).find((k) => q.includes(k));
  const category = key ? map[key] : (q || 'robux');
  const d = deliveryFor(category);
  const label = category === 'v-bucks' ? 'V-Bucks' : category === 'robux' ? 'Robux' : 'your order';
  const e = new EmbedBuilder().setColor(0x7c5cff)
    .setTitle(`📦 How ${label} is delivered`)
    .setThumbnail(BRAND_ICON)
    .setDescription(d.method)
    .addFields(
      { name: 'Steps', value: d.steps.map((s, n) => `**${n + 1}.** ${s}`).join('\n').slice(0, 1024) },
      { name: 'Good to know', value: d.notes.map((n) => `• ${n}`).join('\n').slice(0, 1024) })
    .setFooter({ text: 'ForgeMarket · money back if it never arrives' });
  return i.reply({ embeds: [e], ephemeral: true });
}

// ── /drops → upcoming drops from the store's drop calendar ───────────────────
async function dropsCmd(i) {
  await i.deferReply();
  let drops = [];
  try {
    const res = await fetch(`${FORGEMARKET_API_URL}/api/drops`);
    if (res.ok) drops = (await res.json()).drops || [];
  } catch { /* offline */ }
  const e = new EmbedBuilder().setColor(0x7c5cff).setTitle('📅 Upcoming drops')
    .setThumbnail(BRAND_ICON).setImage(BANNER('deals'))
    .setFooter({ text: 'ForgeMarket · turn on 🔔 Drops in #roles' });
  if (!drops.length) {
    e.setDescription(`No drops scheduled right now — check ${STORE_URL}/drops or watch this space. 👀`);
  } else {
    e.setDescription(drops.slice(0, 10).map((d) => {
      const ts = Math.floor(new Date(d.startsAt).getTime() / 1000);
      return `**${d.title}**${d.category ? ` · ${d.category}` : ''}\n<t:${ts}:F> · <t:${ts}:R>${d.note ? `\n_${d.note}_` : ''}`;
    }).join('\n\n'));
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('📅 Full calendar').setStyle(ButtonStyle.Link).setURL(`${STORE_URL}/drops`));
  return i.editReply({ embeds: [e], components: [row] });
}

// ── /poll → quick reaction poll (up to 4 options) ────────────────────────────
const POLL_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
async function pollCmd(i) {
  const question = i.options.getString('question');
  const options = [1, 2, 3, 4]
    .map((n) => i.options.getString(`option${n}`))
    .filter(Boolean);
  const isYesNo = options.length === 0;
  const e = new EmbedBuilder().setColor(0xa855f7).setTitle(`📊 ${question}`)
    .setDescription(isYesNo
      ? 'Vote with 👍 or 👎'
      : options.map((o, n) => `${POLL_EMOJI[n]} ${o}`).join('\n'))
    .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
    .setFooter({ text: 'ForgeMarket poll' }).setTimestamp();
  await i.reply({ embeds: [e] });
  const msg = await i.fetchReply();
  const reactions = isYesNo ? ['👍', '👎'] : POLL_EMOJI.slice(0, options.length);
  for (const r of reactions) await msg.react(r).catch(() => {});
}

// ── /daily → daily XP claim with streaks ─────────────────────────────────────
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
async function dailyCmd(i) {
  const rec = XP[i.user.id] || (XP[i.user.id] = { xp: 0, lvl: 0 });
  const today = dayKey();
  if (rec.daily?.last === today) {
    return i.reply({ ephemeral: true, content: `You already claimed today — come back tomorrow to keep your **${rec.daily.streak}-day streak** going! 🔥` });
  }
  const yesterday = dayKey(Date.now() - 86_400_000);
  const streak = rec.daily?.last === yesterday ? (rec.daily.streak || 0) + 1 : 1;
  const bonus = 50 + 10 * Math.min(streak, 10); // 60 XP day 1 → caps at 150/day
  rec.daily = { last: today, streak };
  const before = rec.lvl;
  rec.xp += bonus;
  rec.lvl = levelFor(rec.xp);
  saveXP();
  const lvlUp = rec.lvl > before ? `\n🎉 **Level up!** You’re now level ${rec.lvl}.` : '';
  return i.reply({ content:
    `✅ Daily claimed: **+${bonus} XP** · streak **${streak} day${streak > 1 ? 's' : ''}** 🔥` +
    `${streak < 10 ? ` (bonus grows every day up to 10)` : ' (max bonus!)'}${lvlUp}` });
}

// ── Anti-raid: alert staff on a join-rate spike ──────────────────────────────
const recentJoins = [];
let lastRaidAlert = 0;
function trackJoinForRaid(guild) {
  const now = Date.now();
  recentJoins.push(now);
  while (recentJoins.length && recentJoins[0] < now - 60_000) recentJoins.shift();
  if (recentJoins.length >= 8 && now - lastRaidAlert > 10 * 60_000) {
    lastRaidAlert = now;
    const log = findChannel(guild, 'mod-log');
    log?.send({
      content: '@here',
      embeds: [new EmbedBuilder().setColor(0xef4444).setTitle('🚨 Possible raid')
        .setDescription(`**${recentJoins.length} accounts joined in the last 60 seconds.**\n` +
          'Consider enabling higher verification (Server Settings → Safety Setup → raid protection) and watch #mod-log.')
        .setTimestamp()],
      allowedMentions: { parse: ['everyone'] },
    }).catch(() => {});
  }
}

// ── Boost thank-you + member milestones ──────────────────────────────────────
client.on(Events.GuildMemberUpdate, (oldM, newM) => {
  if (!oldM.premiumSince && newM.premiumSince) {
    const ch = findChannel(newM.guild, 'general') || findChannel(newM.guild, 'announcements');
    ch?.send({ embeds: [new EmbedBuilder().setColor(0xf47fff)
      .setDescription(`💎 **<@${newM.id}> just boosted the server!** Thank you — enjoy the extra love from the team. 💜`)] })
      .catch(() => {});
    leadLog(newM.guild, `💎 New boost from <@${newM.id}> (total ${newM.guild.premiumSubscriptionCount || 0})`);
  }
});

function celebrateMilestone(guild) {
  const n = guild.memberCount;
  if (n > 0 && n % 100 === 0) {
    const ch = findChannel(guild, 'general') || findChannel(guild, 'announcements');
    ch?.send({ embeds: [new EmbedBuilder().setColor(0xf5b324)
      .setTitle(`🎉 ${n} members!`)
      .setImage(BANNER('welcome'))
      .setDescription(`We just hit **${n} members** — thank you all! Keep an eye on #giveaways, something special might drop soon… 👀`)] })
      .catch(() => {});
  }
}

// ── Weekly XP leaderboard → #general every Monday evening ────────────────────
const META_FILE = new URL('../bot-meta.json', import.meta.url);
let META = {};
async function loadMeta() {
  const stored = await stateGet('meta', META_FILE);
  if (stored && typeof stored === 'object') META = { ...stored, ...META };
}
const saveMeta = () => { stateSet('meta', META, META_FILE); };

function maybePostWeeklyLeaderboard(guild) {
  const now = new Date();
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 17) return; // Mondays from 17:00 UTC
  const week = `${now.getUTCFullYear()}-w${Math.ceil(((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / 86_400_000 + 1) / 7)}`;
  if (META.lastWeeklyPost === week) return;
  const top = Object.entries(XP).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
  if (!top.length) return;
  META.lastWeeklyPost = week;
  saveMeta();
  const ch = findChannel(guild, 'general');
  if (!ch) return;
  const lines = top.map(([id, r], n) =>
    `**${['🥇', '🥈', '🥉'][n] || `${n + 1}.`}** <@${id}> — Level ${r.lvl} · ${r.xp} XP`).join('\n');
  ch.send({ embeds: [new EmbedBuilder().setColor(0xa855f7)
    .setTitle('🏆 Weekly XP leaderboard')
    .setThumbnail(BRAND_ICON)
    .setDescription(`${lines}\n\nChat to earn XP and don’t forget your \`/daily\` streak! 🔥`)
    .setFooter({ text: 'Posted every Monday' }).setTimestamp()] }).catch(() => {});
}

// ── /flashsale (staff) → limited-time deal with a live countdown ─────────────
// Uses Discord's relative timestamps (<t:…:R>) so the countdown ticks client-side
// without any message editing; the embed is greyed out automatically when it ends.
async function flashSale(i) {
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can start a flash sale.', ephemeral: true });
  const deal = i.options.getString('deal');
  const minutes = Math.min(24 * 60, Math.max(5, i.options.getInteger('minutes') || 60));
  const code = i.options.getString('code');
  const endsAt = Math.floor((Date.now() + minutes * 60_000) / 1000);
  const ch = findChannel(i.guild, 'deals') || findChannel(i.guild, 'discount-codes') || i.channel;
  const dealRole = i.guild.roles.cache.find((r) => r.name === 'Deals');

  const e = new EmbedBuilder().setColor(0xef4444).setTitle('⚡ FLASH SALE')
    .setImage(BANNER('deals'))
    .setThumbnail(BRAND_ICON)
    .setDescription(
      `**${deal}**\n\n` +
      (code ? `Use code **\`${code.toUpperCase()}\`** at checkout.\n` : '') +
      `🛒 ${STORE_URL}/shop\n\n` +
      `⏳ Ends <t:${endsAt}:R> (at <t:${endsAt}:t>)`)
    .setFooter({ text: 'ForgeMarket · limited time' }).setTimestamp();
  const msg = await ch.send({
    content: dealRole ? `<@&${dealRole.id}>` : '',
    embeds: [e],
    allowedMentions: dealRole ? { roles: [dealRole.id] } : { parse: [] },
  });
  // Grey out the post when the sale ends (best-effort; survives a restart only
  // visually via the timestamp, which is fine — the countdown itself is live).
  setTimeout(() => {
    const ended = EmbedBuilder.from(msg.embeds[0]).setColor(0x64748b)
      .setTitle('⚡ FLASH SALE — ENDED')
      .setDescription(`**${deal}**\n\nThis flash sale has ended — keep an eye on <#${ch.id}> for the next one! 👀`);
    msg.edit({ embeds: [ended] }).catch(() => {});
  }, minutes * 60_000);
  leadLog(i.guild, `⚡ Flash sale started by <@${i.user.id}>: "${deal}" (${minutes} min${code ? `, code ${code.toUpperCase()}` : ''})`);
  return i.reply({ content: `Flash sale live in <#${ch.id}> — ends in **${minutes} min**.`, ephemeral: true });
}

// ── Site watchdog: page staff if the store API goes down ─────────────────────
// Checked every 15 min; one alert per hour max, plus a recovery message the
// moment it comes back — downtime should never go unnoticed.
let siteWasDown = false;
let lastDownAlert = 0;
async function checkSiteHealth(guild) {
  if (!FORGEMARKET_API_URL) return;
  const probe = async (timeoutMs) => {
    try {
      const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/health`,
        { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch { return false; }
  };
  // A serverless cold start + a sleeping Neon database can take 15-25s to wake
  // — that's not an outage. Only alert when a RETRY (after 20s, with a longer
  // timeout) also fails, so deploy/idle wake-ups never page staff.
  let ok = await probe(15_000);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 20_000));
    ok = await probe(28_000);
  }

  const ch = findChannel(guild, 'mod-log') || findChannel(guild, 'staff-announcements');
  if (!ok && (!siteWasDown || Date.now() - lastDownAlert > 60 * 60_000)) {
    siteWasDown = true;
    lastDownAlert = Date.now();
    ch?.send({ content: '@here', allowedMentions: { parse: ['everyone'] },
      embeds: [new EmbedBuilder().setColor(0xef4444).setTitle('🔴 Store API is DOWN')
        .setDescription(`\`${FORGEMARKET_API_URL}/api/health\` is not responding.\nCustomers may not be able to order — check Vercel + Neon status.`)
        .setTimestamp()] }).catch(() => {});
  } else if (ok && siteWasDown) {
    siteWasDown = false;
    ch?.send({ embeds: [new EmbedBuilder().setColor(0x10b981).setTitle('🟢 Store API recovered')
      .setDescription('Health checks are passing again.').setTimestamp()] }).catch(() => {});
  }
}

// ── Staff digest: live store numbers via the signed digest endpoint ──────────
async function fetchDigest() {
  if (!FORGEMARKET_API_URL || !REVIEW_INGEST_SECRET) return null;
  try {
    const ts = String(Date.now());
    const signature = createHmac('sha256', REVIEW_INGEST_SECRET).update(`${ts}.digest`).digest('hex');
    const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/discord/digest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signature },
      body: '{}',
    });
    if (!res.ok) throw new Error(`digest ${res.status}`);
    return await res.json();
  } catch (e) { console.error('[digest]', e.message); return null; }
}

function digestEmbed(d) {
  const w = d.week || {};
  const top = (d.topProducts || []).map((p, i) =>
    `${i + 1}. ${p.name} — ${money(p.revenue ?? 0)} (${p.units ?? 0}×)`).join('\n') || '—';
  const low = (d.lowStock || []).map((p) => `• ${p.name}: **${p.available}** left`).join('\n') || 'All stocked ✅';
  return new EmbedBuilder().setColor(0x6366f1)
    .setTitle('📈 Weekly store digest')
    .setThumbnail(BRAND_ICON)
    .addFields(
      { name: '💶 Revenue (7d)', value: money(w.revenue || 0), inline: true },
      { name: '🧾 Paid orders (7d)', value: String(w.paidOrders ?? 0), inline: true },
      { name: '⏳ Pending now', value: String(d.pendingOrders ?? 0), inline: true },
      { name: '🏆 Top products (7d)', value: top.slice(0, 1024) },
      { name: '📦 Low stock', value: low.slice(0, 1024) })
    .setFooter({ text: 'ForgeMarket · live from the store' }).setTimestamp();
}

function maybePostWeeklyDigest(guild) {
  const now = new Date();
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 8) return; // Monday morning
  const week = `${now.getUTCFullYear()}-dw${Math.ceil(((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / 86_400_000 + 1) / 7)}`;
  if (META.lastDigestPost === week) return;
  fetchDigest().then((d) => {
    if (!d) return;
    const ch = findChannel(guild, 'staff-announcements') || findChannel(guild, 'leads');
    if (!ch) return;
    META.lastDigestPost = week;
    saveMeta();
    ch.send({ embeds: [digestEmbed(d)] }).catch(() => {});
  });
}

/**
 * /ref — your referral code, your link and what it has earned.
 *
 * The affiliate program has run server-side since it was built: one code per
 * account, ?ref= attribution on arrival, a commission on every paid order the
 * referred customer places. None of it was reachable from Discord — the place
 * this shop's customers actually are — so the only way to find your own code
 * was to know the account page existed.
 *
 * Ephemeral, because a referral link in a public channel is one someone else
 * can take, and because the earnings are nobody else's business.
 */
async function refCmd(i) {
  await i.deferReply({ ephemeral: true });
  if (!FORGEMARKET_API_URL || !REVIEW_INGEST_SECRET) {
    return i.editReply('The store link isn’t configured yet — ask staff to set REVIEW_INGEST_SECRET.');
  }
  let d = null;
  try {
    const ts = String(Date.now());
    const signature = createHmac('sha256', REVIEW_INGEST_SECRET)
      .update(`${ts}.referral:${i.user.id}`).digest('hex');
    const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/discord/referral`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signature },
      body: JSON.stringify({ uid: i.user.id }),
    });
    if (res.ok) d = await res.json();
  } catch (e) { console.error('[ref]', e.message); }
  if (!d) return i.editReply('Couldn’t reach the store right now — try again in a minute.');
  if (!d.linked) {
    return i.editReply({ embeds: [new EmbedBuilder().setColor(0xf59e0b)
      .setTitle('🔗 Link your Discord first')
      .setDescription(`Sign in on the store with **Discord** and your referral link shows up here.\n\n👉 ${STORE_URL}/login`)
      .setFooter({ text: 'ForgeMarket · account link' })] });
  }
  /* What it has earned, and only when it has earned something. A row of zeros
     is the shop telling a member their link does not work — the same reason the
     storefront hides an empty review count rather than printing 0.0. */
  const earned = (d.totalCents || 0) > 0;
  const e = new EmbedBuilder().setColor(0xa855f7)
    .setTitle('🤝 Your referral link')
    .setThumbnail(BRAND_ICON)
    .setDescription(
      `Share this and you earn **${d.commissionPercent}%** of what they spend, on every order they place — not just the first.\n\n`
      + `\`\`\`${d.url}\`\`\``)
    .addFields({ name: 'Your code', value: `\`${d.code}\``, inline: true });
  if (earned) {
    e.addFields(
      { name: 'Referrals', value: String(d.referrals || 0), inline: true },
      { name: 'Their orders', value: String(d.orders || 0), inline: true },
      { name: '⏳ Pending', value: money(d.pendingCents || 0), inline: true },
      { name: '✅ Paid out', value: money(d.paidCents || 0), inline: true });
  } else {
    e.addFields({ name: 'Earned so far', value: 'Nothing yet — nobody has ordered through it.', inline: false });
  }
  return i.editReply({ embeds: [e.setFooter({ text: 'ForgeMarket · referrals' })] });
}

// /balance — member self-service: Forge Coins + store credit + loyalty tier,
// looked up via the signed balance endpoint (uid is bound into the signature).
async function balanceCmd(i) {
  await i.deferReply({ ephemeral: true });
  if (!FORGEMARKET_API_URL || !REVIEW_INGEST_SECRET) {
    return i.editReply('The store link isn’t configured yet — ask staff to set REVIEW_INGEST_SECRET.');
  }
  let d = null;
  try {
    const ts = String(Date.now());
    const signature = createHmac('sha256', REVIEW_INGEST_SECRET)
      .update(`${ts}.balance:${i.user.id}`).digest('hex');
    const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/discord/balance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signature },
      body: JSON.stringify({ uid: i.user.id }),
    });
    if (res.ok) d = await res.json();
  } catch (e) { console.error('[balance]', e.message); }
  if (!d) return i.editReply('Couldn’t reach the store right now — try again in a minute.');
  if (!d.linked) {
    return i.editReply({ embeds: [new EmbedBuilder().setColor(0xf59e0b)
      .setTitle('🔗 Link your Discord first')
      .setDescription(`Sign in on the store with **Discord** and your balance shows up here.\n\n👉 ${STORE_URL}/login`)
      .setFooter({ text: 'ForgeMarket · account link' })] });
  }
  return i.editReply({ embeds: [new EmbedBuilder().setColor(0x6366f1)
    .setTitle('💰 Your ForgeMarket balance')
    .setThumbnail(BRAND_ICON)
    .addFields(
      { name: '🪙 Forge Coins', value: String(d.coins ?? 0), inline: true },
      { name: '💶 Store credit', value: money(d.creditCents || 0), inline: true },
      { name: '🏅 Loyalty tier', value: d.tier || '—', inline: true })
    .setDescription(`Spend coins in the [Forge Shop](${STORE_URL}/account/forge-shop) — store credit applies automatically at checkout.`)
    .setFooter({ text: 'ForgeMarket · live from your account' }).setTimestamp()] });
}

// /digest + /stock — staff-only, on demand
async function digestCmd(i) {
  if (!isOwnerLevel(i.member)) return i.reply(OWNER_ONLY);
  await i.deferReply({ ephemeral: true });
  const d = await fetchDigest();
  if (!d) return i.editReply('Couldn’t reach the store digest — check FORGEMARKET_API_URL & REVIEW_INGEST_SECRET.');
  return i.editReply({ embeds: [digestEmbed(d)] });
}

async function stockCmd(i) {
  if (!isOwnerLevel(i.member)) return i.reply(OWNER_ONLY);
  await i.deferReply({ ephemeral: true });
  const d = await fetchDigest();
  if (!d) return i.editReply('Couldn’t reach the store — check FORGEMARKET_API_URL & REVIEW_INGEST_SECRET.');
  const low = (d.lowStock || []).map((p) => `• ${p.name}: **${p.available}** codes left`).join('\n');
  return i.editReply({ embeds: [new EmbedBuilder().setColor(low ? 0xf59e0b : 0x10b981)
    .setTitle(low ? '🟠 Low stock' : '✅ Stock levels healthy')
    .setDescription(low || 'Every active product has enough pre-loaded codes.')
    .setFooter({ text: 'ForgeMarket · stock monitor' }).setTimestamp()] });
}

// /launch — staff: live "can I sell today?" readiness report from the store
async function launchCmd(i) {
  if (!isOwnerLevel(i.member)) return i.reply(OWNER_ONLY);
  await i.deferReply({ ephemeral: true });
  const d = await fetchDigest();
  if (!d?.launch) return i.editReply('Couldn’t reach the store — check FORGEMARKET_API_URL & REVIEW_INGEST_SECRET.');
  const MARK = { ok: '✅', warn: '🟡', fail: '🔴' };
  const lines = d.launch.checks.map((c) => `${MARK[c.status]} **${c.label}** — ${c.detail}`).join('\n');
  return i.editReply({ embeds: [new EmbedBuilder()
    .setColor(d.launch.ready ? 0x10b981 : 0xef4444)
    .setTitle(d.launch.ready ? '🚀 Ready to sell' : '⛔ Not ready to sell yet')
    .setDescription(`${lines}\n\n_${d.launch.summary}_`)
    .setThumbnail(BRAND_ICON)
    .setFooter({ text: 'ForgeMarket · live launch check' }).setTimestamp()] });
}

// ── Daily vouch spotlight → #general (social proof on autopilot) ─────────────
async function maybeVouchSpotlight(guild) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (META.lastSpotlight === today) return;
    const hour = new Date().getUTCHours();
    if (hour < 15) return; // afternoon post (17:00 NL)
    const src = findChannel(guild, 'vouches') || findChannel(guild, 'vouchers');
    const dst = findChannel(guild, 'general');
    if (!src || !dst) return;
    const msgs = await src.messages.fetch({ limit: 50 }).catch(() => null);
    if (!msgs) return;
    const week = Date.now() - 7 * 86_400_000;
    const candidates = [...msgs.values()].filter((m) =>
      m.createdTimestamp > week && m.embeds[0]?.description?.includes('⭐'));
    if (!candidates.length) return;
    META.lastSpotlight = today;
    saveMeta();
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const e = EmbedBuilder.from(pick.embeds[0]).setColor(0x22c55e)
      .setFooter({ text: 'Vouch spotlight · leave yours with /vouch' });
    await dst.send({ content: '💚 **Vouch of the day**', embeds: [e] });
  } catch (e) { console.error('[spotlight]', e.message); }
}

// ── Ticket QoL: paste an order number → instant live status ──────────────────
const ORDER_RE = /\bFM-\d{4}-[A-Z0-9]{4,}\b/i;
const orderLookupCooldown = new Map(); // channelId -> ts
client.on(Events.MessageCreate, async (m) => {
  try {
    if (m.author.bot || !m.guild || !FORGEMARKET_API_URL) return;
    const match = m.content.match(ORDER_RE);
    if (!match) return;
    const now = Date.now();
    if (now - (orderLookupCooldown.get(m.channel.id) || 0) < 60_000) return; // 1/min per channel
    orderLookupCooldown.set(m.channel.id, now);

    // Inside a ticket the channel is private (owner + staff only), so posting the
    // status saves everyone a round trip.
    if (m.channel.topic?.startsWith('ticket-owner:')) {
      const e = await orderStatusEmbed(match[0].toUpperCase());
      if (e) await m.reply({ embeds: [e] });
      return;
    }
    // In a public channel we must NOT post it: the number may not be theirs, and
    // the status carries the order total. Point them at the private command
    // instead — most people paste a number because they don't know it exists.
    await m.reply({
      content: `Looking for that order? Run \`/order ${match[0].toUpperCase()}\` — the answer is only visible to you. ` +
        'Heads up: an order number is personal, better not to post it in public. \u{1F512}',
      allowedMentions: { repliedUser: true },
    }).catch(() => {});
  } catch { /* best-effort */ }
});

/**
 * /paylink — attach a payment request with the exact amount to an order.
 *
 * The owner gets a Discord ping the second an order lands. Making the request in
 * the bank app and pasting it back here takes ten seconds, and it removes the
 * whole "customer typed the wrong amount / forgot the reference" problem — the
 * buyer's status page is already polling, so the button appears for them without
 * a refresh.
 */
async function payLinkCmd(i) {
  if (!isOwnerLevel(i.member)) return i.reply(OWNER_ONLY);
  await i.deferReply({ ephemeral: true });
  if (!FORGEMARKET_API_URL || !REVIEW_INGEST_SECRET) {
    return i.editReply('Payment links aren’t configured — the store link or the shared secret is missing.');
  }
  const number = i.options.getString('order').trim().toUpperCase();
  const url = i.options.getString('link').trim();
  try {
    const ts = String(Date.now());
    const signature = createHmac('sha256', REVIEW_INGEST_SECRET)
      .update(`${ts}.paylink:${number}:${url}`).digest('hex');
    const res = await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/discord/pay-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signature },
      body: JSON.stringify({ number, url }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return i.editReply(`⚠️ ${d.error || `Couldn’t attach that link (${res.status}).`}`);
    return i.editReply(
      `✅ Payment link attached to **${d.number}** (${d.total}).\n` +
      'The buyer sees a "pay this exact amount" button on their status page right away — no refresh needed.');
  } catch (e) {
    console.error('[paylink]', e.message);
    return i.editReply('Couldn’t reach the store right now — try again in a minute.');
  }
}

// ── /coupon (staff) → posts a discount code to #discount-codes ────────────────
async function postCoupon(i) {
  if (!isOwnerLevel(i.member)) return i.reply(OWNER_ONLY);
  const code = i.options.getString('code').toUpperCase();
  const percent = Math.min(90, Math.max(1, i.options.getInteger('percent') || 10));
  const note = i.options.getString('note') || 'Redeem at checkout on the website.';
  const ch = findChannel(i.guild, 'discount-codes') || i.channel;
  const e = new EmbedBuilder().setColor(0xec4899).setTitle('🏷️ New discount code!')
    .setImage(BANNER('deals'))
    .setDescription(`Use code **\`${code}\`** for **${percent}% OFF** your order.\n\n${note}`)
    .addFields({ name: 'Code', value: `\`${code}\``, inline: true }, { name: 'Discount', value: `${percent}%`, inline: true })
    .setFooter({ text: 'ForgeMarket • limited time' }).setTimestamp();
  const dealRole = i.guild.roles.cache.find((r) => r.name === 'Deals');
  await ch.send({ content: dealRole ? `<@&${dealRole.id}>` : '', embeds: [e] }).catch(() => {});
  return i.reply({ content: `Posted code **${code}** in <#${ch.id}>. (Add it to the site's COUPONS env to make it work at checkout.)`, ephemeral: true });
}

// ── /announce (staff) → posts to #announcements ───────────────────────────────
async function postAnnounce(i) {
  if (!isOwnerLevel(i.member)) return i.reply(OWNER_ONLY);
  const message = i.options.getString('message');
  const ch = findChannel(i.guild, 'announcements') || i.channel;
  const e = new EmbedBuilder().setColor(0x6366f1).setTitle('📢 Announcement')
    .setDescription(message).setFooter({ text: `Posted by ${i.user.username}` }).setTimestamp();
  await ch.send({ content: '@everyone', embeds: [e], allowedMentions: { parse: ['everyone'] } }).catch(() => {});
  return i.reply({ content: `Announcement posted in <#${ch.id}>.`, ephemeral: true });
}

// ── /clearpins (staff) → wipe every "X pinned a message" system notice ────────
// Discord posts a small "pinned a message to this channel" system message every
// time something is pinned (our setup panels do this on boot). This deletes all
// of them, in every text channel at once — handy after a resync.
const PIN_NOTICE = MessageType.ChannelPinnedMessage; // system pin notification (6)

async function purgePinNoticesIn(channel) {
  let deleted = 0;
  let before;
  // Walk history in pages of 100; stop when a page comes back empty or we hit
  // the safety cap (≈2000 messages) so a huge channel can't run forever.
  for (let page = 0; page < 20; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch || batch.size === 0) break;
    before = batch.last().id;
    for (const msg of batch.values()) {
      if (msg.type !== PIN_NOTICE) continue;
      // System messages can be any age, so delete them one by one (bulkDelete
      // refuses messages older than 14 days).
      if (await msg.delete().then(() => true).catch(() => false)) deleted++;
    }
  }
  return deleted;
}

async function clearPinsCmd(i) {
  if (!isStaff(i.member)) return i.reply({ content: 'Staff only.', ephemeral: true });
  await i.deferReply({ ephemeral: true });
  const onlyHere = i.options.getBoolean('here');
  const me = i.guild.members.me;
  const canManage = (ch) => ch.permissionsFor(me)?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
  ]);

  // Every text/announcement channel (or just this one), split into the ones we
  // can manage and the ones we lack permission for — so we can tell the user
  // exactly which channels were left untouched.
  const candidates = onlyHere
    ? [i.channel].filter((c) => c?.isTextBased?.())
    : [...i.guild.channels.cache.values()].filter((c) =>
        c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
  const targets = candidates.filter((c) => canManage(c));
  const noPerms = candidates.length - targets.length; // excluded up front for missing perms

  if (!targets.length) {
    return i.editReply('I don’t have **Manage Messages** + **Read Message History** anywhere I can reach — give me those and try again.');
  }

  let total = 0;
  let touched = 0;
  let errored = 0;
  for (const ch of targets) {
    const n = await purgePinNoticesIn(ch).catch(() => -1);
    if (n < 0) { errored++; continue; }
    total += n;
    if (n > 0) touched++;
    await i.editReply(`🧹 Cleaning pin notices… **${total}** removed so far (${ch.name}).`).catch(() => {});
  }

  const skipped = noPerms + errored; // couldn't-manage + failed-mid-scan
  const scope = onlyHere ? 'this channel' : `${targets.length} channel${targets.length === 1 ? '' : 's'}`;
  const skipNote = skipped
    ? `\n⚠️ Skipped ${skipped} channel${skipped === 1 ? '' : 's'} I couldn’t manage (need Manage Messages + Read Message History there).`
    : '';
  return i.editReply(
    (total > 0
      ? `✅ Removed **${total}** “pinned a message” notice${total === 1 ? '' : 's'} across ${touched} channel${touched === 1 ? '' : 's'} (scanned ${scope}).`
      : `Nothing to clean — no pin notices found in ${scope}.`) + skipNote,
  );
}

// ── /giveaway (staff) ─────────────────────────────────────────────────────────
async function startGiveaway(i) {
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can start giveaways.', ephemeral: true });
  const prize = i.options.getString('prize');
  // Clamp to 1 min – 14 days: a huge value overflows Node's 32-bit timer (the
  // giveaway would "end" after 1ms), a negative one ends it instantly.
  const minutes = Math.min(20160, Math.max(1, i.options.getInteger('minutes') || 10));
  const winnersCount = Math.max(1, i.options.getInteger('winners') || 1);
  await i.reply({ content: `Starting a giveaway for **${prize}** (${minutes} min, ${winnersCount} winner${winnersCount > 1 ? 's' : ''})…`, ephemeral: true });
  const endsAt = Date.now() + minutes * 60_000;
  const ch = findChannel(i.guild, 'giveaways') || i.channel;
  const gwRole = i.guild.roles.cache.find((r) => r.name === 'Giveaways');
  const e = new EmbedBuilder().setColor(0xa855f7).setTitle('🎉 GIVEAWAY')
    .setThumbnail(BRAND_ICON)
    .setImage(BANNER('giveaways'))
    .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnersCount}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n\nTap **Enter** below to join!\nHosted by <@${i.user.id}>`)
    .addFields({ name: 'Entries', value: '🎟️ 0', inline: true })
    .setFooter({ text: 'ForgeMarket giveaway · verified members only' });
  const msg = await ch.send({ content: gwRole ? `<@&${gwRole.id}>` : '', embeds: [e] });
  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw:enter:${msg.id}`).setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Success));
  await msg.edit({ components: [btn] });
  GIVEAWAYS.set(msg.id, { prize, entries: new Set(), endsAt, channelId: ch.id, msgId: msg.id, winnersCount, hostId: i.user.id, guildId: i.guild.id });
  saveGiveaways();
  setTimeout(() => endGiveaway(i.guild, msg.id, msg), minutes * 60_000);
}

async function endGiveaway(guild, id, msg) {
  const gw = GIVEAWAYS.get(id);
  if (!gw) return;
  GIVEAWAYS.delete(id);
  saveGiveaways();
  const ids = [...gw.entries];
  const pool = [...ids];
  const picks = [];
  while (picks.length < (gw.winnersCount || 1) && pool.length) {
    picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  ENDED.set(id, { prize: gw.prize, entries: ids, channelId: gw.channelId });
  setTimeout(() => ENDED.delete(id), 3_600_000); // keep 1h for /reroll
  const text = picks.length
    ? `🏆 The **${gw.prize}** giveaway ${picks.length > 1 ? 'winners are' : 'winner is'} ${picks.map((w) => `<@${w}>`).join(', ')}! Congrats 🎉 (${ids.length} entries)\nOpen a ticket in #open-a-ticket to claim.`
    : `The **${gw.prize}** giveaway ended with no entries 😢`;
  const winners = findChannel(guild, 'winners');
  if (winners) winners.send(text).catch(() => {});
  const chan = guild.channels.cache.get(gw.channelId);
  if (chan && chan.id !== winners?.id) chan.send(text).catch(() => {});
  // DM each winner.
  for (const w of picks) {
    guild.members.fetch(w)
      .then((mm) => mm.send(`🎉 You won the **${gw.prize}** giveaway on **${guild.name}**! Open a ticket in #open-a-ticket to claim your prize.`).catch(() => {}))
      .catch(() => {});
  }
  await msg?.edit?.({ components: [] }).catch(() => {});
}

async function rerollGiveaway(i) {
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can reroll giveaways.', ephemeral: true });
  const id = i.options.getString('message_id').trim();
  const g = ENDED.get(id);
  if (!g || !g.entries.length) return i.reply({ content: 'No recent giveaway with entries found for that message id (rerolls expire after 1 hour).', ephemeral: true });
  const w = g.entries[Math.floor(Math.random() * g.entries.length)];
  const winners = findChannel(i.guild, 'winners') || i.channel;
  winners.send(`🔁 **Reroll!** The new **${g.prize}** winner is <@${w}>! Congrats 🎉`).catch(() => {});
  return i.reply({ content: `Rerolled — new winner <@${w}>.`, ephemeral: true });
}

// ── Resilient startup ───────────────────────────────────────────────────────
// A Discord bot must keep a long-lived gateway connection: if the process dies,
// every button/command shows "This interaction failed". These guards make sure
// a stray error never takes the bot offline, and that login problems print an
// actionable message instead of a silent crash.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.stack || err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.stack || err?.message || err);
  // Stay alive — a single bad event must not knock the whole bot offline.
});

/**
 * Flush before the container goes away.
 *
 * Railway sends SIGTERM on every deploy, and there was nothing listening. The
 * saves above are debounced — up to four seconds of XP, a giveaway entry, a
 * suggestion vote — so the one moment that reliably erases state was also the
 * one moment nothing was written. Discord is told we are going, too, instead of
 * leaving the bot showing green until the gateway times the session out.
 */
let goingDown = false;
/* Declared before the shutdown handler that closes it, and assigned at the
   bottom once the client exists. A `const` further down would sit in the
   temporal dead zone for the moment between registering the signal handlers
   and reaching it — a SIGTERM in that window would have thrown instead of
   flushing. */
let healthServer = null;
async function shutdown(signal) {
  if (goingDown) return;
  goingDown = true;
  log.info('shutdown signal received', { signal });
  clearTimeout(xpFileTimer);
  clearTimeout(gwSaveTimer);
  const giveaways = [...GIVEAWAYS.entries()]
    .map(([id, g]) => ({ ...g, msgId: id, entries: [...g.entries] }));
  await Promise.allSettled([
    stateSet('xp', XP, XP_FILE),
    stateSet('giveaways', giveaways, GW_FILE),
    stateSet('meta', META, META_FILE),
  ]);
  await client.destroy().catch(() => {});
  await new Promise((r) => (healthServer ? healthServer.close(r) : r()));
  log.info('state flushed, shutting down', { signal });
  process.exit(0);
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { shutdown(sig); });

client.on('error', (e) => log.error('client error', { err: e?.message || String(e) }));
client.on('shardError', (e) => log.error('shard error', { err: e?.message || String(e) }));
client.on(Events.ShardReconnecting, (id) => log.warn('reconnecting to Discord', { shard: id }));
client.on(Events.ShardResume, (id, replayed) => log.info('gateway resumed', { shard: id, replayed }));
client.on(Events.ShardReady, (id) => log.info('gateway ready', { shard: id }));

/**
 * A disconnect discord.js will not come back from.
 *
 * It reconnects on its own for almost everything, and logging was the right
 * response to that. But some close codes are terminal — the token was reset,
 * the intents were switched off, we were rate limited into the ground — and on
 * those the library stops trying and the process sits there forever, alive,
 * connected to nothing, looking healthy to anything that only checks whether it
 * is running. Exiting hands it to the platform, which is the thing that knows
 * how to start it again with fresh state.
 */
client.on(Events.ShardDisconnect, (event, id) => {
  const code = event?.code;
  const terminal = [4004, 4010, 4011, 4012, 4013, 4014].includes(code);
  log.warn('gateway disconnected', { shard: id, code, terminal });
  if (terminal) {
    log.error('gateway closed permanently — exiting so the platform restarts us', { code });
    shutdown(`gateway ${code}`);
  }
});

/* Everything the host needs to know before a single packet is sent.
   A missing token was already fatal; what was silent is a missing
   REVIEW_INGEST_SECRET, which switches off the whole store relay — order pings,
   drops, delivery DMs, durable state — and reads from the outside as a quiet
   shop rather than a bot that is not listening. */
if (!reportEnv()) process.exit(1);

/* Answers "is the gateway actually up?" on the port Railway hands us. A bot
   holds a websocket, not a port, so without this a supervisor cannot tell a
   working bot from a live process with a dead connection — and the second one
   looks perfectly healthy while the server sits silent. */
healthServer = startHealthServer(client);

log.info('connecting to Discord…');
loginWithRetry(client, DISCORD_TOKEN);
