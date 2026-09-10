/**
 * Ten adverts out of one purchase.
 *
 * The brief was ten cuts of the same real recording: three that differ only in
 * pace and seven that differ in what they lean on. Written longhand that is ten
 * more variant literals, each a place for the flow to drift out of step with
 * the other nine — the bug this codebase keeps shipping, and which this round
 * also removed one instance of (concepts.mjs was carrying a byte-identical copy
 * of the scene grammar).
 *
 * So a cut is composed from a PACE and a FOCUS, and these tests are mostly
 * about what composition must not be allowed to change:
 *
 *   · the flow. Ten adverts of one purchase have to be adverts of THAT
 *     purchase — same beats, same order, every time.
 *   · the honesty gate. The opening comes out of hooks.mjs and every caption
 *     goes through fill(), so a line whose token has no real value removes
 *     itself here exactly as it does everywhere else in this toolkit.
 *
 * And about what it must change — otherwise ten files are one advert with ten
 * names, which is worse than one advert.
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

const { CUTS, cutById, PACES, FOCUS, SKELETON, buildCut } =
  await import(join(ROOT, 'scripts/ad/cuts.mjs'));
const { VARIANTS, variantById, tokensFor, fill, blockedReason, S } =
  await import(join(ROOT, 'scripts/ad/variants.mjs'));
const { HOOKS, hookById } = await import(join(ROOT, 'scripts/ad/hooks.mjs'));
const { planCuts, resolveTiming } = await import(join(ROOT, 'scripts/ad/timing.mjs'));
const compose = read('scripts/ad/compose.mjs');
const makeAd = read('scripts/ad/make-ad.mjs');

/* The real recording's own spans, normalised to zero — order FM-2026-H2MKUSQ5,
   Steam Wallet €10. A fixture with eight comfortable seconds in every beat is
   not this shop's footage, and it hides the thing that actually matters: on
   real spans most scenes sit at their speed ceiling, so a focus that only
   redistributes weight moves nothing. */
const BEATS = {
  product: 0, buy: 4118, checkout: 5218, 'order-placed': 7795,
  delivery: 13791, 'email-open': 18656, 'email-detail': 21125, end: 23028,
};
const at = (l) => (l in BEATS ? BEATS[l] : null);
const lengthOf = (c) => {
  const cuts = planCuts(c.scenes, at);
  return resolveTiming(cuts, { target: c.target, card: c.card, min: Math.min(15, c.target - 1) });
};
const real = tokensFor({
  product: { name: 'Steam Wallet €10', price: 1199, currency: 'EUR', instant: true },
  order: { number: 'FM-2026-ABCD1234' }, lang: 'nl',
});

console.log('— The ten that were asked for —');
{
  const want = [
    ['A', 'ultra-fast', 8], ['B', 'balanced', 10], ['C', 'cinematic', 12],
    ['D', 'price', 10], ['E', 'speed', 10], ['F', 'product', 10],
    ['G', 'checkout', 10], ['H', 'email', 10], ['I', 'watch-me-buy', 10],
    ['J', 'clean-premium', 12],
  ];
  ok('there are ten', CUTS.length === 10, `${CUTS.length}`);
  for (const [id, slug, target] of want) {
    const c = cutById(id);
    ok(`${id} — ${slug}, ${target}s`, !!c && c.slug === slug && c.target === target,
      c ? `${c.slug}, ${c.target}s` : 'missing');
  }
  ok('and each one actually resolves to about that length',
    CUTS.every((c) => Math.abs(lengthOf(c).total - c.target) <= 0.4),
    CUTS.map((c) => `${c.id}:${lengthOf(c).total.toFixed(1)}`).join(' '));
}

console.log('\n— All ten are the same purchase —');
{
  const flow = SKELETON.map((s) => s.label).join(' → ');
  ok('the flow is product → buy → checkout → payment → delivered → email → code',
    flow === 'the product → buy → checkout → payment → delivered → the email → the code', flow);
  for (const c of CUTS) {
    ok(`${c.id}: same beats, same order`,
      c.scenes.map((s) => `${s.from}>${s.to}`).join('|')
      === SKELETON.map((s) => `${s.from}>${s.to}`).join('|'));
  }
  /* Not a copy of the grammar — the same objects, spread. A second definition
     of what a payment beat is, is how ten adverts start disagreeing about it. */
  ok('the skeleton is the shared scene grammar, not a restatement of it',
    SKELETON[0].from === S.pHook.from && SKELETON[6].to === S.pReveal.to);
  ok('…and concepts.mjs stopped keeping its own copy of it',
    /export \{ S \} from '\.\/variants\.mjs'/.test(read('scripts/ad/concepts.mjs')));
}

console.log('\n— Only montage, hook, timing, zooms, transitions, captions and CTA differ —');
{
  const differs = (f) => new Set(CUTS.map((c) => JSON.stringify(f(c)))).size;
  ok('the timing differs', differs((c) => [c.target, c.card]) >= 3);
  ok('the montage differs — the weights are redistributed',
    differs((c) => c.scenes.map((s) => s.weight)) >= 8);
  ok('the zooms differ', differs((c) => [c.zoomScale, c.scenes.map((s) => s.zoom)]) >= 2);
  ok('the transitions differ', differs((c) => [c.flash, c.whipAt]) >= 3);
  ok('the captions differ', differs((c) => c.captions.map((x) => x.text)) === 10);
  ok('the closing line is different in all ten',
    new Set(CUTS.map((c) => c.captions[c.captions.length - 1].text)).size === 10);
  /* Seven distinct openings across ten cuts: A, B and C are the same advert at
     three speeds, which is what "8s / 10s / 12s of the same thing" means. */
  ok('seven distinct openings', new Set(CUTS.map((c) => c.hookId)).size === 7,
    [...new Set(CUTS.map((c) => c.hookId))].join(', '));
  ok('…and A, B and C share theirs, because only their pace differs',
    cutById('A').hookId === cutById('B').hookId && cutById('B').hookId === cutById('C').hookId);
  ok('…while the seven focused cuts each lead on something else',
    new Set(['D', 'E', 'F', 'G', 'H', 'I', 'J'].map((id) => cutById(id).hookId)).size === 6);

  /* Nothing else may differ. A cut that quietly re-ordered the beats or changed
     the product would be a different advert, not a different edit. */
  ok('every cut is in the same language', new Set(CUTS.map((c) => c.lang)).size === 1);
  ok('and points at the same shop', new Set(CUTS.map((c) => c.cta)).size === 1);
}

console.log('\n— Pace is one number, not ten hand-tuned ones —');
{
  const A = cutById('A'); const B = cutById('B'); const C = cutById('C');
  /* `ceiling` scales the speed LIMIT. Raising it lets a scene be squeezed;
     lowering it forces the scene closer to real time. That single number is the
     difference between ultra-fast and cinematic. */
  ok('ultra raises every ceiling', A.scenes.every((s, i) => s.speed > B.scenes[i].speed));
  ok('cinematic lowers every ceiling', C.scenes.every((s, i) => s.speed < B.scenes[i].speed));
  ok('balanced is the tuning the performance cut was measured into',
    B.scenes.every((s, i) => s.speed === SKELETON[i].speed));

  ok('the eight-second cut hits harder', A.flash > B.flash && A.zoomScale > B.zoomScale);
  ok('…and throws almost every cut', A.whipAt.length === A.scenes.length - 1);
  ok('the cinematic cut barely flashes', C.flash < 0.3);
  ok('…and throws none of them', C.whipAt.length === 0);
  ok('…and stops punching the camera around',
    C.scenes.every((s) => s.zoom !== 'punch') && B.scenes.some((s) => s.zoom === 'punch'));
  ok('the end card holds longest on the slowest cut', C.card > B.card && B.card > A.card);

  ok('a pace is reusable — J is the cinematic pace on a different focus',
    cutById('J').target === C.target && cutById('J').flash === C.flash);
  ok('…and a focus is reusable across paces',
    typeof PACES.ultra === 'object' && Object.keys(FOCUS).length >= 8);
}

console.log('\n— Focus moves the time to the beat it is about —');
{
  const secondsOn = (c, label) => {
    const r = lengthOf(c);
    return r.cuts.find((x) => x.label === label)?.played ?? 0;
  };
  const B = cutById('B');
  const heavier = (id, label) => secondsOn(cutById(id), label) > secondsOn(B, label) * 1.25;
  ok('D spends longer on the product than B does', heavier('D', 'the product'));
  ok('F spends longer still', secondsOn(cutById('F'), 'the product') > secondsOn(cutById('D'), 'the product'));
  ok('G spends longer on the checkout', heavier('G', 'checkout'));
  ok('H spends longer on the email arriving', heavier('H', 'the email'));
  ok('E spends longer on the delivery', heavier('E', 'delivered'));
  ok('I spends longer on the buying itself', heavier('I', 'buy'));
  ok('and the ten are not the same edit with different words',
    new Set(CUTS.map((c) => lengthOf(c).cuts.map((x) => x.played.toFixed(2)).join(','))).size >= 8);
}

console.log('\n— The honesty gate is inherited, not re-implemented —');
{
  ok('every opening comes out of the hook catalogue',
    CUTS.every((c) => !!hookById(c.hookId)));
  ok('…and is the text that hook actually carries',
    CUTS.every((c) => c.hook === hookById(c.hookId).text));

  /* `needs` is derived from the opening and the captions, never typed out. A
     hand-maintained list goes stale the first time a line changes, and the
     failure is an advert making a claim nothing checked. */
  ok('needs is derived, not hand-maintained', /const needs = \[\.\.\.new Set\(\[/.test(read('scripts/ad/cuts.mjs')));
  for (const c of CUTS) {
    const used = c.captions.flatMap((x) => [
      ...String(x.text || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    ok(`${c.id}: every token it renders is declared`,
      used.every((t) => c.needs.includes(t)), used.filter((t) => !c.needs.includes(t)).join(','));
    ok(`${c.id}: …and it claims a completed order, because it shows one`,
      c.needs.includes('order'));
  }

  // Nothing gets made from a purchase that did not happen.
  ok('an unfinished purchase blocks all ten',
    CUTS.every((c) => blockedReason(c, { tokens: real, order: { status: 'pending' } }) !== null));
  ok('…and a completed one blocks none of them',
    CUTS.every((c) => blockedReason(c, { tokens: real, order: { status: 'completed' } }) === null),
    CUTS.map((c) => `${c.id}:${blockedReason(c, { tokens: real, order: { status: 'completed' } })}`)
      .filter((x) => !x.endsWith(':null')).join(' | '));

  /* The speed cut leans on the shop's own promise for that product, so a
     product with no delivery promise cannot have one made for it. */
  const noPromise = tokensFor({ product: { name: 'Thing', price: 999 }, lang: 'nl' });
  ok('a product with no delivery promise cannot be the speed cut',
    blockedReason(cutById('E'), { tokens: noPromise, order: { status: 'completed' } }) !== null);
  ok('…while the ones that do not claim speed are still fine',
    blockedReason(cutById('G'), { tokens: noPromise, order: { status: 'completed' } }) === null);

  // No cut invents a rating, a count or a comparison. The shop has none.
  const words = CUTS.flatMap((c) => [c.hook, c.hookSub, ...c.captions.map((x) => x.text)]).join(' | ');
  ok('nothing claims a rating or a customer count',
    !/\d\s*\/\s*5|★|\b\d+\+?\s*(klanten|reviews|verkocht)/i.test(words));
  ok('nothing compares itself to a competitor',
    !/goedkoper|cheapest|laagste|beste prijs/i.test(words));
  ok('and no hard-coded figure survives the tokens',
    !/\d/.test(words.replace(/\{\w+\}/g, '')), words.replace(/\{\w+\}/g, ''));
}

console.log('\n— Composed, not written —');
{
  const src = read('scripts/ad/cuts.mjs');
  /* The ten declarations are a table. If someone starts hand-tuning scenes into
     them, the flow drifts and this is the thing that notices. */
  ok('the ten are declarations of a pace and a focus',
    CUTS.every((c) => PACES[c.pace] && FOCUS[c.focus]));
  ok('…and nothing else is spelled out per cut',
    !/scenes: \[/.test(src.slice(src.indexOf('export const CUTS'))));
  ok('a new cut is one line', /\.map\(buildCut\)/.test(src));

  // The composer is usable on its own, which is what makes it a system.
  const custom = buildCut({
    id: 'Z', slug: 'test', name: 'Test', pace: 'ultra', focus: 'price', close: 'Klaar.',
  });
  ok('buildCut composes any pair', custom.target === 8 && custom.hookId === 'price');
  ok('…and rejects a pace that does not exist', (() => {
    try { buildCut({ id: 'Z', slug: 'z', name: 'Z', pace: 'nope', focus: 'flow', close: 'x' }); return false; }
    catch (e) { return /no pace/.test(e.message); }
  })());
  ok('…and a focus that does not exist', (() => {
    try { buildCut({ id: 'Z', slug: 'z', name: 'Z', pace: 'ultra', focus: 'nope', close: 'x' }); return false; }
    catch (e) { return /no focus/.test(e.message); }
  })());
}

console.log('\n— One recording, ten files —');
{
  ok('the editor takes --cut', /const CUT = arg\('cut', null\)/.test(compose));
  ok('an unknown cut stops the render', /No cut "\$\{CUT\}"/.test(compose));
  ok('the wrapper takes --cuts', /const cutsArg = arg\('cuts'\)/.test(makeAd));
  ok('--cuts=all walks the set', /cutsArg === 'all'/.test(makeAd));
  ok('--cuts=list reports without rendering', /cutsArg === 'list'/.test(makeAd));
  ok('a --cuts run reuses the recording rather than buying again',
    /arg\('cuts'\) \|\| arg\('cut'\)/.test(makeAd) && /const REUSE = /.test(makeAd));
  ok('a cut that cannot honestly be made skips the batch, not the run',
    /r\.status === 2\) skipped\.push\(\{ id: c\.id/.test(makeAd));

  /* A–H and J exist in BOTH tables. A run asking for the 8-second cut and
     silently getting the 16-second price-hook variant is the quiet wrong answer
     this whole toolkit is built to avoid. */
  const clash = CUTS.filter((c) => variantById(c.id)).map((c) => c.id);
  ok('the letters do collide with the variants', clash.length >= 8, clash.join(''));
  ok('…so the two are addressed by different flags, not merged',
    /CUT \? cutById\(CUT\)/.test(compose));
  ok('…and the filename says which table it came from',
    /variant\?\.family \? `\$\{variant\.family\}-`/.test(compose));
  ok('cut ids and slugs are unique among themselves',
    new Set(CUTS.map((c) => c.id)).size === 10 && new Set(CUTS.map((c) => c.slug)).size === 10);
  ok('and no cut slug collides with a variant slug',
    !CUTS.some((c) => VARIANTS.some((v) => v.slug === c.slug)));
}

console.log('\n— Nothing that already worked was disturbed —');
{
  ok('every variant still resolves', VARIANTS.length === 12 && !!variantById('K') && !!variantById('L'));
  ok('no variant grew a pace or a focus', VARIANTS.every((v) => !v.pace && !v.focus));
  ok('the flash is unchanged for anything that does not ask',
    /variant\?\.flash \?\? 0\.55/.test(compose));
  ok('the hook catalogue is untouched', HOOKS.length === 15);
  ok('and --variants= still builds variants', /arg\('variants'\) === 'all'/.test(makeAd));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-cuts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
