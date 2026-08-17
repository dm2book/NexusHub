/**
 * The costs a page load pays, pinned so they cannot creep back.
 *
 * perf-budget.test.mjs already guards the JavaScript. This guards the two
 * things that turned out to matter more, both found by measuring rather than
 * reading:
 *
 *  1. QUERIES PER REQUEST. /api/products issued 1 + one COUNT per product — 73
 *     queries for 72 products, 501 for 500. Each was a fast index scan, so it
 *     never looked slow locally; the cost is 72 sequential round trips, which on
 *     a managed Postgres in another region is seconds of pure waiting. Measured
 *     locally: 31ms → 4ms.
 *
 *  2. REQUESTS PER PAGE. /api/config is one small identical document that nine
 *     surfaces need, and each fetched it. Measured in a browser: four requests
 *     on one homepage load, three on the shop and the checkout. Now one.
 *
 * Both are the same shape of bug: correct code, repeated. Neither shows up in a
 * unit test, because every individual call is right.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_perfguard';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const fs = await import('node:fs');
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { all } = await import('../src/db/index.js');

// ── 1. Counting stock is one query, not one per product ─────────────────────
console.log('— Stock counts do not scale with the catalogue —');
{
  const src = read('../src/services/codeStockService.js');
  ok('availableCounts no longer awaits inside a loop',
    !/for \(const id of productIds\) out\[id\] = await availableCount\(id\)/.test(src),
    'the N+1 is back: one COUNT per product');
  ok('…it groups in a single statement',
    /GROUP BY product_id/.test(src) && /product_id = ANY\(@ids\)/.test(src));

  const { availableCounts, addProductCodes } = await import('../src/services/codeStockService.js');
  const { createProduct } = await import('../src/services/productService.js');

  // Behaviour must be identical, including the case the grouped query changes:
  // a product with no rows is absent from the GROUP BY and has to come back 0,
  // not undefined — "out of stock" and "unknown" render as opposite claims.
  const tag = Date.now() % 1000000;
  const withStock = await createProduct({ name: `Perf A ${tag}`, category: 'robux', price: 999, announce: false });
  const without = await createProduct({ name: `Perf B ${tag}`, category: 'robux', price: 999, announce: false });
  await addProductCodes(withStock.id, [`PERF-${tag}-1`, `PERF-${tag}-2`]);

  const counts = await availableCounts([withStock.id, without.id]);
  ok('a stocked product reports its real count', counts[withStock.id] === 2, String(counts[withStock.id]));
  ok('a product with no codes reports 0, not undefined',
    counts[without.id] === 0, String(counts[without.id]));
  ok('every id asked for comes back', Object.keys(counts).length === 2, Object.keys(counts).join(','));
  ok('an empty list does not query at all', Object.keys(await availableCounts([])).length === 0);
}

// ── 2. The indexes the hot paths need ───────────────────────────────────────
console.log('\n— Reading an order does not scan a whole table —');
{
  const rows = await all(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
  const have = new Set(rows.map((r) => r.indexname));

  // Postgres does not index a foreign-key column for you. These two carried the
  // track page, which is uncached and polls every 5 seconds while an order is in
  // flight — so each poll scanned both tables end to end.
  for (const idx of ['idx_order_items_order', 'idx_deliveries_order', 'idx_order_items_product']) {
    ok(`${idx} exists`, have.has(idx), 'the migration did not run or was reverted');
  }
  // order_status_history already had one; the other two were simply missed.
  ok('the pre-existing status-history index is still there', have.has('idx_status_hist_order'));

  const migrations = read('../src/db/migrations.js');
  ok('the index migration is declared once',
    (migrations.match(/idx_order_items_order/g) || []).length === 1);
  ok('no duplicate index on page_views.created_at',
    !/idx_page_views_created/.test(migrations),
    'idx_page_views_time already covers that column; a second one costs writes and buys nothing');
}

// ── 3. One config request per page load ─────────────────────────────────────
console.log('\n— The runtime config is fetched once, not once per component —');
{
  const shared = read('../../src/lib/useConfig.js');
  ok('there is a shared fetcher', /export function getConfig/.test(shared));
  ok('…that de-duplicates concurrent callers', /inflight/.test(shared));
  ok('…and keeps the answer for the life of the page', /cache = /.test(shared));
  ok('…and caches a failure instead of retrying in a loop',
    /catch\(\(\) => \{ cache = EMPTY/.test(shared));

  // Every consumer must go through it, or the dedupe is decorative.
  const consumers = [
    '../../src/components/SiteExtras.jsx',
    '../../src/components/store/AnnouncementBar.jsx',
    '../../src/lib/useTrustpilot.js',
    '../../src/lib/useCategoryLogos.js',
    '../../src/pages/Checkout.jsx',
    '../../src/pages/HomeStore.jsx',
    '../../src/pages/info/PaymentMethods.jsx',
    '../../src/pages/Track.jsx',
  ];
  const direct = consumers.filter((f) => /api\.get\('\/api\/config'\)/.test(read(f)));
  ok('no surface fetches /api/config directly any more', direct.length === 0,
    direct.map((f) => f.split('/').pop()).join(', '));
  const viaShared = consumers.filter((f) => /getConfig\(\)/.test(read(f)));
  ok(`all ${consumers.length} surfaces use the shared fetcher`,
    viaShared.length === consumers.length, `${viaShared.length}/${consumers.length}`);
}

// ── 4. A product page does not download the whole shop ──────────────────────
console.log('\n— One product costs one product —');
{
  const page = read('../../src/pages/ProductDetail.jsx');
  ok('the full catalogue is no longer fetched',
    !/api\.get\('\/api\/products'\)/.test(page),
    '49KB of JSON for a page that shows one product');
  ok('related items come from the recommendations route instead',
    /recommendations/.test(page));
}

// ── 5. The loading state reserves the space it is about to fill ─────────────
console.log('\n— A spinner smaller than its content is a layout shift —');
{
  const ui = read('../../src/components/ui.jsx');
  ok('PageLoader holds a viewport of height',
    /PageLoader[\s\S]{0,900}min-h-screen/.test(ui),
    'CLS on the product page was 0.518 without it');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
