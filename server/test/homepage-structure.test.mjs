/**
 * The homepage, pinned to the structure it was rebuilt to.
 *
 * The old page opened with "Everything You Need, All in One Place" — the biggest
 * text on the site carrying no information about what is sold or why to trust
 * it — and buried a stats grid that read "0 / — / —" on launch day. Sections
 * drift back over time, so the shape and the honesty rules are enforced here
 * rather than remembered.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const home = readFileSync(join(ROOT, 'src', 'pages', 'HomeStore.jsx'), 'utf8');
/* Comments stripped for the copy checks: this file explains WHY the old slogan
   was removed, and that explanation must not trip the rule against it. */
const code = home
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
const nl = readFileSync(join(ROOT, 'src', 'lib', 'i18n.jsx'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

console.log('— The agreed order —');
{
  // Every section must exist, and in this order: a buyer should meet the goods
  // before the argument, and the argument before the questions.
  const marks = [
    ['Hero', 'fm-stage'],
    ['How it works', "home.howTitle"],
    // `pillars.map` also renders the hero chips, so it cannot mark this
    // section. The pack count only exists on a product card.
    ['Popular products', "home.packs"],
    ['Why ForgeMarket', "home.whyTitle"],
    ['Reviews', "home.reviewsTitle"],
    ['FAQ', "home.faqTitle"],
    ['Footer', '<StoreFooter />'],
  ];
  let last = -1, ordered = true;
  for (const [label, token] of marks) {
    const at = code.indexOf(token);
    ok(`${label} is on the page`, at !== -1, token);
    if (at !== -1 && at < last) ordered = false;
    if (at !== -1) last = at;
  }
  ok('the sections appear in the agreed order', ordered);
}

console.log('\n— It says what it sells —');
{
  // The headline must name the goods. A slogan that would fit any shop is the
  // thing this rebuild existed to remove.
  const GENERIC = [/Everything You Need/i, /All in One Place/i, /Your one[- ]stop/i,
                   /The best place to/i, /Level up your game/i];
  const hits = GENERIC.filter((re) => re.test(code));
  ok('no interchangeable slogan in the headline', hits.length === 0, String(hits));
  for (const word of ['Game currency', 'gift cards', 'subscriptions']) {
    ok(`the hero names "${word}"`, home.includes(word));
  }
  // The three pillars have to be real category slugs, not decoration.
  for (const slug of ['robux', 'giftcard', 'discord-nitro']) {
    ok(`the pillars point at the real "${slug}" category`, home.includes(`'${slug}'`));
  }
}

console.log('\n— Nothing is invented —');
{
  // A pillar renders only if the live catalogue has products in it.
  ok('a pillar with no products is dropped', /cats\.length \? \{ \.\.\.pillar, cats, solo \} : null/.test(home));
  /* A pillar that collapses to one category shows that category's PRODUCTS.
     Gift cards was the case: ten of the most recognisable brands in the shop
     rendered as one grey tile reading "Gift cards · 10 packs available",
     because all ten share the giftcard category. */
  ok('a single-category pillar expands into its products',
    /cats\.length === 1 && cats\[0\]\.count >= 4/.test(home) && /pillar\.solo \?/.test(home));
  ok('prices come from the real cheapest product',
    /items\.reduce\(\(a, b\) => \(a\.price <= b\.price \? a : b\)\)/.test(home));
  // Reviews: real ones or an honest empty state — never filler.
  ok('reviews render only when real ones exist', /hasReviews \?/.test(home));
  ok('the empty state says so rather than faking it', /home\.noReviewsT/.test(home));
  ok('the empty state offers somewhere real to check instead',
    /home\.askBuyers/.test(home) && /footer\.trust/.test(home));
  // The stats grid that printed "0 / — / —" on launch day is gone for good.
  ok('no stats grid can render an empty figure', !/const statCards/.test(home));
}

console.log('\n— The page asks for the sale —');
{
  /* The hero had TWO buttons and both went to /shop. A secondary CTA that
     repeats the primary takes clicks off it and gives the visitor nothing they
     did not already have. */
  /* Back up past the opening <Link> tag: the marker sits inside the primary
     button, so its own `to` is behind it. The pillar chips just above use a
     template literal, which the `to="` pattern below deliberately misses. */
  const heroAt = code.indexOf('home.shopNowBig');
  const hero = code.slice(Math.max(0, heroAt - 500), heroAt + 900);
  const dests = [...hero.matchAll(/<Link to="([^"]+)"/g)].map((m) => m[1]);
  ok('the hero has at least two calls to action', dests.length >= 2, dests.join(', '));
  ok('and they do not go to the same place', new Set(dests).size === dests.length, dests.join(', '));

  /* The page used to end on an FAQ and then the footer: the visitor who read
     the whole thing had nowhere to go but back up. */
  const faqAt = code.indexOf('home.faqTitle');
  const footAt = code.indexOf('<StoreFooter />');
  const tail = code.slice(faqAt, footAt);
  ok('something asks for the sale after the FAQ',
    /home\.endCta|home\.endTitle/.test(tail), 'no closing CTA between the FAQ and the footer');

  /* A price to decide against. Read off the catalogue, never typed in. */
  ok('the hero anchors on a real price', /catalogueAnchor/.test(code));
  ok('and the anchor is computed from the live catalogue, not written down',
    /live\.reduce\(\(a, b\) => \(a\.price <= b\.price \? a : b\)\)/.test(code));
  ok('the anchor disappears rather than showing an empty shop',
    /if \(live\.length < 2\) return null/.test(code));

  // "1 packs available" shipped on the two single-product categories.
  ok('a count of one is not pluralised', /home\.packs1/.test(code));
}

console.log('\n— No claim the shop cannot back —');
{
  /* SiteLayout printed "● All systems operational" as static text next to a
     pulsing green dot, checking nothing. It was dead code, but during the
     August outage that footer would have said the shop was fine. The live
     version in StoreFooter asks /api/health and says so when it is not. */
  const layouts = ['src/layouts/StoreLayout.jsx', 'src/components/store/StoreFooter.jsx', 'src/pages/HomeStore.jsx'];
  for (const f of layouts) {
    let src = '';
    try { src = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    const hard = /All systems operational/.test(src) && !/api\/health/.test(src);
    ok(`${f} does not claim a status it never checked`, !hard);
  }
}

console.log('\n— Works on a phone —');
{
  ok('the FAQ opens without JavaScript', /<details/.test(home) && /<summary/.test(home));
  ok('FAQ rows clear the 44px thumb target', /min-h-\[56px\]/.test(home));
  ok('product images defer until needed', /loading="lazy"/.test(home));
  // The header measured wider than 390px and clipped the Sign Up button.
  ok('the wordmark yields on the narrowest screens', /hidden xs:inline/.test(home));
  ok('section headers stack instead of colliding', /flex-col sm:flex-row/.test(home));
}

console.log('\n— Dutch —');
{
  // A missing key silently falls back to English, so a half-Dutch page ships
  // without anything failing. Every key this page introduces must be present.
  const used = [...home.matchAll(/tr\('((?:home|footer|nav|card|product)\.[A-Za-z0-9.]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((k) => !nl.includes(`'${k}'`));
  ok('every key the homepage uses has Dutch', missing.length === 0, missing.join(', '));
  for (const k of ['home.pillar.currency', 'home.pillar.giftcards', 'home.pillar.subscriptions']) {
    ok(`${k} is translated`, nl.includes(`'${k}'`));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
