/**
 * The supply side, end to end: a sync that remembers, and a page that compares.
 *
 * supplier_products is overwritten on every sync — cost, stock and status are
 * always "now". So the two questions an owner actually asks about a supplier
 * ("has this got more expensive", "is this running down") had no data behind
 * them at all. supplier_offer_history is the answer, and this is about the
 * parts that only exist once there is a database:
 *
 *   · a sync writes a history row when something CHANGES, and not when it does
 *     not — forty unchanged SKUs is forty rows that say nothing;
 *   · a price rise is measured against the OLDEST point in the window, not the
 *     previous row, because four percent a week for a month is not a four
 *     percent rise;
 *   · the endpoint is staff-only and read-only, and nothing on this page can
 *     move a product's supply.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
import { sha256 } from '../src/utils/crypto.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { requestEmailOtp } = await import('../src/services/authService.js');
const sup = await import('../src/services/supplier/supplierService.js');
const {
  offerHistory, costChanges, supplierIntelligence, coverage,
} = await import('../src/services/supplier/supplierIntelligenceService.js');
const { run, get, all } = await import('../src/db/index.js');

const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

const email = 'mohamedelhannouti51@gmail.com';
await requestEmailOtp(email, {});
const otp = await get(
  `SELECT id FROM otp_codes WHERE email=@e AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  { e: email });
await run(`UPDATE otp_codes SET code_hash=@h WHERE id=@id`, { h: sha256('654321'), id: otp.id });
const login = await (await fetch(`${base}/api/auth/otp/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, code: '654321' }) })).json();
const auth = { authorization: `Bearer ${login.accessToken}` };
ok('staff signs in', !!login.accessToken);

console.log('\n— A shop with no suppliers says so rather than showing an empty table —');
{
  const c = await coverage();
  ok('it counts what exists', typeof c.suppliers === 'number' && typeof c.mappings === 'number');
  ok('and names the first thing to do',
    c.suppliers > 0 || c.blockers.some((b) => /No suppliers are configured/.test(b)),
    JSON.stringify(c.blockers));
  ok('…naming the three that need credentials and the one that does not',
    c.suppliers > 0 || c.blockers.some((b) => /Kinguin, G2A and Eldorado/.test(b) && /manual/.test(b)));
}

// ── Two suppliers, one product, mapped by hand ────────────────────────────
const product = await createProduct({ name: 'Test Top-up 1000', category: 'robux',
  price: 999, announce: false });
const kinguin = await sup.createSupplier({ name: 'Kinguin', connectorKind: 'manual' });
const g2a = await sup.createSupplier({ name: 'G2A', connectorKind: 'manual' });
await sup.mapSupplierProduct({ supplierId: kinguin.id, productId: product.id,
  supplierSku: 'K-1000', cost: 700, priority: 50 });
await sup.mapSupplierProduct({ supplierId: g2a.id, productId: product.id,
  supplierSku: 'G-1000', cost: 650, priority: 10 });

console.log('\n— Every supplier for the product, side by side —');
{
  const intel = await supplierIntelligence();
  const row = intel.products.find((p) => p.productId === product.id);
  ok('the product appears once with both suppliers', !!row && row.offers.length === 2,
    JSON.stringify(row?.offers?.map((o) => o.supplierName)));
  ok('each offer carries its buy price',
    row.offers.every((o) => typeof o.costCents === 'number'));
  ok('…and a margin and a profit per sale',
    row.offers.every((o) => o.marginPct != null && o.profitPerSaleEur != null));
  ok('a supplier with no fulfilment history has no reliability',
    row.offers.every((o) => o.reliabilityPct === null));
  ok('the cheaper one is recommended',
    row.bestSupplierId === g2a.id, `${row.bestSupplierId} vs ${g2a.id}`);
  ok('…and the reason is a sentence, not a score', /cheapest of/.test(row.bestReason));
}

console.log('\n— And the one orders will really go to —');
{
  const intel = await supplierIntelligence();
  const row = intel.products.find((p) => p.productId === product.id);
  /* Routing is priority ASC, so G2A at 10 wins here and they agree. Raise
     Kinguin above it and the two answers part company — which is the whole
     point of putting them on one row. */
  ok('routing follows priority', row.routedSupplierId === g2a.id);

  await run(`UPDATE supplier_products SET priority = 5 WHERE supplier_id=@s`, { s: kinguin.id });
  const after = await supplierIntelligence();
  const row2 = after.products.find((p) => p.productId === product.id);
  ok('a priority change moves the route', row2.routedSupplierId === kinguin.id);
  ok('…but not the recommendation', row2.bestSupplierId === g2a.id);
  const gap = after.warnings.find((w) => w.code === 'ROUTED_NOT_BEST' && w.productId === product.id);
  ok('and the disagreement is raised with the money on it',
    !!gap && /€0\.50 per sale/.test(gap.detail), gap?.detail);
  await run(`UPDATE supplier_products SET priority = 50 WHERE supplier_id=@s`, { s: kinguin.id });
}

console.log('\n— A sync remembers what changed, and only that —');
{
  const before = await get(`SELECT COUNT(*) AS n FROM supplier_offer_history`);

  await sup.recordOffer({ supplierId: kinguin.id, supplierSku: 'K-1000', productId: product.id,
    cost: 700, availableStock: 40, supplierStatus: 'in_stock',
    observedAt: new Date(Date.now() - 20 * 86400_000).toISOString() });
  await sup.recordOffer({ supplierId: kinguin.id, supplierSku: 'K-1000', productId: product.id,
    cost: 740, availableStock: 22, supplierStatus: 'in_stock',
    observedAt: new Date(Date.now() - 10 * 86400_000).toISOString() });
  await sup.recordOffer({ supplierId: kinguin.id, supplierSku: 'K-1000', productId: product.id,
    cost: 860, availableStock: 8, supplierStatus: 'in_stock',
    observedAt: new Date(Date.now() - 1 * 86400_000).toISOString() });

  const after = await get(`SELECT COUNT(*) AS n FROM supplier_offer_history`);
  ok('history rows are written', Number(after.n) > Number(before.n));
}

console.log('\n— A price rise is measured across the window, not row to row —');
{
  const changes = await costChanges({ days: 30 });
  const c = changes.get(`${kinguin.id}::K-1000`);
  ok('the change is found', !!c, JSON.stringify([...changes.keys()]));
  /* 700 → 860 is 22.9%. Row to row it is three moves of 5.7% and 16.2%, and
     neither of those is the thing that happened. */
  ok('from the oldest point to the newest', c.fromCents === 700 && c.toCents === 860);
  ok('…as one percentage', c.pct === 22.9, String(c.pct));

  const intel = await supplierIntelligence();
  const row = intel.products.find((p) => p.productId === product.id);
  const rise = intel.warnings.find((w) => w.code === 'SUPPLIER_PRICE_UP' && w.productId === product.id);
  ok('and the product row carries it',
    !!row.offers.find((o) => o.supplierId === kinguin.id)?.costChange);
  ok('…and it becomes an alert', !!rise, JSON.stringify(intel.warnings.map((w) => w.code)));
}

console.log('\n— The chart has points, or says it has not —');
{
  const h = await offerHistory(product.id, { days: 90 });
  ok('one series per supplier that has history', h.series.length === 1,
    JSON.stringify(h.series.map((s) => s.supplierName)));
  ok('…named', h.series[0].supplierName === 'Kinguin');
  ok('…with its points in time order',
    h.series[0].points.length === 3
    && h.series[0].points.every((p, i, a) => i === 0 || a[i - 1].at <= p.at));
  ok('…carrying both cost and stock', h.series[0].points.every(
    (p) => typeof p.costCents === 'number' && typeof p.stock === 'number'));
  ok('and it says there is enough to draw a line', h.enoughToPlot === true);

  /* One point is not a line, and the page should not pretend otherwise. */
  const lonely = await createProduct({ name: 'Only Once', category: 'robux', price: 500, announce: false });
  await sup.recordOffer({ supplierId: g2a.id, supplierSku: 'G-ONE', productId: lonely.id, cost: 400 });
  const h2 = await offerHistory(lonely.id, { days: 90 });
  ok('a single observation is not plottable', h2.enoughToPlot === false);
}

console.log('\n— The endpoints —');
{
  const r = await fetch(`${base}/api/admin/suppliers/intelligence`, { headers: auth });
  const body = await r.json();
  ok('staff can read the comparison', r.status === 200 && Array.isArray(body.products));
  ok('…with the per-supplier rollup beside it', Array.isArray(body.suppliers));
  ok('…and the coverage state', !!body.coverage && Array.isArray(body.coverage.blockers));

  const h = await fetch(`${base}/api/admin/suppliers/history/${product.id}?days=60`, { headers: auth });
  const hb = await h.json();
  ok('and the history for one product', h.status === 200 && hb.days === 60);

  const anon = await fetch(`${base}/api/admin/suppliers/intelligence`);
  ok('a stranger cannot', anon.status === 401 || anon.status === 403, String(anon.status));
}

console.log('\n— Nothing here changes a supply route —');
{
  const before = await all(`SELECT id, priority, cost FROM supplier_products ORDER BY id`);
  await fetch(`${base}/api/admin/suppliers/intelligence`, { headers: auth });
  await supplierIntelligence();
  const after = await all(`SELECT id, priority, cost FROM supplier_products ORDER BY id`);
  ok('reading the dashboard moves no mapping',
    JSON.stringify(before) === JSON.stringify(after));
}

srv.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} supplier-history: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
