/**
 * The supply side, per product.
 *
 * The supplier page that existed answered "how is each supplier doing". The
 * question an owner asks a week before launch is the other one: *which products
 * can I actually deliver, what do they cost me, and what runs out first?* — and
 * a product with no supplier at all appeared on no supplier's page, which is
 * precisely the product you needed to find.
 *
 * Most of what is asserted below is the same discipline as the profit
 * dashboard, because the same mistake is available here and it is worse: stock
 * has THREE meanings in this codebase (pre-loaded codes, what the supplier says
 * it holds, and `products.stock` — a column nothing enforces, nothing
 * decrements and nothing sells from, which the admin product table renders as
 * "∞" when it is null). Adding them, or picking the wrong one, produces a
 * dashboard that says a shop with zero deliverable codes is fully stocked.
 */
import { migrate } from '../src/db/migrate.js';
import { run, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/* Comments stripped: this service documents the bugs it avoids by quoting the
   code it refuses to write, so a raw-text assertion would happily match its own
   explanation. That has caught me three times in this repository. */
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const {
  lowStockTier, productRow, supplierRow, warningsFor, groupWarnings, supplierDashboard,
} = await import('../src/services/supplier/supplierDashboardService.js');
const { pickCostMapping, costCentsFor, costCentsForMany } =
  await import('../src/services/costService.js');
const { stockTierFor } = await import('../src/services/codeStockService.js');

const at = nowIso();
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();

const product = async (name, { price = 1000, active = 1, metaCost, stock = null } = {}) => {
  const id = newId('prd');
  await run(
    `INSERT INTO products (id, sku, name, category, description, price, currency, kind, stock, active, metadata, created_at, updated_at)
     VALUES (@id,@s,@n,'robux','t',@p,'EUR','digital',@st,@a,@m,@at,@at)`,
    { id, s: `SD-${id.slice(-8)}`, n: name, p: price, st: stock, a: active,
      m: JSON.stringify(metaCost == null ? {} : { cost: metaCost }), at });
  return id;
};
const supplier = async (name, { status = 'active', kind = 'manual', syncedAt = null, syncStatus = null } = {}) => {
  const id = newId('sup');
  await run(
    `INSERT INTO suppliers (id, name, connector_kind, status, config, last_sync_at, last_sync_status, created_at, updated_at)
     VALUES (@id,@n,@k,@st,'{}',@sa,@ss,@at,@at)`,
    { id, n: name, k: kind, st: status, sa: syncedAt, ss: syncStatus, at });
  return id;
};
const map = async (supplierId, productId, { cost = null, stock = null, priority = 100, syncedAt = at, skuStatus = null } = {}) => {
  const id = newId('sprd');
  await run(
    `INSERT INTO supplier_products (id, supplier_id, product_id, supplier_sku, cost, available_stock, supplier_status, priority, last_synced_at)
     VALUES (@id,@s,@p,@k,@c,@st,@ss,@pr,@at)`,
    { id, s: supplierId, p: productId, k: `SKU-${id.slice(-8)}`,
      c: cost, st: stock, ss: skuStatus, pr: priority, at: syncedAt });
  return id;
};
const codes = async (productId, n) => {
  for (let i = 0; i < n; i++) {
    await run(`INSERT INTO product_codes (id, product_id, code, status, created_at)
               VALUES (@id,@p,@c,'available',@at)`,
      { id: newId('pcd'), p: productId, c: `C-${productId.slice(-4)}-${i}`, at });
  }
};
const warn = (ws, code, productId) => ws.find((w) => w.code === code && w.productId === productId);

console.log('— One rule for what a product costs —');
{
  /* The cost pick used to live only inside a query's ORDER BY, so a second
     reader had to restate it. Restating it is how the column name drifted four
     ways in the first place. */
  const m = (o) => ({ supplier_status: 'active', cost: 100, priority: 100, last_synced_at: at, ...o });
  ok('a paused supplier does not set the cost',
    pickCostMapping([m({ supplier_status: 'paused', cost: 50 })]) === null);
  ok('a mapping with no cost does not set the cost',
    pickCostMapping([m({ cost: null })]) === null);
  ok('the lower priority number wins',
    pickCostMapping([m({ cost: 900, priority: 50 }), m({ cost: 100, priority: 10 })]).cost === 100);
  ok('…and on equal priority, the most recently synced',
    pickCostMapping([m({ cost: 900, last_synced_at: ago(9) }), m({ cost: 100, last_synced_at: at })]).cost === 100);
  ok('a never-synced mapping loses to one that has synced',
    pickCostMapping([m({ cost: 900, last_synced_at: null }), m({ cost: 100 })]).cost === 100);

  const p = await product('cost rule', { metaCost: 700 });
  const s = await supplier('Cost Co');
  ok('with no mapping, the hand-entered cost is used', (await costCentsFor(p)) === 700);
  await map(s, p, { cost: 400 });
  ok('a supplier mapping overrides it — it is what the shop pays NOW',
    (await costCentsFor(p)) === 400);

  /* The single and the bulk reader must be the SAME reader, not two that agree
     today. costCentsFor is literally costCentsForMany with one id. */
  const p2 = await product('cost rule 2', { metaCost: 250 });
  const p3 = await product('cost rule 3');
  const many = await costCentsForMany([p, p2, p3]);
  ok('the bulk reader agrees with the single one, product by product',
    many[p] === (await costCentsFor(p))
    && many[p2] === (await costCentsFor(p2))
    && many[p3] === (await costCentsFor(p3)), JSON.stringify(many));
  ok('…and a product with no cost anywhere is null, not 0', many[p3] === null, String(many[p3]));
  ok('the single reader delegates rather than re-implementing',
    /costCentsForMany\(\[productId\]\)/.test(codeOf('server/src/services/costService.js')));
}

console.log('\n— Three things called stock, kept apart —');
{
  const p = await product('stock kinds', { stock: 9999 });   // the decorative column
  const s = await supplier('Stock Co');
  await map(s, p, { cost: 300, stock: 4 });
  await codes(p, 2);
  const d = await supplierDashboard();
  const row = d.products.find((r) => r.productId === p);
  ok('the shelf is counted from product_codes', row.codeStock === 2, String(row.codeStock));
  ok('what the supplier claims is reported separately', row.supplierStock === 4, String(row.supplierStock));
  ok('products.stock is reported but never mixed in', row.declaredStock === 9999);
  ok('…and the three are never added together',
    row.codeStock + row.supplierStock + row.declaredStock !== row.codeStock
    && !/codeStock\s*\+\s*supplierStock/.test(codeOf('server/src/services/supplier/supplierDashboardService.js')));

  const never = await product('never reported');
  const s2 = await supplier('Silent Co');
  await map(s2, never, { cost: 100 });          // no available_stock at all
  const d2 = await supplierDashboard();
  const r2 = d2.products.find((r) => r.productId === never);
  ok('a supplier that never reported stock is null, not 0', r2.supplierStock === null, String(r2.supplierStock));
}

console.log('\n— Per supplier: products, stock value, average cost —');
{
  const s = await supplier('Rollup Co', { syncedAt: ago(1), syncStatus: 'success' });
  const a = await product('rollup a');
  const b = await product('rollup b');
  const c = await product('rollup c');
  await map(s, a, { cost: 500, stock: 3 });     // valued: 1500
  await map(s, b, { cost: 300, stock: 10 });    // valued: 3000
  await map(s, c, { cost: 900 });               // cost known, stock unknown

  const d = await supplierDashboard();
  const row = d.suppliers.find((x) => x.id === s);
  ok('product count is the mappings that point at a product', row.products === 3, String(row.products));
  ok('stock value multiplies cost by units, over the mappings with both',
    row.stockValueCents === 4500, String(row.stockValueCents));
  ok('…and says how much of the supplier it actually covered',
    row.stockValueCoverage.counted === 2 && row.stockValueCoverage.total === 3,
    JSON.stringify(row.stockValueCoverage));
  ok('the mapping with unknown stock is NOT valued at zero units',
    row.stockValueCents !== 4500 + 0 * 900 || row.stockValueCoverage.counted === 2);
  ok('average cost is over the mappings that have one', row.avgCostCents === 567, String(row.avgCostCents));
  ok('stock units count only what was reported', row.stockUnits === 13, String(row.stockUnits));
  ok('the last sync is carried through', row.lastSyncStatus === 'success' && !!row.lastSyncAt);

  const empty = await supplier('Empty Co');
  const d2 = await supplierDashboard();
  const er = d2.suppliers.find((x) => x.id === empty);
  ok('a supplier with nothing mapped has no stock VALUE, rather than €0.00',
    er.stockValueCents === null && er.avgCostCents === null && er.stockUnits === null);

  const unmapped = await supplier('Catalogue Co');
  await run(`INSERT INTO supplier_products (id, supplier_id, product_id, supplier_sku, cost, priority)
             VALUES (@id,@s,NULL,'FLOATING',100,100)`, { id: newId('sprd'), s: unmapped });
  const d3 = await supplierDashboard();
  const ur = d3.suppliers.find((x) => x.id === unmapped);
  ok('a SKU mapped to no product counts as unmapped, not as a product',
    ur.products === 0 && ur.unmappedSkus === 1, JSON.stringify([ur.products, ur.unmappedSkus]));
}

console.log('\n— The three warnings that were asked for —');
{
  const d = await supplierDashboard();
  const bare = await product('no supplier no codes');
  const withCodes = await product('no supplier but codes');
  await codes(withCodes, 40);
  const noCost = await product('supplier without cost');
  const s = await supplier('Warn Co');
  await map(s, noCost, { cost: null, stock: 5 });
  const low = await product('running out');
  await map(s, low, { cost: 100, stock: 200 });
  await codes(low, 3);

  const w = (await supplierDashboard()).warnings;
  ok('a product with no supplier AND no codes is critical, not a warning',
    warn(w, 'NO_SUPPLY', bare)?.severity === 'critical');
  ok('…and says what actually happens to a paid order',
    /manual queue/.test(warn(w, 'NO_SUPPLY', bare).detail));
  ok('a product with codes but no supplier is informational — it DOES deliver',
    warn(w, 'NO_SUPPLIER', withCodes)?.severity === 'info');
  ok('…and names the thing that runs out', /40 pre-loaded code/.test(warn(w, 'NO_SUPPLIER', withCodes).detail));
  ok('a missing cost price is warned about', !!warn(w, 'NO_COST', noCost));
  ok('…saying which numbers it costs you', /margin/.test(warn(w, 'NO_COST', noCost).detail));
  ok('low code stock is warned about', !!warn(w, 'LOW_STOCK', low));
  ok('…at the tier the Discord alert uses, not a second hand-written number',
    warn(w, 'LOW_STOCK', low).detail.includes(`below the ${stockTierFor(3)} mark`),
    warn(w, 'LOW_STOCK', low).detail);
  ok('the shared tier function is imported rather than re-derived',
    /import \{ stockTierFor \}/.test(read('server/src/services/supplier/supplierDashboardService.js')));
  ok('a product with a costed, stocked supplier and codes is not warned about at all',
    !w.some((x) => x.productId === low && x.code === 'NO_COST'));
  ok('warnings are ordered worst first',
    w.every((x, i) => i === 0 || ({ critical: 0, warn: 1, info: 2 })[w[i - 1].severity]
      <= ({ critical: 0, warn: 1, info: 2 })[x.severity]));
  ok('the empty shop before any of this had warnings too — it is not silent when broken',
    Array.isArray(d.warnings));
}

console.log('\n— The warnings that would drown the list —');
{
  const off = await product('discontinued', { active: 0 });
  const w = (await supplierDashboard()).warnings;
  ok('an inactive product raises nothing — nobody can buy it',
    !w.some((x) => x.productId === off), JSON.stringify(w.filter((x) => x.productId === off)));

  /* One product, three missing things, is three facts. It used to be easy to
     emit nine: a route warning, a cost warning and a stock warning each in two
     flavours. */
  const broke = await product('nothing at all');
  const w2 = (await supplierDashboard()).warnings.filter((x) => x.productId === broke);
  ok('a product with no supplier, no cost and no codes raises exactly two warnings',
    w2.length === 2, JSON.stringify(w2.map((x) => x.code)));
  ok('…the route one and the cost one, not a third about its empty shelf',
    w2.some((x) => x.code === 'NO_SUPPLY') && w2.some((x) => x.code === 'NO_COST')
    && !w2.some((x) => x.code === 'OUT_OF_CODES'));

  /* A product sourced live from a supplier is SUPPOSED to hold no codes. */
  const live = await product('sourced live');
  const s = await supplier('Live Co', { kind: 'api' });
  await map(s, live, { cost: 250, stock: 500 });
  const w3 = (await supplierDashboard()).warnings.filter((x) => x.productId === live);
  ok('a live-sourced product with zero codes is not called out of stock',
    w3.length === 0, JSON.stringify(w3.map((x) => x.code)));
}

console.log('\n— A supplier that exists on paper and not in practice —');
{
  const p = await product('paused supply');
  const s = await supplier('Paused Co', { status: 'paused' });
  await map(s, p, { cost: 400, stock: 10 });
  const d = await supplierDashboard();
  const row = d.products.find((r) => r.productId === p);
  const w = d.warnings;
  ok('the product is flagged as having only paused suppliers', !!warn(w, 'SUPPLIER_PAUSED', p));
  ok('…as critical, because there are no codes either',
    warn(w, 'SUPPLIER_PAUSED', p).severity === 'critical');
  ok('a paused supplier does not supply the cost', row.costCents === null, String(row.costCents));
  ok('…and the row says the cost is unknown rather than showing the paused number',
    row.costSource === null);
  ok('nothing would route to it', row.fulfilSupplierId === null);

  const out = await product('supplier says none left');
  const s2 = await supplier('Out Co');
  await map(s2, out, { cost: 400, stock: 0 });
  const d2 = await supplierDashboard();
  ok('a supplier reporting zero stock cannot fulfil', 
    d2.products.find((r) => r.productId === out).fulfilSupplierId === null);
  ok('…and that is critical when there are no codes to fall back on',
    warn(d2.warnings, 'SUPPLIER_OUT_OF_STOCK', out)?.severity === 'critical');
  ok('…but its cost still counts — we know what it costs, we just cannot buy it today',
    d2.products.find((r) => r.productId === out).costCents === 400);

  const sick = await product('supplier says out');
  await map(s2, sick, { cost: 400, stock: 50, skuStatus: 'out_of_stock' });
  const d3 = await supplierDashboard();
  ok('a SKU flagged out_of_stock is not routable even with units on it',
    d3.products.find((r) => r.productId === sick).fulfilSupplierId === null);
}

console.log('\n— Buying from one supplier and being billed by another —');
{
  const p = await product('split');
  const cheap = await supplier('Cheap but empty');
  const stocked = await supplier('Pricier but has it');
  await map(cheap, p, { cost: 100, stock: 0, priority: 10 });
  await map(stocked, p, { cost: 900, stock: 50, priority: 20 });
  const row = (await supplierDashboard()).products.find((r) => r.productId === p);
  /* The cost pick and the fulfilment pick are different rules with different
     gates. When they disagree, the margin on the screen is not the margin on
     the order — so the row says so instead of quietly picking one. */
  ok('the cost still comes from the cheapest active mapping', row.costCents === 100);
  ok('…but the order would be filled by the one that has it',
    row.fulfilSupplierId === stocked, row.fulfilSupplierId);
  ok('…and the row admits the two are different', row.costFulfilSplit === true);
  ok('the supplier shown is the one whose cost is on the row, so the two agree',
    row.supplier.id === cheap);
}

console.log('\n— Totals that can say "I do not know" —');
{
  const d = await supplierDashboard();
  ok('totals count active products only where it matters',
    d.totals.activeProducts < d.totals.products, JSON.stringify(d.totals));
  ok('stock value coverage is stated next to the stock value',
    d.totals.stockValueCoverage.counted < d.totals.stockValueCoverage.total,
    JSON.stringify(d.totals.stockValueCoverage));
  ok('the low-stock tier the page warns at is published with the data',
    d.lowStockTier === lowStockTier() && d.lowStockTier > 0, String(d.lowStockTier));

  const pure = {
    products: [], suppliers: [],
    row: productRow({ id: 'x', name: 'x', price: 100, active: 1, metadata: '{}' }, [], 0),
    sup: supplierRow({ id: 's', name: 's', connector_kind: 'manual', status: 'active' }, []),
  };
  ok('a product with nothing at all has a null cost, not zero', pure.row.costCents === null);
  ok('…and no supplier, rather than an empty one', pure.row.supplier === null);
  ok('…and a shelf of zero, which IS known', pure.row.codeStock === 0);
  ok('an empty supplier values at null', pure.sup.stockValueCents === null);
  ok('warningsFor on nothing is an empty list, not a crash', warningsFor([]).length === 0);
}


console.log('\n— A warning list long enough to be ignored is not a warning list —');
{
  /* Measured, not guessed: rendered one row per product against a seeded copy
     of this catalogue, the list came out at 124 rows over 72 products — 116 of
     them the same two sentences. A shop that has entered no costs yet gets one
     amber row per product, which reads exactly as fast as no rows at all. */
  const many = Array.from({ length: 9 }, (_, i) => ({
    code: 'NO_COST', severity: 'warn', productId: `p${i}`, name: `Product ${i}`, detail: 'x',
  }));
  const g = groupWarnings(many);
  ok('nine of the same warning collapse to one line', g.length === 1, String(g.length));
  ok('…that counts them', g[0].count === 9);
  ok('…and names a few so it is actionable', g[0].names.length === 4);
  ok('…with a sentence that is true of all nine, not of one',
    /9 active products have no cost price/.test(g[0].detail), g[0].detail);
  ok('…and no productId, because it is about nine of them', g[0].productId === null);

  const few = many.slice(0, 3);
  ok('three stay individual — naming them is more useful than counting them',
    groupWarnings(few).length === 3);

  /* A code that is critical for two products and info for twenty must not be
     filed under "info" because most of it is. */
  const mixed = [
    ...Array.from({ length: 8 }, (_, i) => ({ code: 'NO_SUPPLIER', severity: 'info', productId: `i${i}`, name: `I${i}`, detail: 'x' })),
    { code: 'NO_SUPPLIER', severity: 'critical', productId: 'c1', name: 'C1', detail: 'x' },
  ];
  ok('the worst severity in a group wins the group',
    groupWarnings(mixed)[0].severity === 'critical');
  ok('groups are ordered worst first, then biggest',
    groupWarnings([...many, ...mixed])[0].severity === 'critical');

  const d = await supplierDashboard();
  ok('the dashboard publishes both the groups and the full list',
    Array.isArray(d.warningGroups) && Array.isArray(d.warnings));
  ok('…and the groups account for every warning',
    d.warningGroups.reduce((a, w) => a + w.count, 0) === d.warnings.length,
    `${d.warningGroups.reduce((a, w) => a + w.count, 0)} vs ${d.warnings.length}`);
  ok('grouping nothing yields nothing', groupWarnings([]).length === 0);
}

console.log('\n— Wiring —');
{
  const route = read('server/src/routes/admin/suppliers.js');
  const iDash = route.indexOf("router.get('/dashboard'");
  const iId = route.indexOf("router.get('/:id'");
  ok('the dashboard route exists', iDash > 0);
  /* Express matches in declaration order: below `/:id`, GET /dashboard is read
     as a supplier whose id is the word "dashboard" and 404s. */
  ok('…and is declared ABOVE /:id, or it is never reached', iDash < iId, `${iDash} vs ${iId}`);
  ok('it is behind the suppliers.read permission',
    /router\.get\('\/dashboard', requirePermission\('suppliers\.read'\)/.test(route));

  const page = read('src/pages/admin/Suppliers.jsx');
  const panel = codeOf('src/components/admin/SupplyDashboard.jsx');
  ok('the admin panel loads it', /\/api\/admin\/suppliers\/dashboard/.test(panel));
  ok('…and renders the grouped warnings, not one row per product',
    /warningGroups\.map/.test(panel) && !/d\.warnings\.slice/.test(panel));
  ok('…and the supplier page renders the panel',
    /import SupplyDashboard/.test(page) && /<SupplyDashboard \/>/.test(page));
  /* The admin shell is DARK — `theme-light` is applied by StoreLayout, not here.
     Measured on #101019: slate-900 is 1.06:1, slate-800 1.29:1, slate-700
     1.83:1. Text at those values is in the DOM and not on the screen. */
  ok('the panel uses no light-theme text colours on the dark admin card',
    !/text-slate-(700|800|900)/.test(panel),
    (panel.match(/text-slate-(700|800|900)/g) || []).join(','));
  for (const f of ['src/pages/admin/Profit.jsx', 'src/pages/admin/Market.jsx',
                   'src/pages/admin/Suppliers.jsx', 'src/pages/admin/Analytics.jsx']) {
    const src = codeOf(f);
    ok(`…nor does ${f.split('/').pop()}`, !/text-slate-(700|800|900)/.test(src),
      (src.match(/text-slate-(700|800|900)/g) || []).length + ' occurrence(s)');
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} supplier-dashboard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
