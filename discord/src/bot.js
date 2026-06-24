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

// Simple in-memory giveaway store (one bot instance).
const GIVEAWAYS = new Map(); // messageId -> { prize, entries:Set, endsAt, channelId, msgId, winnersCount, hostId }
const ENDED = new Map();     // messageId -> { prize, entries:[], channelId }  (kept ~1h for /reroll)

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
} = process.env;

const P = PermissionFlagsBits;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

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
const starred = new Set();           // message ids already posted to #starboard

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

// ── ready ────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`✅ ${c.user.tag} online — AI: ${anthropic ? 'on' : 'rule-based'} · API: ${FORGEMARKET_API_URL || 'sample'}`);
  c.user.setPresence({ activities: [{ name: '/ask · instant top-ups' }], status: 'online' });
});

// ── greet new members ──────────────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async (member) => {
  const dm = new EmbedBuilder().setColor(0x6366f1)
    .setTitle(`Welcome to ${member.guild.name} ⚡`)
    .setDescription(
      `Hey ${member.user.username}! Glad you're here.\n\n` +
      "✅ **Verify** in the #verify channel to unlock everything\n" +
      "🛒 Browse top-ups or ask me in **#ask-the-bot**\n" +
      "🎁 Join **#giveaways** for free drops\n" +
      "🎫 Need help? **#open-a-ticket**\n\nInstant delivery · buyer-protected · 24/7 support.");
  member.send({ embeds: [dm] }).catch(() => {});
  leadLog(member.guild, `🟢 New member joined: <@${member.id}> (${member.guild.memberCount} total)`);
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
    return i.reply({ content: 'You left the giveaway. 👋', ephemeral: true });
  }
  gw.entries.add(i.user.id);
  updateGwCount(i.guild, gw);
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

async function closeTicket(i) {
  const ch = i.channel;
  if (!ch?.topic?.startsWith('ticket-owner:')) {
    return i.reply({ content: 'This isn’t a ticket channel.', ephemeral: true });
  }
  await i.reply({ embeds: [new EmbedBuilder().setColor(0xef4444)
    .setDescription('🔒 Closing this ticket and saving a transcript… (channel deletes in a few seconds)')] });

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

  const logs = findChannel(i.guild, 'ticket-logs');
  if (logs) {
    const logEmbed = new EmbedBuilder().setColor(0x6366f1).setTitle('📄 Ticket closed')
      .addFields(
        { name: 'Channel', value: `#${ch.name}`, inline: true },
        { name: 'Owner', value: ownerId ? `<@${ownerId}>` : 'unknown', inline: true },
        { name: 'Closed by', value: `<@${i.user.id}>`, inline: true },
        ...(mins ? [{ name: 'Open for', value: `${mins} min`, inline: true }] : []))
      .setTimestamp();
    await logs.send({ embeds: [logEmbed], files: [file] }).catch(() => {});
  }
  // DM the owner their transcript + a quick rating prompt.
  if (ownerId) {
    const owner = await i.guild.members.fetch(ownerId).catch(() => null);
    if (owner) {
      const stars = new ActionRowBuilder().addComponents(
        ...[1, 2, 3, 4, 5].map((n) => new ButtonBuilder()
          .setCustomId(`rate:${n}`).setLabel('⭐'.repeat(n)).setStyle(n >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary)));
      await owner.send({
        content: `Here’s the transcript of your ForgeMarket ticket (closed by ${i.user.tag}).\n\n**How was our support?** Tap a rating below 👇`,
        files: [file], components: [stars],
      }).catch(() => {});
    }
  }
  setTimeout(() => ch.delete().catch(() => {}), 5000);
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
      "`/order` — check an order status\n`/vouch` — leave a vouch\n`/suggest` — suggest an idea\n" +
      "`/shop` — open the shop\n`/invite` — get the invite link\n`/stats` — server stats\n" +
      "`/rank` — your level & XP\n`/leaderboard` — top members\n" +
      "`/close` — staff: close a ticket\n`/giveaway` — staff: start a giveaway\n`/reroll` — staff: reroll a winner\n" +
      "`/coupon` — staff: post a discount code\n`/announce` — staff: post an announcement\n" +
      "Buttons: verify in #verify, pick roles in #roles, open a ticket in #open-a-ticket." });
  }
  if (i.commandName === 'order') return lookupOrder(i);
  if (i.commandName === 'vouch') return postVouch(i);
  if (i.commandName === 'giveaway') return startGiveaway(i);
  if (i.commandName === 'reroll') return rerollGiveaway(i);
  if (i.commandName === 'rank') return rankCmd(i);
  if (i.commandName === 'leaderboard') return leaderboardCmd(i);
  if (i.commandName === 'suggest') return postSuggestion(i);
  if (i.commandName === 'coupon') return postCoupon(i);
  if (i.commandName === 'announce') return postAnnounce(i);
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
    ch.send(`🎉 GG <@${m.author.id}> — you reached **Level ${rec.lvl}**! Keep chatting to level up. ⚡`).catch(() => {});
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
  return i.reply({ content: 'Thanks for the vouch! 💚 Posted in #vouchers.', ephemeral: true });
}

// ── /coupon (staff) → posts a discount code to #discount-codes ────────────────
async function postCoupon(i) {
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can post coupons.', ephemeral: true });
  const code = i.options.getString('code').toUpperCase();
  const percent = Math.min(90, Math.max(1, i.options.getInteger('percent') || 10));
  const note = i.options.getString('note') || 'Redeem at checkout on the website.';
  const ch = findChannel(i.guild, 'discount-codes') || i.channel;
  const e = new EmbedBuilder().setColor(0xec4899).setTitle('🏷️ New discount code!')
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
    .setDescription(`**Prize:** ${prize}\n**Winners:** ${winnersCount}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n\nTap **Enter** below to join!\nHosted by <@${i.user.id}>`)
    .addFields({ name: 'Entries', value: '🎟️ 0', inline: true })
    .setFooter({ text: 'ForgeMarket giveaway · verified members only' });
  const msg = await ch.send({ content: gwRole ? `<@&${gwRole.id}>` : '', embeds: [e] });
  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw:enter:${msg.id}`).setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Success));
  await msg.edit({ components: [btn] });
  GIVEAWAYS.set(msg.id, { prize, entries: new Set(), endsAt, channelId: ch.id, msgId: msg.id, winnersCount, hostId: i.user.id });
  setTimeout(() => endGiveaway(i.guild, msg.id, msg), minutes * 60_000);
}

async function endGiveaway(guild, id, msg) {
  const gw = GIVEAWAYS.get(id);
  if (!gw) return;
  GIVEAWAYS.delete(id);
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

client.login(DISCORD_TOKEN);
