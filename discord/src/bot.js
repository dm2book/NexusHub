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
import { FAQ } from './config.js';

const {
  DISCORD_TOKEN, ANTHROPIC_API_KEY, AI_MODEL = 'claude-sonnet-4-6',
  FORGEMARKET_API_URL = '', STORE_URL = 'https://forgemarket.app',
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

  if (i.customId.startsWith('ticket:')) return openTicket(i, i.customId.split(':')[1]);
  if (i.customId === 'ticket:close') return closeTicket(i);
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
      "**Forge — your assistant**\n`/ask` — ask anything\n`/recommend` — get a product recommendation\nButtons: verify in #verify, open a ticket in #open-a-ticket." });
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

// ── AI in #ask-the-bot ──────────────────────────────────────────────────────
client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot || m.channel.name !== 'ask-the-bot') return;
  await m.channel.sendTyping().catch(() => {});
  const products = await getProducts();
  const answer = await askAI(m.content, products);
  if (BUY_INTENT.test(m.content)) leadLog(m.guild, `💡 Buying intent from <@${m.author.id}>: "${m.content.slice(0, 120)}"`);
  m.reply(answer.slice(0, 1900)).catch(() => {});
});

client.login(DISCORD_TOKEN);
