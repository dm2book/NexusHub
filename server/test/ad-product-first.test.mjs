/**
 * The product, visually central, from the first frame.
 *
 * Every cut in this toolkit opened on a SCREEN RECORDING of a product page — a
 * browser, a header, a breadcrumb, a chat bubble, and somewhere inside all of
 * that, small, the thing being sold. In a feed that is a second spent working
 * out what you are looking at, and the second is the entire budget.
 *
 * Variant M puts the shop's OWN artwork, name and price full-frame at t=0 and
 * then hands off to the footage. Six moments, each drawn from the product row:
 *
 *   1. product zoom-in      the artwork full-frame, pushing in
 *   2. product card reveal  art and name over the real page
 *   3. price reveal         the badge, on its own beat
 *   4. checkout transition  a thrown cut into the checkout
 *   5. email transition     a thrown cut into the mail landing
 *   6. code reveal          the code, with a chip saying what it is FOR
 *
 * The two things this must not become: an advert for a picture nobody can read
 * on a phone, and an advert for a product the shop does not have artwork of.
 */
import { readFileSync, existsSync } from 'node:fs';
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
const { CUTS } = await import(join(ROOT, 'scripts/ad/cuts.mjs'));
const { planCuts, resolveTiming } = await import(join(ROOT, 'scripts/ad/timing.mjs'));
const compose = read('scripts/ad/compose.mjs');
const cards = read('scripts/ad/cards.mjs');
const makeAd = read('scripts/ad/make-ad.mjs');

const M = variantById('M');
// The real recording's own spans, normalised — order FM-2026-H2MKUSQ5.
const BEATS = {
  product: 0, buy: 4118, checkout: 5218, 'order-placed': 7795,
  delivery: 13791, 'email-open': 18656, 'email-detail': 21125, end: 23028,
};
const at = (l) => (l in BEATS ? BEATS[l] : null);
const plan = () => {
  const c = planCuts(M.scenes, at);
  return resolveTiming(c, { target: M.target - M.hero, card: M.card, min: Math.min(15, M.target - M.hero - 1) });
};

console.log('— The product is on screen before anything else —');
{
  ok('there is a product-first variant', !!M && M.slug === 'product-first');
  ok('it opens on the product, not on a recording of a page', M.hero > 0, String(M.hero));
  /* The brief: within one second you know what is being sold. The hero IS the
     first second, so it has to be at least most of one. */
  ok('…for most of the first second', M.hero >= 0.8, `${M.hero}s`);
  ok('…and not so long that the advert becomes a slideshow', M.hero <= 1.5);
  ok('the hero is the first thing in the finished cut',
    /names\.unshift\('vhero'\)/.test(compose));
  ok('it is a still, pushing in — not a frozen frame',
    /\[vhero\]/.test(compose) && /zoompan[\s\S]{0,400}\[vhero\]/.test(compose));

  /* It comes out of the FOOTAGE budget, so a twelve-second cut is still twelve
     seconds rather than thirteen. */
  ok('the hero is paid for out of the footage, not added to the running time',
    /target: TARGET - HERO/.test(compose));
  ok('…so the advert is still the length it asks for',
    Math.abs(M.hero + plan().total - M.target) <= 0.4, (M.hero + plan().total).toFixed(2));
}

console.log('— It uses the shop’s own artwork —');
{
  ok('cards.mjs takes the product image', /const IMAGE = arg\('image', ''\)/.test(cards));
  ok('…and resolves it against the shop being filmed',
    /\$\{BASE\}\$\{IMAGE\.startsWith\('\/'\) \? '' : '\/'\}/.test(cards));
  ok('…and accepts an absolute URL as it is', /\/\^https\?:\/\.test\(IMAGE\)/.test(cards));
  /* The recorder already writes product.image into beats.json; make-ad hands it
     on. Nothing here draws a picture the shop does not have. */
  ok('make-ad passes the product’s own image to the cards',
    /p\.image \? \[`--image=\$\{p\.image\}`\]/.test(makeAd));
  ok('a product with no artwork gets no hero cards',
    /^if \(ART\) \{/m.test(cards));
  ok('…and compose says so rather than opening on a blank',
    /no hero\.png in \$\{IN\}/.test(compose) && /this product has no artwork/.test(compose));
  ok('…and still renders, opening on the footage',
    /const HERO = Number\(arg\('hero'[\s\S]{0,140}fs\.existsSync\(heroCard\)/.test(compose));
}

console.log('— The six moments each have a mechanism —');
{
  const labels = M.scenes.map((s) => s.label);
  ok('1. product zoom-in — the hero pushes in', M.hero > 0 && /zoompan[\s\S]{0,400}\[vhero\]/.test(compose));

  ok('2. product card reveal — over the product page',
    /reveal\('productcard\.png', variant\?\.productCardAt \|\| 'the product'/.test(compose)
    && M.productCard === true && labels.includes('the product'));
  ok('…and it rises into place rather than appearing',
    /overlay=0:'\$\{y\}'/.test(compose) && /const RISE = /.test(compose));

  const priceScene = M.scenes.find((s) => s.price);
  ok('3. price reveal — the badge has a beat of its own', !!priceScene, 'none');
  /* Not the product scene. There it shared the frame with the product card,
     which already carried the price — two of the same number in one frame is
     not emphasis. */
  ok('…and it is not the scene the product card is on',
    priceScene && priceScene.label !== 'the product', priceScene?.label);
  ok('…so the card no longer carries a price at all',
    !/cprice/.test(cards), 'productcard still prices itself');

  /* Cut indices are counted over the whole body, and the hero is the first
     thing in it — so every footage cut is one later than the scene list reads. */
  const iCheckout = labels.indexOf('checkout');
  const iEmail = labels.indexOf('the email');
  ok('4. checkout transition — the cut into it is thrown',
    M.whipAt.includes(iCheckout), `whipAt ${M.whipAt} vs ${iCheckout}`);
  ok('5. email transition — so is the cut into the mail landing',
    M.whipAt.includes(iEmail), `whipAt ${M.whipAt} vs ${iEmail}`);
  ok('…and the cut out of the hero is thrown too', M.whipAt.includes(0));
  ok('the mail landing also slides its own card in',
    M.captions.some((c) => c.at === 'the email' && c.style === 'notify'));

  ok('6. code reveal — the closing frame says what the code is for',
    /reveal\('productchip\.png', variant\?\.productChipAt \|\| 'the code'/.test(compose)
    && labels.includes('the code'));
  ok('…and the code shot is a push into the frame, not a drift',
    M.scenes.find((s) => s.label === 'the code').zoom === 'focus');
}

console.log('— Readable on a phone —');
{
  /* A line that has to survive a six-inch screen at arm's length is not a 60px
     line. The old price badge was, and it is legible on a laptop and a smudge
     on a phone. These are ~6mm and ~8mm of glass. */
  const heroName = Number(/const HERO_NAME = (\d+)/.exec(cards)?.[1]);
  const heroPrice = Number(/const HERO_PRICE = (\d+)/.exec(cards)?.[1]);
  ok('the product name is set for a phone', heroName >= 96, String(heroName));
  ok('…and the price larger still', heroPrice >= 110 && heroPrice > heroName, String(heroPrice));
  ok('…both a real fraction of the frame', heroName / 1080 > 0.085);
  ok('the card’s name is big too', Number(/font-size:(\d+)px;line-height:1\.04/.exec(cards)?.[1] || 0) >= 64);
  /* One line. It wrapped to two, which is what pushed the card from 233 to
     1400 in the frame and printed it straight across the caption at 1160. */
  ok('…and kept to one line', /white-space:nowrap;overflow:hidden;text-overflow:ellipsis/.test(cards));

  /* The caption is bottom-anchored for this variant for the same reason: the
     two-line hook plate sits at 250px from the top and so does the card. */
  ok('the hook is moved out from under the card', M.hookStyle === 'big');
  ok('…and says something the pictures do not',
    !/\{name\}|\{price\}/.test(M.hook), M.hook);
}

console.log('— The hero does not shift anything underneath it —');
{
  /* Everything timed against the body — flashes, whips, the corner tag, the
     sound — accumulates from the footage, and the footage no longer starts at
     zero. Each of these was wrong by exactly one hero before it was right. */
  ok('the flashes start after the hero', /let acc = HERO;/.test(compose));
  ok('…and the cut out of the hero is one of them', /if \(HERO\) flashes\.push\(HERO\)/.test(compose));
  ok('the corner tag waits for it', /const tagFrom = HERO \+/.test(compose));
  ok('…and ends where the body ends', /const bodyEnd = HERO \+/.test(compose));
  /* The cue plan takes the hero as its own argument now, so the sound starts
     where the footage starts rather than at zero. */
  ok('the sound follows the picture', /hero: HERO,/.test(compose));
  ok('…including the cut out of the hero, which is a cut like any other',
    /if \(HERO\) flashes\.push\(HERO\)/.test(compose));
  /* The stopwatch reads the recording's own clock off these rows. Wrong by a
     hero, it would have read the footage a second early — and a clock that is
     wrong is the one thing that file exists to prevent. */
  ok('the stopwatch rows are offset too', /r\.in \+ HERO, out: r\.out \+ HERO/.test(compose));
  ok('…and its frame count covers the hero', /const swBody = HERO \+/.test(compose));
}

console.log('— It is honest, like everything else here —');
{
  const real = tokensFor({
    product: { name: 'Steam Wallet €10', price: 1199, currency: 'EUR', instant: true },
    order: { number: 'FM-2026-ABCD1234' }, lang: 'nl',
  });
  ok('it claims a delivery, so it needs one',
    blockedReason(M, { tokens: real, order: { status: 'pending' } }) !== null);
  ok('…and builds when there is one',
    blockedReason(M, { tokens: real, order: { status: 'completed' } }) === null);
  ok('the card copy goes through the claim gate like every other card',
    /said\('--name'/.test(cards));
  ok('nothing on the hero is invented — name and price come off the product row',
    /\$\{esc\(NAME\)\}/.test(cards) && /\$\{esc\(PRICE\)\}/.test(cards));
}

console.log('— Nothing that already worked was disturbed —');
{
  /* These files exist for every recording of a product that has artwork.
     Switching the overlays on by default would have quietly redressed twelve
     variants, ten cuts and seventy-five concepts composed without them. */
  ok('the product overlays are opt-in', /if \(variant\?\.productCard === true\)/.test(compose));
  ok('…and no other variant opted in',
    VARIANTS.filter((v) => v.productCard === true).length === 1);
  ok('…nor any cut', CUTS.every((c) => c.productCard !== true));
  ok('the hero is off unless a variant asks',
    VARIANTS.filter((v) => (v.hero ?? 0) > 0).length === 1 && CUTS.every((c) => !c.hero));
  ok('every earlier variant still resolves', VARIANTS.length === 13 && !!variantById('K') && !!variantById('L'));
  ok('and the price badge still lands on whichever scene asks for it',
    /const idx = cuts\.findIndex\(\(c\) => c\.price\)/.test(compose));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-product-first: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
