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

console.log('\n— Free-currency bait and platform phishing —');
{
  /* The bait that actually targets this audience. Each one must be removed,
     whatever kind the guard files it under. */
  const bait = [
    'FREE ROBUX!!! https://robux-rewards.gift/claim',
    'free robux generator: rbx-free.com',
    'free vbucks https://fortnite-gift.net',
    'https://roblox.com.free-gift.ru',
    'https://steamcommnunity.com/gift/123',
    'https://dlscord.gift/nitro',
    'gratis robux hier',
    'vbucks generator works 100%',
  ];
  for (const t of bait) ok(`caught: "${t}"`, !!check(t), JSON.stringify(check(t)));
  ok('a fake platform host is named as phishing',
    check('https://steamcommnunity.com/gift/123')?.kind === 'phishing');
  ok('…including one that starts with the real domain',
    check('https://roblox.com.free-gift.ru')?.detail === 'roblox.com.free-gift.ru');

  const normal = [
    'how do I buy robux?',
    'https://www.roblox.com/home',
    'forgemarket.nl/track',
    'https://discord.com/channels/1/2',
    'https://store.steampowered.com/app/730',
    'https://www.epicgames.com/fortnite/en-US/home',
    'is shipping free? I want robux',
  ];
  for (const t of normal) ok(`allowed: "${t}"`, check(t) === null, JSON.stringify(check(t)));
}

console.log('\n— AutoMod patterns are valid and bounded —');
{
  const { AUTOMOD_REGEX, AUTOMOD_KEYWORDS } = await import('../src/scamGuard.js');
  ok('at most 10 regex patterns (Discord limit)', AUTOMOD_REGEX.length <= 10);
  ok('every pattern fits 260 chars', AUTOMOD_REGEX.every((r) => r.length <= 260));
  ok('every pattern compiles', AUTOMOD_REGEX.every((r) => { try { new RegExp(r.replace('(?i)', ''), 'i'); return true; } catch { return false; } }));
  ok('keywords fit Discord limits', AUTOMOD_KEYWORDS.length <= 1000 && AUTOMOD_KEYWORDS.every((k) => k.length <= 60));
}

console.log('\n— Edited messages are checked again —');
{
  const { readFileSync } = await import('node:fs');
  const bot = readFileSync(new URL('../src/bot.js', import.meta.url), 'utf8');
  ok('the bot listens for edits', /Events\.MessageUpdate/.test(bot));
  ok('…and runs the same guard on them', /MessageUpdate[\s\S]{0,600}moderateMessage\(/.test(bot));
  const setup = readFileSync(new URL('../src/setup.js', import.meta.url), 'utf8');
  ok('setup creates AutoMod rules', /autoModerationRules/.test(setup));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
