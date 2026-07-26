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
import { ROLES, CATEGORIES, STAFF, MEMBERS, GAME_ROLES, NOTIFY_ROLES, LEVEL_ROLES } from './config.js';
import { buildPanels } from './panels.js';

const { DISCORD_TOKEN, DISCORD_GUILD_ID } = process.env;
let STORE_URL = process.env.STORE_URL || 'https://forgemarket.nl';
if (!/^https?:\/\//.test(STORE_URL)) STORE_URL = `https://${STORE_URL}`;

const MARKER = 'forgemarket-setup';

const P = PermissionFlagsBits;
const TYPE = {
  text: ChannelType.GuildText, voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum,
};

// REPOST=1 → re-post all panels. Trimmed because Windows' `set REPOST=1 && …`
// includes the space before && in the value.
const REPOST = /^(1|true|yes)$/i.test((process.env.REPOST || '').trim());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const resolvePerms = (arr = []) => arr.map((n) => P[n]).filter(Boolean);
/** Panel data (already substituted + channel-linked) → an embed. */
const embed = (m) => {
  const e = new EmbedBuilder().setColor(m.color ?? 0x6366f1)
    .setTitle(m.title).setDescription(m.description).setFooter({ text: MARKER });
  if (m.image) e.setImage(m.image);                // brand banner (hosted by the store)
  if (m.thumbnail) e.setThumbnail(m.thumbnail);
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
    // Everything the bot actually does: post embeds and banners, pin panels,
    // build and tear down tickets, react, and read history for transcripts.
    // A short list here fails silently at runtime, which is the worst way to fail.
    const botOW = { id: client.user.id, allow: [
      P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.ReadMessageHistory,
      P.EmbedLinks, P.AttachFiles, P.AddReactions, P.ManageMessages, P.ManageChannels,
      P.ManageThreads, P.Connect,
    ] };
    console.log(`▶ Building "${guild.name}"`);

    // 1) Roles ───────────────────────────────────────────────────────────────
    const roleIds = {};
    for (const r of ROLES) {
      try {
        let role = guild.roles.cache.find((x) => x.name === r.name);
        if (!role) {
          role = await guild.roles.create({
            name: r.name, color: r.color ?? undefined, hoist: r.hoist, mentionable: r.mentionable,
            permissions: resolvePerms(r.perms), reason: 'ForgeMarket setup',
          });
          console.log(`  + role ${r.name}`);
        } else if (role.editable) {
          // Reconcile drift. Without this the script is only idempotent for
          // roles that do not exist yet: editing perms/colour in config.js and
          // re-running setup changed nothing, which is the opposite of what
          // "safe to re-run" promises.
          const wanted = resolvePerms(r.perms).reduce((a, b) => a | b, 0n);
          const changed = role.permissions.bitfield !== wanted
            || role.hoist !== r.hoist
            || role.mentionable !== r.mentionable
            || (r.color != null && role.hexColor.toLowerCase() !== String(r.color).toLowerCase());
          if (changed) {
            await role.edit({
              color: r.color ?? undefined, hoist: r.hoist, mentionable: r.mentionable,
              permissions: resolvePerms(r.perms), reason: 'ForgeMarket setup: reconcile',
            }).catch((e) => console.log(`  ! role ${r.name} update failed: ${e.message}`));
            console.log(`  · role ${r.name}: synced to config`);
          }
        }
        roleIds[r.key] = role.id;
      } catch (e) { console.log(`  ! role ${r.name} failed: ${e.message}`); }
    }

    // Self-assignable game + notification roles (toggled via #roles buttons).
    // NOT mentionable: the bot pings these roles itself (flash sales, drops,
    // giveaways) through allowedMentions, which works regardless. Leaving them
    // mentionable let any member notify everyone who opted in.
    for (const r of [...GAME_ROLES, ...NOTIFY_ROLES]) {
      try {
        const existing = guild.roles.cache.find((x) => x.name === r.label);
        if (!existing) {
          // permissions: [] — otherwise Discord copies @everyone's set into a
          // role handed out by a button any member can press.
          await guild.roles.create({ name: r.label, color: r.color, mentionable: false, permissions: [], reason: 'ForgeMarket self-roles' });
          console.log(`  + self-role ${r.label}`);
        } else if (existing.mentionable && existing.editable) {
          await existing.edit({ mentionable: false }).catch(() => {});
          console.log(`  · self-role ${r.label}: mention spam disabled`);
        }
      } catch (e) { console.log(`  ! self-role ${r.label} failed: ${e.message}`); }
    }

    // Level roles — granted automatically by the bot as members level up.
    for (const r of LEVEL_ROLES) {
      try {
        if (!guild.roles.cache.find((x) => x.name === r.name)) {
          await guild.roles.create({ name: r.name, color: r.color, permissions: [], reason: 'ForgeMarket level roles' });
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

    /**
     * The same policy, applied to the CHANNEL itself.
     *
     * Discord does not consult a category's overwrites when resolving a
     * channel's permissions — a channel only ever carries its own set, copied
     * from the parent at sync time. Creating channels with their own overwrite
     * array (as we do, for the bot and read-only rules) therefore left every one
     * of them ungated: the deny lived on the category and nowhere else. Staff
     * channels included.
     *
     * `ch.public` opts a single channel out of the gate, so the things that
     * prove the shop is real (#faq, #how-to-buy, #reviews, #proof-of-delivery)
     * can be read by someone still deciding whether to trust us.
     */
    const channelOverwrites = (cat, ch) => {
      const byId = new Map();
      const put = (ow) => {
        const cur = byId.get(ow.id) || { id: ow.id, allow: [], deny: [] };
        cur.allow = [...new Set([...cur.allow, ...(ow.allow || [])])];
        cur.deny = [...new Set([...cur.deny, ...(ow.deny || [])])].filter((f) => !cur.allow.includes(f));
        byId.set(ow.id, cur);
      };
      const access = ch.public ? 'public' : cat.access;
      categoryOverwrites(access).forEach(put);
      // A public channel inside a gated category still needs every gated role to
      // keep its Connect/Speak grants; harmless for text channels.
      if (ch.public && cat.access !== 'public') {
        viewers(cat.access).filter((k) => roleIds[k])
          .forEach((k) => put({ id: roleIds[k], allow: [P.ViewChannel, P.Connect, P.Speak] }));
      }
      if (ch.readOnly) {
        put({ id: everyone, deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] });
        for (const k of STAFF) if (roleIds[k]) put({ id: roleIds[k], allow: [P.SendMessages] });
      }
      return [...byId.values()];
    };

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
            const overwrites = channelOverwrites(cat, ch);
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
            // Re-apply the FULL policy to the channel itself. Clearing the
            // view rule and leaning on the category left gated channels open.
            await channel.permissionOverwrites.set(channelOverwrites(cat, ch)).catch((e) =>
              console.log(`    ! #${ch.name} perms failed: ${e.message}`));
            // Topics drift too — they are read as often as the pinned panel.
            const wantTopic = ch.type === 'voice' ? null : (ch.topic || '').replace('{STORE_URL}', STORE_URL);
            if (wantTopic && channel.topic !== wantTopic) {
              await channel.setTopic(wantTopic).catch(() => {});
            }
            if ((ch.slowmode || 0) !== (channel.rateLimitPerUser || 0)) {
              await channel.setRateLimitPerUser(ch.slowmode || 0).catch(() => {});
            }
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
    // Built from the shared panel module, so the bot's boot-time copy sync and
    // this first post can never diverge. Channel placeholders resolve to real
    // mentions now that every channel exists.
    const channelIdByName = Object.fromEntries(
      Object.entries(channelByName).map(([n, c]) => [n, c.id]));
    const PANEL_COPY = buildPanels({ storeUrl: STORE_URL, guildName: guild.name, channelIdByName });

    const ticketButtons = [
      new ButtonBuilder().setCustomId('ticket:order').setLabel('Order issue').setEmoji('🛒').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket:payment').setLabel('Payment').setEmoji('💳').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:partner').setLabel('Partnership').setEmoji('🤝').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ticket:other').setLabel('Other').setEmoji('❓').setStyle(ButtonStyle.Secondary),
    ];
    const verifyButton = new ButtonBuilder().setCustomId('verify').setLabel('Verify me').setEmoji('✅').setStyle(ButtonStyle.Success);

    const PANELS = [
      ['welcome', [link('🛍️ Visit the shop', `${STORE_URL}/shop`)]],
      ['start-here'],
      ['rules'],
      ['verify', [verifyButton]],
      ['links', [
        link('🛍️ Shop', `${STORE_URL}/shop`), link('🏠 Home', STORE_URL),
        link('📦 Track order', `${STORE_URL}/track`), link('👤 Account', `${STORE_URL}/account`)]],
      ['announcements'],
      ['status', [link('📦 Track an order', `${STORE_URL}/track`)]],
      ['products', [link('🛍️ Browse the shop', `${STORE_URL}/shop`)]],
      ['price-list', [link('See live prices', `${STORE_URL}/shop`)]],
      ['how-to-buy', [link('Go to shop', `${STORE_URL}/shop`)]],
      ['deals'],
      ['faq'],
      ['support-info'],
      ['report-a-scam', [new ButtonBuilder().setCustomId('ticket:other')
        .setLabel('Report a scammer').setEmoji('🚨').setStyle(ButtonStyle.Danger)]],
      ['open-a-ticket', ticketButtons],
      ['reviews'],
      ['vouches'],
      ['proof-of-delivery'],
      ['discount-codes'],
      ['suggestions'],
      ['starboard'],
      ['giveaways'],
      ['partners', [ticketButtons[2]]],
      ['staff-announcements'],
    ];

    let posted = 0;
    for (const [name, btns] of PANELS) {
      try {
        const panel = PANEL_COPY[name];
        if (!panel) { console.log(`  ! #${name}: no panel copy defined`); continue; }
        const status = await postOnce(channelByName[name], embed(panel), btns ? [row(...btns)] : []);
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
      const status = await postOnce(channelByName['roles'], embed(PANEL_COPY.roles), rows);
      if (status === 'posted') posted++;
      console.log(`  · #roles: ${status}`);
    } catch (e) { console.log(`  ! #roles FAILED: ${e.message}`); }
    console.log(`\n✅ Setup complete. Panels posted now: ${posted}. ${REPOST ? '(REPOST mode)' : 'Run with REPOST=1 to re-post all.'}`);

    // Channels that exist on the server but are no longer in the blueprint.
    // setup.js never deletes anything — a channel can hold history and pins that
    // are not ours to throw away — so it reports them instead. Empty leftovers
    // are exactly what makes a small server look abandoned.
    try {
      const wanted = new Set(CATEGORIES.flatMap((c) => c.channels)
        .flatMap((c) => [c.name, ...(c.aka || [])]));
      const ours = new Set(CATEGORIES.map((c) => c.name));
      const strays = guild.channels.cache.filter((c) => {
        if (c.type === ChannelType.GuildCategory) return !ours.has(c.name) && c.name !== '📊 SERVER STATS';
        if (c.parent && !ours.has(c.parent.name)) return false;      // in someone else's category
        if (c.parent?.name === '🎫 TICKETS') return false;            // live tickets
        return !wanted.has(c.name);
      });
      if (strays.size) {
        console.log(`\nℹ️  ${strays.size} channel(s) exist here but are not in the blueprint:`);
        strays.forEach((c) => console.log(`   · ${c.type === ChannelType.GuildCategory ? '' : '#'}${c.name}`));
        console.log('   Nothing was deleted. Empty ones are worth removing by hand — a room');
        console.log('   nobody has posted in reads as an abandoned shop.');
      }
    } catch (e) { console.log(`   ! stray-channel check failed: ${e.message}`); }

    // Hierarchy check, not a reminder. If the bot's own managed role sits below
    // "Verified Customer", every verification silently fails at the one gate
    // between a new member and the whole server — so say so, loudly, by name.
    try {
      const me = await guild.members.fetchMe();
      const verified = guild.roles.cache.find((r) => r.name === 'Verified Customer');
      const mine = me.roles.highest;
      if (verified && mine.position <= verified.position) {
        console.log(`\n🚨 ACTION NEEDED: my role "${mine.name}" is ranked BELOW "Verified Customer".`);
        console.log('   Discord will refuse every verification until you fix it:');
        console.log(`   Server Settings → Roles → drag "${mine.name}" ABOVE "Verified Customer". Takes 10 seconds.`);
      } else if (verified) {
        console.log(`   ✓ Role hierarchy OK — "${mine.name}" outranks "Verified Customer", verification will work.`);
      }
    } catch (e) { console.log(`   ! could not check role hierarchy: ${e.message}`); }
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
