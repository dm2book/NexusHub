/**
 * The Discord → website funnel, at the points where it leaked.
 *
 * Every call to action the bot posted pointed at the shop and said "Buy now" or
 * "Open the shop". Before the launch moment that is a promise the site refuses
 * to keep: the catalogue browses on purpose, but the checkout is closed, so a
 * member who followed the button arrived somewhere that would not sell to them.
 * A dead end at the end of the funnel is worse than no funnel.
 *
 * And two steps existed that nobody needed to take. /price identified exactly
 * which product someone asked about and then offered its four runners-up as
 * plain text — listed, priced, and one search away from a page we had already
 * found. Verification ended with two channel names, handing a member who had
 * just proved they were here to buy something a reading list.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const HERE = dirname(fileURLToPath(import.meta.url));
const bot = readFileSync(join(HERE, '..', 'src', 'bot.js'), 'utf8');
const roles = readFileSync(join(HERE, '..', '..', 'server', 'src', 'services', 'discordRolesService.js'), 'utf8');
const config = readFileSync(join(HERE, '..', 'src', 'config.js'), 'utf8');

console.log('— No call to action promises a checkout that is closed —');
{
  ok('the bot asks the store when it opens', /\/api\/config/.test(bot) && /launchAt/.test(bot));
  ok('…and caches the answer instead of asking per click', /launchCache/.test(bot));
  ok('one helper decides what a shop button says', /async function shopCta\(/.test(bot));
  ok('…and every shop button is built from it', /async function shopButton\(/.test(bot));

  /* The label has to change, not just the copy underneath it: a button that
     says "Buy now" has already made the promise by the time anyone reads the
     small print. */
  ok('before launch the label describes browsing, not buying',
    /open \? \(productUrl \? 'Buy now' : 'Open the shop'\)[\s\S]{0,120}'See it on the site'[\s\S]{0,60}'Browse the catalogue'/.test(bot));
  ok('…and it says when the shop opens', /Opens \$\{when/.test(bot));

  const hardcoded = [...bot.matchAll(/setLabel\('[^']*Open the shop'\)/g)];
  ok('no button still hard-codes "Open the shop"', hardcoded.length === 0,
    hardcoded.map((m) => m[0]).join(', '));
  ok('/price no longer hard-codes "Buy now"', !/\[Buy now\]\(\$\{STORE_URL\}/.test(bot));

  /* Wrong in the safe direction: an unreachable store must show a working shop,
     not hide one — that is the post-launch state and the site's own default. */
  ok('an unreachable store is treated as open',
    /const shopIsOpen = async \(\) => \{[\s\S]{0,160}at === null \|\| Date\.now\(\) >= at/.test(bot));
}

console.log('\n— Steps nobody needed to take —');
{
  ok('/price deep-links the product it found',
    /shopLink\(`\$\{STORE_URL\}\/product\/\$\{best\.id\}`\)/.test(bot));
  ok('…and links the runners-up too, instead of naming them',
    /\[\$\{p\.name\}\]\(\$\{STORE_URL\}\/product\/\$\{p\.id\}\)/.test(bot));

  ok('verifying ends with a way out of Discord, not two channel names',
    /Verified!\*\* Welcome in[\s\S]{0,700}await shopButton\(\)/.test(bot));
  ok('…and points at the roles that drive restock pings',
    /Verified!\*\* Welcome in[\s\S]{0,700}chanRef\(i\.guild, 'roles'\)/.test(bot));
  ok('…while still saying when the shop opens',
    /Verified!\*\* Welcome in[\s\S]{0,400}cta\.note/.test(bot));
}

console.log('\n— The end of the funnel leads back into it —');
{
  ok('the delivery DM offers a way back to the shop', /shopInviteLine\(\)/.test(roles));
  ok('…and that line respects the launch gate',
    /function shopInviteLine[\s\S]{0,400}launchAtIso\(\)/.test(roles));
  ok('…inviting a look rather than a purchase before it opens',
    /the shop opens \$\{when\}/.test(roles));
  ok('…and it still asks for the review first', /Type \*\*\/vouch\*\*/.test(roles));
}

console.log('\n— The invite keeps working —');
{
  /* A default Discord invite dies after seven days, and a dead invite on the
     storefront silently ends the funnel before it starts. */
  ok('the bot keeps a non-expiring invite', /maxAge: 0, maxUses: 0/.test(bot));
  ok('…and pushes it to the site', /api\/discord\/invite/.test(bot));
  ok('…with a fallback if it cannot make one', /FALLBACK_INVITE/.test(bot));
  ok('nothing in this change touches the invite path',
    /async function ensurePermanentInvite/.test(bot));
}

console.log('\n— Discovery reaches the right people —');
{
  // The funnel's first step after verifying: picking games, which is what makes
  // a restock ping land on someone who wants it.
  ok('game roles exist to be picked', /export const GAME_ROLES/.test(config));
  ok('…and a restock knows which one it belongs to', /export const CATEGORY_GAME_ROLE/.test(config));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
