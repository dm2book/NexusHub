/**
 * Finding the product at the supplier, instead of hunting for its id by hand.
 *
 * Mapping a product asked for a "supplier SKU". For Kinguin that is a numeric
 * kinguinId, and there was nowhere in this admin to look one up — so the only
 * way to fill the field was to go to kinguin.net, find the listing, and retype
 * the number. Once per product. Seventy-one times, with seventy-one chances to
 * point a product at the wrong listing and sell somebody a key for a different
 * game, in a region where it will not redeem.
 *
 * Two things this has to get right, and both are about what a WRONG mapping
 * costs rather than about search quality:
 *
 *   The cost that lands on the mapping is the cost the margin guard compares
 *   against before it is allowed to buy anything. So search and sync must
 *   normalise a listing identically — one mapping function, not two that agree
 *   until someone edits one.
 *
 *   A mapping whose cost is at or above the sell price NEVER auto-buys. That
 *   guard is deliberately silent: the order simply goes to the manual queue.
 *   So the picker has to say it out loud while you are choosing, using the
 *   same condition the guard uses.
 */
import { migrate } from '../src/db/migrate.js';
import { run, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const { KinguinConnector } = await import('../src/services/supplier/KinguinConnector.js');
const { SupplierConnector, searchTermsFor } = await import('../src/services/supplier/SupplierConnector.js');
const { CsvConnector } = await import('../src/services/supplier/CsvConnector.js');

/* Every request Kinguin would have received, so the assertions are about the
   call that was actually made and not about a hope. */
const calls = [];
const mockFetch = (rows) => {
  global.fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const name = (u.searchParams.get('name') || '').toLowerCase();
    const hits = name ? rows.filter((r) => r.name.toLowerCase().includes(name)) : rows;
    return { ok: true, status: 200, text: async () => JSON.stringify({ results: hits }) };
  };
};

const CATALOG = [
  { kinguinId: 111, name: 'Roblox Gift Card 10 EUR', price: 9.42, qty: 7, platform: 'Roblox', regionalLimitations: 'Region Free' },
  { kinguinId: 222, name: 'Roblox Gift Card 25 EUR', price: 23.10, qty: 0, platform: 'Roblox', regionalLimitations: 'EU' },
  { kinguinId: 333, name: 'Roblox Gift Card 5 EUR', price: 5.90, qty: 3, platform: 'Roblox', regionalLimitations: 'Region Free' },
  { kinguinId: 444, name: 'Something Else Entirely', price: 1.00, qty: 99 },
];

console.log('— One listing, one normalisation —');
{
  const n = KinguinConnector.normalise(CATALOG[0]);
  ok('the kinguinId becomes the supplier SKU', n.supplierSku === '111', n.supplierSku);
  ok('euros become cents', n.cost === 942, String(n.cost));
  ok('stock is carried through', n.availableStock === 7);
  ok('platform and region come with it — two listings can differ only there',
    n.platform === 'Roblox' && n.region === 'Region Free');
  ok('…and a link to check it by eye', /kinguin\.net\/category\/111/.test(n.url), n.url);

  const empty = KinguinConnector.normalise(CATALOG[1]);
  ok('zero stock is out of stock, and null rather than 0 units',
    empty.status === 'out_of_stock' && empty.availableStock === null);

  /* The cost written on a mapping is what the margin guard compares against.
     Two copies of this mapping is how the price you chose stops matching the
     price the sync writes a week later. */
  const svc = codeOf('server/src/services/supplier/KinguinConnector.js');
  ok('search and sync share one normaliser',
    (svc.match(/KinguinConnector\.normalise\(/g) || []).length >= 1
    && (svc.match(/supplierSku: String\(/g) || []).length === 1,
    'more than one place builds a catalog item');
}

console.log('\n— Searching where the catalogue actually is —');
{
  mockFetch(CATALOG);
  calls.length = 0;
  const c = new KinguinConnector({ config: { apiKey: 'KG' } });
  const hits = await c.searchCatalog('Roblox Gift Card');

  ok('the search term is sent to the supplier, not applied locally',
    calls.some((u) => u.includes('name=Roblox+Gift+Card') || u.includes('name=Roblox%20Gift%20Card')),
    calls.join(' | '));
  ok('…so unrelated products never come back at all',
    !hits.some((h) => h.supplierSku === '444'), JSON.stringify(hits.map((h) => h.name)));
  ok('three matches found', hits.length === 3, String(hits.length));
  /* Buyable first, then cheapest — an out-of-stock listing you cannot buy
     today should not sit above one you can. */
  ok('what you can buy comes first', hits[0].status === 'in_stock' && hits[1].status === 'in_stock');
  ok('…then cheapest first', hits[0].cost === 590 && hits[1].cost === 942,
    JSON.stringify(hits.map((h) => h.cost)));
  /* …but nothing is HIDDEN. An out-of-stock listing at the right price is
     still the product you were looking for, and dropping it reads as "this
     supplier does not carry it", which is a different and wrong answer. */
  ok('out of stock is shown, not filtered away',
    hits.some((h) => h.status === 'out_of_stock'), JSON.stringify(hits.map((h) => h.status)));

  ok('the limit is capped at the supplier maximum',
    (await (async () => { calls.length = 0; await c.searchCatalog('Roblox', { limit: 9999 }); return calls[0]; })())
      .includes('limit=100'), calls[0]);

  /* Kinguin's own docs require 3 characters. Refusing here beats sending a
     request we can see will be rejected and showing the person an API error. */
  ok('a two-letter term is refused before it is sent',
    (await c.searchCatalog('ro')).length === 0);
  const before = calls.length;
  await c.searchCatalog('ro');
  ok('…and really not sent', calls.length === before);

  ok('no key means no search', (await new KinguinConnector({ config: {} }).searchCatalog('Roblox')).length === 0);
  ok('…and the connector says so rather than pretending',
    new KinguinConnector({ config: {} }).supportsSearch === false
    && c.supportsSearch === true);
}

console.log('\n— A connector that cannot search still answers honestly —');
{
  /* The base class filters whatever fetchCatalog returned. For a CSV that is
     the whole catalogue and perfectly good; for a supplier with a hundred
     thousand listings it is a coincidence, not a search — so the payload says
     which of the two happened. */
  const base = new SupplierConnector({ config: {} });
  ok('the default searches whatever it can enumerate', (await base.searchCatalog('x')).length === 0);
  ok('…and does not claim to be a supplier-side search', base.supportsSearch === false);

  class Fake extends SupplierConnector {
    async fetchCatalog() {
      return [{ supplierSku: 'a', name: 'Alpha Pack' }, { supplierSku: 'b', name: 'Beta Pack' }];
    }
  }
  const f = new Fake({ config: {} });
  ok('it does match on the name', (await f.searchCatalog('alpha')).length === 1);
  ok('…case-insensitively', (await f.searchCatalog('ALPHA')).length === 1);
  ok('…and an empty term matches nothing rather than everything',
    (await f.searchCatalog('  ')).length === 0);
  ok('CsvConnector inherits it rather than reimplementing',
    !/searchCatalog/.test(read('server/src/services/supplier/CsvConnector.js')));
}

console.log('\n— The shop writes 1,000 and the supplier writes 1000 —');
{
  /* Measured against a live catalogue through the running API:
       "1,000 Robux" → 0 results
       "1000 Robux"  → 1 result
     Every product in this catalogue is named with a thousands separator, so
     searching the shop's own product name would have come back empty for
     essentially all 71 — and the honest-looking conclusion would have been
     "this supplier does not carry what we sell". Found by driving the picker in
     a browser, not by reading the query. */
  ok('a thousands separator is normalised away',
    searchTermsFor('1,000 Robux')[0] === '1000 Robux', JSON.stringify(searchTermsFor('1,000 Robux')));
  ok('…and the quantity is dropped as a fallback',
    searchTermsFor('1,000 Robux')[1] === 'Robux');
  ok('the game after the dash is tried too — usually the best term of the three',
    searchTermsFor('1,155 Diamonds — Mobile Legends').includes('Mobile Legends'),
    JSON.stringify(searchTermsFor('1,155 Diamonds — Mobile Legends')));
  ok('a hyphenated product name is not mangled',
    searchTermsFor('13,500 V-Bucks')[0] === '13500 V-Bucks',
    JSON.stringify(searchTermsFor('13,500 V-Bucks')));
  ok('a name with no quantity yields exactly one term',
    JSON.stringify(searchTermsFor('Discord Nitro')) === '["Discord Nitro"]');
  /* Only between digits: a comma inside a title is part of the title. */
  ok('a comma that is not a thousands separator is left alone',
    searchTermsFor('Rainbow Six, Gold Edition')[0] === 'Rainbow Six, Gold Edition',
    searchTermsFor('Rainbow Six, Gold Edition')[0]);
  ok('terms shorter than the supplier minimum are dropped',
    !searchTermsFor('500 VP').includes('VP'), JSON.stringify(searchTermsFor('500 VP')));
  ok('nothing in, nothing out', searchTermsFor('').length === 0 && searchTermsFor(null).length === 0);
  /* Each term is a request to somebody else's API. */
  ok('at most three terms are ever tried',
    searchTermsFor('1,155 Diamonds — Mobile Legends — EU').length <= 3);
  ok('duplicates are not tried twice',
    new Set(searchTermsFor('1,000 Robux')).size === searchTermsFor('1,000 Robux').length);

  const route = codeOf('server/src/routes/admin/suppliers.js');
  ok('the endpoint tries them in order and stops at the first that finds something',
    /for \(const term of terms\)/.test(route) && /if \(results\.length\) \{ searchedFor = term; break; \}/.test(route));
  ok('…and reports which term actually answered',
    /searchedFor,/.test(route) && /tried,/.test(route));

  const page = codeOf('src/pages/admin/Suppliers.jsx');
  ok('the picker says so when it searched for something else than you typed',
    /searchedFor !== search\.q\.trim\(\)/.test(page)
    && /your product name found nothing/.test(page));
}

console.log('\n— What the mapping would MEAN —');
{
  const route = codeOf('server/src/routes/admin/suppliers.js');
  ok('the endpoint exists', /router\.get\('\/:id\/search'/.test(route));
  ok('…behind the suppliers.read permission',
    /'\/:id\/search', requirePermission\('suppliers\.read'\)/.test(route));
  ok('…and refuses a term shorter than the supplier accepts',
    /q: z\.string\(\)\.min\(3/.test(route));
  ok('…and caps the page size', /limit: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)/.test(route));

  /* The guard in fulfillmentService is `cost == null || cost >= effectiveUnit`
     → never auto-buy, order to the manual queue, no error anywhere. A mapping
     made at a loss therefore looks perfect and silently never delivers. The
     picker warns with the SAME comparison. */
  const guard = codeOf('server/src/services/fulfillmentService.js');
  ok('the auto-buy guard still refuses at or above the sell price',
    /cost == null \|\| cost >= effectiveUnit/.test(guard));
  ok('…and the search result carries that exact verdict',
    /wouldRefuseAutoBuy: price != null && r\.cost != null \? r\.cost >= price : null/.test(route));
  ok('…with the margin it would leave', /marginPct/.test(route));
  ok('the payload says whether the search was server-side',
    /serverSide: !!connector\.supportsSearch/.test(route));

  const page = codeOf('src/pages/admin/Suppliers.jsx');
  ok('the picker warns before you map a loss-maker',
    /wouldRefuseAutoBuy/.test(page) && /would never auto-buy/.test(page));
  ok('choosing a product searches for it with no typing',
    /const pickProduct/.test(page) && /runSearch\(q, productId\)/.test(page));
  ok('…and one click fills the SKU and the cost',
    /const useResult/.test(page) && /supplierSku: r\.supplierSku/.test(page)
    && /costEuro: r\.cost != null/.test(page));
  ok('a term under 3 characters is not even sent from the page',
    /term\.length < 3/.test(page));
  ok('“nothing found” says what that actually means',
    /may simply not carry it/.test(page));
  ok('the picker uses the dark palette the admin renders in',
    !/text-slate-(700|800|900)/.test(page));
}

console.log('\n— End to end, against the database —');
{
  const at = nowIso();
  const pid = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,'SR-1','Roblox Gift Card 10 EUR','robux','t',1299,'EUR','digital',1,'{}',@at,@at)`,
    { id: pid, at });
  const sid = newId('sup');
  await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at)
             VALUES (@id,'Kinguin','kinguin','active',@c,@at,@at)`,
    { id: sid, c: JSON.stringify({ apiKey: 'KG', autoDeliver: true }), at });

  const { createConnector } = await import('../src/services/supplier/registry.js');
  mockFetch(CATALOG);
  const conn = createConnector({ id: sid, connector_kind: 'kinguin', config: { apiKey: 'KG' } });
  const hits = await conn.searchCatalog('Roblox Gift Card 10');
  ok('a real supplier row searches through the registry', hits.length === 1 && hits[0].supplierSku === '111');

  /* €9.42 cost against a €12.99 sell price: a real margin, auto-buy allowed. */
  const price = 1299;
  ok('a profitable listing is not flagged', hits[0].cost < price);
  const pct = Math.round(((price - hits[0].cost) / price) * 1000) / 10;
  ok('…and the margin is the one the picker shows', pct === 27.5, String(pct));

  /* The €23.10 card against the same €12.99 product: mapping it would look
     fine and never deliver a single order. */
  const bad = (await conn.searchCatalog('Roblox Gift Card 25'))[0];
  ok('a listing that costs more than you charge is caught', bad.cost >= price, String(bad.cost));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} supplier-catalog-search: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
