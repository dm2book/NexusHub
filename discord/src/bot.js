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
} from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import { FAQ, GAME_ROLES, NOTIFY_ROLES } from './config.js';

const SELF_ROLES = [...GAME_ROLES, ...NOTIFY_ROLES];
const STAFF_ROLE_NAMES = ['Owner', 'Admin', 'Moderator', 'Support'];
const isStaff = (member) => member?.permissions?.has?.(PermissionFlagsBits.ManageMessages)
  || member?.roles?.cache?.some((r) => STAFF_ROLE_NAMES.includes(r.name));

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
      writeFileSync(GW_FILE, JSON.stringify(data));
    } catch { /* ignore */ }
  }, 1500);
}
async function restoreGiveaways(c) {
  let data = [];
  try { if (existsSync(GW_FILE)) data = JSON.parse(readFileSync(GW_FILE, 'utf8')); } catch { return; }
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
    else setTimeout(finish, msLeft);          // re-arm the timer
    console.log(`[giveaway] restored "${g.prize}" (${Math.round(msLeft / 60000)} min left, ${(g.entries || []).length} entries)`);
  }
}

// ── Leveling / XP (persisted to xp.json so it survives restarts) ─────────────
const XP_FILE = new URL('../xp.json', import.meta.url);
let XP = {};
try { if (existsSync(XP_FILE)) XP = JSON.parse(readFileSync(XP_FILE, 'utf8')); } catch { XP = {}; }
let xpSaveTimer = null;
function saveXP() { clearTimeout(xpSaveTimer); xpSaveTimer = setTimeout(() => { try { writeFileSync(XP_FILE, JSON.stringify(XP)); } catch { /* ignore */ } }, 4000); }
const levelFor = (xp) => Math.floor(0.18 * Math.sqrt(xp));
const xpForLevel = (lvl) => Math.ceil((lvl / 0.18) ** 2);
const xpCooldown = new Map();

// Anti-scam: invite links + common scam phrases.
const SCAM = /(discord\.(gg|com\/invite)\/|free\s*nitro|steamcommunity\.com\/(gift|trade)|t\.me\/|claim\s+your\s+(reward|prize|nitro)|airdrop|nitro\s+giveaway\s+http)/i;

const {
  DISCORD_TOKEN, ANTHROPIC_API_KEY, AI_MODEL = 'claude-sonnet-4-6',
  FORGEMARKET_API_URL = '', STORE_URL = 'https://forgemarket-store.vercel.app',
  REVIEW_INGEST_SECRET = '',
} = process.env;

// Push a /vouch to the website so it appears on the storefront reviews section.
// Signed with HMAC-SHA256 (x-timestamp + x-signature) so the API can verify
// authenticity and reject replays — must match the server's canonicalReview().
async function pushReviewToSite({ author, avatarUrl, stars, body, externalId }) {
  if (!FORGEMARKET_API_URL || !REVIEW_INGEST_SECRET) return;
  try {
    const payload = { author, avatarUrl, stars, body, externalId };
    const ts = String(Date.now());
    // NUL separator — must byte-match the server's canonicalReview() exactly,
    // or the HMAC never verifies and vouches fall back to the legacy header.
    const canonical = [author, stars ?? 5, body, externalId || ''].join('\u0000');
    const signature = createHmac('sha256', REVIEW_INGEST_SECRET).update(`${ts}.${canonical}`).digest('hex');
    await fetch(`${FORGEMARKET_API_URL.replace(/\/$/, '')}/api/reviews/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-timestamp': ts,
        'x-signature': signature,
        'x-ingest-secret': REVIEW_INGEST_SECRET, // legacy fallback during rollout
      },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.error('[review->site]', e?.message || e); }
}

const P = PermissionFlagsBits;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// Brand assets, hosted by the storefront (public/discord/*).
const BANNER = (n) => `${STORE_URL}/discord/banner-${n}.png`;
const BRAND_ICON = `${STORE_URL}/icon-512.png`;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
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
    const res = await fetch(`${FORGEMARKET_API_URL}/api/products`);
    const data = await res.json();
    catalogCache = { at: Date.now(), items: data.products || [] };
  } catch { /* keep stale */ }
  return catalogCache.items;
}

const money = (cents, cur = 'EUR') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format((cents || 0) / 100);

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
        "- Mention instant delivery, buyer protection and verified reviews when relevant.\n" +
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
  if (match) return `Check out **${match.name}** — ${money(match.price, match.currency)}, instant delivery. Browse more at ${STORE_URL}/shop 🎮`;
  return `I can help with top-ups, prices, delivery and orders! Tell me the game and amount, browse ${STORE_URL}/shop, or open a ticket in #open-a-ticket for order help.`;
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
    const fields = Object.entries(byCat)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 24) // Discord embed cap: 25 fields
      .map(([cat, list]) => ({
        name: `🎮 ${cat.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}`,
        value: list
          .sort((a, b) => a.price - b.price)
          .map((p) => `${p.name} — **${money(p.price, p.currency)}**`)
          .join('\n').slice(0, 1024),
      }));

    const embed = new EmbedBuilder().setColor(0x6366f1)
      .setTitle('🏷️ Live price list')
      .setThumbnail(BRAND_ICON)
      .setImage(BANNER('products'))
      .setDescription('Prices sync automatically from the store — always current. Instant delivery on everything.')
      .addFields(fields)
      .setFooter({ text: 'ForgeMarket · auto-updated every 10 min' })
      .setTimestamp();
    const shopRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🛍️ Open the shop').setStyle(ButtonStyle.Link).setURL(`${STORE_URL}/shop`));

    // Edit our previous price-list message so the channel stays clean.
    const msgs = await ch.messages.fetch({ limit: 25 }).catch(() => null);
    const mine = msgs?.find((m) => m.author.id === client.user.id && m.embeds[0]?.title?.includes('price list'));
    if (mine) await mine.edit({ embeds: [embed], components: [shopRow] });
    else await ch.send({ embeds: [embed], components: [shopRow] });
  } catch (e) { console.error('[price-list]', e.message); }
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
    const ch = findChannel(member.guild, 'scam-warning') || findChannel(member.guild, 'mod-log');
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
  c.user.setPresence({ activities: [{ name: '/ask · instant top-ups' }], status: 'online' });
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
  setInterval(() => c.guilds.cache.forEach((g) => maybePostWeeklyLeaderboard(g)), 60 * 60_000);

  // Resume any giveaways that were live before a restart.
  restoreGiveaways(c);

  // Daily vouch spotlight → #general (checked hourly, posts once a day).
  setInterval(() => c.guilds.cache.forEach((g) => maybeVouchSpotlight(g)), 60 * 60_000);
  setTimeout(() => c.guilds.cache.forEach((g) => maybeVouchSpotlight(g)), 90_000);
});

// ── greet new members (with anti-scam warning) ─────────────────────────────
client.on(Events.GuildMemberAdd, async (member) => {
  const dm = new EmbedBuilder().setColor(0x7c5cff)
    .setTitle(`Welcome to ${member.guild.name} ⚡`)
    .setThumbnail(BRAND_ICON)
    .setImage(BANNER('welcome'))
    .setDescription(
      `Hey ${member.user.username}! Glad you're here.\n\n` +
      "✅ **Verify** in the #verify channel to unlock everything\n" +
      "🛒 Browse top-ups or ask me in **#ask-the-bot**\n" +
      "🎁 Join **#giveaways** for free drops\n" +
      "🎫 Need help? **#open-a-ticket**\n\n" +
      "🛡️ **Stay safe:** our staff will **NEVER** DM you first, never ask for your password, " +
      "and we only sell via the official store link in the server. Anyone else is a scammer — report them in #open-a-ticket.\n\n" +
      "Instant delivery · buyer-protected · 24/7 support.")
    .setFooter({ text: 'ForgeMarket · instant game top-ups' });
  const dmButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('🛍️ Open the shop').setStyle(ButtonStyle.Link).setURL(`${STORE_URL}/shop`),
    new ButtonBuilder().setLabel('📦 Track an order').setStyle(ButtonStyle.Link).setURL(`${STORE_URL}/track`));
  member.send({ embeds: [dm], components: [dmButtons] }).catch(() => {});
  leadLog(member.guild, `🟢 New member joined: <@${member.id}> (${member.guild.memberCount} total)`);
  checkImpersonation(member); // scam guard: flag staff-lookalike names on join
  trackJoinForRaid(member.guild); // raid guard: alert staff on join spikes
  celebrateMilestone(member.guild); // 🎉 every 100 members
  // Public greeting — skipped during join spikes so a raid can't flood #general.
  if (recentJoins.length < 5) {
    const ch = findChannel(member.guild, 'general');
    const verifyCh = findChannel(member.guild, 'verify');
    ch?.send(`👋 Welcome <@${member.id}>! Verify in ${verifyCh ? `<#${verifyCh.id}>` : '#verify'} to unlock everything, and say hi 💜`)
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 10 * 60_000))
      .catch(() => {});
  }
});

// ── interactions: buttons + slash ──────────────────────────────────────────
client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isButton()) return await handleButton(i);
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
    const rules = new EmbedBuilder().setColor(0x6366f1)
      .setTitle('📜 Read & accept the rules')
      .setDescription(
        '**1. Be respectful.** No harassment, hate or NSFW.\n' +
        '**2. No scams.** Trade only via official channels. Staff will **never** DM you first.\n' +
        '**3. No spam / self-promo** without permission.\n' +
        '**4. English in main channels** so staff can moderate.\n' +
        '**5. One account per person.** No ban evasion.\n' +
        '**6. Use tickets for order issues** — never share private info publicly.\n' +
        '**7. Staff decisions are final.** Appeals via ticket.\n\n' +
        'Press the green button below to accept the rules and unlock the server.')
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
    await i.member.roles.add(role).catch(() => {});
    leadLog(i.guild, `✅ Verified: <@${i.user.id}>`);
    return i.update({
      content: '✅ **Verified!** Welcome in — the full server is now unlocked. Start at <#products> and <#ask-the-bot>. 🎮',
      embeds: [], components: [],
    }).catch(() => {});
  }

  if (i.customId.startsWith('role:')) return toggleRole(i, i.customId.split(':')[1]);
  if (i.customId === 'ticket:close') return closeTicket(i);
  if (i.customId === 'ticket:claim') return claimTicket(i);
  if (i.customId.startsWith('ticket:')) return openTicket(i, i.customId.split(':')[1]);
  if (i.customId.startsWith('rate:')) return rateSupport(i, Number(i.customId.split(':')[1]));
  if (i.customId.startsWith('gw:enter:')) return enterGiveaway(i, i.customId.split(':')[2]);
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
  if (i.channel.topic.includes('claimed:')) {
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
    return i.reply({ content: 'Please verify in #verify first to enter giveaways. ✅', ephemeral: true });
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

async function openTicket(i, type) {
  await i.deferReply({ ephemeral: true });
  const support = findChannel(i.guild, 'open-a-ticket');
  const category = support?.parent;

  // One open ticket per member.
  const existing = i.guild.channels.cache.find((c) => c.topic?.includes(`ticket-owner:${i.user.id}`));
  if (existing) return i.editReply(`You already have an open ticket: <#${existing.id}>`);

  const staffRoles = ['Support', 'Admin', 'Moderator'].map((n) => findRole(i.guild, n)).filter(Boolean);
  // Member tiers can view the SUPPORT category, so explicitly hide each ticket
  // from them — only the owner, staff and bot should ever see it.
  const memberRoles = ['Verified Customer', 'VIP Customer', 'Partner'].map((n) => findRole(i.guild, n)).filter(Boolean);
  let channel;
  try {
    channel = await i.guild.channels.create({
      name: `ticket-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90) || `ticket-${i.user.id}`,
      type: ChannelType.GuildText, parent: category?.id,
      topic: `ticket-owner:${i.user.id} · type:${type} · opened:${Date.now()}`,
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

  const label = { order: '🛒 Order issue', payment: '💳 Payment', partner: '🤝 Partnership', other: '❓ Other' }[type] || '🎫 Support';
  const embed = new EmbedBuilder().setColor(0x6366f1)
    .setTitle(`${label}`)
    .setDescription(
      `Hi <@${i.user.id}>, thanks for reaching out! A team member will be with you shortly. ⚡\n\n` +
      '**To speed things up, please share:**\n' +
      '• Your **order number** (if any)\n• A short description of the issue\n• Screenshots if relevant')
    .setFooter({ text: 'ForgeMarket Support • use the buttons below' }).setTimestamp();
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setEmoji('🛠️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));
  const supportPing = findRole(i.guild, 'Support');
  await channel.send({ content: supportPing ? `<@&${supportPing.id}> — new ticket` : '', embeds: [embed], components: [controls] }).catch(() => {});
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

  const ownerId = ch.topic.match(/ticket-owner:(\d+)/)?.[1];
  const openedAt = Number(ch.topic.match(/opened:(\d+)/)?.[1]) || null;
  const mins = openedAt ? Math.max(1, Math.round((Date.now() - openedAt) / 60000)) : null;
  const file = new AttachmentBuilder(Buffer.from(lines, 'utf8'), { name: `${ch.name}.txt` });

  const logs = findChannel(ch.guild, 'ticket-logs');
  if (logs) {
    const logEmbed = new EmbedBuilder().setColor(0x6366f1).setTitle('📄 Ticket closed')
      .addFields(
        { name: 'Channel', value: `#${ch.name}`, inline: true },
        { name: 'Owner', value: ownerId ? `<@${ownerId}>` : 'unknown', inline: true },
        { name: 'Closed by', value: closedByText, inline: true },
        ...(mins ? [{ name: 'Open for', value: `${mins} min`, inline: true }] : []))
      .setTimestamp();
    await logs.send({ embeds: [logEmbed], files: [file] }).catch(() => {});
  }
  // DM the owner their transcript + a quick rating prompt.
  if (ownerId) {
    const owner = await ch.guild.members.fetch(ownerId).catch(() => null);
    if (owner) {
      const stars = new ActionRowBuilder().addComponents(
        ...[1, 2, 3, 4, 5].map((n) => new ButtonBuilder()
          .setCustomId(`rate:${n}`).setLabel('⭐'.repeat(n)).setStyle(n >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary)));
      await owner.send({
        content: `Here’s the transcript of your ForgeMarket ticket (closed by ${dmLabel || 'our team'}).\n\n**How was our support?** Tap a rating below 👇`,
        files: [file], components: [stars],
      }).catch(() => {});
    }
  }
  setTimeout(() => ch.delete().catch(() => {}), 5000);
}

async function closeTicket(i) {
  const ch = i.channel;
  if (!ch?.topic?.startsWith('ticket-owner:')) {
    return i.reply({ content: 'This isn’t a ticket channel.', ephemeral: true });
  }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xef4444)
    .setDescription('🔒 Closing this ticket and saving a transcript… (channel deletes in a few seconds)')] });
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
      if (ch.type !== ChannelType.GuildText || !ch.topic?.startsWith('ticket-owner:')) continue;
      const msgs = await ch.messages.fetch({ limit: 1 }).catch(() => null);
      const lastTs = msgs?.first()?.createdTimestamp
        || Number(ch.topic.match(/opened:(\d+)/)?.[1]) || Date.now();
      const idleHours = (Date.now() - lastTs) / 3_600_000;
      if (idleHours < 24) continue;

      if (ch.topic.includes('idlewarned')) {
        // Warned 24h+ ago and still silence → close it (warning was the last message).
        await ch.send({ embeds: [new EmbedBuilder().setColor(0xef4444)
          .setDescription('🔒 Closing this ticket due to inactivity. You can always open a new one in #open-a-ticket.')] }).catch(() => {});
        await archiveTicket(ch, 'Auto-close (inactive)');
      } else {
        const ownerId = ch.topic.match(/ticket-owner:(\d+)/)?.[1];
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

async function rateSupport(i, stars) {
  // Runs from a DM, so search the bot's guilds for the log channel.
  let logs = null;
  for (const g of i.client.guilds.cache.values()) {
    const c = g.channels.cache.find((ch) => ch.name === 'ticket-logs');
    if (c) { logs = c; break; }
  }
  await i.update({ content: `Thanks for your feedback — you rated us ${'⭐'.repeat(stars)} (${stars}/5)! 💜`, components: [] }).catch(() => {});
  if (logs) await logs.send({ embeds: [new EmbedBuilder().setColor(stars >= 4 ? 0x10b981 : 0xf5b324)
    .setDescription(`⭐ Support rated **${stars}/5** by <@${i.user.id}>`)] }).catch(() => {});
}

async function handleCommand(i) {
  if (i.commandName === 'help') {
    return i.reply({ ephemeral: true, content:
      "**Forge — your assistant**\n`/ask` — ask anything\n`/recommend` — product recommendation\n" +
      "`/price` — look up a product's live price\n`/order` — check an order status\n" +
      "`/vouch` — leave a vouch\n`/suggest` — suggest an idea\n`/poll` — start a quick poll\n" +
      "`/shop` — open the shop\n`/invite` — get the invite link\n`/stats` — server stats\n" +
      "`/rank` — your level & XP\n`/daily` — claim your daily XP (streaks!)\n`/leaderboard` — top members\n" +
      "`/close` — staff: close a ticket\n`/giveaway` — staff: start a giveaway\n`/reroll` — staff: reroll a winner\n" +
      "`/coupon` — staff: post a discount code\n`/flashsale` — staff: countdown deal in #deals\n" +
      "`/announce` — staff: post an announcement\n`/serverinfo` — server stats\n" +
      "Buttons: verify in #verify, pick roles in #roles, open a ticket in #open-a-ticket." });
  }
  if (i.commandName === 'order') return lookupOrder(i);
  if (i.commandName === 'price') return priceCmd(i);
  if (i.commandName === 'poll') return pollCmd(i);
  if (i.commandName === 'daily') return dailyCmd(i);
  if (i.commandName === 'vouch') return postVouch(i);
  if (i.commandName === 'giveaway') return startGiveaway(i);
  if (i.commandName === 'reroll') return rerollGiveaway(i);
  if (i.commandName === 'rank') return rankCmd(i);
  if (i.commandName === 'leaderboard') return leaderboardCmd(i);
  if (i.commandName === 'suggest') return postSuggestion(i);
  if (i.commandName === 'coupon') return postCoupon(i);
  if (i.commandName === 'flashsale') return flashSale(i);
  if (i.commandName === 'announce') return postAnnounce(i);
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
    return i.reply({ ephemeral: true, content: `🛍️ Browse the shop: ${STORE_URL}/shop` });
  }
  if (i.commandName === 'invite') {
    return i.reply({ ephemeral: true, content: '📨 Invite friends with this link: https://discord.gg/vNcfgDbVd' });
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

// ── Suggestions (/suggest → #suggestions with ✅/❌ voting) ───────────────────
async function postSuggestion(i) {
  const text = i.options.getString('idea');
  const ch = findChannel(i.guild, 'suggestions');
  if (!ch) return i.reply({ content: 'No #suggestions channel — ask an admin to run setup.', ephemeral: true });
  const e = new EmbedBuilder().setColor(0x6366f1).setTitle('💡 New suggestion')
    .setDescription(text).setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
    .setFooter({ text: 'Vote with the reactions below' }).setTimestamp();
  const msg = await ch.send({ embeds: [e] });
  await msg.react('✅').catch(() => {});
  await msg.react('❌').catch(() => {});
  leadLog(i.guild, `💡 Suggestion from <@${i.user.id}>: "${text.slice(0, 120)}"`);
  return i.reply({ content: `✅ Posted your suggestion in <#${ch.id}>!`, ephemeral: true });
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
  if (m.channel.name?.startsWith('ticket-')) return;
  if (isStaff(m.member)) return;
  if (!SCAM.test(m.content)) return;
  await m.delete().catch(() => {});
  const warn = await m.channel.send(
    `⚠️ <@${m.author.id}> invites & "free" offers aren’t allowed. **Staff never DM you first** — stay safe.`).catch(() => null);
  setTimeout(() => warn?.delete().catch(() => {}), 8000);
  const log = findChannel(m.guild, 'mod-log');
  if (log) log.send(`🚫 Auto-removed from <@${m.author.id}> in <#${m.channel.id}>: \`${m.content.slice(0, 140).replace(/`/g, "'")}\``).catch(() => {});
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

// ── Leveling: award XP per message (60s cooldown), announce level-ups ─────────
client.on(Events.MessageCreate, (m) => {
  if (m.author.bot || !m.guild) return;
  if (m.channel.name?.startsWith('ticket-')) return;
  const now = Date.now();
  if (now - (xpCooldown.get(m.author.id) || 0) < 60_000) return;
  xpCooldown.set(m.author.id, now);
  const rec = XP[m.author.id] || (XP[m.author.id] = { xp: 0, lvl: 0 });
  const before = rec.lvl;
  rec.xp += 15 + Math.floor(Math.random() * 11);
  rec.lvl = levelFor(rec.xp);
  saveXP();
  if (rec.lvl > before && rec.lvl > 0) {
    const ch = findChannel(m.guild, 'general') || m.channel;
    ch.send({ embeds: [new EmbedBuilder().setColor(0xf5b324)
      .setAuthor({ name: m.author.username, iconURL: m.author.displayAvatarURL() })
      .setDescription(`🎉 GG <@${m.author.id}> — you reached **Level ${rec.lvl}**! Keep chatting (and claim your \`/daily\`) to level up. ⚡`)] })
      .catch(() => {});
  }
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

// ── /order lookup (uses the store's public tracking endpoint) ─────────────────
async function lookupOrder(i) {
  await i.deferReply({ ephemeral: true });
  const num = i.options.getString('number').trim();
  if (!FORGEMARKET_API_URL) return i.editReply('Order lookup isn’t configured yet.');
  try {
    const res = await fetch(`${FORGEMARKET_API_URL}/api/track/${encodeURIComponent(num)}`);
    if (!res.ok) return i.editReply(`No order found for \`${num}\`. Check the number or open a ticket in #open-a-ticket.`);
    const o = await res.json();
    const hist = (o.history || []).map((h) => `• ${h.to || h.to_status} — ${new Date(h.at || h.created_at).toLocaleString()}`).join('\n') || '—';
    const e = new EmbedBuilder().setColor(0x6366f1).setTitle(`Order ${o.number}`)
      .setDescription(`**Status:** ${o.statusLabel || o.status}\n\n**Timeline:**\n${hist}`);
    return i.editReply({ embeds: [e] });
  } catch { return i.editReply('Couldn’t reach the store right now — try again shortly or open a ticket.'); }
}

// ── /vouch → posts to #vouchers ───────────────────────────────────────────────
async function postVouch(i) {
  const message = i.options.getString('message');
  const stars = Math.min(5, Math.max(1, i.options.getInteger('stars') || 5));
  const ch = findChannel(i.guild, 'vouchers');
  const e = new EmbedBuilder().setColor(0x22c55e)
    .setAuthor({ name: i.user.username, iconURL: i.user.displayAvatarURL() })
    .setDescription(`${'⭐'.repeat(stars)}\n\n${message}`)
    .setFooter({ text: 'Community vouch' }).setTimestamp();
  if (ch) await ch.send({ embeds: [e] }).catch(() => {});
  // Mirror the vouch onto the website's reviews section.
  pushReviewToSite({
    author: i.user.username,
    avatarUrl: i.user.displayAvatarURL({ extension: 'png', size: 128 }),
    stars, body: message, externalId: `vouch:${i.user.id}:${i.id}`,
  });
  return i.reply({ content: 'Thanks for the vouch! 💚 Posted in #vouchers **and** on the website.', ephemeral: true });
}

// ── /price → live price lookup from the real catalog ─────────────────────────
async function priceCmd(i) {
  await i.deferReply({ ephemeral: true });
  const q = i.options.getString('product').toLowerCase().trim();
  const products = await getProducts();
  if (!products.length) return i.editReply(`I can’t reach the catalog right now — browse ${STORE_URL}/shop 🛍️`);
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
    return i.editReply(`No product matching **${q}** — see the full list in #price-list or at ${STORE_URL}/shop`);
  }
  const top = scored.slice(0, 5);
  const e = new EmbedBuilder().setColor(0x6366f1)
    .setTitle(`🏷️ ${top[0].p.name}`)
    .setDescription(
      `**${money(top[0].p.price, top[0].p.currency)}** · instant delivery\n[Buy now](${STORE_URL}/product/${top[0].p.id})` +
      (top.length > 1
        ? `\n\n**Also matching:**\n${top.slice(1).map(({ p }) => `• ${p.name} — ${money(p.price, p.currency)}`).join('\n')}`
        : ''))
    .setFooter({ text: 'Live prices from the store' });
  return i.editReply({ embeds: [e] });
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
try { if (existsSync(META_FILE)) META = JSON.parse(readFileSync(META_FILE, 'utf8')); } catch { META = {}; }
const saveMeta = () => { try { writeFileSync(META_FILE, JSON.stringify(META)); } catch { /* ignore */ } };

function maybePostWeeklyLeaderboard(guild) {
  const now = new Date();
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 17) return; // Mondays from 17:00 UTC
  const week = `${now.getUTCFullYear()}-w${Math.ceil(((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / 86_400_000 + 1) / 7)}`;
  if (META.lastWeeklyPost === week) return;
  const top = Object.entries(XP).sort((a, b) => b[1].xp - a[1].xp).slice(0, 10);
  if (!top.length) return;
  META.lastWeeklyPost = week;
  saveMeta();
  const ch = findChannel(guild, 'general') || findChannel(guild, 'events');
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
      `🛒 ${STORE_URL}/shop — instant delivery\n\n` +
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

// ── Daily vouch spotlight → #general (social proof on autopilot) ─────────────
async function maybeVouchSpotlight(guild) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (META.lastSpotlight === today) return;
    const hour = new Date().getUTCHours();
    if (hour < 15) return; // afternoon post (17:00 NL)
    const src = findChannel(guild, 'vouchers');
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
    if (m.author.bot || !m.guild || !m.channel.topic?.startsWith('ticket-owner:')) return;
    const match = m.content.match(ORDER_RE);
    if (!match || !FORGEMARKET_API_URL) return;
    const now = Date.now();
    if (now - (orderLookupCooldown.get(m.channel.id) || 0) < 60_000) return; // 1/min per ticket
    orderLookupCooldown.set(m.channel.id, now);
    const num = match[0].toUpperCase();
    const res = await fetch(`${FORGEMARKET_API_URL}/api/track/${encodeURIComponent(num)}`);
    if (!res.ok) return;
    const o = await res.json();
    const hist = (o.history || []).slice(-4).map((h) =>
      `• ${h.to || h.to_status} — ${new Date(h.at || h.created_at).toLocaleString()}`).join('\n') || '—';
    await m.reply({ embeds: [new EmbedBuilder().setColor(0x6366f1)
      .setTitle(`📦 Order ${o.number}`)
      .setDescription(`**Status:** ${o.statusLabel || o.status}\n\n**Latest updates:**\n${hist}`)
      .setFooter({ text: 'Auto-lookup · live from the store' })] });
  } catch { /* best-effort */ }
});

// ── /coupon (staff) → posts a discount code to #discount-codes ────────────────
async function postCoupon(i) {
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can post coupons.', ephemeral: true });
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
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can announce.', ephemeral: true });
  const message = i.options.getString('message');
  const ch = findChannel(i.guild, 'announcements') || i.channel;
  const e = new EmbedBuilder().setColor(0x6366f1).setTitle('📢 Announcement')
    .setDescription(message).setFooter({ text: `Posted by ${i.user.username}` }).setTimestamp();
  await ch.send({ content: '@everyone', embeds: [e], allowedMentions: { parse: ['everyone'] } }).catch(() => {});
  return i.reply({ content: `Announcement posted in <#${ch.id}>.`, ephemeral: true });
}

// ── /giveaway (staff) ─────────────────────────────────────────────────────────
async function startGiveaway(i) {
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can start giveaways.', ephemeral: true });
  const prize = i.options.getString('prize');
  const minutes = i.options.getInteger('minutes') || 10;
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

client.on('error', (e) => console.error('[client error]', e?.message || e));
client.on('shardError', (e) => console.error('[shard error]', e?.message || e));
client.on(Events.ShardDisconnect, () => console.warn('⚠️  Gateway disconnected — discord.js will auto-reconnect…'));
client.on(Events.ShardReconnecting, () => console.log('🔄 Reconnecting to Discord…'));

if (!DISCORD_TOKEN) {
  console.error('\n❌ DISCORD_TOKEN is missing. Create a .env file in discord/ with:\n' +
    '   DISCORD_TOKEN=your-bot-token\n   DISCORD_CLIENT_ID=...\n   DISCORD_GUILD_ID=...\n');
  process.exit(1);
}

console.log('⏳ Connecting to Discord…');
client.login(DISCORD_TOKEN).catch((err) => {
  const msg = String(err?.message || err);
  if (/disallowed intents/i.test(msg)) {
    console.error('\n❌ Login failed: privileged intents are not enabled.\n' +
      '   Open https://discord.com/developers/applications → your app → Bot, and turn ON:\n' +
      '     • SERVER MEMBERS INTENT\n     • MESSAGE CONTENT INTENT\n   Then run the bot again.\n');
  } else if (/token/i.test(msg)) {
    console.error('\n❌ Login failed: the DISCORD_TOKEN is invalid.\n' +
      '   Reset it in the Developer Portal (Bot → Reset Token) and update discord/.env.\n');
  } else {
    console.error('\n❌ Login failed:', msg);
    console.error('   Most common causes: wrong DISCORD_TOKEN, or the privileged intents\n' +
      '   (Server Members + Message Content) are not enabled in the Developer Portal.\n');
  }
  process.exit(1);
});
