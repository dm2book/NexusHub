/**
 * The draw, and the bonus entries somebody paid for.
 *
 * A giveaway kept its entrants in a `Set` of user ids and drew from that. One
 * ticket each, by construction — which is fine until the shop starts selling
 * "+1 bonus entry in this week's giveaway" for eight coins, which it does. The
 * extra entry was not representable at all: not by the bot, and not by a staff
 * member trying to honour it by hand. The coins bought nothing.
 *
 * The pool is what the draw reaches into now. Two things about it are easy to
 * get wrong and both cost somebody a prize:
 *
 *   · a second ticket must not win the same person a second prize, so the draw
 *     removes every ticket belonging to a winner, not just the one drawn;
 *   · the entry count printed at the end must be the size of the POOL. Printing
 *     the number of people while drawing from a weighted pool misreports
 *     everybody's odds.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bot = readFileSync(join(ROOT, 'src/bot.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

/* The draw, reproduced exactly as bot.js builds and consumes the pool. Kept in
   step by the source assertions at the bottom — bot.js cannot be imported
   without a Discord client. */
function buildPool(ids, boosts = {}) {
  const pool = [];
  for (const uid of ids) {
    pool.push(uid);
    for (let n = 0; n < (boosts[uid] || 0); n++) pool.push(uid);
  }
  return pool;
}
function draw(pool, winnersCount, rand = Math.random) {
  const picks = [];
  const remaining = [...pool];
  while (picks.length < winnersCount && remaining.length) {
    const taken = remaining.splice(Math.floor(rand() * remaining.length), 1)[0];
    picks.push(taken);
    for (let k = remaining.length - 1; k >= 0; k--) if (remaining[k] === taken) remaining.splice(k, 1);
  }
  return picks;
}

console.log('\n— One ticket each, plus what you paid for —');
{
  ok('no boosts is one ticket per person',
    buildPool(['a', 'b', 'c']).length === 3);
  ok('a boost is one extra ticket',
    buildPool(['a', 'b'], { a: 1 }).length === 3);
  ok('…and it belongs to the buyer',
    buildPool(['a', 'b'], { a: 1 }).filter((x) => x === 'a').length === 2);
  ok('two boosts are two extra tickets',
    buildPool(['a'], { a: 2 }).length === 3);
  ok('a boost for somebody who did not enter adds nothing',
    buildPool(['a'], { z: 5 }).length === 1);
}

console.log('\n— A second ticket does not win a second prize —');
{
  /* The bug this guards: splice removes ONE ticket. A member holding two who is
     drawn first would still be in the pool for the second prize, and could win
     the same giveaway twice while other entrants are still in it. */
  const pool = buildPool(['a', 'b'], { a: 3 });
  for (let seed = 0; seed < 50; seed++) {
    const picks = draw(pool, 2, () => (seed % 7) / 7);
    if (new Set(picks).size !== picks.length) {
      ok('nobody wins twice', false, JSON.stringify(picks));
      break;
    }
    if (seed === 49) ok('nobody wins twice', true);
  }
  ok('…and the other entrant can still win',
    new Set(Array.from({ length: 200 }, () => draw(pool, 2)[1])).has('b'));
  ok('asking for more winners than there are people stops at the people',
    draw(buildPool(['a'], { a: 4 }), 3).length === 1);
}

console.log('\n— Boosted odds are actually better —');
{
  /* Four tickets against one: the boosted entrant should win far more often.
     Asserted as a wide band rather than a number, because it is a random draw
     and a tight assertion would be flaky rather than correct. */
  const pool = buildPool(['boosted', 'plain'], { boosted: 3 });
  let boostedWins = 0;
  for (let n = 0; n < 4000; n++) if (draw(pool, 1)[0] === 'boosted') boostedWins += 1;
  const rate = boostedWins / 4000;
  ok('the boosted entrant wins about four times in five', rate > 0.70 && rate < 0.90,
    `${(rate * 100).toFixed(1)}%`);
}

console.log('\n— The bot builds and draws the same way —');
{
  ok('the pool is built from entries plus boosts',
    /for \(let n = 0; n < \(boosts\[uid\] \|\| 0\); n\+\+\) pool\.push\(uid\)/.test(bot));
  ok('every ticket of a winner is removed, not just the drawn one',
    /if \(remaining\[k\] === taken\) remaining\.splice\(k, 1\)/.test(bot));
  ok('boosts are claimed against the giveaway id, so a retry is safe',
    /claimBoosts\(ids, id\)/.test(bot));
  ok('…and the request is signed with that id bound in',
    /boosts:\$\{giveawayId\}/.test(bot));
  /* A draw that cannot reach the store still has to happen. */
  ok('an unreachable store draws unweighted rather than not at all',
    /drawing unweighted/.test(bot));
  ok('the announced tally is the pool, not the number of people',
    /\$\{pool\.length\} entries from/.test(bot));
  ok('…and it says where the bonus entries came from',
    /bonus \$\{boosted === 1 \? 'entry' : 'entries'\} from the Forge Shop/.test(bot));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} giveaway-pool: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
