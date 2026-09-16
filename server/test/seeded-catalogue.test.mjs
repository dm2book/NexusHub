/**
 * The catalogue baked into the HTML, and the rules that keep it safe.
 *
 * earlyFetch already starts the products request while the HTML is parsing.
 * That removes the wait for React to boot before ASKING; it cannot remove the
 * asking. The shelves still could not paint until a round trip to a serverless
 * function and a database in another datacentre came back, which on a slow
 * answer is the whole first second a visitor spends looking at nothing.
 *
 * Measured on this page, first product tile on screen:
 *
 *                                    before      after
 *     normal                          212ms      169ms
 *     API 2.5s slow                  2551ms      131ms
 *     …and a 4× slower CPU           2657ms      496ms
 *
 * The API's speed stopped gating the first paint, because the first paint no
 * longer waits for the API.
 *
 * Three things make that safe, and each is checked below:
 *
 *   · nothing seeded is ever ACTED on — the server prices every order from its
 *     own row, so a stale label is corrected before anyone can buy at it;
 *   · the live request still runs and replaces what was baked;
 *   · a build with no database bakes nothing and every page behaves exactly as
 *     it did before. This layer may only ever remove waiting.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const prerender = read('scripts/prerender.mjs');
const seed = read('src/lib/seed.js');
const home = read('src/pages/HomeStore.jsx');
const shop = read('src/pages/Shop.jsx');

console.log('— A stale label can never become a wrong charge —');
{
  /* This is the assumption the whole idea rests on. If the checkout ever
     started trusting a price from the browser, seeding the browser with a
     price from last week would become a way to buy at last week's price. */
  const order = read('server/src/services/orderService.js');
  ok('the server prices an order from its own row',
    /const unit = product\.price;/.test(order), 'the checkout may be trusting the client');
  ok('…for a product it looked up by id, not one it was handed',
    /const product = await getProduct\(li\.productId\)/.test(order));
  ok('…and refuses an inactive one', /if \(!product\.active\)/.test(order));
}

console.log('\n— The live answer always wins —');
{
  ok('the homepage still asks', /withEarly\('products'/.test(home));
  ok('…and replaces what was baked', /setProducts\(withFallback\(r\.products\)\)/.test(home));
  ok('the shop still asks', /withEarly\('products'/.test(shop));
  ok('…and replaces what was baked', /setProducts\(withFallback\(r\.products\)\)/.test(shop));

  /* Read in a useState initialiser, not an effect. An effect runs after the
     first paint, which is the exact frame this exists to fill. */
  ok('the seed is read before the first paint, not after',
    /useState\(\(\) => readSeed\('products'\)/.test(home)
    && /useState\(\(\) => readSeed\('products'\)\)/.test(shop),
    'it is being read in an effect, which is one paint too late');
}

console.log('\n— Missing is a normal state, not a broken one —');
{
  ok('a build with no database bakes nothing rather than failing',
    /catch \(err\) \{[\s\S]{0,200}?return null;/.test(prerender),
    'the build would fail without a database');
  ok('…and says so, so nobody wonders why it is slow',
    /no catalogue baked in/.test(prerender));
  ok('reading a seed that is not there returns null',
    /if \(typeof window === 'undefined'\) return null;/.test(seed) && /catch \{/.test(seed));
  ok('the page that was not seeded still knows it is waiting',
    /useState\(\(\) => !readSeed\('products'\)\)/.test(home));
}

console.log('\n— Only what needs it, and only what it needs —');
{
  /* 40KB of JSON in the privacy policy buys nothing and costs every reader of
     it. */
  ok('only the routes that draw products carry the catalogue',
    /SEEDED_ROUTES = new Set\(\['\/', '\/shop', \.\.\.Object\.keys\(LANDING\)\]\)/.test(prerender));
  /* The full row is 69KB — stock bookkeeping, image geometry, timestamps.
     Nothing on a shelf reads any of it. */
  for (const field of ['metadata', 'created_at', 'updated_at', 'low_stock_alerted_at', 'imageScale'])
    ok(`${field} is not baked into every page`,
      !new RegExp(`${field}: full\\.`).test(prerender));
  for (const field of ['name', 'price', 'image', 'stockLeft', 'instant', 'descriptionDe'])
    ok(`${field} is`, new RegExp(`${field}: full\\.`).test(prerender));

  /* An inline <script> holding JSON is a place to end a tag early. */
  ok('the blob cannot break out of its own script tag',
    /replace\(\/<\/g/.test(prerender) && /u2028/.test(prerender),
    'a product name containing </script> would break the page');
}

console.log('\n— The product page was the last one still waiting —');
{
  /* Every other route came in under 300ms against a slow API. The product page
     took 2,162ms, because the product the API inlines into the HTML only
     exists on a DIRECT hit — and the common path is not a direct hit, it is
     clicking a card in the shop, which is a client-side navigation with no new
     HTML at all. Measured on that journey with the API 2s slow:
     3,063ms → 608ms. */
  const detail = read('src/pages/ProductDetail.jsx');
  ok('the product page falls back to the catalogue in the page',
    /readSeed\('products'\)/.test(detail), 'a client-side navigation still waits for the API');
  ok('…and the inlined product still wins where there is one',
    /if \(BOOT\) \{[\s\S]{0,160}?if \(BOOT\.id === id\) return BOOT;/.test(detail));
  /* Dropping it when the id differs is what stops every product page after
     the first from flashing the one the visitor originally landed on. */
  ok('…and is dropped the moment a different product is asked for',
    /BOOT = null;/.test(detail));
  ok('the seeded copy is looked up BY ID, never just the first one',
    /\.find\(\(p\) => p && p\.id === id\)/.test(detail),
    'this could show the wrong product, which is worse than showing none');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} seeded-catalogue: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
