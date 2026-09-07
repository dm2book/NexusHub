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
    /\[body\]\[ctatag\]overlay=0:0:format=auto/.test(compose));
  ok('…starting after the hook rather than competing with it',
    /const tagFrom = Math\.min/.test(compose));
  /* Bounded at the input, like the end card. An unbounded `-loop 1` still
     overlaid onto the concatenated body rendered eighteen seconds of black
     under the overlays — a filtergraph that runs, exits zero, and writes a file
     nobody would ship. */
  ok('…from an input bounded by -t, not an endless loop',
    /'-loop', '1', '-framerate', String\(FPS\),\s*\n?\s*'-t', bodyEnd/.test(compose));
}

console.log('\n— The overlays have to be transparent, or they hide the advert —');
{
  /* The one that cost the most to find. After `document.write` the root keeps
     the navigated site's background — computed style says rgb(7,7,16), not
     transparent — so `omitBackground` had nothing to omit and Chromium wrote an
     OPAQUE png. Every caption then covered the footage instead of sitting on
     it, and the whole advert rendered as black rectangles with the text
     floating on them. It fails silently: the screenshot is written, ffmpeg
     overlays it happily, and the only way to notice is to watch the result. */
  for (const f of ['scripts/ad/cards.mjs', 'scripts/ad/captions.mjs']) {
    const src = read(f);
    ok(`${f.split('/').pop()} clears the root background before shooting`,
      /documentElement\.style\.setProperty\('background', 'transparent', 'important'\)/.test(src));
    ok('…and the body with it', /body\.style\.setProperty\('background', 'transparent', 'important'\)/.test(src));
    ok('…and still asks for a transparent screenshot', /omitBackground: true/.test(src));
  }
}

console.log('\n— The recording is filmed in the language of the advert —');
{
  /* The shop picks a language from the browser, and headless Chromium says
     en-US: a Dutch advert was filmed against an English shop, and the delivery
     email in its last third arrived in English. Nothing was broken — the shop
     served an English buyer an English mail. The recording simply has to browse
     the way the audience does. */
  const rec = read('scripts/ad/record.mjs');
  ok('the recorder takes a language', /const LANG = arg\('lang', 'nl'\)/.test(rec));
  ok('…sets the browser locale from it', /locale: LOCALE/.test(rec));
  ok('…and the shop’s own stored choice, before the first navigation',
    /addInitScript[\s\S]{0,200}fm_lang/.test(rec));
  ok('the buttons it presses exist in every language it can film in',
    /Direct kopen/.test(rec) && /Sofort kaufen/.test(rec) && /Acheter maintenant/.test(rec));

  /* Templates are per (id, language) now; selecting on the id alone returned
     whichever row Postgres felt like. */
  const mail = read('scripts/ad/email.mjs');
  ok('the delivery email is read in the language it was sent in',
    /WHERE id = @id AND lang = @lang/.test(mail));

  /* A re-recording used to destroy the take: the new file was renamed over
     raw.webm and then the "extras" sweep deleted raw.webm, which was by then
     the recording that had just been made. */
  ok('re-recording does not delete the take it just made',
    /f !== 'raw\.webm'/.test(rec));

  /* An account top-up asks for a username, and that field is required — so
     leaving it empty means the browser silently refuses to submit and the
     recording dies with nothing in the server log, because no request was made. */
  ok('a product that needs a delivery target gets one', /#co-target/.test(rec));
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
