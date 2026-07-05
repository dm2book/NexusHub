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
import { ROLES, CATEGORIES, MESSAGES, FAQ, STAFF, MEMBERS, GAME_ROLES, NOTIFY_ROLES, LEVEL_ROLES } from './config.js';

const { DISCORD_TOKEN, DISCORD_GUILD_ID } = process.env;
let STORE_URL = process.env.STORE_URL || 'https://forgemarket-store.vercel.app';
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
const embed = (m) => {
  const e = new EmbedBuilder().setColor(m.color ?? 0x6366f1)
    .setTitle(sub(m.title)).setDescription(sub(m.description)).setFooter({ text: MARKER });
  if (m.image) e.setImage(sub(m.image));           // brand banner (hosted by the store)
  if (m.thumbnail) e.setThumbnail(sub(m.thumbnail));
  return e;
};
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const link = (label, url) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();
    const everyone = guild.roles.everyone.id;
    // The bot's own member overwrite — guarantees it can always view + post,
    // even in read-only channels and gated categories, without Administrator.
    const botOW = { id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ManageChannels] };
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

    // Self-assignable game + notification roles (toggled via #roles buttons).
    for (const r of [...GAME_ROLES, ...NOTIFY_ROLES]) {
      try {
        if (!guild.roles.cache.find((x) => x.name === r.label)) {
          await guild.roles.create({ name: r.label, color: r.color, mentionable: true, reason: 'ForgeMarket self-roles' });
          console.log(`  + self-role ${r.label}`);
        }
      } catch (e) { console.log(`  ! self-role ${r.label} failed: ${e.message}`); }
    }

    // Level roles — granted automatically by the bot as members level up.
    for (const r of LEVEL_ROLES) {
      try {
        if (!guild.roles.cache.find((x) => x.name === r.name)) {
          await guild.roles.create({ name: r.name, color: r.color, reason: 'ForgeMarket level roles' });
          console.log(`  + level role ${r.name}`);
        }
      } catch (e) { console.log(`  ! level role ${r.name} failed: ${e.message}`); }
    }

    // Role ORDER — staff on top, then community tiers, loyalty, levels, verified,
    // then the cosmetic self-roles. Everything in one bulk call (best-effort:
    // roles above the bot's own highest role can't be moved).
    try {
      const me = await guild.members.fetchMe();
      const order = [
        ...ROLES.map((r) => r.name),
        ...LEVEL_ROLES.map((r) => r.name).reverse(), // Level 30 above Level 5
        ...GAME_ROLES.map((r) => r.label),
        ...NOTIFY_ROLES.map((r) => r.label),
      ];
      const movable = order
        .map((n) => guild.roles.cache.find((x) => x.name === n))
        .filter((r) => r && r.editable && r.position < me.roles.highest.position);
      // Bottom-up: last in `order` gets position 1 (just above @everyone).
      const payload = movable.slice().reverse().map((r, idx) => ({ role: r.id, position: idx + 1 }));
      if (payload.length) {
        await guild.roles.setPositions(payload);
        console.log(`  · role order synced (${payload.length} roles)`);
      }
    } catch (e) { console.log(`  ! role ordering failed: ${e.message}`); }

    const viewers = (access) => access === 'staff' ? STAFF
      : access === 'vip' ? ['vip', ...STAFF] : MEMBERS;

    // Desired category-level overwrites for an access tier. Public = everyone can
    // view; otherwise everyone is denied and only the listed roles + bot can view.
    // This is the verification gate: only 'public' categories are visible before a
    // member gets the Verified role.
    // Voice fix: gated categories also grant Connect/Speak explicitly to the
    // allowed roles (and deny Connect to everyone), so voice channels are
    // joinable regardless of how the server's base @everyone permissions are set.
    const categoryOverwrites = (access) => access === 'public'
      ? [{ id: everyone, allow: [P.ViewChannel] }, botOW]
      : [{ id: everyone, deny: [P.ViewChannel, P.Connect] }, botOW,
         ...viewers(access).filter((k) => roleIds[k]).map((k) => ({
           id: roleIds[k],
           allow: [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD],
         }))];

    // 2) Categories + channels ────────────────────────────────────────────────
    const channelByName = {};
    const categoryByName = {};
    for (const cat of CATEGORIES) {
      let category;
      try {
        category = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name === cat.name);
        if (!category) {
          category = await guild.channels.create({
            name: cat.name, type: ChannelType.GuildCategory,
            permissionOverwrites: categoryOverwrites(cat.access), reason: 'ForgeMarket setup',
          });
          console.log(`  + category ${cat.name}`);
        } else {
          // Re-apply the full access policy so re-running setup fixes existing
          // servers (e.g. enforces the verification gate on already-public cats).
          await category.permissionOverwrites.set(categoryOverwrites(cat.access)).catch(() => {});
          console.log(`  · category ${cat.name}: perms synced (${cat.access})`);
        }
        categoryByName[cat.name] = category;
      } catch (e) { console.log(`  ! category ${cat.name} failed: ${e.message}`); continue; }

      for (const ch of cat.channels) {
        try {
          const wantedType = TYPE[ch.type] ?? ChannelType.GuildText;
          // Match by name in the right category, then anywhere by name or an
          // old alias (aka) — so renamed/moved channels are adopted, not duplicated.
          let channel = guild.channels.cache.find((c) => c.name === ch.name && c.parentId === category.id)
            || guild.channels.cache.find((c) => c.type === wantedType
              && (c.name === ch.name || (ch.aka || []).includes(c.name)));
          if (!channel) {
            const overwrites = [botOW];
            if (ch.readOnly) {
              overwrites.push({ id: everyone, deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] });
              for (const k of STAFF) if (roleIds[k]) overwrites.push({ id: roleIds[k], allow: [P.SendMessages] });
            }
            channel = await guild.channels.create({
              name: ch.name, type: wantedType, parent: category.id,
              topic: ch.type === 'voice' ? undefined : (ch.topic || '').replace('{STORE_URL}', STORE_URL),
              rateLimitPerUser: ch.slowmode || 0,
              userLimit: ch.type === 'voice' ? (ch.userLimit || 0) : undefined,
              permissionOverwrites: overwrites,
              reason: 'ForgeMarket setup',
            });
            console.log(`    + #${ch.name}`);
          } else {
            // Adopt: right place, right name, then enforce policy on it.
            if (channel.parentId !== category.id) {
              await channel.setParent(category.id, { lockPermissions: true }).catch(() => {});
              console.log(`    → moved #${channel.name} into ${cat.name}`);
            }
            if (channel.name !== ch.name) {
              await channel.setName(ch.name).catch(() => {});
              console.log(`    → renamed to ${ch.name}`);
            }
            // Enforce policy on existing channels: clear any channel-level view
            // override so it INHERITS the (gated) category, re-apply read-only,
            // and make sure the bot can still post.
            await channel.permissionOverwrites.edit(everyone,
              ch.readOnly
                ? { ViewChannel: null, SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false }
                : { ViewChannel: null, SendMessages: null }).catch(() => {});
            if (ch.readOnly) {
              for (const k of STAFF) if (roleIds[k]) {
                await channel.permissionOverwrites.edit(roleIds[k], { SendMessages: true }).catch(() => {});
              }
            }
            await channel.permissionOverwrites.edit(client.user.id,
              { ViewChannel: true, SendMessages: true, ManageMessages: true }).catch(() => {});
            if (ch.type === 'voice' && (ch.userLimit || 0) !== channel.userLimit) {
              await channel.setUserLimit(ch.userLimit || 0).catch(() => {});
            }
          }
          channelByName[ch.name] = channel;
        } catch (e) { console.log(`    ! #${ch.name} failed: ${e.message}`); }
      }
    }

    // 2b) Order — categories in config order, channels in config order inside
    // each category. Discord sorts voice below text automatically; positions
    // are enforced per type, so this is one pass of best-effort moves.
    try {
      // The bot-managed "📊 SERVER STATS" category stays pinned to the very top.
      const stats = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === '📊 SERVER STATS');
      let catPos = 0;
      if (stats) await stats.setPosition(catPos++).catch(() => {});
      for (const cat of CATEGORIES) {
        const category = categoryByName[cat.name];
        if (category) await category.setPosition(catPos++).catch(() => {});
      }
      for (const cat of CATEGORIES) {
        let pos = 0;
        for (const ch of cat.channels) {
          const channel = channelByName[ch.name];
          if (channel) await channel.setPosition(pos++).catch(() => {});
        }
      }
      console.log('  · category & channel order synced');
    } catch (e) { console.log(`  ! ordering failed: ${e.message}`); }

    // 2c) AFK — point the guild at the 💤 AFK channel (5 min timeout) so idle
    // members are moved out of active voice rooms automatically.
    try {
      const afkDef = CATEGORIES.flatMap((c) => c.channels).find((c) => c.afk);
      const afk = afkDef && channelByName[afkDef.name];
      if (afk && guild.afkChannelId !== afk.id) {
        await guild.edit({ afkChannel: afk.id, afkTimeout: 300 });
        console.log('  · AFK channel set (5 min timeout)');
      }
    } catch (e) { console.log(`  ! AFK setup failed: ${e.message}`); }

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
      ['suggestions', embed(MESSAGES.suggestionsIntro)],
      ['starboard', embed(MESSAGES.starboardIntro)],
      ['giveaways', embed(MESSAGES.giveawaysIntro)],
      ['events', embed(MESSAGES.eventsIntro)],
      ['partnerships', embed(MESSAGES.partnersIntro)],
      ['partner-perks', embed(MESSAGES.partnerPerks)],
      ['staff-announcements', embed(MESSAGES.staffIntro)],
    ];

    let posted = 0;
    for (const [name, emb, btns] of PANELS) {
      try {
        const status = await postOnce(channelByName[name], emb, btns ? [row(...btns)] : []);
        if (status === 'posted') posted++;
        console.log(`  · #${name}: ${status}`);
      } catch (e) { console.log(`  ! #${name} FAILED: ${e.message}`); }
    }

    // Self-roles panel (#roles) — multiple button rows.
    try {
      const mkBtn = (r) => new ButtonBuilder().setCustomId(`role:${r.key}`).setLabel(r.label)
        .setEmoji(r.emoji).setStyle(ButtonStyle.Secondary);
      const rows = [];
      for (let i = 0; i < GAME_ROLES.length; i += 5) rows.push(row(...GAME_ROLES.slice(i, i + 5).map(mkBtn)));
      rows.push(row(...NOTIFY_ROLES.map(mkBtn)));
      const status = await postOnce(channelByName['roles'], embed(MESSAGES.rolesPanel), rows);
      if (status === 'posted') posted++;
      console.log(`  · #roles: ${status}`);
    } catch (e) { console.log(`  ! #roles FAILED: ${e.message}`); }
    console.log(`\n✅ Setup complete. Panels posted now: ${posted}. ${REPOST ? '(REPOST mode)' : 'Run with REPOST=1 to re-post all.'}`);
    console.log('   Reminder: drag the "Bot" role just under "Admin" so it can grant the Verified role.');
    process.exit(0);
  } catch (err) {
    console.error('Setup failed:', err);
    process.exit(1);
  }
});

async function postOnce(channel, embedBuilder, rows = []) {
  if (!channel || !channel.isTextBased?.()) return 'no-channel';
  const recent = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  const mine = recent ? [...recent.values()].filter(
    (m) => m.author.id === client.user.id && m.embeds[0]?.footer?.text === MARKER) : [];
  if (mine.length && !REPOST) return 'exists';
  if (REPOST) { for (const m of mine) await m.delete().catch(() => {}); }
  const sent = await channel.send({ embeds: [embedBuilder], components: rows });
  await sent.pin().catch(() => {});
  return 'posted';
}

client.login(DISCORD_TOKEN);
