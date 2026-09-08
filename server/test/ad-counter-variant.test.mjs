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

console.log('\n— The performance edit, measured against the first cut —');
{
  /* Every number here was read off the finished 18s file before it changed:
     six of eighteen seconds under 1.5 on frame-to-frame motion, one cut per
     2.25s, −33.6 LUFS, and the price on screen three times at once. */
  const compose = read('scripts/ad/compose.mjs');

  ok('the advert is cut to twelve seconds, not eighteen', V.target === 12, String(V.target));
  ok('…and the end card comes down with it', V.card !== undefined && V.card < 2.6, String(V.card));
  ok('…without a hardcoded floor padding it back up',
    /min: Math\.min\(15, TARGET - 1\)/.test(compose));

  /* The waiting shots are the ones with nothing in them: `confirmed → delivery`
     is the shop polling, and the track page is a status list that does not
     move. Left at 1.2–1.4× they were the dead stretch. */
  const byLabel = Object.fromEntries(V.scenes.map((sc) => [sc.label, sc]));
  ok('the polling wait is compressed hard', byLabel.confirmed.speed >= 4);
  ok('…and so is the status page', byLabel.delivered.speed >= 2);

  ok('the audio is normalised to what the platforms play at',
    /loudnorm=I=-14:TP=-1\.5:LRA=11/.test(compose));

  /* The shot the advert is built to reach was a 1.2× drift with the code small
     and unmagnified near the top of a dense email. */
  ok('the code reveal is a real push, not a drift', byLabel['the code'].zoom === 'focus');
  ok('…and the focus zoom actually magnifies', /min\(1\.06\+0\.49\*on/.test(compose));

  ok('the price is not on screen three times at once', V.priceCard === false
    && V.captions.filter((c) => /\{price\}/.test(c.text)).length <= 1);

  /* A beat fires when the navigation resolves, not when the page has painted:
     frame one was 200ms of the catalogue the product page was still leaving. */
  ok('the opening scene waits for the page to paint', V.scenes[0].settle > 0);
  ok('…and the resolver honours that', /if \(s\.settle\)/.test(read('scripts/ad/timing.mjs')));
}

console.log('\n— Nothing sits under the platform’s own furniture —');
{
  const caps = read('scripts/ad/captions.mjs');
  const cards = read('scripts/ad/cards.mjs');
  /* TikTok's caption and buttons cover roughly the bottom 420px. The
     bottom-anchored styles were at 430–470px — inside it — and the permanent
     call to action was at 210px, which is as hidden as a CTA can be. */
  const pads = [...caps.matchAll(/padding:0 80px (\d+)px/g)].map((m) => Number(m[1]));
  ok('every bottom-anchored caption clears the chrome zone',
    pads.length > 0 && pads.every((n) => n >= 560), pads.join(','));
  /* The copy styles, not the notification mimic — a notification that is set
     like a headline stops reading as a notification. */
  const copySizes = [...caps.matchAll(/font-weight:[678]00;font-size:(\d+)px;line-height/g)]
    .map((m) => Number(m[1]));
  ok('…and every line of copy is big enough to survive a phone',
    copySizes.length > 0 && copySizes.every((n) => n >= 52), copySizes.join(','));
  ok('the call to action is out of the lower third entirely',
    /align-items:flex-start;justify-content:flex-start;padding:150px/.test(cards));
}

console.log('\n— A preview cannot be mistaken for a finished advert —');
{
  const rec = read('scripts/ad/record.mjs');
  const compose = read('scripts/ad/compose.mjs');
  /* Footage filmed against anything but the live shop bakes that host into the
     delivery email's footer — `© 2026 ForgeMarket — localhost:3000` was legible
     for a second and a half — and a demo payment puts a demo-mode notice on the
     checkout, in Dutch, on camera. Both were console warnings: a note to
     whoever ran the command, nothing to whoever uploads the file later. */
  ok('the recording records what it is', /const provenance = \{/.test(rec)
    && /realPayment: PAY === 'manual'/.test(rec));
  ok('…and whether the shop it filmed was the live one', /provenance\.live/.test(rec)
    || /live: \/\^https/.test(rec));
  ok('compose reads it', /PUBLISHABLE = provenance\.live === true/.test(compose));
  ok('…names the file preview- when it is not publishable',
    /`preview-\$\{baseName\}`/.test(compose));
  ok('…and burns a marker into every frame of it',
    /const mark = PUBLISHABLE \? '' :/.test(compose));

  /* A visible pointer. It was a 26px radial gradient fading to nothing, which
     on a light storefront page is a lens flare rather than a cursor. */
  ok('the cursor is opaque and ringed', /border:2\.5px solid rgba\(255,255,255/.test(rec));

  /* And the route OUT of preview, written down — because the obvious reading of
     "not publishable" is "wait for the card provider", and that is not what
     blocks it. A manual payment method needs no provider at all: verified
     against a running shop with PAY_TIKKIE set and DEMO_PAYMENTS off, the
     checkout offered a real method, orderingPaused was false and nothing on the
     page said demo. */
  const doc = read('scripts/ad/README.md');
  ok('the README says what makes a cut publishable', /What makes a cut publishable/.test(doc));
  ok('…and that it does not need the card provider',
    /It does not need Mollie/.test(doc) && /PAY_TIKKIE/.test(doc));
  ok('…and that a manual method is what the shop already has',
    /--pay=manual/.test(doc) && /commerceBlockers/.test(doc));
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
