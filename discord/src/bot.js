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
const GIVEAWAYS = new Map(); // messageId -> { prize, entries:Set<string>, endsAt, channelId }
// Anti-scam: invite links + common scam phrases.
const SCAM = /(discord\.(gg|com\/invite)\/|free\s*nitro|steamcommunity\.com\/(gift|trade)|t\.me\/|claim\s+your\s+(reward|prize|nitro)|airdrop|nitro\s+giveaway\s+http)/i;

const {
  DISCORD_TOKEN, ANTHROPIC_API_KEY, AI_MODEL = 'claude-sonnet-4-6',
  FORGEMARKET_API_URL = '', STORE_URL = 'https://nexus-hub-aigq.vercel.app',
} = process.env;

const P = PermissionFlagsBits;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

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
    if (i.isButton()) return handleButton(i);
    if (i.isChatInputCommand()) return handleCommand(i);
  } catch (e) { console.error('[interaction]', e.message); }
});

async function handleButton(i) {
  if (i.customId === 'verify') {
    const role = findRole(i.guild, 'Verified Customer');
    if (!role) return i.reply({ content: 'Verification role missing — run setup.', ephemeral: true });
    if (i.member.roles.cache.has(role.id)) return i.reply({ content: 'You’re already verified ✅', ephemeral: true });
    await i.member.roles.add(role).catch(() => {});
    return i.reply({ content: '✅ Verified! Welcome in — check out #products and #ask-the-bot. 🎮', ephemeral: true });
  }

  if (i.customId.startsWith('role:')) return toggleRole(i, i.customId.split(':')[1]);
  if (i.customId === 'ticket:close') return closeTicket(i);
  if (i.customId === 'ticket:claim') return claimTicket(i);
  if (i.customId.startsWith('ticket:')) return openTicket(i, i.customId.split(':')[1]);
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
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can claim tickets.', ephemeral: true });
  await i.reply(`🛠️ Ticket claimed by <@${i.user.id}> — they’ll help you from here.`);
}

async function enterGiveaway(i, messageId) {
  const gw = GIVEAWAYS.get(messageId);
  if (!gw) return i.reply({ content: 'This giveaway has ended.', ephemeral: true });
  if (gw.entries.has(i.user.id)) return i.reply({ content: 'You’re already entered ✅ Good luck! 🍀', ephemeral: true });
  gw.entries.add(i.user.id);
  return i.reply({ content: `🎉 You’re in! **${gw.entries.size}** entries so far.`, ephemeral: true });
}

async function openTicket(i, type) {
  await i.deferReply({ ephemeral: true });
  const support = findChannel(i.guild, 'open-a-ticket');
  const category = support?.parent;
  const existing = i.guild.channels.cache.find((c) => c.topic?.includes(`ticket-owner:${i.user.id}`));
  if (existing) return i.editReply(`You already have an open ticket: <#${existing.id}>`);

  const staffRoles = ['Support', 'Admin', 'Moderator'].map((n) => findRole(i.guild, n)).filter(Boolean);
  const channel = await i.guild.channels.create({
    name: `ticket-${i.user.username}`.slice(0, 90),
    type: ChannelType.GuildText, parent: category?.id,
    topic: `ticket-owner:${i.user.id} · type:${type}`,
    permissionOverwrites: [
      { id: i.guild.roles.everyone.id, deny: [P.ViewChannel] },
      { id: i.user.id, allow: [P.ViewChannel, P.SendMessages, P.AttachFiles, P.ReadMessageHistory] },
      ...staffRoles.map((r) => ({ id: r.id, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ReadMessageHistory] })),
    ],
  });

  const label = { order: '🛒 Order issue', payment: '💳 Payment', partner: '🤝 Partnership', other: '❓ Other' }[type] || 'Support';
  const embed = new EmbedBuilder().setColor(0x6366f1)
    .setTitle(`${label} — ticket`)
    .setDescription(
      `Hi <@${i.user.id}>, thanks for reaching out. A team member will be with you shortly.\n\n` +
      "To speed things up, please share:\n• Your **order number** (if any)\n• A short description\n• Screenshots if relevant");
  const close = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setEmoji('🛠️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));
  const supportPing = findRole(i.guild, 'Support');
  await channel.send({ content: supportPing ? `<@&${supportPing.id}>` : '', embeds: [embed], components: [close] });
  leadLog(i.guild, `🎫 Ticket opened by <@${i.user.id}> — **${label}** → <#${channel.id}>`);
  return i.editReply(`Your ticket is ready: <#${channel.id}>`);
}

async function closeTicket(i) {
  const ch = i.channel;
  if (!ch?.topic?.startsWith('ticket-owner:')) return i.reply({ content: 'Not a ticket channel.', ephemeral: true });
  await i.reply({ content: '🔒 Closing ticket and saving transcript…' });

  const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
  const lines = msgs ? [...msgs.values()].reverse().map(
    (m) => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}`).join('\n') : 'No messages.';
  const file = new AttachmentBuilder(Buffer.from(lines, 'utf8'), { name: `${ch.name}.txt` });
  const logs = findChannel(i.guild, 'ticket-logs');
  if (logs) await logs.send({ content: `📄 Transcript for **${ch.name}** (closed by ${i.user.tag})`, files: [file] }).catch(() => {});
  setTimeout(() => ch.delete().catch(() => {}), 4000);
}

async function handleCommand(i) {
  if (i.commandName === 'help') {
    return i.reply({ ephemeral: true, content:
      "**Forge — your assistant**\n`/ask` — ask anything\n`/recommend` — product recommendation\n" +
      "`/order` — check an order status\n`/vouch` — leave a vouch\n`/giveaway` — staff: start a giveaway\n" +
      "Buttons: verify in #verify, pick roles in #roles, open a ticket in #open-a-ticket." });
  }
  if (i.commandName === 'order') return lookupOrder(i);
  if (i.commandName === 'vouch') return postVouch(i);
  if (i.commandName === 'giveaway') return startGiveaway(i);
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

// ── /giveaway (staff) ─────────────────────────────────────────────────────────
async function startGiveaway(i) {
  if (!isStaff(i.member)) return i.reply({ content: 'Only staff can start giveaways.', ephemeral: true });
  const prize = i.options.getString('prize');
  const minutes = i.options.getInteger('minutes') || 10;
  await i.reply({ content: `Starting a giveaway for **${prize}** (${minutes} min)…`, ephemeral: true });
  const endsAt = Date.now() + minutes * 60_000;
  const ch = findChannel(i.guild, 'giveaways') || i.channel;
  const gwRole = i.guild.roles.cache.find((r) => r.name === 'Giveaways');
  const e = new EmbedBuilder().setColor(0xa855f7).setTitle('🎉 GIVEAWAY')
    .setDescription(`**Prize:** ${prize}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n\nTap **Enter** below to join!\nHosted by <@${i.user.id}>`)
    .setFooter({ text: 'ForgeMarket giveaway' });
  const msg = await ch.send({ content: gwRole ? `<@&${gwRole.id}>` : '', embeds: [e] });
  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw:enter:${msg.id}`).setLabel('Enter').setEmoji('🎉').setStyle(ButtonStyle.Success));
  await msg.edit({ components: [btn] });
  GIVEAWAYS.set(msg.id, { prize, entries: new Set(), endsAt, channelId: ch.id });
  setTimeout(() => endGiveaway(i.guild, msg.id, msg), minutes * 60_000);
}

async function endGiveaway(guild, id, msg) {
  const gw = GIVEAWAYS.get(id);
  if (!gw) return;
  GIVEAWAYS.delete(id);
  const ids = [...gw.entries];
  const winner = ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
  const text = winner
    ? `🏆 The **${gw.prize}** giveaway winner is <@${winner}>! Congrats 🎉 (${ids.length} entries)\nOpen a ticket in #open-a-ticket to claim.`
    : `The **${gw.prize}** giveaway ended with no entries 😢`;
  const winners = findChannel(guild, 'winners');
  if (winners) winners.send(text).catch(() => {});
  const chan = guild.channels.cache.get(gw.channelId);
  if (chan) chan.send(text).catch(() => {});
  await msg?.edit?.({ components: [] }).catch(() => {});
}

client.login(DISCORD_TOKEN);
