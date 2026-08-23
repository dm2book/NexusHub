/**
 * The permission boundaries, resolved rather than read.
 *
 * The rule that keeps customers out of staff channels lived in a closure inside
 * setup.js's ready handler, so the only way to find out whether a Verified
 * Customer could read #mod-log was to build a real guild and look. It is in
 * permissions.js now, and this runs it over the real blueprint: every role
 * against every channel, asking Discord's own resolution order.
 *
 * And the setup used to say "invite the bot with Administrator" — in the README
 * three times. Administrator bypasses every overwrite checked below, including
 * the ones that make a ticket private, so the bot's own least-privilege set is
 * pinned here too.
 */
import { CATEGORIES, ROLES, GAME_ROLES, NOTIFY_ROLES, LEVEL_ROLES } from '../src/config.js';
import {
  resolveOverwrites, canView, FLAGS, BOT_PERMISSIONS, DANGEROUS_FOR_BOT,
  botPermissionBits, botInviteUrl,
} from '../src/permissions.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const STAFF_KEYS = ['admin', 'moderator', 'support'];
const MEMBER_KEYS = ['verified', 'vip', 'partner', ...STAFF_KEYS];
const CUSTOMER_KEYS = ['verified', 'vip', 'partner'];

// Stand-in ids: the resolver only ever compares them.
const EVERYONE = 'id-everyone';
const BOT = 'id-bot';
const roleIds = Object.fromEntries(
  [...new Set([...MEMBER_KEYS, ...ROLES.map((r) => r.key)])].map((k) => [k, `id-${k}`]));
const botOverwrite = { id: BOT, allow: [FLAGS.ViewChannel, FLAGS.SendMessages] };

const resolve = (category, channel) => resolveOverwrites({
  category, channel, everyoneId: EVERYONE, roleIds, botOverwrite,
  staffKeys: STAFF_KEYS, memberKeys: MEMBER_KEYS,
});

const everyChannel = CATEGORIES.flatMap((cat) => cat.channels.map((ch) => ({ cat, ch })));

console.log('— A customer cannot see anything staff-only —');
{
  const staffChannels = everyChannel.filter(({ cat }) => cat.access === 'staff');
  ok('the blueprint has staff channels to protect', staffChannels.length >= 5, `${staffChannels.length}`);

  const leaks = [];
  for (const { cat, ch } of staffChannels) {
    const ow = resolve(cat, ch);
    for (const key of CUSTOMER_KEYS) {
      if (canView(ow, roleIds[key], EVERYONE)) leaks.push(`${key} → #${ch.name}`);
    }
    if (canView(ow, EVERYONE, EVERYONE)) leaks.push(`@everyone → #${ch.name}`);
  }
  ok('no customer-tier role can view a staff channel', leaks.length === 0, leaks.join(', '));

  // The three that carry the most: transcripts of private tickets, moderation
  // history, and the sales feed with buyer email addresses in it.
  for (const name of ['ticket-logs', 'mod-log', 'leads']) {
    const found = everyChannel.find(({ ch }) => ch.name === name);
    ok(`#${name} exists and is staff-gated`, !!found && found.cat.access === 'staff',
      found ? found.cat.access : 'missing');
  }
}

console.log('\n— …and every staff role still can —');
{
  const blind = [];
  for (const { cat, ch } of everyChannel.filter(({ cat }) => cat.access === 'staff')) {
    const ow = resolve(cat, ch);
    for (const key of STAFF_KEYS) if (!canView(ow, roleIds[key], EVERYONE)) blind.push(`${key} ✗ #${ch.name}`);
  }
  ok('staff can read their own channels', blind.length === 0, blind.join(', '));
}

console.log('\n— An unverified visitor sees only what is meant to be public —');
{
  const visible = everyChannel
    .filter(({ cat, ch }) => canView(resolve(cat, ch), EVERYONE, EVERYONE))
    .map(({ ch }) => ch.name);
  const intended = everyChannel
    .filter(({ cat, ch }) => ch.public || cat.access === 'public')
    .map(({ ch }) => ch.name);
  ok('exactly the public set is readable before verifying',
    JSON.stringify([...visible].sort()) === JSON.stringify([...intended].sort()),
    `visible=${visible.sort()} intended=${intended.sort()}`);
  ok('and that set is not empty', visible.length > 0);
}

console.log('\n— A read-only channel is read-only for members, not for staff —');
{
  const ro = everyChannel.find(({ ch }) => ch.readOnly && ch.name === 'announcements');
  const ow = resolve(ro.cat, ro.ch);
  const everyoneOw = ow.find((o) => o.id === EVERYONE);
  ok('members cannot post in #announcements',
    everyoneOw.deny.includes(FLAGS.SendMessages), String(everyoneOw.deny));
  for (const key of STAFF_KEYS) {
    const mine = ow.find((o) => o.id === roleIds[key]);
    ok(`${key} can post in #announcements`, !!mine?.allow?.includes(FLAGS.SendMessages));
  }
}

console.log('\n— No overwrite ever both allows and denies the same thing —');
{
  const conflicts = [];
  for (const { cat, ch } of everyChannel) {
    for (const o of resolve(cat, ch)) {
      const both = o.allow.filter((f) => o.deny.includes(f));
      if (both.length) conflicts.push(`#${ch.name}/${o.id}`);
    }
  }
  ok('allow and deny never collide', conflicts.length === 0, conflicts.join(', '));
}

console.log('\n— The bot is invited with what it uses, and no more —');
{
  ok('Administrator is not in the set', !BOT_PERMISSIONS.includes('Administrator'));
  for (const name of DANGEROUS_FOR_BOT) {
    ok(`the bot never asks for ${name}`, !BOT_PERMISSIONS.includes(name));
  }
  ok('every requested permission is a real flag',
    BOT_PERMISSIONS.every((n) => typeof FLAGS[n] === 'bigint'),
    BOT_PERMISSIONS.filter((n) => typeof FLAGS[n] !== 'bigint').join(', '));

  /* Each of these is used somewhere the bot would otherwise fail silently at
     runtime, which is the worst way to fail. */
  for (const need of ['ManageRoles', 'ManageChannels', 'ManageMessages',
    'MentionEveryone', 'CreateInstantInvite', 'ManageGuild']) {
    ok(`…and it does ask for ${need}`, BOT_PERMISSIONS.includes(need));
  }
  const bits = botPermissionBits();
  ok('the invite carries a real bitfield', bits > 0n && !(bits & FLAGS.Administrator), `${bits}`);
  ok('the invite link asks for bot + commands only',
    /scope=bot%20applications\.commands/.test(botInviteUrl('x')));
}

console.log('\n— Staff hold only what their job needs —');
{
  const byKey = Object.fromEntries(ROLES.map((r) => [r.key, r]));
  // Escalation: ManageRoles lets a holder grant any role below their own.
  // Exactly one staff tier should have it, and it is the one that is already
  // near-owner by design.
  const withRoles = ROLES.filter((r) => (r.perms || []).includes('ManageRoles')).map((r) => r.key);
  ok('only Admin can manage roles', JSON.stringify(withRoles) === JSON.stringify(['admin']),
    withRoles.join(', '));
  const withGuild = ROLES.filter((r) => (r.perms || []).includes('ManageGuild')).map((r) => r.key);
  ok('only Admin can manage the server', JSON.stringify(withGuild) === JSON.stringify(['admin']),
    withGuild.join(', '));
  ok('only Admin can ban', ROLES.filter((r) => (r.perms || []).includes('BanMembers'))
    .every((r) => r.key === 'admin'));
  ok('Support cannot kick, ban or time out',
    !['KickMembers', 'BanMembers', 'ModerateMembers'].some((p) => byKey.support.perms.includes(p)),
    byKey.support.perms.join(', '));
  ok('Moderator cannot ban', !byKey.moderator.perms.includes('BanMembers'));
  ok('Moderator cannot read the audit log', !byKey.moderator.perms.includes('ViewAuditLog'));

  // A cosmetic role that quietly carries a permission is the classic way an
  // escalation hides: everyone gets Bronze, Bronze grants ManageMessages.
  const cosmetic = [...ROLES.filter((r) => !STAFF_KEYS.includes(r.key)),
    ...GAME_ROLES, ...NOTIFY_ROLES, ...LEVEL_ROLES];
  const armed = cosmetic.filter((r) => (r.perms || []).length).map((r) => r.name || r.label);
  ok('no customer, loyalty, game, notify or level role grants anything',
    armed.length === 0, armed.join(', '));
}

console.log('\n— The flag table matches the one discord.js ships, when it is installed —');
{
  let P = null;
  try { ({ PermissionFlagsBits: P } = await import('discord.js')); } catch { /* not installed here */ }
  if (!P) {
    console.log('  ⏭  discord.js not installed — skipping the cross-check');
  } else {
    const wrong = Object.entries(FLAGS).filter(([n, v]) => P[n] !== v).map(([n]) => n);
    ok('every copied bit equals discord.js', wrong.length === 0, wrong.join(', '));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
