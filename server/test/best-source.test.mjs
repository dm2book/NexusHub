/**
 * "Scan every supplier, take the cheapest, and let me press map-all."
 *
 * What these assertions are mostly about is NOT that the cheapest listing wins
 * — sorting is easy — but what a bulk button must refuse. A mapped product is
 * bought automatically when an order arrives, so the button is only allowed
 * to map what can be checked without a person:
 *
 *   the cheapest listing is often the wrong one ("10,000 Robux" for 1,000),
 *   a card for the United States does not redeem in the Netherlands,
 *   a listing that looks 10% profitable loses money once BTW is paid over,
 *   and a product the owner mapped by hand is theirs, not the button's.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { createProduct } = await import('../src/services/productService.js');
const { costCentsForMany } = await import('../src/services/costService.js');
const { registerConnector } = await import('../src/services/supplier/registry.js');
const { SupplierConnector } = await import('../src/services/supplier/SupplierConnector.js');
const best = await import('../src/services/supplier/bestSourceService.js');

/* A supplier that hands over its whole price list, like a CSV or most APIs.
   Counts how often it is asked, so "downloaded once per scan" is measured. */
let downloads = 0;
class ListConnector extends SupplierConnector {
  static kind = 'test-list';
  async fetchCatalog() { downloads++; return this.config.items || []; }
}
registerConnector(ListConnector);

/* Kinguin, searched at the supplier, with the network answered from a table. */
const KINGUIN = [
  { kinguinId: 501, name: 'Roblox 1000 Robux Gift Card', price: 7.5, qty: 12, regionalLimitations: 'EUROPE' },
  // The trap: cheaper, in stock, and ten times the amount.
  { kinguinId: 502, name: 'Roblox 10000 Robux Gift Card', price: 1.0, qty: 50, regionalLimitations: 'Region Free' },
  { kinguinId: 503, name: 'Fortnite 2800 V-Bucks', price: 9.0, qty: 5, regionalLimitations: 'United States' },
];
global.fetch = async (url) => {
  const name = (new URL(url).searchParams.get('name') || '').toLowerCase();
  const hits = KINGUIN.filter((r) => r.name.toLowerCase().includes(name));
  return { ok: true, status: 200, text: async () => JSON.stringify({ results: hits }) };
};

const supplier = async (name, kind, config, status = 'active') => {
  const id = newId('sup');
  await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at)
             VALUES (@id, @n, @k, @s, @c, @at, @at)`,
  { id, n: name, k: kind, s: status, c: JSON.stringify(config), at: nowIso() });
  return id;
};

const stamp = Date.now();
const product = (name, price) => createProduct({ name, sku: `BST-${name.replace(/\W+/g, '')}-${stamp}`,
  category: 'robux', price, currency: 'EUR', active: true, announce: false, metadata: {} });

const kinguin = await supplier('Kinguin', 'kinguin', { apiKey: 'test-key' });
const list = await supplier('Price list', 'test-list', { items: [
  { supplierSku: 'L-1000R', name: 'Roblox 1000 Robux', cost: 800, status: 'in_stock' },
  { supplierSku: 'L-500C', name: 'Coins 500 pack', cost: 900, status: 'in_stock' },
  { supplierSku: 'L-SPOT', name: 'Spotify Premium 1 Month', cost: 500, status: 'in_stock' },
  { supplierSku: 'L-HAND', name: 'Handmapped 750 Gems', cost: 300, status: 'in_stock' },
] });
await supplier('Paused supplier', 'test-list', { items: [
  { supplierSku: 'P-1000R', name: 'Roblox 1000 Robux', cost: 1, status: 'in_stock' },
] }, 'inactive');

const robux = await product('1,000 Robux', 1299);
const vbucks = await product('2,800 V-Bucks', 1999);
const coins = await product('500 Coins', 1000);
const spotify = await product('Spotify Premium', 1099);
const riot = await product('1,000 Riot Points', 999);
const hand = await product('750 Gems', 999);

// Mapped by hand before the scan ever ran.
await run(`INSERT INTO supplier_products (id, supplier_id, product_id, supplier_sku, cost, priority, last_synced_at)
           VALUES (@id, @s, @p, 'L-HAND', 300, 100, @at)`, { id: newId('sp'), s: list, p: hand.id, at: nowIso() });

const ids = [robux, vbucks, coins, spotify, riot, hand].map((p) => p.id);
downloads = 0;
const scan1 = await best.scanBest(ids.slice(0, 3));
const scan2 = await best.scanBest(ids.slice(3));
const results = [...scan1.results, ...scan2.results];
const row = (p) => results.find((r) => r.productId === p.id);

console.log('\n— The cheapest listing that is actually the right one —');
{
  const r = row(robux);
  ok('1,000 Robux is ready to map', r.verdict === 'ready', r.verdict);
  ok('…from the cheapest supplier that sells the RIGHT amount', r.best.supplierId === kinguin && r.best.cost === 750,
    JSON.stringify(r.best && { s: r.best.supplierName, cost: r.best.cost, title: r.best.title }));
  ok('…not the €1.00 listing for ten times as much', r.best.title !== 'Roblox 10000 Robux Gift Card');
  ok('…with a fallback from the OTHER supplier', r.fallback?.supplierId === list && r.fallback.cost === 800,
    JSON.stringify(r.fallback));
  ok('…and a paused supplier is never asked', r.suppliersSearched === 2, String(r.suppliersSearched));
  /* €12.99 incl. 21% BTW is €10.74 for the shop; minus €7.50 and the fees. */
  ok('profit is measured after BTW and fees', r.best.profitCents > 200 && r.best.profitCents < 290,
    String(r.best.profitCents));
}

console.log('\n— What the button must not map —');
{
  const v = row(vbucks);
  ok('a United States card is sent to a person', v.verdict === 'check'
    && v.best.reasons.some((x) => /United States/.test(x)), JSON.stringify(v.best?.reasons));

  const c = row(coins);
  /* €10.00 with a €9.00 cost: 10% on the face of it, −€1.27 after BTW and fees. */
  ok('a listing that only looks profitable before BTW is a loss', c.verdict === 'loss'
    && c.best.profitCents < 0, JSON.stringify({ v: c.verdict, p: c.best?.profitCents }));

  const s = row(spotify);
  ok('a product with no amount to check goes to a person', s.verdict === 'check'
    && /no amount/.test(s.best.reasons.join(' ')), JSON.stringify(s.best?.reasons));

  ok('a product nobody carries says so', row(riot).verdict === 'not_found', row(riot).verdict);

  const h = row(hand);
  ok('a product mapped by hand is reported as mapped', h.mapped === true
    && h.current?.supplierName === 'Price list', JSON.stringify(h.current));
  ok('…and is not counted as mappable', !scan2.summary.mappable || scan2.results
    .filter((r) => r.verdict === 'ready' && !r.mapped).every((r) => r.productId !== hand.id));
}

console.log('\n— The scan is polite to other people\'s APIs —');
{
  /* Two batches, one list-supplier each: two downloads, not one per term per
     product. */
  ok('a downloaded price list is fetched once per scan', downloads === 2, String(downloads));
  ok('the scan says which BTW rate it measured after', scan1.vat?.pct === 21 && scan1.vat.registered === false,
    JSON.stringify(scan1.vat));
}

console.log('\n— Map all —');
{
  const ready = results.filter((r) => r.verdict === 'ready' && !r.mapped);
  const picks = ready.map((r) => ({
    productId: r.productId, supplierId: r.best.supplierId, supplierSku: r.best.supplierSku,
    supplierUrl: r.best.url, cost: r.best.cost,
    fallback: r.fallback && { supplierId: r.fallback.supplierId, supplierSku: r.fallback.supplierSku, cost: r.fallback.cost },
  }));
  const out = await best.mapBest(picks, { actor: { id: 'usr_staff' } });
  ok('every ready product is mapped', out.mapped === ready.length && ready.length >= 1,
    JSON.stringify(out));

  const maps = await all(`SELECT supplier_id, priority, cost FROM supplier_products WHERE product_id=@p ORDER BY priority`,
    { p: robux.id });
  ok('the best source is tried first', maps[0]?.supplier_id === kinguin && maps[0].priority === best.PRIORITY.BEST,
    JSON.stringify(maps));
  ok('…and the other supplier is the fallback', maps[1]?.supplier_id === list && maps[1].priority === best.PRIORITY.FALLBACK);

  /* The part that saves the owner the most work: a mapping is where the shop
     reads a product's purchase cost from first. */
  const costs = await costCentsForMany([robux.id]);
  ok('mapping fills in the cost price', costs[robux.id] === 750, String(costs[robux.id]));

  // The button pressed with a hand-mapped product in the list anyway.
  const again = await best.mapBest([{ productId: hand.id, supplierId: kinguin, supplierSku: '999', cost: 1 }]);
  ok('a hand-mapped product is skipped, not moved', again.mapped === 0
    && again.skipped[0]?.why === 'already mapped', JSON.stringify(again));
  const handMaps = await all(`SELECT supplier_sku FROM supplier_products WHERE product_id=@p`, { p: hand.id });
  ok('…and its mapping is untouched', handMaps.length === 1 && handMaps[0].supplier_sku === 'L-HAND');

  const paused = (await all(`SELECT id FROM suppliers WHERE name='Paused supplier'`))[0].id;
  const toPaused = await best.mapBest([{ productId: riot.id, supplierId: paused, supplierSku: 'P-1', cost: 1 }]);
  ok('nothing is mapped to a supplier that is not active', toPaused.mapped === 0
    && toPaused.skipped[0]?.why === 'supplier not active', JSON.stringify(toPaused));

  const logs = await all(`SELECT id FROM audit_logs WHERE action='supplier.map_best'`);
  ok('the bulk mapping is audited', logs.length >= 1, String(logs.length));
}

console.log('\n— The amount check itself —');
{
  const a = (t) => [...best.amountsIn(t)].sort((x, y) => x - y).join(',');
  ok('"1,000" is one thousand', a('1,000 Robux') === '1000');
  ok('"1.000" is one thousand too', a('Apex 1.000 Coins') === '1000');
  ok('both numbers of "EA FC 25 — 2,800 Points" count', a('EA FC 25 — 2,800 Points') === '25,2800');
  ok('a price in the name is not an amount', a('Now 4,99 for 500 V-Bucks') === '500');
  ok('a space is not a thousands separator', a('Pack 100 500 coins') === '100,500');
  ok('"RoW" is not Europe', !best.matchCheck('1,000 Robux', { name: '1000 Robux', region: 'RoW' }).safe);
  ok('an unstated region is noted, not blocking',
    best.matchCheck('1,000 Robux', { name: '1000 Robux' }).safe
    && best.matchCheck('1,000 Robux', { name: '1000 Robux' }).notes.length === 1);
}

console.log('\n— The right amount, but not the right product —');
{
  /* Both from a live scan against Kinguin: the amount and the region matched,
     and each would have been mapped the day either was cheap enough. */
  const apex = best.matchCheck('1,000 Apex Coins',
    { name: 'Apex Legends - 1000 Apex Coins XBOX One CD Key', region: 'REGION FREE' });
  ok('an Xbox-only code does not map to a product that names no platform',
    !apex.safe && apex.reasons.some((r) => /Xbox only/.test(r)), JSON.stringify(apex.reasons));
  const acct = best.matchCheck('1,000 V-Bucks',
    { name: 'Fortnite - 1000 V-Bucks Epic Games Account', region: 'REGION FREE' });
  ok('a game account is not a code', !acct.safe && acct.reasons.some((r) => /account/.test(r)),
    JSON.stringify(acct.reasons));
  ok('…while a V-Bucks CODE that says "Epic Games" is fine',
    best.matchCheck('1,000 V-Bucks', { name: 'Fortnite 1000 V-Bucks Epic Games Key', region: 'Global' }).safe);
  ok('a platform in the supplier\'s own field counts too',
    !best.matchCheck('1,000 Apex Coins', { name: 'Apex 1000 Coins', region: 'Global', platform: 'Xbox One' }).safe);
  ok('…and a PlayStation card maps to a PSN product',
    best.matchCheck('PSN €20', { name: 'PlayStation Network Card 20 EUR', region: 'Europe' }).safe);
}

console.log('\n— A price list that says 8.00 means eight euros —');
{
  /* Found by looking at this screen with a real price list in it: every cost
     read as cents. `Number("8.00")` is 8, a whole number, and whole numbers were
     taken to be cents already — so a €8.00 card cost the shop 8 cents, every
     row came out 90%+ profitable, and "map all" would have mapped on it. */
  const { CsvConnector } = await import('../src/services/supplier/CsvConnector.js');
  const csv = (content, extra = {}) => new CsvConnector({ config: {
    source: { type: 'inline', content }, columns: { sku: 'sku', name: 'name', cost: 'cost' }, ...extra } });
  const got = Object.fromEntries((await csv(
    'sku,name,cost\na,x,8.00\nb,x,13.50\nc,x,"12,50"\nd,x,€8\ne,x,800\nf,x,"1.234,56"\n').fetchCatalog())
    .map((r) => [r.supplierSku, r.cost]));
  ok('"8.00" is eight euros, not eight cents', got.a === 800, String(got.a));
  ok('"13.50" is still €13.50', got.b === 1350, String(got.b));
  ok('a Dutch "12,50" is €12.50', got.c === 1250, String(got.c));
  ok('"€8" is eight euros', got.d === 800, String(got.d));
  ok('a bare "800" keeps its old meaning, cents', got.e === 800, String(got.e));
  ok('"1.234,56" is €1,234.56', got.f === 123456, String(got.f));
  const major = await csv('sku,name,cost\ng,x,8\n', { amounts: 'major' }).fetchCatalog();
  ok('a list that says so can write whole euros', major[0].cost === 800, String(major[0].cost));

  /* The API connector had the same rule and the same hole for prices sent as
     text. A JSON number cannot say which it is, so that half is unchanged. */
  const { ApiConnector } = await import('../src/services/supplier/ApiConnector.js');
  const api = new ApiConnector({ config: { baseUrl: 'https://supplier.test', endpoints: { catalog: '/c' } } });
  global.fetch = async () => ({ ok: true, status: 200,
    json: async () => ({ items: [{ sku: 's', name: 'x', cost: '8.00' }, { sku: 'n', name: 'x', cost: 8.5 }] }),
    text: async () => JSON.stringify({ items: [{ sku: 's', name: 'x', cost: '8.00' }, { sku: 'n', name: 'x', cost: 8.5 }] }) });
  const fromApi = await api.fetchCatalog().catch((e) => ({ error: e.message }));
  const bySku = Array.isArray(fromApi) ? Object.fromEntries(fromApi.map((r) => [r.supplierSku, r.cost])) : {};
  ok('an API price sent as "8.00" is eight euros', bySku.s === 800, JSON.stringify(fromApi).slice(0, 160));
  ok('…and a number 8.5 is still €8.50', bySku.n === 850, String(bySku.n));
}

console.log(`\n${fail ? '❌' : '✅'} best-source: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
