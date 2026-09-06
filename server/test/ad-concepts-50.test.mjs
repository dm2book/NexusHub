/**
 * Fifty written concepts, held to the same rules as the shop.
 *
 * The set exists to be briefed from rather than edited, so it carries a written
 * body instead of scene marks. What it does NOT get is a different standard of
 * proof: every one names a SKU that exists, and none of them may reach for the
 * things that raise click-through and cost the sale — a countdown counting
 * nothing, stars from nobody, "cheapest" with no competitor observed, or
 * "official" about a company that has never heard of this shop.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCEPTS_50, BRANDS_50, conceptsForBrand50 } from '../../scripts/ad/concepts-50.mjs';
import { tokensFor, fill } from '../../scripts/ad/variants.mjs';
import { CATALOG } from '../src/db/demoSeed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'scripts', 'ad', 'concepts-50.mjs'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('— The set —');
{
  ok('there are fifty', CONCEPTS_50.length === 50, `${CONCEPTS_50.length}`);
  for (const b of Object.keys(BRANDS_50)) {
    ok(`${BRANDS_50[b].label} has ten`, conceptsForBrand50(b).length === 10, `${conceptsForBrand50(b).length}`);
  }
  const ids = CONCEPTS_50.map((x) => x.id);
  ok('every id is unique', new Set(ids).size === ids.length);
  /* Fifty concepts that open the same way are ten concepts. The hook is the
     only part a viewer is guaranteed to see, so it is the one field that must
     never repeat — the ANGLE may, across brands, but the first two seconds
     may not. */
  const hooks = CONCEPTS_50.map((x) => x.hook);
  ok('every hook is different', new Set(hooks).size === 50,
    `${new Set(hooks).size} distinct`);
  // A hook that needs a second sentence is not a hook.
  const long = CONCEPTS_50.filter((x) => x.hook.length > 90).map((x) => x.id);
  ok('and short enough to land in two seconds', long.length === 0, long.join(', '));
}

console.log('\n— Each one is complete —');
{
  const missing = [];
  for (const x of CONCEPTS_50) {
    for (const k of ['hook', 'body', 'cta', 'caption', 'onScreen', 'sku', 'needs']) {
      if (!x[k] || (Array.isArray(x[k]) && !x[k].length)) missing.push(`${x.id}.${k}`);
    }
    if (!x.caption?.text || !x.caption?.tags?.length) missing.push(`${x.id}.caption`);
  }
  ok('hook, body, CTA, caption and on-screen text on all fifty',
    missing.length === 0, missing.join(', '));
  /* Paid promotion has to say so — both platforms require it, and so does the
     Reclamecode Social Media here. */
  const undisclosed = CONCEPTS_50.filter((x) => !x.onScreen.some((o) => /#ad|paid promotion/i.test(o)));
  ok('every one carries the paid-promotion disclosure', undisclosed.length === 0,
    undisclosed.map((x) => x.id).join(', '));
  // One idea per body. Three ideas is a script nobody finishes.
  const rambling = CONCEPTS_50.filter((x) => x.body.length > 320).map((x) => x.id);
  ok('and a body short enough to say out loud', rambling.length === 0, rambling.join(', '));
}

console.log('\n— Every one names a product that exists —');
{
  const skus = new Set(CATALOG.filter((p) => p.active !== false).map((p) => p.sku));
  const unknown = CONCEPTS_50.filter((x) => !skus.has(x.sku)).map((x) => `${x.id}:${x.sku}`);
  ok('no concept advertises a SKU the shop does not sell', unknown.length === 0, unknown.join(', '));
  const badBrand = [];
  for (const [key, b] of Object.entries(BRANDS_50)) {
    for (const s of b.skus) if (!skus.has(s)) badBrand.push(`${key}:${s}`);
  }
  ok('and every brand shelf is real', badBrand.length === 0, badBrand.join(', '));

  // The tokens resolve against real prices, or the concept declares it needs one.
  const bySku = Object.fromEntries(CATALOG.map((p) => [p.sku, p]));
  const broken = [];
  for (const x of CONCEPTS_50) {
    const p = bySku[x.sku];
    if (!p) continue;
    const t = tokensFor({ product: { ...p, price: Number(p.price), currency: 'EUR', instant: false } });
    for (const need of x.needs) {
      if (need === 'order' || need === 'delivery') continue;      // resolved at record time
      if (!t[need]) broken.push(`${x.id} needs {${need}} and ${x.sku} has none`);
    }
    for (const o of x.onScreen) if (o.includes('{') && !fill(o, t)) broken.push(`${x.id} overlay ${o}`);
  }
  ok('every token a concept leans on has a real value', broken.length === 0, broken.join(' | '));
}

console.log('\n— Nothing here outruns the shop —');
{
  ok('no countdown or manufactured scarcity',
    !/hurry|last chance|only \d+ left|ends (today|tonight|in)|don.t miss|selling fast/i.test(src));
  ok('nothing is promised in seconds or minutes',
    !/in seconds|within minutes|in under a minute|instantly/i.test(src));
  ok('no rating, no review count, no customer count',
    !/\b\d(?:[.,]\d)?\s*\/\s*5\b|★|happy customers|trusted by \d/i.test(src));
  /* market_observations is empty, so this shop has observed no competitor
     price and may not compare itself to one. */
  ok('no comparison it has not measured',
    !/cheapest|lowest price|beat any|better than any|than anywhere/i.test(src));
  // Roblox, EA, Epic, Valve and Discord have not endorsed this shop.
  ok('no claimed relationship with a rights-holder',
    !/\b(official|authoris[ez]ed|partner(ed|ship)?)\b/i.test(src));

  /* The one number in the set that is a calculation rather than a price:
     €84.99 across twelve months against €8.99. Recomputed here so a price
     change makes this fail rather than makes the advert wrong. */
  const year = CATALOG.find((p) => p.sku === 'NITRO-1Y');
  const month = CATALOG.find((p) => p.sku === 'NITRO-1M');
  const perMonth = (year.price / 12) / 100;
  const saving = Math.round((1 - (year.price / 12) / month.price) * 100);
  ok('the Nitro per-month figure matches the catalogue',
    src.includes(`€${perMonth.toFixed(2)} a month`), `€${perMonth.toFixed(2)}`);
  ok('and so does the percentage', src.includes(`${saving}% less`), `${saving}%`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
