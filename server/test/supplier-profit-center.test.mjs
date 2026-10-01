/**
 * Supplier Profit Center: per product, Kinguin / G2A / Eneba / Eldorado —
 * winst, marge, BTW, Stripe, netto winst — and BEST PROFIT, BEST PRICE,
 * BEST STOCK.
 *
 * What it must not do:
 *   show a price nobody observed — a marketplace with nothing is "not
 *   available", with the reason;
 *   use a listing older than a week as if it were today's;
 *   call the cheapest source the most profitable when it is sold out;
 *   disagree with the margin every other admin page uses;
 *   take the Stripe fee off the price excluding BTW — Stripe charges on what
 *   the buyer paid.
 */
import './_selling-shop.mjs';   // must come first — see that file
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { config } = await import('../src/config/env.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { createProduct } = await import('../src/services/productService.js');
const { createSupplier, mapSupplierProduct } = await import('../src/services/supplier/supplierService.js');
const { recordObservation } = await import('../src/services/market/observations.js');
const { marginAt } = await import('../src/services/market/pricing.js');
const spc = await import('../src/services/supplier/supplierProfitService.js');

const stamp = Date.now();
const cfg = config.market;

console.log('\n— The sum —');
{
  ok('fees under test are the defaults: 2.9% + €0.29', cfg.paymentFeePercent === 2.9 && cfg.paymentFixedFee === 0.29);
  const b = spc.breakdown(2000, 1100, { vatPct: 21 });
  ok('winst: price minus purchase', b.profitCents === 900);
  ok('BTW impact: 21% inside a €20 price is €3.47', b.vatCents === 347, String(b.vatCents));
  ok('Stripe: 2.9% of the FULL €20 plus €0.29 is €0.87', b.stripeCents === 87, String(b.stripeCents));
  ok('netto winst = winst − BTW − Stripe', b.netProfitCents === 900 - 347 - 87 && b.netProfitCents === 466);
  ok('marge over the price excluding BTW', b.marginPct === 28.2, String(b.marginPct));
  const m = marginAt(20, 11, { ...cfg, vatPercent: 21 });
  ok('the same answer as the margin every other page uses', Math.abs(m.profitEur * 100 - b.netProfitCents) <= 1,
    `${m.profitEur} vs ${b.netProfitCents}`);
  /* The bug this round fixed: marginAt took the fee off €16.53, not €20. */
  ok('…which now charges the fee on the full price too', m.profitEur === 4.66, String(m.profitEur));
  ok('no cost, no sum', spc.breakdown(2000, null) === null && spc.breakdown(0, 500) === null);
}

const product = (name, price) => createProduct({ name, sku: `SPC-${name.replace(/\W+/g, '')}-${stamp}`, category: 'robux',
  price, currency: 'EUR', active: true, announce: false });
const kinguin = await createSupplier({ name: 'Kinguin', connectorKind: 'kinguin', config: {} });
const g2a = await createSupplier({ name: 'G2A', connectorKind: 'g2a', config: {} });
const eldorado = await createSupplier({ name: 'Eldorado', connectorKind: 'csv', config: {} });   // named, not by connector
const wholesale = await createSupplier({ name: 'Some Wholesaler', connectorKind: 'csv', config: {} });

async function map(s, p, cost, { priority = 20, status = 'in_stock', stock = null } = {}) {
  await mapSupplierProduct({ supplierId: s.id, productId: p.id, supplierSku: `${s.name}-${p.id}`, cost, priority });
  await run(`UPDATE supplier_products SET supplier_status=@st, available_stock=@n WHERE supplier_id=@s AND product_id=@p`,
    { st: status, n: stock, s: s.id, p: p.id });
}
async function listing(source, p, cents, { availability = 'in_stock', hoursAgo = 0 } = {}) {
  const title = `${p.name} ${stamp}`;
  const r = await recordObservation(source, { title, priceCents: cents, currency: 'EUR',
    url: `https://${source}.test/item`, availability });
  await run(`INSERT INTO market_candidates (id, market_product_id, forge_product_id, status, created_at, updated_at)
             VALUES (@id, @mp, @fp, 'product_created', @at, @at) ON CONFLICT (market_product_id) DO UPDATE SET forge_product_id=@fp`,
    { id: newId('mkc'), mp: r.marketProductId, fp: p.id, at: nowIso() });
  if (hoursAgo) {
    await run(`UPDATE market_observations SET observed_at=@at WHERE market_product_id=@mp AND source_key=@s`,
      { at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(), mp: r.marketProductId, s: source });
  }
}

// A: four sources, three different winners.
const A = await product('Robux 20 SPC', 2000);
await map(kinguin, A, 1200, { priority: 10, stock: 5 });                // current
await map(g2a, A, 1000, { status: 'out_of_stock', stock: 0 });          // cheapest, sold out
await map(eldorado, A, 1100, { stock: 50 });                            // best in stock, most stock
await listing('eneba', A, 1150);                                        // listing only
// B: only one source, and it loses money.
const B = await product('Tiny Topup SPC', 500);
await map(kinguin, B, 480, { priority: 10, stock: 3 });
// C: nothing anywhere.
const C = await product('Nowhere SPC', 1500);
// D: an Eneba listing from ten days ago.
const D = await product('Stale SPC', 1500);
await listing('eneba', D, 900, { hoursAgo: 240 });
// E: Kinguin paused; bought now from a wholesaler outside the four.
const E = await product('Paused SPC', 3000);
await map(wholesale, E, 2400, { priority: 10 });
const kinguin2 = await createSupplier({ name: 'Kinguin (second account)', connectorKind: 'kinguin', config: {} });
await map(kinguin2, E, 1500);
await run(`UPDATE suppliers SET status='paused' WHERE id=@id`, { id: kinguin2.id });

const r = await spc.supplierProfitCenter({ productIds: [A.id, B.id, C.id, D.id, E.id] });
const row = (p) => r.products.find((x) => x.productId === p.id);
const cell = (p, k) => row(p).offers.find((o) => o.key === k);

console.log('\n— Per product, the four side by side —');
{
  const a = row(A);
  ok('all four marketplaces, in order', a.offers.map((o) => o.key).join() === 'kinguin,g2a,eneba,eldorado');
  ok('Kinguin: your supplier\'s price, stock and the full sum', cell(A, 'kinguin').basis === 'supplier'
    && cell(A, 'kinguin').costCents === 1200 && cell(A, 'kinguin').stock === 5
    && cell(A, 'kinguin').netProfitCents === spc.breakdown(2000, 1200, { vatPct: 21 }).netProfitCents);
  ok('Eldorado is recognised by the supplier\'s name', cell(A, 'eldorado').basis === 'supplier' && cell(A, 'eldorado').supplierName === 'Eldorado');
  ok('Eneba: a listing, with its link and time', cell(A, 'eneba').basis === 'listing' && cell(A, 'eneba').costCents === 1150
    && cell(A, 'eneba').url === 'https://eneba.test/item' && !!cell(A, 'eneba').observedAt);
  ok('every offer carries winst, marge, BTW, Stripe and netto winst', a.offers.every((o) =>
    ['profitCents', 'marginPct', 'vatCents', 'stripeCents', 'netProfitCents'].every((k) => Number.isFinite(o[k]))));
}

console.log('\n— BEST PROFIT, BEST PRICE, BEST STOCK —');
{
  const a = row(A);
  ok('BEST PROFIT: the highest netto winst in stock — Eldorado', a.bestProfit === 'eldorado');
  ok('BEST PRICE: the lowest purchase price — G2A, even though it is sold out', a.bestPrice === 'g2a');
  ok('…so the cheapest source is not called the most profitable when it cannot deliver', a.bestProfit !== a.bestPrice);
  ok('BEST STOCK: the most units — Eldorado\'s 50', a.bestStock === 'eldorado');
  ok('you buy from Kinguin now; Eldorado adds €1.00 a sale', a.current.supplierName === 'Kinguin' && a.gainPerSaleCents === 100,
    String(a.gainPerSaleCents));

  const b = row(B);
  ok('one source: all three badges, and a loss is shown as a loss', b.bestProfit === 'kinguin'
    && cell(B, 'kinguin').netProfitCents < 0, String(cell(B, 'kinguin').netProfitCents));
  ok('…and nothing to gain by switching to itself', b.gainPerSaleCents === null);
}

console.log('\n— Nothing made up —');
{
  const c = row(C);
  ok('no source: every marketplace "none", with a reason', c.offers.every((o) => o.basis === 'none' && o.reason));
  ok('…Eneba\'s says the shop has no Eneba connection', /no Eneba supplier connection/.test(cell(C, 'eneba').reason));
  ok('…and no badge', c.bestProfit === null && c.bestPrice === null && c.bestStock === null && !!c.reasons.bestProfit);
  ok('a listing older than 7 days is not used', cell(D, 'eneba').basis === 'none');
  ok('a paused supplier is not "in stock"', cell(E, 'kinguin').inStock === false && /paused/.test(cell(E, 'kinguin').status));
  ok('…so with nothing deliverable there is no BEST PROFIT, but there is a BEST PRICE',
    row(E).bestProfit === null && row(E).bestPrice === 'kinguin');
  ok('the current supplier can be outside the four', row(E).current.supplierName === 'Some Wholesaler');
}

console.log('\n— Summary and filters —');
{
  ok('the summary counts priced products, gains and losses',
    r.summary.products === 5 && r.summary.priced === 3 && r.summary.withGain === 1 && r.summary.lossMaking === 1,
    JSON.stringify(r.summary));
  const gain = await spc.supplierProfitCenter({ productIds: [A.id, B.id, C.id, D.id, E.id], only: 'gain' });
  ok('"could earn more" shows just A', gain.products.map((p) => p.productId).join() === A.id);
  const loss = await spc.supplierProfitCenter({ productIds: [A.id, B.id, C.id, D.id, E.id], only: 'loss' });
  ok('"loss at every source" shows just B', loss.products.map((p) => p.productId).join() === B.id);
  ok('search', (await spc.supplierProfitCenter({ productIds: [A.id, B.id], q: 'tiny' })).products.length === 1);
}

console.log('\n— Admin —');
{
  const owner = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`,
    { id: owner, e: `o-${stamp}@x.dev`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
  const srv = createApp().listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/api/admin/suppliers/profit-center`;
  const res = await fetch(`${url}?only=gain`, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  ok('the page answers', res.status === 200 && body.products.some((p) => p.productId === A.id), JSON.stringify(body).slice(0, 200));
  ok('…not as a supplier id', !body.error);
  ok('…and only for staff', (await fetch(url)).status === 401);
  ok('a bad filter is ignored, not an error',
    (await fetch(`${url}?only=nonsense`, { headers: { authorization: `Bearer ${accessToken}` } })).status === 200);
  srv.close();

  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  ok('Supplier Profit Center is in the admin menu', /profit-center.*Supplier Profit Center/.test(read('src/layouts/AdminLayout.jsx')));
  const page = read('src/pages/admin/SupplierProfitCenter.jsx');
  ok('the page shows the three badges', ['BEST PROFIT', 'BEST PRICE', 'BEST STOCK'].every((b) => page.includes(b)));
  ok('…and the full sum per source', ['Winst', 'BTW', 'Stripe', 'Netto winst', 'Marge'].every((w) => page.includes(w)));
}

console.log(`\n${fail ? '❌' : '✅'} supplier-profit-center: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
