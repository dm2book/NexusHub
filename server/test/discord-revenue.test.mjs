/**
 * What Discord is worth to the shop, pinned.
 *
 * The audit that produced this found the same shape three times: a revenue
 * feature built, working, and invisible from the place the customers actually
 * are. The affiliate programme had issued a code per account and paid a
 * commission on every referred order since it was written, and Discord had no
 * command for it and never announced a payout. The review request had run on
 * the maintenance sweep for as long, and only ever sent an email — on a shop
 * whose entire social-proof position is getting the first review.
 *
 * These are source-level checks. What they protect was verified by loading
 * every touched module and by reading the endpoints against the HMAC scheme the
 * other bot endpoints use.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const strip = (src) => src
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

const bot = read('discord', 'src', 'bot.js');
const cmds = read('discord', 'src', 'register-commands.js');
const dcfg = read('discord', 'src', 'config.js');
const routes = read('server', 'src', 'routes', 'discord.js');
const dsvc = read('server', 'src', 'services', 'discordService.js');
const aff = read('server', 'src', 'services', 'affiliateService.js');
const orders = read('server', 'src', 'services', 'orderService.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('— The referral programme is reachable from Discord —');
{
  ok('there is a /ref command', /setName\('ref'\)/.test(cmds));
  ok('the bot handles it', /commandName === 'ref'/.test(bot) && /async function refCmd/.test(bot));
  ok('and it is answered privately', /refCmd\(i\)[\s\S]{0,600}?ephemeral: true/.test(bot),
    'a referral link in a public channel is one somebody else can take');
  ok('the server exposes it', /router\.post\('\/referral'/.test(routes));
  /* Same HMAC scheme as every other bot endpoint: the uid is bound into the
     signature, so a member cannot ask for someone else's earnings. */
  ok('the uid is bound into the signature', /canonicalReferral = \(b = \{\}\) => `referral:\$\{b\.uid/.test(routes));
  ok('and an unlinked member is told how to link', /linked: false/.test(routes) && /Link your Discord first/.test(bot));
  /* A row of zeros is the shop telling a member their link does not work. */
  ok('an unused link shows no empty earnings table', /Nothing yet — nobody has ordered through it/.test(bot));
}

console.log('\n— And it is findable without knowing it exists —');
{
  const panel = (dcfg.match(/partnersIntro: \{[\s\S]*?\n  \},/) || [''])[0];
  ok('the earning panel names the open programme', /\/ref/.test(panel));
  ok('and says what it pays', /5%/.test(panel));
  /* It said "revenue share" about an application-only scheme and nothing about
     the one every reader already has. */
  ok('the open programme comes before the gated one',
    panel.indexOf('/ref') < panel.indexOf('How to apply'));
}

console.log('\n— Earning something is announced where it was earned —');
{
  ok('there is a referral payout DM', /export async function postReferralEarned/.test(dsvc));
  ok('the commission sends it', /postReferralEarned\(uid/.test(aff));
  /* The buyer did not agree to have their purchase announced to whoever shared
     a link. The DM says what was earned and nothing about who bought. */
  const fn = (dsvc.match(/export async function postReferralEarned[\s\S]*?\n\}/) || [''])[0];
  /* The signature is the guarantee: the only thing it can be told is the amount,
     so there is nothing about the buyer for it to leak — not a name, not what
     they bought, not the order number. */
  ok('it can only be told the amount',
    /postReferralEarned\(discordUserId, \{ commissionCents \} = \{\}\)/.test(dsvc));
  ok('and its body names no buyer', !/\border\b|buyer|customer|referred/i.test(strip(fn)));
  // "earned you 1.95 in store credit" read as a coin count next to a euro wallet.
  ok('the in-app notification carries a currency', /€\$\{\(commission \/ 100\)/.test(aff));
}

console.log('\n— The review ask reaches a linked buyer —');
{
  ok('there is a review-request DM', /export async function postReviewRequest/.test(dsvc));
  ok('the sweep sends it alongside the email',
    /postReviewRequest\(uid/.test(orders) && /sendEmailAsync\('review_request'/.test(orders));
  /* The claim it makes is the shop's real one, and the only one it has: a
     review here only counts from a delivered order. */
  ok('and it makes the claim the shop can back',
    /only counts if it came from a delivered order/.test(dsvc));
  ok('one ask per order, not a nag',
    /review_request_sent_at IS NULL/.test(orders));
}

console.log('\n— No revenue surface promises what the shop cannot do —');
{
  /* honest-copy.test.mjs reads src/pages, src/components and index.html. It has
     never read server/src/services, server/src/db or discord/src — and that is
     exactly where "instant delivery" survived after being removed from every
     surface a person could see on the site: in the Discord drop announcement,
     in the abandoned-cart email, and in four product descriptions. */
  const SURFACES = [
    ['server/src/services/discordService.js', dsvc],
    ['server/src/services/defaultTemplates.js', read('server', 'src', 'services', 'defaultTemplates.js')],
    ['server/src/db/demoSeed.js', read('server', 'src', 'db', 'demoSeed.js')],
    ['discord/src/config.js', dcfg],
  ];
  const BANNED = [
    [/instant(ly)?\s+(automated\s+)?deliver/i, 'instant delivery'],
    [/delivered\s+instantly/i, 'delivered instantly'],
    [/delivered\s+in\s+seconds/i, 'delivered in seconds'],
    [/\b24\s*\/\s*7\b/, '24/7'],
  ];
  for (const [name, src] of SURFACES) {
    const code = strip(src);
    const hits = BANNED.filter(([re]) => re.test(code)).map(([, l]) => l);
    ok(`${name} keeps only promises the shop can keep`, hits.length === 0, hits.join(', '));
  }
}

console.log('\n— Every click out of Discord is measurable —');
{
  /* The site has read utm_* off the landing URL since it was built, follows the
     visit to an order, and the admin has a view of which creative produced
     purchases. Every link this bot handed out went in BARE — so the largest
     owned traffic source was the one source that could never be measured, and
     "does Discord bring paying customers" had no answer in the data. */
  ok('the bot tags the links it hands out', /function tagged\(url, surface\)/.test(bot));
  ok('as discord/community', /utm_source', 'discord'/.test(bot) && /utm_medium', 'community'/.test(bot));
  /* The surface, not the campaign. Knowing Discord converts is worth something;
     knowing the join DM converts and the drop posts do not is worth acting on. */
  for (const surface of ['join-dm', 'verify', 'price', 'ask']) {
    ok(`${surface} is tagged as its own surface`, new RegExp(`'${surface}'`).test(bot), surface);
  }
  /* A referral link a member shared is theirs. Overwriting its attribution
     would take the credit for their sale. */
  ok('a link that already carries a ref or utm is left alone',
    /\^\(utm_\|ref\$\|source\$\|src\$\)/.test(bot));
}

console.log('\n— The member whose DMs are closed is not lost —');
{
  /* Most Discord accounts have DMs from server members off, and the welcome DM
     was `.catch(() => {})`. The only thing left was a public greeting that
     deletes itself after ten minutes — for the highest-intent visitor the
     server will ever get. */
  ok('the join DM reports whether it landed', /const dmDelivered = await member\.send/.test(bot));
  ok('and a bounced DM gets the shop in public instead',
    /if \(dmDelivered\)/.test(bot) && /welcome-public/.test(bot));
  ok('that message does not delete itself', /Your DMs are closed/.test(bot)
    && !/Your DMs are closed[\s\S]{0,400}setTimeout\(\(\) => m\.delete/.test(bot));
}

console.log('\n— A vouch says what actually happened —');
{
  /* addReview inserts `pending`: it is NOT on the site until a person publishes
     it. The reply said "posted in #vouchers AND on the website", so somebody who
     wrote something nice and went to look for it found nothing. */
  ok('the reply no longer claims it is already live',
    !/Posted in #vouchers \*\*and\*\* on the website/.test(bot));
  ok('and says it is read first', /once a person has read it/.test(bot));
  /* Nothing told anyone a vouch was waiting, so they accumulated in an admin
     list nobody opens while the storefront kept saying "no reviews yet". */
  ok('staff are told one is waiting', /waiting to be published/.test(bot));
}

console.log('\n— The referral command is findable —');
{
  // It was mentioned once, in one panel, in one channel.
  ok('/ref is in the help list', /`\/ref` — your referral link/.test(bot));
  ok('and says what it pays', /5% of every order it brings/.test(bot));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
