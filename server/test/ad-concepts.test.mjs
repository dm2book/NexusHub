/**
 * Twenty-five short-form concepts, held to the same rules as the shop.
 *
 * The value of scripts/ad/ is not that it makes adverts — it is that a variant
 * which cannot tell the truth skips itself. A concept written in a slide deck
 * inherits none of that, so these live in code and are checked here: the SKU has
 * to exist, the hook has to fill from real data, and nothing may claim a rating,
 * a comparison or a relationship that does not exist.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCEPTS, BRANDS, conceptsForBrand } from '../../scripts/ad/concepts.mjs';
import { VARIANTS, tokensFor, fill, blockedReason } from '../../scripts/ad/variants.mjs';
import { CATALOG } from '../src/db/demoSeed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('— The set —');
{
  ok('there are twenty-five', CONCEPTS.length === 25, `${CONCEPTS.length}`);
  for (const b of Object.keys(BRANDS)) {
    ok(`${BRANDS[b].label} has five`, conceptsForBrand(b).length === 5, `${conceptsForBrand(b).length}`);
  }
  const ids = CONCEPTS.map((c) => c.id);
  ok('every id is unique', new Set(ids).size === ids.length);
  /* Twenty-five concepts that open the same way are one concept. The hook is
     the only part a viewer is guaranteed to see. */
  const hooks = CONCEPTS.map((c) => c.hook);
  ok('every hook is different', new Set(hooks).size === hooks.length);
}

console.log('\n— Each one is complete —');
{
  const missing = [];
  for (const c of CONCEPTS) {
    for (const k of ['hook', 'scenes', 'captions', 'onScreen', 'cta', 'post', 'sku', 'needs']) {
      if (!c[k] || (Array.isArray(c[k]) && !c[k].length)) missing.push(`${c.id}.${k}`);
    }
    if (!c.post?.text || !c.post?.tags?.length) missing.push(`${c.id}.post`);
  }
  ok('hook, script, captions, on-screen text, CTA and post caption on all 25',
    missing.length === 0, missing.join(', '));

  // A short that runs long is not watched to the CTA.
  const tooLong = CONCEPTS.filter((c) => !(c.target >= 12 && c.target <= 25)).map((c) => c.id);
  ok('every one is between 12 and 25 seconds', tooLong.length === 0, tooLong.join(', '));

  /* Paid promotion has to say so — TikTok and YouTube both require it, and in
     the Netherlands so does the Reclamecode Social Media. */
  const undisclosed = CONCEPTS.filter((c) => !c.onScreen.some((o) => /#ad|paid promotion/i.test(o)))
    .map((c) => c.id);
  ok('every one carries the paid-promotion disclosure', undisclosed.length === 0, undisclosed.join(', '));
}

console.log('\n— Every one names a product that exists —');
{
  const skus = new Set(CATALOG.filter((p) => p.active !== false).map((p) => p.sku));
  const unknown = CONCEPTS.filter((c) => !skus.has(c.sku)).map((c) => `${c.id}:${c.sku}`);
  ok('no concept advertises a SKU the shop does not sell', unknown.length === 0, unknown.join(', '));

  // The brand tables have to match the catalogue too, or a brief points at air.
  const badBrand = [];
  for (const [key, b] of Object.entries(BRANDS)) {
    for (const s of b.skus) if (!skus.has(s)) badBrand.push(`${key}:${s}`);
  }
  ok('and every brand ladder is real', badBrand.length === 0, badBrand.join(', '));
}

console.log('\n— And can be made without inventing anything —');
{
  const bySku = Object.fromEntries(CATALOG.map((p) => [p.sku, p]));
  const blocked = [];
  for (const c of CONCEPTS) {
    const p = bySku[c.sku];
    if (!p) continue;
    const product = { ...p, price: Number(p.price), currency: 'EUR', instant: false };
    const tokens = { ...tokensFor({ product }), orderNumber: 'FM-1042' };
    const reason = blockedReason(c, { tokens, order: { status: 'completed' } });
    if (reason) blocked.push(`${c.id}: ${reason}`);
    else if (!fill(c.hook, tokens)) blocked.push(`${c.id}: hook does not fill`);
  }
  ok('all 25 resolve against the real catalogue', blocked.length === 0, blocked.join(' | '));

  /* The token this set leans on hardest. It is the shop's own two numbers, and
     it must refuse anything that is not a countable pack — a €25 card is priced
     in euros and "3 Months" is not three of something. */
  const t = (name, price) => tokensFor({ product: { name, price, currency: 'EUR' } }).perThousand;
  ok('per-1,000 is computed for a countable pack', t('4,500 Robux', 3899) === '€8.66', String(t('4,500 Robux', 3899)));
  ok('and refused for a card priced in euros', t('Netflix Gift Card €25', 2699) === null);
  ok('and refused for a month count', t('Xbox Game Pass Ultimate — 3 Months', 3499) === null);
}

console.log('\n— No advert outruns the shop —');
{
  const src = readFileSync(join(ROOT, 'scripts', 'ad', 'concepts.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  /* honest-copy.test.mjs already holds this file to the banned-claims list.
     These are the rules specific to advertising a shop with no trading history. */
  ok('no countdown or manufactured scarcity',
    !/hurry|last chance|only \d+ left|ends (today|tonight|in)|don.t miss/i.test(src));
  ok('nothing is promised in seconds or minutes',
    !/in seconds|within minutes|in under a minute/i.test(src));
  ok('no advert quotes a review that is not token-gated',
    !/★★|5 stars|five stars/i.test(src));
}

console.log('\n— The workflow cut —');
{
  const compose = readFileSync(join(ROOT, 'scripts', 'ad', 'compose.mjs'), 'utf8');
  const captions = readFileSync(join(ROOT, 'scripts', 'ad', 'captions.mjs'), 'utf8');
  const timing = readFileSync(join(ROOT, 'scripts', 'ad', 'timing.mjs'), 'utf8');

  const W = VARIANTS.find((v) => v.id === 'W');
  ok('there is a workflow variant', !!W);
  /* Product → Checkout → Payment → Email delivery → Success, and nothing else:
     no shop front and no browsing, so every second is spent on the five steps
     between wanting the thing and having it. */
  const labels = (W?.scenes || []).map((s) => s.label);
  ok('it runs product → buy → checkout → payment → confirmed → email → code',
    labels.join(' → ') === 'the product → buy → checkout → payment → confirmed → the email → the code',
    labels.join(' → '));
  ok('it claims a delivery, so it needs one', (W?.needs || []).includes('order'));

  /* The grammar went straight from checkout to confirmed, so the beat between
     placing an order and it existing was not a scene anything could pin to. */
  const pay = W?.scenes?.find((s) => s.label === 'payment');
  ok('the payment scene bridges order-placed and confirmed',
    pay?.from === 'order-placed' && pay?.to === 'confirmed');

  /* On the shared speeds this cut opened on a four-second product shot and did
     not reach its first flash until then. */
  ok('it carries its own pacing rather than the shared defaults',
    W?.scenes?.every((s) => typeof s.speed === 'number' && typeof s.weight === 'number'));
  const emailScene = W?.scenes?.find((s) => s.label === 'the email');
  ok('and the email arrival is the one scene played at real time',
    emailScene?.speed === 1.0 && emailScene.weight === Math.max(...W.scenes.map((x) => x.weight)));

  // The four effects the brief asks for, each in the code rather than in a note.
  ok('fast zooms: every scene declares one', W?.scenes?.every((s) => ['in', 'punch', 'drift'].includes(s.zoom)));
  ok('flash transitions: a white frame on every cut', /color=white@0\.55/.test(compose));
  ok('motion blur: frames averaged after the speed ramp', /Motion blur/.test(compose) && /tmix|tblend/.test(compose));
  ok('cursor tracking: painted from the real click coordinates',
    /A visible cursor/.test(readFileSync(join(ROOT, 'scripts', 'ad', 'record.mjs'), 'utf8')));

  /* The email arrival. Every other caption fades; this one has to move, because
     a notification that dissolves into view is not an arrival. */
  ok('the arrival card has a style of its own', /notify: `/.test(captions));
  ok('it is pinned to the top so it can slide in from off-frame',
    /align-items:flex-start/.test(captions.slice(captions.indexOf('notify: `'))));
  ok('compose slides it rather than fading it',
    /const arrival = c\.style === 'notify'/.test(compose) && /const SLIDE/.test(compose));
  ok('it overshoots and settles', /OVERSHOOT/.test(compose));
  ok('and the frame underneath lifts as it lands', /eq=brightness=0\.06/.test(compose));

  /* Two copies of the timing maths is how an edit and its storyboard drift
     apart — the same shape as every other drift in this codebase. */
  ok('the timing resolver lives in one file', /export function resolveTiming/.test(timing));
  ok('and compose calls it rather than restating it',
    /resolveTiming\(cuts/.test(compose) && !/const share = room \* /.test(compose));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
