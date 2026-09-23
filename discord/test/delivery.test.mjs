/**
 * "How do I actually get it?"
 *
 * /delivery knew two of the twenty-one things this shop sells. A five-entry
 * keyword map matched robux and v-bucks; everything else fell through as a raw
 * query string into a table that did not have it, and came back with the
 * generic paragraph under the heading "How your order is delivered".
 * `/delivery valorant` and `/delivery nitro` both did that — and the real
 * steps for both were already written, already translated, and reachable only
 * from the delivery email.
 *
 * So the recipes moved to src/lib, the product page and the bot read the same
 * ones, and this checks the bot's generated copy against the shop's.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const { DELIVERY, DELIVERY_CATEGORIES, DELIVERY_FIELD, deliveryFor } =
  await import('../src/generated/delivery.js');
const shop = await import(join(ROOT, 'src/lib/deliveryInfo.js'));

console.log('— The bot answers for every category the shop can answer for —');
{
  ok(`the shop can answer for ${shop.deliveryCategories().length} categories`,
    shop.deliveryCategories().length >= 8, shop.deliveryCategories().join(', '));
  ok('…and the bot carries the same list',
    JSON.stringify(DELIVERY_CATEGORIES) === JSON.stringify(shop.deliveryCategories()),
    DELIVERY_CATEGORIES.join(', '));

  /* The two it used to know, and six it did not. Named individually because
     "the lists match" would still pass if both were two. */
  for (const c of ['robux', 'v-bucks', 'valorant', 'discord-nitro', 'giftcard', 'gamepass', 'spotify', 'minecraft']) {
    ok(`${c} has a specific answer`, DELIVERY_CATEGORIES.includes(c));
  }
}

console.log('\n— In the member\'s own language —');
{
  for (const lang of ['nl', 'en', 'de', 'fr']) {
    const missing = DELIVERY_CATEGORIES.filter((c) => {
      const d = deliveryFor(c, lang);
      return !d || !d.method || !Array.isArray(d.steps) || !d.steps.length;
    });
    ok(`[${lang}] every category has steps`, missing.length === 0, missing.join(', '));
  }

  /* A marker word per language, so "it returned something" is not the test.
     Checked on valorant — one of the six the bot could not answer at all. */
  /* Words that exist in one of these languages only. "Boutique" was the first
     guess and it was wrong, not the copy: Valorant's menu is called the Store
     in French too, so the French recipe says "va dans le Store" — around
     unmistakably French words. Marker words have to come from the sentence,
     not from what the sentence ought to say. */
  const MARK = { nl: /\bZo wissel je\b/i, en: /\bHow to redeem\b/i, de: /\bSo löst du\b/i, fr: /\bComment (utiliser|récupérer)\b/i };
  for (const [lang, re] of Object.entries(MARK)) {
    const d = deliveryFor('valorant', lang);
    ok(`[${lang}] valorant is answered in ${lang}`, re.test(`${d.method} ${d.steps.join(' ')}`),
      `${d.method} — ${d.steps[0]}`.slice(0, 80));
  }

  /* An unknown category must fall back, not crash or return undefined. */
  for (const lang of ['nl', 'en', 'de', 'fr']) {
    const d = deliveryFor('apex', lang);
    ok(`[${lang}] a category with no recipe still answers`, !!d?.method && d.steps.length > 0);
  }
}

console.log('\n— The email\'s HTML does not leak into a Discord embed —');
{
  const html = [];
  for (const lang of Object.keys(DELIVERY)) {
    for (const [cat, d] of Object.entries(DELIVERY[lang])) {
      if (/<[a-z/]/i.test(`${d.method} ${d.steps.join(' ')} ${d.notes.join(' ')}`)) html.push(`${lang}/${cat}`);
    }
  }
  ok('no <strong> survives into the bot copy', html.length === 0, html.slice(0, 4).join(', '));
}

console.log('\n— What we need from you, which the old command never said —');
{
  ok('robux names the one thing it needs', !!DELIVERY_FIELD.robux, JSON.stringify(DELIVERY_FIELD.robux));
  for (const lang of ['nl', 'en', 'de', 'fr']) {
    ok(`[${lang}] …in ${lang}`, !!DELIVERY_FIELD.robux?.[lang], DELIVERY_FIELD.robux?.[lang]);
  }
  /* A code category must NOT claim to need an account detail. */
  ok('a gift card asks for nothing', !DELIVERY_FIELD.giftcard);
}

console.log('\n— The copy is generated, so it cannot drift —');
{
  let stale = false;
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts/gen-discord-delivery.mjs'), '--check'],
      { cwd: ROOT, stdio: 'pipe' });
  } catch { stale = true; }
  ok('the generated file matches the shop', !stale,
    'run: node scripts/gen-discord-delivery.mjs');

  const bot = readFileSync(join(HERE, '..', 'src', 'config.js'), 'utf8');
  ok('…and the bot keeps no second table of its own',
    !/export const DELIVERY_INFO = \{/.test(bot),
    'two tables is how one of them came to have two entries');
}

console.log('\n— /price answers in one language, not one and a half —');
{
  /* Half-translating is worse than not translating: the delivery sentence
     came out in the member's language under English headings, beside an
     English availability line. */
  const bot = readFileSync(join(HERE, '..', 'src', 'bot.js'), 'utf8');
  const LANGS = ['nl', 'en', 'de', 'fr'];

  for (const name of ['AVAILABILITY', 'PRICE_UI', 'DELIVERY_UI']) {
    const block = bot.match(new RegExp(`const ${name} = \\{[\\s\\S]*?\\n\\};`))?.[0] || '';
    ok(`${name} covers every language`,
      LANGS.every((l) => new RegExp(`^  ${l}: \\{`, 'm').test(block)), `missing from ${name}`);
  }

  ok('the availability line takes a language', /function availabilityLine\(p, lang/.test(bot));
  ok('…and /price passes the member\'s', /availabilityLine\(best, lang\)/.test(bot));
  ok('…and its field names come from the table, not a literal',
    /name: P\.when/.test(bot) && /name: P\.how/.test(bot),
    'an English heading over a translated sentence is the defect this replaced');
  /* This read `botLang(i.locale)` — the locale the member's Discord client
     happens to be set to, which is a good guess and only a guess. Members can
     now pick a language in #roles, and a guess must lose to an answer. */
  ok('/delivery answers in the language the member picked',
    /const lang = memberLang\(i\.member, i\.locale\);/.test(bot));
  ok('…and no reply anywhere still goes by the client locale alone',
    !/\bbotLang\(/.test(bot),
    'a call site reads the locale directly, so a picked language would not reach it');
  ok('…and no longer guesses with a five-entry keyword map',
    !/const map = \{ robux: 'robux', roblox: 'robux'/.test(bot));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
