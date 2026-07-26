/**
 * The anti-scam guard, tested on the messages that actually get posted.
 *
 * Two directions matter equally: catching the scam, and NOT deleting a normal
 * member's message. An over-eager filter that eats real conversation in a server
 * this small is worse than no filter — people stop talking.
 */
import { scamReason, lookalikeHost } from '../src/scamGuard.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const HOST = 'forgemarket.nl';
const check = (text, opts = {}) => scamReason(text, { storeHost: HOST, ...opts });

console.log('— Lookalike domains (the expensive one) —');
{
  const fakes = [
    'yo cheap robux here https://forgemarket.shop/robux',
    'buy at http://forge-market.nl now',
    'https://forgemarkets.nl/shop best prices',
    'check https://forgemarket.net/deal',
    'FORGEMARKET.STORE has better prices https://FORGEMARKET.STORE/x',
  ];
  for (const f of fakes) ok(`caught: ${f.slice(0, 42)}…`, check(f)?.kind === 'lookalike', JSON.stringify(check(f)));

  const real = [
    'order here https://forgemarket.nl/shop',
    'track it at https://forgemarket.nl/track?number=FM-2026-ABCD',
    'the banner is at https://www.forgemarket.nl/discord/banner-welcome.png',
    'cdn link https://images.forgemarket.nl/x.png',
  ];
  for (const r of real) ok(`allowed: ${r.slice(0, 42)}…`, check(r) === null, JSON.stringify(check(r)));

  // A near-miss spelling is the whole point of a typosquat.
  ok('one-letter typo is caught', lookalikeHost('go to https://forgemarkt.nl/x', HOST) === 'forgemarkt.nl');
  ok('an unrelated domain is not flagged as a lookalike', lookalikeHost('https://roblox.com/redeem', HOST) === null);
  ok('a link to Roblox/Steam is fine', check('redeem at https://roblox.com/redeem') === null);
}

console.log('\n— Selling by DM —');
{
  const solicits = [
    'dm me for cheap robux',
    'DM ME i sell vbucks cheaper than here',
    'hmu for valorant points',
    'selling robux cheap, dm me',
    'add me for gift cards',
    'pm me my prices are better on nitro',
  ];
  for (const t of solicits) ok(`caught: "${t}"`, check(t)?.kind === 'solicit', JSON.stringify(check(t)));

  const innocent = [
    'does anyone know how long robux takes to arrive?',
    'I just bought vbucks and it worked, thanks',
    'can someone dm me the link to the rules?',
    'cheap? this is already the cheapest I found',
    'add me on fortnite: coolgamer123',
    'my robux arrived in 5 minutes',
  ];
  for (const t of innocent) ok(`allowed: "${t}"`, check(t) === null, JSON.stringify(check(t)));
}

console.log('\n— Invites, bait and mass pings —');
{
  ok('discord invite is removed', check('join https://discord.gg/abcd')?.kind === 'phrase');
  ok('free nitro bait is removed', check('FREE NITRO claim your reward now')?.kind === 'phrase');
  ok('telegram funnel is removed', check('message me t.me/scammer')?.kind === 'phrase');
  ok('@everyone by a member is removed', check('hey', { mentionsEveryone: true })?.kind === 'mention');
  ok('five user pings is removed', check('yo', { mentionCount: 5 })?.kind === 'mention');
  ok('a couple of pings is fine', check('hey <@1> <@2> look', { mentionCount: 2 }) === null);
}

console.log('\n— Ordering —');
{
  // A message with both must report the costlier one, because the notice the
  // member sees is different: one names the fake domain.
  const both = check('dm me for cheap robux https://forgemarket.shop');
  ok('a fake domain outranks a DM offer', both?.kind === 'lookalike', JSON.stringify(both));
  ok('empty and junk input never throws',
    check('') === null && check(null) === null && check(undefined) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
