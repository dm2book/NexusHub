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
import { tokensFor, fill, blockedReason } from '../../scripts/ad/variants.mjs';
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
