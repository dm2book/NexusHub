/**
 * The flagship: one template, for TikTok, Reels and Shorts.
 *
 * Not a fourteenth idea — the assembly of what the previous rounds measured,
 * in the shape a performance team would ship. So this file is the brief,
 * checked line by line, against the template that claims to satisfy it.
 *
 * The two properties that make it a FLAGSHIP rather than another variant:
 *
 *   1. it is the highest-scoring thing the toolkit can make, on the toolkit's
 *      own scorer, with every dimension full
 *   2. it is built to be RE-OPENED — one purchase recording becomes ten adverts
 *      that share every frame after the first second and none of the first
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

const { VARIANTS, variantById, tokensFor, fill } = await import(join(ROOT, 'scripts/ad/variants.mjs'));
const { HOOKS, eligibleHooks } = await import(join(ROOT, 'scripts/ad/hooks.mjs'));
const { gatherEvidence, inspect } = await import(join(ROOT, 'scripts/ad/claims.mjs'));
const { scoreAd, TOTAL } = await import(join(ROOT, 'scripts/ad/score.mjs'));
const { planCuts, resolveTiming } = await import(join(ROOT, 'scripts/ad/timing.mjs'));
const { styleMetrics } = await import(join(ROOT, 'scripts/ad/captions.mjs'));
const { PROFILE_IDS, profileById } = await import(join(ROOT, 'scripts/ad/sound.mjs'));
const compose = read('scripts/ad/compose.mjs');
const record = read('scripts/ad/record.mjs');
const cards = read('scripts/ad/cards.mjs');
const makeAd = read('scripts/ad/make-ad.mjs');
const captions = read('scripts/ad/captions.mjs');

const F = variantById('flagship');
/* The real recording's own spans — order FM-2026-H2MKUSQ5, normalised. */
const BEATS = {
  open: 0, shop: 29071, select: 32132, product: 32996, buy: 36114, checkout: 37214,
  'order-placed': 39791, confirmed: 39809, delivery: 45787, 'delivered-detail': 48232,
  'email-open': 50652, 'email-detail': 53121, end: 55024,
};
const at = (l) => (l in BEATS ? BEATS[l] : null);
const tokens = tokensFor({
  product: { name: 'Steam Wallet €10', price: 1199, currency: 'EUR', instant: true },
  order: { number: 'FM-2026-H2MKUSQ5' }, stock: 4, lang: 'nl',
});
const evidence = gatherEvidence({ product: { instant: true, deliveryLine: tokens.delivery }, lang: 'nl' });
const resolved = (() => {
  const c = planCuts(F.scenes, at);
  return resolveTiming(c, { target: F.target - F.hero, card: F.card, min: Math.min(15, F.target - F.hero - 1) });
})();
const seconds = F.hero + resolved.total;
const labels = F.scenes.map((s) => s.label);

console.log('— The brief, line by line —');
{
  // 9:16
  ok('9:16', /const W = 1080; const H = 1920;/.test(compose));

  // 8–12 seconds
  ok('eight to twelve seconds', seconds >= 8 && seconds <= 12, `${seconds.toFixed(2)}s`);
  ok('…and the target says so too', F.target >= 8 && F.target <= 12, String(F.target));

  /* A strong first second: the shop's own artwork, name and price full-frame.
     A caption naming the product over a screen recording of a browser is a
     sentence to read; the artwork is a thing to recognise. */
  ok('a strong first second — the product, full-frame', F.hero >= 0.8 && F.hero <= 1.5, `${F.hero}s`);
  ok('…drawn from the shop’s own product artwork', F.productCard === true
    && /const IMAGE = arg\('image', ''\)/.test(cards));
  ok('…pushing in rather than sitting still', /zoompan[\s\S]{0,400}\[vhero\]/.test(compose));

  // Real product information, real price — from the product row, via tokens.
  ok('real product information', fill(F.captions.find((c) => /\{name\}/.test(c.text))?.text, tokens)
    === 'Steam Wallet €10. Geleverd.');
  ok('…and a real price, off the same row', tokens.price === '€11.99');
  ok('…both refused when the row has neither',
    fill('{name} — {price}', tokensFor({ product: {}, lang: 'nl' })) === null);

  // The purchase, beat by beat. These are windows into one real recording.
  for (const [what, label] of [
    ['a real checkout flow', 'checkout'],
    ['a real payment status', 'payment'],
    ['a real email delivery', 'the email'],
    ['a real order/code reveal', 'the code'],
  ]) {
    ok(what, labels.includes(label), labels.join(' → '));
  }
  ok('…in the order they happen', labels.join('|')
    === 'the product|buy|checkout|payment|delivered|the email|the code', labels.join('|'));
  ok('…and every one is a window into the recording, not a graphic',
    F.scenes.every((s) => s.from && s.to));
  /* "when available" is not a figure of speech: a scene whose beats are not in
     the recording is dropped, and the whole cut is refused when the purchase
     did not complete. */
  /* `email-detail` is a BEAT; "the email" is a scene label, and asking for the
     latter tests nothing because it was already null. Without the beat, the two
     scenes that span it disappear rather than being filled with something. */
  ok('a beat the recording does not have is dropped, not faked',
    planCuts(F.scenes, (l) => (l === 'email-detail' ? null : at(l))).length === F.scenes.length - 2,
    `${planCuts(F.scenes, (l) => (l === 'email-detail' ? null : at(l))).length} of ${F.scenes.length}`);
  ok('…and a purchase that never completed refuses the whole cut',
    F.needs.includes('order') && F.needs.includes('delivery'));

  // No invented claims.
  const everyLine = [F.hook, F.hookSub, ...F.captions.flatMap((c) => [c.text, c.sub])].filter(Boolean);
  const bad = everyLine.flatMap((t) => inspect(fill(t, tokens) || t, evidence).filter((f) => !f.proven));
  ok('no invented claims', bad.length === 0, bad.map((b) => b.label).join(', '));

  // Fast but comprehensible.
  const longest = Math.max(...resolved.cuts.map((c) => c.played));
  ok('fast — a cut every two seconds or better',
    (resolved.cuts.length) / seconds >= 0.5, `${(resolved.cuts.length / seconds).toFixed(2)}/s`);
  ok('…but comprehensible: nothing is a flash frame',
    Math.min(...resolved.cuts.map((c) => c.played)) >= 0.45,
    `${Math.min(...resolved.cuts.map((c) => c.played)).toFixed(2)}s`);
  ok('…and no shot outstays its welcome', longest <= 3.0, `${longest.toFixed(2)}s`);

  // Professional transitions: three thrown, the rest flashed.
  ok('professional transitions — some cuts are thrown, not all flashed',
    Array.isArray(F.whipAt) && F.whipAt.length >= 2 && F.whipAt.length < F.scenes.length,
    JSON.stringify(F.whipAt));
  ok('…the throw is a directional smear', /boxblur=luma_radius=42/.test(compose));
  ok('…and lands ON the cut while a whoosh leads it',
    /add\('throw', t - 0\.06\)/.test(read('scripts/ad/sound.mjs'))
    && /add\('transition', t - 0\.12\)/.test(read('scripts/ad/sound.mjs')));

  // Motion blur — in the file from the start, and applied zero times until it was measured.
  ok('motion blur', F.blurAt < 2 && F.scenes.filter((s) => s.blur).length >= 5,
    `blurAt ${F.blurAt}, ${F.scenes.filter((s) => s.blur).length} forced`);
  ok('…frames actually averaged after the ramp', /tmix=frames=/.test(compose));

  // Cursor tracking.
  ok('cursor tracking', /window\.__adGlide = /.test(record));
  ok('…on an ease-out at frame rate, not a CSS transition',
    /requestAnimationFrame\(step\)/.test(record));

  // Sound design.
  ok('sound design', !!F.sound && !!profileById(F.sound), String(F.sound));
  ok('…and the same video remixes four ways', PROFILE_IDS.length === 4);

  // A strong CTA.
  ok('a strong CTA — the address on screen from the second scene', !!F.cta);
  ok('…a closing line on the code', F.captions.some((c) => c.at === 'the code'));
  ok('…and an end card held long enough to read', F.card >= 0.9, String(F.card));
}

console.log('\n— It is the best the toolkit can make —');
{
  const r = scoreAd({ variant: F, at, tokens, evidence });
  ok('it is buildable and proven', r.verdict === 'ok', `${r.verdict} ${r.why || ''}`);
  ok('and it scores full marks', r.total === TOTAL, `${r.total}/${TOTAL}`);
  for (const dim of r.dimensions) {
    ok(`  ${dim.id} is full`, dim.score === dim.max, `${dim.score}/${dim.max} — ${dim.failed.join('; ')}`);
  }
  ok('nothing in the whole toolkit scores higher',
    VARIANTS.every((v) => scoreAd({ variant: v, at, tokens, evidence }).total <= r.total));
}

console.log('\n— Five or more openings from one recording —');
{
  const possible = eligibleHooks(tokens, fill);
  ok('the catalogue offers at least five this recording can prove',
    possible.length >= 5, `${possible.length} of ${HOOKS.length}`);
  ok('…and they are not all the same kind',
    new Set(possible.map((h) => h.type)).size >= 4,
    [...new Set(possible.map((h) => h.type))].join(', '));
  ok('…each with a different opening line',
    new Set(possible.map((h) => fill(h.text, tokens))).size === possible.length);
  ok('…and none of them claiming anything unproven',
    possible.every((h) => inspect(`${fill(h.text, tokens)} ${fill(h.sub, tokens) || ''}`, evidence)
      .every((f) => f.proven)));

  /* The ones this shop cannot prove today stay refused, however good they would
     be: no published reviews, no measured delivery, no per-unit rate for a
     currency-denominated card. */
  const blockedIds = HOOKS.filter((h) => !possible.includes(h)).map((h) => h.id);
  ok('the rest stay refused', blockedIds.length > 0 && blockedIds.includes('review-stars'),
    blockedIds.join(', '));

  ok('the batch renders them onto the flagship, not a hardcoded variant',
    /variantById\(arg\('variant'\) \|\| 'N'\)/.test(makeAd));
  ok('…and --flagship is one command for all of them',
    /const FLAGSHIP = process\.argv\.includes\('--flagship'\)/.test(makeAd)
    && /FLAGSHIP \? 'all'/.test(makeAd));
  ok('…reusing the recording rather than buying one per opening',
    /process\.argv\.includes\('--flagship'\)/.test(makeAd.slice(makeAd.indexOf('const REUSE'))));
  ok('…and the opening is in the filename', /\$\{h\.id\}\.mp4/.test(makeAd));
}

console.log('\n— The geometry holds for every one of them —');
{
  /* Both of this toolkit's shipped overlay collisions were found by measuring
     rather than by reading the CSS, and the catalogue hooks made the second one
     possible again: they all carry a second line, which grows the plate upward
     into the product card. */
  const hookStyle = styleMetrics(F.hookStyle);
  ok('the opening is bottom-anchored', hookStyle.anchor === 'bottom');
  ok('…clear of the bottom 420px the platforms fill', hookStyle.offset >= 420, String(hookStyle.offset));
  ok('…and it can carry a second line at all', hookStyle.subSize >= 40, String(hookStyle.subSize));
  ok('every caption style clears that zone too',
    ['small', 'big', 'quote'].every((s) => styleMetrics(s).offset >= 420));
  ok('…and every one is readable on a phone',
    ['small', 'big', 'quote'].every((s) => styleMetrics(s).fontSize >= 50));

  /* The card was moved up and in after measuring the tallest hook — a two-line
     headline over a two-line sub — at y 937. */
  const pad = /\.cwrap\{[^}]*padding:(\d+)px (\d+)px/.exec(cards);
  ok('the product card starts high enough to clear the tallest hook',
    Number(pad?.[1]) <= 140, `${pad?.[1]}px from the top`);
  ok('…and is narrow enough not to reach it', Number(pad?.[2]) >= 200, `${pad?.[2]}px inset`);
  ok('the collision is documented where it happened', /rows\.mjs/.test(cards));

  /* A hook's second line rendered as unstyled inline text at the headline size
     until `big` learned to carry one. */
  ok('a second line on the flagship’s style is actually styled',
    /big: `[\s\S]{0,600}\.t \.sub\{/.test(captions));
  ok('…and every catalogue hook has one to render', HOOKS.every((h) => !!h.sub));
}

console.log('\n— It is the existing toolkit, assembled —');
{
  ok('no new renderer', !/ffmpeg/.test(read('scripts/ad/variants.mjs')));
  ok('the flagship is a variant like any other, resolvable by slug',
    variantById('N') === F && variantById('flagship') === F);
  ok('…so compose, cards, captions, sound and claims are unchanged paths',
    /--variant=/.test(makeAd) && /compose\.mjs/.test(makeAd));
  ok('it declares the platforms it is cut for',
    Array.isArray(F.platforms) && ['tiktok', 'reels', 'shorts'].every((p) => F.platforms.includes(p)));
  ok('and every earlier variant still resolves',
    VARIANTS.length === 14 && !!variantById('K') && !!variantById('L') && !!variantById('M'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-flagship: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
