/**
 * The server blueprint: roles, channels and who can see what.
 *
 * The gate that matters here is the verification gate. Discord resolves a
 * channel's permissions from that channel's OWN overwrites — a category's
 * overwrites are copied to children at sync time, never consulted at runtime —
 * so a gated category is not a gate. These checks pin the blueprint that
 * setup.js applies per channel.
 */
import { ROLES, CATEGORIES, GAME_ROLES, NOTIFY_ROLES, LEVEL_ROLES, STAFF, MEMBERS, MESSAGES, FAQ } from '../src/config.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const channels = CATEGORIES.flatMap((c) => c.channels.map((ch) => ({ ...ch, category: c.name, access: c.access })));

console.log('— Roles —');
{
  const byKey = Object.fromEntries(ROLES.map((r) => [r.key, r]));
  const DANGEROUS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageWebhooks', 'MentionEveryone'];

  // Customer-facing roles must carry no power at all.
  const customerRoles = ['vip', 'partner', 'platinum', 'gold', 'silver', 'bronze', 'verified'];
  const armed = customerRoles.filter((k) => (byKey[k]?.perms || []).length > 0);
  ok('no customer role grants any permission', armed.length === 0, armed.join(', '));

  ok('Support cannot ban or manage the server',
    !(byKey.support?.perms || []).some((p) => DANGEROUS.includes(p) || p === 'BanMembers'));
  ok('Moderator cannot manage roles or the server',
    !(byKey.moderator?.perms || []).some((p) => ['Administrator', 'ManageGuild', 'ManageRoles'].includes(p)));
  ok('nobody is handed Administrator', !ROLES.some((r) => (r.perms || []).includes('Administrator')));

  // Support is pinged by the bot through allowedMentions, not by members typing.
  ok('no role is member-mentionable', !ROLES.some((r) => r.mentionable),
    ROLES.filter((r) => r.mentionable).map((r) => r.name).join(', '));

  // The gate role outranks the cosmetic ones, so a colour on it would win on
  // every member and make every game/level colour invisible.
  ok('the verified role carries no colour', byKey.verified?.color == null);

  ok('every role key used by the permission groups exists',
    [...STAFF, ...MEMBERS].every((k) => byKey[k]), [...STAFF, ...MEMBERS].filter((k) => !byKey[k]).join(', '));

  // Discord caps a member's role list; more importantly these are all cosmetic.
  ok('self-roles and level roles have unique labels',
    new Set([...GAME_ROLES, ...NOTIFY_ROLES].map((r) => r.label)).size === GAME_ROLES.length + NOTIFY_ROLES.length);
  ok('no two self-role buttons share an emoji',
    new Set(GAME_ROLES.map((r) => r.emoji)).size === GAME_ROLES.length,
    GAME_ROLES.map((r) => r.emoji).join(' '));
  ok('level roles are ordered and distinct',
    LEVEL_ROLES.every((r, i) => i === 0 || r.level > LEVEL_ROLES[i - 1].level));
}

console.log('\n— Channels —');
{
  ok('no duplicate channel names', new Set(channels.map((c) => c.name)).size === channels.length,
    channels.map((c) => c.name).filter((n, i, a) => a.indexOf(n) !== i).join(', '));

  // Every room a visitor can enter and find empty reads as an abandoned shop.
  ok('the server stays small enough to feel alive at launch', channels.length <= 40, `${channels.length} channels`);

  const staffChannels = channels.filter((c) => c.access === 'staff');
  ok('staff channels are never marked public', !staffChannels.some((c) => c.public),
    staffChannels.filter((c) => c.public).map((c) => c.name).join(', '));
  ok('staff area exists and is gated', staffChannels.length > 0);

  // The whole point of the public exception: proof the shop is real, readable
  // by someone who has not joined anything yet.
  const publicNames = channels.filter((c) => c.public || c.access === 'public').map((c) => c.name);
  for (const n of ['faq', 'how-to-buy', 'reviews', 'proof-of-delivery', 'welcome', 'rules', 'verify']) {
    ok(`#${n} is readable before verifying`, publicNames.includes(n));
  }
  ok('every public-marked channel is read-only',
    channels.filter((c) => c.public).every((c) => c.readOnly),
    channels.filter((c) => c.public && !c.readOnly).map((c) => c.name).join(', '));

  // Renames must adopt the old channel instead of leaving a ghost beside it.
  const renamed = channels.filter((c) => c.aka?.length);
  ok('renamed channels carry their old names for adoption', renamed.length > 0);
  ok('no aka collides with a live channel name',
    !renamed.some((c) => (c.aka || []).some((a) => channels.some((x) => x.name === a))),
    renamed.flatMap((c) => c.aka || []).join(', '));

  ok('exactly one AFK channel', channels.filter((c) => c.afk).length === 1);
  ok('voice channels carry no topic (Discord drops it)',
    !channels.some((c) => c.type === 'voice' && c.topic));
}

console.log('\n— Promises —');
{
  const allCopy = [
    ...Object.values(MESSAGES).map((m) => (typeof m === 'function' ? m('ForgeMarket') : m)).map((m) => `${m.title} ${m.description}`),
    ...channels.map((c) => c.topic || ''),
    ...FAQ.map((f) => `${f.q} ${f.a}`),
    ...ROLES.map((r) => r.responsibility || ''),
  ].join('\n');

  ok('nothing promises instant delivery', !/instant delivery|delivered in seconds|instantly/i.test(allCopy));
  ok('nothing promises 24/7 staffing', !/24\/7/i.test(allCopy));
  ok('nothing promises a response time we cannot keep', !/under 10 min|within 10 min/i.test(allCopy));
  ok('nothing claims card checkout', !/card payment|secure card/i.test(allCopy));
  ok('no standing "all systems operational" claim', !/all systems operational/i.test(allCopy));

  // Every channel a promise points at has to exist, or the promise is a dead end.
  const names = new Set(channels.map((c) => c.name));
  const referenced = [...new Set([...allCopy.matchAll(/<#([a-z0-9-]+)>/g)].map((m) => m[1]))];
  const dangling = referenced.filter((r) => !names.has(r));
  ok('every referenced channel exists', dangling.length === 0, dangling.join(', '));

  // Roles that unlock nothing must not be sold as unlocking something.
  ok('no role promises exclusive channels it does not have', !/exclusive channel/i.test(allCopy));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
