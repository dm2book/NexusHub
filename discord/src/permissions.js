/**
 * Who can see what, and the smallest set of powers the bot needs to do its job.
 *
 * Two things live here because both are security boundaries and neither could
 * be tested where it was:
 *
 *   resolveOverwrites() was a closure inside setup.js's ready handler, so the
 *   only way to find out whether a customer could read #mod-log was to build a
 *   real guild and look. It is the same logic, moved out and given its inputs
 *   as arguments — setup.js calls it, and so does the test that asserts no
 *   customer-tier role can view a staff channel.
 *
 *   BOT_PERMISSIONS replaces "invite the bot with Administrator", which is what
 *   the README said in three places. Administrator on a bot is total control of
 *   the guild: it bypasses every channel overwrite (including the ones above
 *   that keep tickets private), can delete channels, ban anyone, and read every
 *   private ticket. The token lives in a hosting environment and in the
 *   dependency tree of a Node process; the blast radius of it leaking should
 *   not be "the attacker owns the server".
 */
/**
 * Discord's documented permission bits, by name.
 *
 * Written out rather than imported so this module — and the test that checks
 * the boundaries it describes — can be read without a Discord client present.
 * server-blueprint.test.mjs asserts every value here against discord.js's own
 * PermissionFlagsBits whenever the library is installed, so the copy cannot
 * drift from the source it is copying.
 */
export const FLAGS = {
  CreateInstantInvite: 1n << 0n,
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  AddReactions: 1n << 6n,
  ViewAuditLog: 1n << 7n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  Connect: 1n << 20n,
  Speak: 1n << 21n,
  MuteMembers: 1n << 22n,
  DeafenMembers: 1n << 23n,
  MoveMembers: 1n << 24n,
  UseVAD: 1n << 25n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  CreatePublicThreads: 1n << 35n,
  SendMessagesInThreads: 1n << 38n,
  ManageThreads: 1n << 34n,
  ModerateMembers: 1n << 40n,
  Stream: 1n << 9n,
};

/**
 * Everything the bot actually does, and nothing else.
 *
 * Derived by reading the calls it makes rather than by guessing:
 *   ManageGuild        setup sets the AFK channel (guild.edit)
 *   ManageRoles        creates/reconciles roles, grants Verified and level roles
 *   ManageChannels     creates categories, channels and ticket channels; slowmode
 *   ManageMessages     pins panels, deletes scam messages, /clearpins
 *   ManageThreads      opens and archives suggestion threads
 *   MentionEveryone    pings the opt-in notify roles, which are deliberately
 *                      NOT mentionable so members cannot ping them
 *   CreateInstantInvite  makes the permanent invite the storefront links to
 *   the rest           post embeds, attach banners, react, read history for
 *                      ticket transcripts
 *
 * Deliberately absent: Administrator, BanMembers, KickMembers, ModerateMembers,
 * ManageWebhooks, ViewAuditLog, ManageNicknames. The bot never kicks, bans or
 * times anyone out — its only moderation action is deleting a scam message,
 * which is ManageMessages.
 */
export const BOT_PERMISSIONS = [
  'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ManageThreads',
  'MentionEveryone', 'CreateInstantInvite', 'ViewChannel', 'SendMessages',
  'SendMessagesInThreads', 'CreatePublicThreads', 'EmbedLinks', 'AttachFiles',
  'AddReactions', 'ReadMessageHistory',
];

/** The bitfield for the invite URL. */
export const botPermissionBits = () =>
  BOT_PERMISSIONS.reduce((acc, name) => acc | FLAGS[name], 0n);

/** The invite link to hand an owner, with exactly those powers and no more. */
export const botInviteUrl = (clientId) =>
  `https://discord.com/api/oauth2/authorize?client_id=${clientId}`
  + `&scope=bot%20applications.commands&permissions=${botPermissionBits()}`;

/** Powers that would let a leaked bot token take the server apart. */
export const DANGEROUS_FOR_BOT = [
  'Administrator', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageWebhooks',
];

/**
 * The overwrites one channel should carry.
 *
 * Discord does not consult a category's overwrites when resolving a channel's
 * permissions — a channel only ever carries its own set, copied from the parent
 * at sync time. Creating channels with their own overwrite array (as setup does,
 * for the bot and the read-only rules) therefore left every one of them
 * ungated: the deny lived on the category and nowhere else. Staff channels
 * included. So the full policy is rebuilt per channel.
 *
 * `channel.public` opts a single channel out of the gate, so the things that
 * prove the shop is real (#faq, #how-to-buy, #reviews, #proof-of-delivery) can
 * be read by someone still deciding whether to trust us.
 */
export function resolveOverwrites({
  category, channel, everyoneId, roleIds, botOverwrite, staffKeys, memberKeys, P = FLAGS,
}) {
  const viewers = (access) => (access === 'staff' ? staffKeys
    : access === 'vip' ? ['vip', ...staffKeys] : memberKeys);

  // Public = everyone can view; otherwise everyone is denied and only the
  // listed roles + the bot can. This is the verification gate.
  //
  // Gated categories also grant Connect/Speak explicitly to the allowed roles
  // (and deny Connect to everyone), so voice channels are joinable regardless
  // of how the server's base @everyone permissions happen to be set.
  const forAccess = (access) => (access === 'public'
    ? [{ id: everyoneId, allow: [P.ViewChannel] }, botOverwrite]
    : [{ id: everyoneId, deny: [P.ViewChannel, P.Connect] }, botOverwrite,
      ...viewers(access).filter((k) => roleIds[k]).map((k) => ({
        id: roleIds[k],
        allow: [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD],
      }))]);

  const byId = new Map();
  const put = (ow) => {
    const cur = byId.get(ow.id) || { id: ow.id, allow: [], deny: [] };
    cur.allow = [...new Set([...cur.allow, ...(ow.allow || [])])];
    cur.deny = [...new Set([...cur.deny, ...(ow.deny || [])])].filter((f) => !cur.allow.includes(f));
    byId.set(ow.id, cur);
  };

  const access = channel.public ? 'public' : category.access;
  forAccess(access).forEach(put);
  // A public channel inside a gated category still needs every gated role to
  // keep its Connect/Speak grants; harmless for text channels.
  if (channel.public && category.access !== 'public') {
    viewers(category.access).filter((k) => roleIds[k])
      .forEach((k) => put({ id: roleIds[k], allow: [P.ViewChannel, P.Connect, P.Speak] }));
  }
  if (channel.readOnly) {
    put({ id: everyoneId, deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] });
    for (const k of staffKeys) if (roleIds[k]) put({ id: roleIds[k], allow: [P.SendMessages] });
  }
  return [...byId.values()];
}

/**
 * Can a role see this channel, given the resolved overwrites?
 *
 * Discord's own resolution order for a channel: @everyone's deny, then the
 * role's allow. A role with no overwrite at all inherits @everyone.
 */
export function canView(overwrites, roleId, everyoneId, P = FLAGS) {
  const mine = overwrites.find((o) => o.id === roleId);
  if (mine?.allow?.includes(P.ViewChannel)) return true;
  if (mine?.deny?.includes(P.ViewChannel)) return false;
  const base = overwrites.find((o) => o.id === everyoneId);
  if (base?.deny?.includes(P.ViewChannel)) return false;
  return true;
}
