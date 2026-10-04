/**
 * The giveaway draw: one equal chance per entrant, nothing else.
 *
 * The draw used to add tickets for Forge-Shop "boosts" bought with coins
 * earned by spending — a paid advantage in a game of chance. That is gone, and
 * these tests make sure it stays gone, along with the rules the published
 * terms promise:
 *
 *   · nobody wins twice in one draw;
 *   · a reroll never picks someone who already won that giveaway;
 *   · each entrant's odds are equal;
 *   · the logged fingerprint depends on who entered, not on entry order;
 *   · entry needs a Discord account at least seven days old.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { drawWinners, entrantsFingerprint } from '../src/giveaway.js';
import { accountOldEnough, MIN_ACCOUNT_AGE_MS } from '../src/limits.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bot = readFileSync(join(ROOT, 'src/bot.js'), 'utf8');
const config = readFileSync(join(ROOT, 'src/config.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('\n— One entry, one chance —');
{
  ok('a duplicate entrant id counts once', drawWinners(['a', 'a', 'a'], 3).length === 1);
  for (let n = 0; n < 200; n++) {
    const picks = drawWinners(['a', 'b', 'c', 'd'], 3);
    if (new Set(picks).size !== picks.length) { ok('nobody wins twice', false, JSON.stringify(picks)); break; }
    if (n === 199) ok('nobody wins twice', true);
  }
  ok('asking for more winners than people stops at the people', drawWinners(['a', 'b'], 5).length === 2);
  ok('no entrants, no winners', drawWinners([], 1).length === 0);

  /* Equal odds: over many draws each of four entrants wins about a quarter. */
  const wins = { a: 0, b: 0, c: 0, d: 0 };
  for (let n = 0; n < 8000; n++) wins[drawWinners(['a', 'b', 'c', 'd'], 1)[0]] += 1;
  const rates = Object.values(wins).map((w) => w / 8000);
  ok('every entrant has about the same chance', rates.every((r) => r > 0.21 && r < 0.29),
    rates.map((r) => (r * 100).toFixed(1)).join('/'));
}

console.log('\n— Rerolls skip previous winners —');
{
  for (let n = 0; n < 100; n++) {
    const [w] = drawWinners(['a', 'b', 'c'], 1, { exclude: ['a', 'b'] });
    if (w !== 'c') { ok('the only remaining entrant is drawn', false, w); break; }
    if (n === 99) ok('the only remaining entrant is drawn', true);
  }
  ok('when everyone has won, nobody is drawn', drawWinners(['a'], 1, { exclude: ['a'] }).length === 0);
}

console.log('\n— The fingerprint —');
{
  const ids = ['300', '100', '200'];
  const expected = createHash('sha256').update(['100', '200', '300'].join('\n')).digest('hex');
  ok('it is SHA-256 over the sorted ids', entrantsFingerprint(ids) === expected);
  ok('entry order does not change it', entrantsFingerprint(['200', '300', '100']) === expected);
  ok('a different entrant list does', entrantsFingerprint(['100', '200']) !== expected);
}

console.log('\n— Account age —');
{
  const now = Date.now();
  ok('seven days is the bar', MIN_ACCOUNT_AGE_MS === 7 * 24 * 60 * 60_000);
  ok('an account from yesterday is too young', !accountOldEnough(now - 86_400_000, now));
  ok('an account from last month is fine', accountOldEnough(now - 30 * 86_400_000, now));
  ok('an unknown creation time is not waved through', !accountOldEnough(undefined, now));
}

console.log('\n— The bot draws this way, and only this way —');
{
  ok('no boosts are claimed any more', !/claimBoosts|boosts\/claim/.test(bot));
  ok('no bonus entries are announced', !/bonus (entry|entries)/i.test(bot));
  ok('the draw uses the shared function', /drawWinners\(ids, gw\.winnersCount/.test(bot));
  ok('a reroll excludes earlier winners', /drawWinners\(g\.entries, 1, \{ exclude: g\.winners/.test(bot));
  ok('ended giveaways are kept durably, not for an hour', !/setTimeout\(\(\) => ENDED\.delete/.test(bot)
    && /endedStore\(\)\[id\] = \{/.test(bot));
  ok('entrant count and fingerprint are logged', /entrantsFingerprint\(entrants\)/.test(bot)
    && /name: 'Entrants'/.test(bot));
  ok('entry checks account age', /async function enterGiveaway[\s\S]{0,900}accountOldEnough/.test(bot));
  ok('every giveaway links the terms', /async function startGiveaway[\s\S]{0,1500}giveaway-terms/.test(bot));
  ok('the terms exist and say what the bot enforces',
    /GIVEAWAY_TERMS/.test(config) && /7 dagen/.test(config) && /16/.test(config) && /SHA-256/.test(config));
  ok('nothing promises a weekly giveaway', !/every week/i.test(config));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} giveaway-pool: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
