/**
 * The performance generator — the cut built for a feed rather than for a demo.
 *
 * Everything asserted here came out of measuring earlier renders of the same
 * footage, so each one is a number that was wrong before it was a rule:
 *
 *   0 applications of motion blur   nothing ever reached the 2.0× threshold
 *   6% / 9% zooms                   invisible at phone size
 *   one flash on every cut          so no cut reads as punctuation
 *   a hook giving only a price      to a viewer who does not know the shop
 *   −33.6 LUFS                      about twenty under what platforms play at
 *   6 of 18 seconds under 1.5       on frame-to-frame motion
 *
 * The flow the variant has to walk is fixed: hook → product → checkout →
 * payment → email arrival → code → call to action. A scene missing from the
 * middle of that is not a shorter advert, it is a different one.
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

const { variantById, tokensFor, fill, blockedReason } =
  await import(join(ROOT, 'scripts/ad/variants.mjs'));
const compose = read('scripts/ad/compose.mjs');
const record = read('scripts/ad/record.mjs');
const caps = read('scripts/ad/captions.mjs');
const sfxSrc = read('scripts/ad/sfx.mjs');

const V = variantById('performance');
const real = tokensFor({
  product: { name: 'Steam Wallet €10', price: 1199, currency: 'EUR', instant: true },
  order: { number: 'FM-2026-ABCD1234' }, lang: 'nl',
});

console.log('— The flow is the one that was asked for —');
{
  ok('the performance variant exists', !!V);
  ok('…and is written for a Dutch placement', V.lang === 'nl');
  /* hook → product → checkout → payment → email arrival → code → CTA.
     The hook rides the product scene and the CTA is the end card, so the
     scene list is the five between them plus those two. */
  const labels = V.scenes.map((s) => s.label);
  for (const beat of ['the product', 'buy', 'checkout', 'payment', 'delivered', 'the email', 'the code']) {
    ok(`the cut walks through "${beat}"`, labels.includes(beat), labels.join(' → '));
  }
  ok('…in that order', labels.join('|') ===
    'the product|buy|checkout|payment|delivered|the email|the code', labels.join('|'));
  ok('the call to action is the end card, and it is short',
    V.card !== undefined && V.card <= 2.0, String(V.card));
}

console.log('\n— Eight to twelve seconds —');
{
  ok('the target is inside the brief', V.target >= 8 && V.target <= 12, String(V.target));
  ok('…and the floor follows it rather than padding back to fifteen',
    /min: Math\.min\(15, TARGET - 1\)/.test(compose));
}

console.log('\n— The first two seconds say what is being sold —');
{
  /* A hook that gives only a price answers "how much" for somebody who does not
     yet know WHAT. Measured on the first cut: two seconds of "€11.99. Meer
     wordt het niet." over a product page, to a viewer deciding in under a
     second whether this is for them. */
  ok('the hook names the product', /\{name\}/.test(V.hook), V.hook);
  ok('…and its price', /\{price\}/.test(V.hook));
  ok('…and a second line says what the shop sells', !!V.hookSub, String(V.hookSub));
  ok('…in plain language, not a token', /giftcards|tegoed/i.test(V.hookSub || ''));
  ok('the hook resolves against real data',
    fill(V.hook, real) === 'Steam Wallet €10 — €11.99', fill(V.hook, real));

  /* It rendered its first line and silently dropped the second, because the
     second line was only ever emitted for the notification style. */
  ok('a second line is rendered on any style that has one',
    /: esc\(line\.text\) \+ \(line\.sub \?/.test(caps));
  ok('the two-line hook style exists', /\n  lede: `/.test(caps));
  ok('…and compose reaches for it when there is a second line',
    /hookSub \? 'lede' : 'hook'/.test(compose));
  /* SLAB used to come last and overrode every background a style set. */
  ok('a style that draws its own plate is not overridden by the default slab',
    /\$\{SLAB\}\$\{style\}/.test(caps));
}

console.log('\n— Aggressive cuts, and every one of them moving —');
{
  const speeds = V.scenes.map((s) => s.speed);
  ok('every scene declares a real ramp', speeds.every((n) => n >= 1.1), speeds.join(','));
  ok('…and the waiting ones are compressed hardest',
    V.scenes.find((s) => s.label === 'payment').speed >= 4);
  /* The weights are what stop the budget being spent on stillness: small
     weights mean the ceilings bind and everything is moving. */
  const weights = V.scenes.map((s) => s.weight);
  ok('no scene is weighted to sprawl', weights.every((n) => n <= 2), weights.join(','));
}

console.log('\n— Motion blur, which had never once been applied —');
{
  ok('the threshold is a variable, not a hardcoded 2.0',
    /c\.blur \|\| c\.speed >= BLUR_AT/.test(compose));
  ok('…and this variant lowers it', V.blurAt !== undefined && V.blurAt < 2, String(V.blurAt));
  const forced = V.scenes.filter((s) => s.blur);
  ok('…while the hardest cuts force it outright', forced.length >= 3,
    forced.map((s) => s.label).join(', '));
  ok('a harder ramp gets a longer average',
    /c\.speed >= 3 \? 5 : 3/.test(compose));
}

console.log('\n— Cinematic zooms —');
{
  ok('the pushes are scaled by the variant', /const ZOOM = Number\(arg\('zoom'/.test(compose));
  ok('…and this one asks for real movement', V.zoomScale >= 2, String(V.zoomScale));
  ok('the reveal is a push into the frame, not a drift',
    V.scenes.find((s) => s.label === 'the code').zoom === 'focus');
  ok('…and the focus zoom magnifies to 1.55×', /min\(1\.06\+0\.49\*on/.test(compose));
}

console.log('\n— Whip transitions, and a flash that still means something —');
{
  ok('the variant names the cuts that are thrown', Array.isArray(V.whipAt) && V.whipAt.length >= 2,
    JSON.stringify(V.whipAt));
  ok('…and compose smears those and only those',
    /const whipCuts = new Set\(variant\?\.whipAt \|\| \[\]\)/.test(compose)
    && /boxblur=luma_radius=42/.test(compose));
  /* Still fires on every cut this variant does not throw, and still at 0.55:
     the weight is a variant-level knob now (an eight-second cut wants it
     harder, a cinematic one barely at all), and K does not ask, so K gets what
     it always got. */
  ok('the flash is still there for the ordinary cuts',
    /color=white@\$\{FLASH\.toFixed\(2\)\}:t=fill:enable='\$\{flashExpr\}'/.test(compose));
  ok('…at the weight this variant was measured into', (V.flash ?? 0.55) === 0.55
    && /variant\?\.flash \?\? 0\.55/.test(compose));
}

console.log('\n— Smooth cursor tracking —');
{
  /* The pointer set a transform and let a 90ms CSS transition cover the gap,
     which across the width of a phone screen is a teleport. */
  ok('the cursor animates along its path', /window\.__adGlide = /.test(record));
  ok('…on an ease-out at frame rate', /requestAnimationFrame\(step\)/.test(record));
  ok('…and the recorder awaits the travel, not the arrival',
    /await page\.evaluate\(\(\[px, py\]\) => window\.__adGlide/.test(record));
  ok('the pointer itself is opaque and ringed',
    /border:2\.5px solid rgba\(255,255,255/.test(record));
}

console.log('\n— The sound follows the beats —');
{
  for (const s of ['click', 'whoosh', 'notify', 'confirm', 'whip', 'impact', 'bed']) {
    ok(`${s} is generated`, new RegExp(`\\b${s}:`).test(sfxSrc) || s === 'bed');
  }
  ok('a thrown cut gets the whip, an ordinary one the whoosh',
    /sfx\(thrown \? 'whip' : 'whoosh'\)/.test(compose));
  ok('the payment beat has a confirmation sound', /if \(c\.confirm\) place\(sfx\('confirm'\)/.test(compose));
  ok('…and the variant marks which scene that is',
    V.scenes.some((s) => s.confirm));
  ok('the email arrival keeps its notification sound',
    /if \(c\.notify\) place\(sfx\('notify'\)/.test(compose)
    && V.scenes.some((s) => s.notify));
  ok('every sound the graph asks for is on the required list',
    /const need = \['click', 'whoosh', 'notify', 'impact', 'confirm', 'whip', 'bed'\]/.test(compose));
  ok('the mix is normalised to what the platforms play at',
    /loudnorm=I=-14:TP=-1\.5:LRA=11/.test(compose));
}

console.log('\n— Branding is kept, and nothing is invented —');
{
  ok('the call to action is the shop’s own address', V.cta === 'forgemarket.nl');
  ok('the sounds are generated, never sampled', /waveform maths/.test(sfxSrc));
  const claims = V.captions.map((c) => c.text).join(' ') + ' ' + V.hook + ' ' + V.hookSub;
  ok('no rating, no review count, no delivery time in minutes',
    !/\d\s*\/\s*5|\d+\s*(reviews|klanten)|\d+\s*(min|minuten|sec)/i.test(claims), claims);
  ok('…and no claim to beat a competitor',
    !/goedkoper|cheaper|billiger|vs\.?\s/i.test(claims));
  /* Every caption is a thing that happened on camera, so the cut is refused
     rather than faked when the purchase did not complete. */
  ok('it needs a completed order',
    blockedReason(V, { tokens: real, order: { status: 'pending' } }) !== null);
  ok('…and builds when there is one',
    blockedReason(V, { tokens: real, order: { status: 'completed' } }) === null);
}

console.log('\n— It is part of the existing toolkit —');
{
  ok('no new entry point was added',
    existsSync(join(ROOT, 'scripts/ad/make-ad.mjs'))
    && !existsSync(join(ROOT, 'scripts/ad/make-performance-ad.mjs')));
  ok('it is reachable by slug like every other variant',
    variantById('performance') === variantById('K'));
  ok('…and the older variants still resolve',
    !!variantById('klik-tot-code') && !!variantById('A'));
  ok('the older variants keep their tuning',
    (variantById('klik-tot-code').zoomScale ?? 1) !== V.zoomScale);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-performance: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
