/**
 * One-shot, idempotent server builder. Creates roles, categories, channels,
 * topics and permissions from config.js, then posts rich onboarding + info panels
 * (welcome, rules, start-here, verify button, products, how-to-buy, deals,
 * announcement, FAQ, support info, ticket panel, reviews, giveaways, events…).
 *
 * Resilient: a failure on one item is logged and skipped, never aborting the run.
 * Safe to re-run — it reuses anything that already exists and fills in what's
 * missing. The Owner is never touched; invite the bot with Administrator.
 *
 *   npm run setup
 */
import 'dotenv/config';
import {
  Client, GatewayIntentBits, PermissionFlagsBits, ChannelType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { ROLES, CATEGORIES, MESSAGES, FAQ, STAFF, MEMBERS } from './config.js';

const { DISCORD_TOKEN, DISCORD_GUILD_ID } = process.env;
let STORE_URL = process.env.STORE_URL || 'https://forgemarket.app';
if (!/^https?:\/\//.test(STORE_URL)) STORE_URL = `https://${STORE_URL}`;

const MARKER = 'forgemarket-setup';
const P = PermissionFlagsBits;
const TYPE = {
  text: ChannelType.GuildText, voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum,
};

const REPOST = /^(1|true|yes)$/i.test(process.env.REPOST || ''); // REPOST=1 → re-post all panels

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const resolvePerms = (arr = []) => arr.map((n) => P[n]).filter(Boolean);
const sub = (s) => String(s).replaceAll('{STORE_URL}', STORE_URL);
const embed = (m) => new EmbedBuilder().setColor(0x6366f1).setTitle(sub(m.title)).setDescription(sub(m.description)).setFooter({ text: MARKER });
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const link = (label, url) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();
    const everyone = guild.roles.everyone.id;
    console.log(`▶ Building "${guild.name}"`);

    // 1) Roles ───────────────────────────────────────────────────────────────
    const roleIds = {};
    for (const r of ROLES) {
      try {
        let role = guild.roles.cache.find((x) => x.name === r.name);
        if (!role) {
          role = await guild.roles.create({
            name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
            permissions: resolvePerms(r.perms), reason: 'ForgeMarket setup',
          });
          console.log(`  + role ${r.name}`);
        }
        roleIds[r.key] = role.id;
      } catch (e) { console.log(`  ! role ${r.name} failed: ${e.message}`); }
    }

    const viewers = (access) => access === 'staff' ? STAFF
      : access === 'vip' ? ['vip', ...STAFF] : MEMBERS;

    // 2) Categories + channels ────────────────────────────────────────────────
    const channelByName = {};
    for (const cat of CATEGORIES) {
      let category;
      try {
        category = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === cat.name);
        if (!category) {
          const ow = cat.access === 'public'
            ? [{ id: everyone, allow: [P.ViewChannel] }]
            : [{ id: everyone, deny: [P.ViewChannel] },
               ...viewers(cat.access).filter((k) => roleIds[k]).map((k) => ({ id: roleIds[k], allow: [P.ViewChannel] }))];
          category = await guild.channels.create({
            name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: ow, reason: 'ForgeMarket setup',
          });
          console.log(`  + category ${cat.name}`);
        }
      } catch (e) { console.log(`  ! category ${cat.name} failed: ${e.message}`); continue; }

      for (const ch of cat.channels) {
        try {
          let channel = guild.channels.cache.find((c) => c.name === ch.name && c.parentId === category.id);
          if (!channel) {
            const overwrites = [];
            if (ch.readOnly) {
              overwrites.push({ id: everyone, deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] });
              for (const k of STAFF) if (roleIds[k]) overwrites.push({ id: roleIds[k], allow: [P.SendMessages] });
            }
            channel = await guild.channels.create({
              name: ch.name, type: TYPE[ch.type] ?? ChannelType.GuildText, parent: category.id,
              topic: ch.type === 'voice' ? undefined : (ch.topic || '').replace('{STORE_URL}', STORE_URL),
              rateLimitPerUser: ch.slowmode || 0,
              permissionOverwrites: overwrites.length ? overwrites : undefined,
              reason: 'ForgeMarket setup',
            });
            console.log(`    + #${ch.name}`);
          }
          channelByName[ch.name] = channel;
        } catch (e) { console.log(`    ! #${ch.name} failed: ${e.message}`); }
      }
    }

    // 3) Panels (rich content in every key channel) ───────────────────────────
    const faqEmbed = new EmbedBuilder().setColor(0x6366f1).setTitle('❓ Frequently Asked Questions')
      .setDescription(FAQ.map((f) => `**${f.q}**\n${f.a}`).join('\n\n')).setFooter({ text: MARKER });

    const ticketButtons = [
      new ButtonBuilder().setCustomId('ticket:order').setLabel('Order issue').setEmoji('🛒').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket:payment').setLabel('Payment').setEmoji('💳').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:partner').setLabel('Partnership').setEmoji('🤝').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:other').setLabel('Other').setEmoji('❓').setStyle(ButtonStyle.Secondary),
    ];
    const verifyButton = new ButtonBuilder().setCustomId('verify').setLabel('Verify me').setEmoji('✅').setStyle(ButtonStyle.Success);

    const PANELS = [
      ['welcome', embed(MESSAGES.welcome(guild.name)), [link('🛍️ Visit the shop', `${STORE_URL}/shop`)]],
      ['start-here', embed(MESSAGES.startHere)],
      ['rules', embed(MESSAGES.rules)],
      ['verify', embed(MESSAGES.verify), [verifyButton]],
      ['links', embed(MESSAGES.links), [
        link('🛍️ Shop', `${STORE_URL}/shop`), link('🏠 Home', STORE_URL),
        link('📦 Track order', `${STORE_URL}/track`), link('👤 Account', `${STORE_URL}/account`)]],
      ['announcements', embed(MESSAGES.announcement)],
      ['status', embed(MESSAGES.status)],
      ['products', embed(MESSAGES.products), [link('🛍️ Browse the shop', `${STORE_URL}/shop`)]],
      ['price-list', embed(MESSAGES.priceList), [link('See live prices', `${STORE_URL}/shop`)]],
      ['how-to-buy', embed(MESSAGES.howToBuy), [link('Go to shop', `${STORE_URL}/shop`)]],
      ['deals', embed(MESSAGES.deals)],
      ['faq', faqEmbed],
      ['support-info', embed(MESSAGES.supportInfo)],
      ['report-a-scam', embed(MESSAGES.reportScam)],
      ['open-a-ticket', embed(MESSAGES.ticketPanel), ticketButtons],
      ['reviews', embed(MESSAGES.reviewsIntro)],
      ['vouchers', embed(MESSAGES.vouchersIntro)],
      ['proof-of-delivery', embed(MESSAGES.proofIntro)],
      ['discount-codes', embed(MESSAGES.discountCodes)],
      ['giveaways', embed(MESSAGES.giveawaysIntro)],
      ['events', embed(MESSAGES.eventsIntro)],
      ['partnerships', embed(MESSAGES.partnersIntro)],
      ['partner-perks', embed(MESSAGES.partnerPerks)],
      ['staff-announcements', embed(MESSAGES.staffIntro)],
    ];

    let posted = 0;
    for (const [name, emb, btns] of PANELS) {
      try {
        const status = await postOnce(channelByName[name], emb, btns ? row(...btns) : undefined);
        if (status === 'posted') posted++;
        console.log(`  · #${name}: ${status}`);
      } catch (e) { console.log(`  ! #${name} FAILED: ${e.message}`); }
    }
    console.log(`\n✅ Setup complete. Panels posted now: ${posted}. ${REPOST ? '(REPOST mode)' : 'Run with REPOST=1 to re-post all.'}`);
    console.log('   Reminder: drag the "Bot" role just under "Admin" so it can grant the Verified role.');
    process.exit(0);
  } catch (err) {
    console.error('Setup failed:', err);
    process.exit(1);
  }
});

async function postOnce(channel, embedBuilder, components) {
  if (!channel || !channel.isTextBased?.()) return 'no-channel';
  const recent = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  const mine = recent ? [...recent.values()].filter(
    (m) => m.author.id === client.user.id && m.embeds[0]?.footer?.text === MARKER) : [];
  if (mine.length && !REPOST) return 'exists';
  if (REPOST) { for (const m of mine) await m.delete().catch(() => {}); }
  const sent = await channel.send({ embeds: [embedBuilder], components: components ? [components] : [] });
  await sent.pin().catch(() => {});
  return 'posted';
}

client.login(DISCORD_TOKEN);
