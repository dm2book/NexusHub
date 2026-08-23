/**
 * The support ticket system, checked where it can be checked without a guild.
 *
 * Four things this found:
 *
 *   "My order never arrived" and "the code does not work" were both a single
 *   "Order issue" button, so the ticket where money is missing arrived looking
 *   exactly like the one where it is not — and the Support role was pinged for
 *   every ticket either way, which makes the ping mean nothing.
 *
 *   Ownership was matched with `topic.includes('ticket-owner:<id> ')`. It needs
 *   that trailing space to stop `…owner:123` matching `…owner:1234`, and the
 *   topic is appended to twice more during a ticket's life (claimed, idlewarned).
 *
 *   Close was one red button next to Claim that deleted the channel five
 *   seconds later, with no confirmation.
 *
 *   The rating buttons live in a DM that stays in the member's history forever
 *   and carried no ticket reference, so an old transcript could be rated again
 *   months later and land in the log as if it were about whatever had just
 *   closed.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TICKET_TYPES, PRIORITY, ticketType, ticketLabel, priorityOf,
  ticketChannelName, buildTopic, parseTopic, isOwnedBy,
} from '../src/tickets.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const HERE = dirname(fileURLToPath(import.meta.url));
const bot = readFileSync(join(HERE, '..', 'src', 'bot.js'), 'utf8');
const setup = readFileSync(join(HERE, '..', 'src', 'setup.js'), 'utf8');

console.log('— Every kind of problem has a lane —');
{
  // The seven a shop like this actually gets, plus partnerships.
  for (const [key, what] of [
    ['purchase', 'purchase support'],
    ['delivery', 'missing delivery'],
    ['payment', 'payment problem'],
    ['refund', 'refund'],
    ['chargeback', 'chargeback'],
    ['product', 'product problem'],
    ['general', 'general support'],
  ]) {
    ok(`${what} → ${key}`, !!ticketType(key), 'missing');
  }
  ok('every type has a label, a blurb and a priority',
    TICKET_TYPES.every((t) => t.label && t.blurb && PRIORITY[t.priority]),
    TICKET_TYPES.filter((t) => !t.label || !t.blurb || !PRIORITY[t.priority]).map((t) => t.key).join(', '));
  ok('no two types share a key', new Set(TICKET_TYPES.map((t) => t.key)).size === TICKET_TYPES.length);
  ok('a select menu holds them all', TICKET_TYPES.length <= 25, `${TICKET_TYPES.length}`);

  /* A server that has not re-run setup still has the old four buttons pinned in
     #open-a-ticket, and #report-a-scam links ticket:other directly. */
  ok('the old "order" button still opens something', ticketType('order')?.key === 'delivery');
  ok('the old "other" button still opens something', ticketType('other')?.key === 'general');
  ok('an unknown id does not crash the label', ticketLabel('nonsense') === '🎫 Support');
}

console.log('\n— Priority sorts the queue without promising a time —');
{
  ok('money in flight is high', ['delivery', 'payment', 'chargeback']
    .every((k) => priorityOf(k).key === 'high'));
  ok('a question is not', ['purchase', 'general', 'partner']
    .every((k) => priorityOf(k).key !== 'high'));
  ok('a refund is not urgent but is not nothing', priorityOf('refund').key === 'normal');

  /* This shop makes no response-time claims anywhere — server-blueprint.test.mjs
     enforces that on the copy. A priority label that reads as "within the hour"
     is the same promise wearing a different hat. */
  const words = Object.values(PRIORITY).map((p) => p.label).join(' ');
  ok('no priority label promises a time',
    !/hour|minute|day|24|asap|immediately|fast/i.test(words), words);

  ok('the channel name leads with the priority so the list sorts itself',
    ticketChannelName('delivery', 'Someone').startsWith(PRIORITY.high.dot),
    ticketChannelName('delivery', 'Someone'));
  ok('…and says what it is about',
    ticketChannelName('refund', 'Someone').includes('refund'));
  ok('a hostile username cannot escape the channel name',
    /^[^a-z0-9-]*[a-z0-9-]+$/.test(ticketChannelName('refund', '../../@everyone ping!!')),
    ticketChannelName('refund', '../../@everyone ping!!'));
  ok('the name fits Discord\u2019s limit',
    ticketChannelName('chargeback', 'x'.repeat(200)).length <= 95);
}

console.log('\n— Only the ping that matters —');
{
  const pinged = TICKET_TYPES.filter((t) => t.ping).map((t) => t.key);
  ok('Support is pinged only where waiting costs the buyer money',
    JSON.stringify(pinged.sort()) === JSON.stringify(['chargeback', 'delivery', 'payment']),
    pinged.join(', '));
  ok('the bot only pings for those', /ticketType\(type\)\?\.ping \? findRole/.test(bot));
}

console.log('\n— A ticket belongs to exactly one member —');
{
  const topic = buildTopic({ ownerId: '123', type: 'refund', openedAt: 1700000000000 });
  ok('the topic round-trips', parseTopic(topic)?.ownerId === '123'
    && parseTopic(topic)?.type === 'refund');
  ok('owned by its owner', isOwnedBy(topic, '123'));

  /* The substring form matched a prefix unless a trailing space saved it — and
     the topic gets appended to twice more while the ticket is open. */
  ok('not owned by an id that merely starts the same', !isOwnedBy(topic, '1234'));
  ok('not owned by an id that merely ends the same', !isOwnedBy(topic, '23'));
  const later = `${topic} · claimed:999 · idlewarned`;
  ok('still owned after it is claimed and warned', isOwnedBy(later, '123'));
  ok('the claimer is not the owner', !isOwnedBy(later, '999'));
  ok('a claimed ticket reports its claimer', parseTopic(later)?.claimedBy === '999');
  ok('an idle-warned ticket says so', parseTopic(later)?.idleWarned === true);
  ok('a fresh ticket does not', parseTopic(topic)?.idleWarned === false);
  ok('a non-ticket channel parses to nothing', parseTopic('just a normal topic') === null);
  ok('an empty topic parses to nothing', parseTopic('') === null && parseTopic(undefined) === null);

  ok('the bot matches ownership through the parser, not a substring',
    /isOwnedBy\(c\.topic, i\.user\.id\)/.test(bot) && !/topic\?\.includes\(`ticket-owner:/.test(bot));
  ok('duplicate prevention runs before the form is shown',
    bot.indexOf('isOwnedBy(c.topic, i.user.id)') < bot.indexOf('new ModalBuilder()'));
}

console.log('\n— Closing asks first —');
{
  ok('the close button opens a confirmation', /async function closeTicket[\s\S]{0,900}ticket:close:yes/.test(bot));
  ok('only the confirmation archives', /async function confirmClose[\s\S]{0,900}archiveTicket\(ch/.test(bot));
  ok('there is a way to back out', /ticket:close:no/.test(bot));
  ok('the confirmation is private to the person clicking',
    /async function closeTicket[\s\S]{0,700}ephemeral: true/.test(bot));
  ok('it says the channel goes away', /cannot be reopened here/.test(bot));
}

console.log('\n— Nothing from one ticket reaches another —');
{
  ok('the rating carries the ticket it is about', /rate:\$\{n\}:\$\{ch\.name\}/.test(bot));
  ok('…and the handler reads it', /const \[, n, ticket\] = i\.customId\.split/.test(bot));
  ok('…and the log names it', /ticket \\`\$\{ticket\}\\`/.test(bot) || /ticket \\`/.test(bot));

  /* Each ticket channel denies @everyone and every member tier by name, then
     allows the owner, the three staff roles and the bot. That is what stops one
     customer reading another's order number, address or codes. */
  ok('a new ticket denies everyone first', /id: i\.guild\.roles\.everyone\.id, deny: \[P\.ViewChannel\]/.test(bot));
  ok('…and each member tier by name',
    /memberRoles\.map\(\(r\) => \(\{ id: r\.id, deny: \[P\.ViewChannel\] \}\)\)/.test(bot));
  ok('…and allows only the owner and staff',
    /id: i\.user\.id, allow/.test(bot) && /staffRoles\.map/.test(bot));
  ok('the transcript goes to the owner and the staff log, nowhere else',
    /members\.fetch\(ownerId\)/.test(bot) && /findChannel\(ch\.guild, 'ticket-logs'\)/.test(bot));
}

console.log('\n— The log covers the whole life of a ticket —');
{
  ok('opening is logged', /Ticket opened/.test(bot));
  ok('…with its priority', /name: 'Priority'/.test(bot));
  ok('closing is logged with a transcript', /Ticket closed/.test(bot) && /files: \[file\]/.test(bot));
  ok('…and says what it was about', /name: 'About', value: ticketLabel/.test(bot));
  ok('…and who claimed it', /name: 'Claimed by'/.test(bot));
}

console.log('\n— A restart does not forget a ticket —');
{
  /* Every piece of ticket state lives in the channel topic, which Discord keeps.
     Nothing here is held in memory, so the sweep picks up exactly where it left
     off after a deploy. */
  ok('the sweep reads its state from the topic', /const meta = parseTopic\(ch\.topic\)/.test(bot));
  ok('the idle warning is recorded on the channel', /idlewarned/.test(bot));
  ok('the sweep is scheduled, not one-shot', /setInterval\(sweep/.test(bot));
  ok('…and runs after the caches warm up', /setTimeout\(sweep/.test(bot));
  ok('no ticket state is kept in a Map', !/TICKETS\s*=\s*new Map/.test(bot));
}

console.log('\n— The panel offers all of them —');
{
  ok('the picker is a select menu', /StringSelectMenuBuilder/.test(setup) && /ticket:pick/.test(setup));
  ok('…built from the shared table', /TICKET_TYPES\.map/.test(setup));
  ok('the bot handles the picker', /i\.customId === 'ticket:pick'/.test(bot));
  ok('#partners has its own button, not an index into the picker',
    /ticket:partner'\)\s*\n?\s*\.setLabel\('Apply as a partner'/.test(setup));
  ok('the old four-button ids are gone from setup',
    !/setCustomId\('ticket:order'\)/.test(setup));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
