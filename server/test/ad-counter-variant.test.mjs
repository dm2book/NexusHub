/**
 * The cut written against a competitor's advert has to keep its own promises.
 *
 * scripts/ad/ENEBA-TEARDOWN.md is a list of things that advert does wrong and a
 * claim that this one does the opposite. A claim in a markdown file is worth
 * nothing on its own — these are the four that are checkable, checked.
 *
 * The one that matters most is the last: the cut says every number on screen is
 * real, and the toolkit is what has to enforce that.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { VARIANTS, variantById, tokensFor, fill, blockedReason } =
  await import(join(ROOT, 'scripts/ad/variants.mjs'));

const V = variantById('klik-tot-code');
const real = tokensFor({
  product: { name: '1,000 Robux', price: 999, currency: 'EUR', instant: true },
  order: { number: 'FM-2026-ABCD1234' }, lang: 'nl',
});

console.log('— The counter-cut exists and is Dutch —');
{
  ok('the variant is there', !!V);
  ok('…and declares the placement it is written for', V.lang === 'nl');
  ok('…and every caption is written in it',
    !V.captions.some((c) => /\b(the|your|and|order is|payment)\b/i.test(c.text)),
    V.captions.map((c) => c.text).join(' | '));
  ok('the delivery sentence comes out Dutch too',
    /Verstuurd zodra|met de hand/i.test(real.delivery), real.delivery);
}

console.log('\n— No splash: the first thing on screen is a price —');
{
  /* Their advert opens on a logo. This one has to open on the product page,
     with the price in the hook itself. */
  ok('the first scene is the product, not a brand card', V.scenes[0].label === 'the product');
  ok('the hook is the price', /\{price\}/.test(V.hook), V.hook);
  ok('…and it resolves to a real one', fill(V.hook, real) === '€9.99. Meer wordt het niet.',
    fill(V.hook, real));
}

console.log('\n— The delivery is the climax, not absent —');
{
  const labels = V.scenes.map((s) => s.label);
  ok('the cut runs all the way to the code', labels.includes('the code'), labels.join(' → '));
  ok('…through the email actually arriving', labels.includes('the email'));
  ok('…and the email caption slides in rather than fading',
    V.captions.some((c) => c.at === 'the email' && c.style === 'notify'));
  ok('the last caption is the code landing',
    /code/i.test(V.captions[V.captions.length - 1].text), V.captions[V.captions.length - 1].text);
}

console.log('\n— The address is on screen early, not at 73% —');
{
  const cards = read('scripts/ad/cards.mjs');
  const compose = read('scripts/ad/compose.mjs');
  ok('a corner tag is rendered', /cta-tag\.png/.test(cards));
  ok('…in the shop’s own type, like the other cards',
    /Bricolage Grotesque/.test(cards.slice(cards.indexOf('cta-tag') - 1200, cards.indexOf('cta-tag'))));
  ok('…and compose holds it over the body of the advert',
    /ctatag/.test(compose) && /overlay=0:0:format=auto:eof_action=pass/.test(compose));
  ok('…starting after the hook rather than competing with it',
    /const tagFrom = Math\.min/.test(compose));
}

console.log('\n— It cannot be built out of things that did not happen —');
{
  /* The whole argument against the other advert is that it asserts. This one is
     refused rather than faked when the purchase did not complete. */
  ok('it requires a completed order',
    blockedReason(V, { tokens: real, order: { status: 'pending' } }) !== null);
  ok('…and a real order number', V.needs.includes('orderNumber'));
  ok('…and a real price', V.needs.includes('price'));
  ok('with a completed order it builds',
    blockedReason(V, { tokens: real, order: { status: 'completed' } }) === null);

  const noOrder = tokensFor({ product: { name: '1,000 Robux', price: 999, currency: 'EUR', instant: true }, lang: 'nl' });
  ok('a caption with no real value drops rather than guessing',
    fill('Bestelling {orderNumber}', noOrder) === null);

  /* The claim the teardown makes about itself: it never says "cheaper than". */
  const doc = read('scripts/ad/ENEBA-TEARDOWN.md');
  const claims = V.captions.map((c) => c.text).join(' ') + ' ' + V.hook;
  ok('nothing in the cut claims to beat a competitor’s price',
    !/goedkoper|cheaper|billiger|minder dan|vs\.?\s/i.test(claims), claims);
  ok('…and the teardown says why that is deliberate',
    /market_observations`? is empty/.test(doc));
}

console.log('\n— The other variants still work —');
{
  ok('every variant still has a hook and a cta',
    VARIANTS.every((v) => v.hook && v.cta));
  ok('…and English ones still read English',
    /Sent the moment/.test(tokensFor({ product: { instant: true }, lang: 'en' }).delivery));
  ok('an unknown language falls back rather than breaking',
    /Sent the moment/.test(tokensFor({ product: { instant: true }, lang: 'zz' }).delivery));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-counter-variant: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
