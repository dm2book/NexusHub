/**
 * One-shot, idempotent server builder. Creates roles, categories, channels,
 * topics and permissions from config.js, then posts the onboarding panels
 * (welcome, rules, start-here, verify button, ticket button, FAQ).
 *
 * Run again any time — it reuses anything that already exists by name.
 * The Owner is never touched; invite the bot with Administrator so it can manage
 * the server (the Owner still outranks it).
 *
 *   npm run setup
 */
import 'dotenv/config';
import {
  Client, GatewayIntentBits, PermissionFlagsBits, ChannelType,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { ROLES, CATEGORIES, MESSAGES, FAQ, STAFF, MEMBERS } from './config.js';

const { DISCORD_TOKEN, DISCORD_GUILD_ID, STORE_URL = 'https://forgemarket.app' } = process.env;
const MARKER = 'forgemarket-setup';
const P = PermissionFlagsBits;
const TYPE = {
  text: ChannelType.GuildText, voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const resolvePerms = (arr = []) => arr.map((n) => P[n]).filter(Boolean);

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();
    const everyone = guild.roles.everyone.id;
    console.log(`▶ Building "${guild.name}"`);

    // 1) Roles (skip if a role with the same name exists) ───────────────────
    const roleIds = {};
    for (const r of ROLES) {
      let role = guild.roles.cache.find((x) => x.name === r.name);
      if (!role) {
        role = await guild.roles.create({
          name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
          permissions: resolvePerms(r.perms), reason: 'ForgeMarket setup',
        });
        console.log(`  + role ${r.name}`);
      }
      roleIds[r.key] = role.id;
    }

    // helper: which roles may VIEW a category
    const viewers = (access) =>
      access === 'staff' ? STAFF
        : access === 'vip' ? ['vip', ...STAFF]
          : MEMBERS; // verified

    // 2) Categories + channels ──────────────────────────────────────────────
    const channelByName = {};
    for (const cat of CATEGORIES) {
      let category = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === cat.name);
      if (!category) {
        category = await guild.channels.create({
          name: cat.name, type: ChannelType.GuildCategory,
          permissionOverwrites: cat.access === 'public'
            ? [{ id: everyone, allow: [P.ViewChannel] }]
            : [{ id: everyone, deny: [P.ViewChannel] },
               ...viewers(cat.access).map((k) => ({ id: roleIds[k], allow: [P.ViewChannel] }))],
          reason: 'ForgeMarket setup',
        });
        console.log(`  + category ${cat.name}`);
      }

      for (const ch of cat.channels) {
        const existing = guild.channels.cache.find(
          (c) => c.name === ch.name && c.parentId === category.id);
        const overwrites = [];
        // read-only: members read, staff post
        if (ch.readOnly) {
          overwrites.push({ id: everyone, deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] });
          for (const k of STAFF) overwrites.push({ id: roleIds[k], allow: [P.SendMessages] });
        }
        let channel = existing;
        if (!channel) {
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
      }
    }

    // 3) Onboarding panels (post once) ───────────────────────────────────────
    await postOnce(channelByName['welcome'], embed(MESSAGES.welcome(guild.name)));
    await postOnce(channelByName['start-here'], embed(MESSAGES.startHere));
    await postOnce(channelByName['rules'], embed(MESSAGES.rules));
    await postOnce(channelByName['verify'], embed(MESSAGES.verify),
      row(new ButtonBuilder().setCustomId('verify').setLabel('✅ Verify').setStyle(ButtonStyle.Success)));
    await postOnce(channelByName['open-a-ticket'], embed(MESSAGES.ticketPanel),
      row(
        new ButtonBuilder().setCustomId('ticket:order').setLabel('Order issue').setEmoji('🛒').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticket:payment').setLabel('Payment').setEmoji('💳').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket:partner').setLabel('Partnership').setEmoji('🤝').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket:other').setLabel('Other').setEmoji('❓').setStyle(ButtonStyle.Secondary),
      ));
    const faqEmbed = new EmbedBuilder().setColor(0x6366f1).setTitle('❓ Frequently Asked Questions')
      .setDescription(FAQ.map((f) => `**${f.q}**\n${f.a}`).join('\n\n')).setFooter({ text: MARKER });
    await postOnce(channelByName['faq'], faqEmbed);

    console.log('\n✅ Setup complete. Channels, roles and panels are ready.');
    console.log('   Tip: drag the bot’s role just under Admin so it can manage members.');
    process.exit(0);
  } catch (err) {
    console.error('Setup failed:', err);
    process.exit(1);
  }
});

function embed(m) {
  return new EmbedBuilder().setColor(0x6366f1).setTitle(m.title).setDescription(m.description).setFooter({ text: MARKER });
}
function row(...buttons) { return new ActionRowBuilder().addComponents(...buttons); }

async function postOnce(channel, embedBuilder, components) {
  if (!channel || !channel.isTextBased?.()) return;
  const recent = await channel.messages.fetch({ limit: 15 }).catch(() => null);
  const already = recent?.some((msg) => msg.author.id === client.user.id
    && msg.embeds[0]?.footer?.text === MARKER);
  if (already) return;
  const sent = await channel.send({ embeds: [embedBuilder], components: components ? [components] : [] });
  await sent.pin().catch(() => {});
}

client.login(DISCORD_TOKEN);
