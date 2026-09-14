/**
 * "Which of the things I sell can this supplier deliver, profitably?" — asked
 * for the whole catalogue instead of one product at a time.
 *
 * The picker answers it per product. Seventy-one products is an hour of
 * clicking to reach one number, and that number decides whether a launch date
 * is real: how much of the shop can be automated on day one.
 *
 * ── THE FAILURE THIS FEATURE INVITES ──────────────────────────────────────
 * Matching is by NAME. "Robux" finds a gift card as readily as the top-up a
 * product actually is, and a bulk table of green ticks is exactly the thing a
 * tired owner accepts wholesale. So the contract asserted here is that this
 * PROPOSES and never maps: nothing in the service writes, every row carries the
 * supplier's own title and region for a human to check, and the page needs a
 * click per row.
 *
 * ── AND THE ONE THAT IS SILENT ────────────────────────────────────────────
 * fulfillmentService refuses to auto-buy at or above the sell price, without an
 * error — the order simply goes to the manual queue. A mapping that fails that
 * test therefore looks perfect and never delivers, so "best" here means the
 * cheapest listing that is in stock AND under our price, not the top hit.
 */
import { migrate } from '../src/db/migrate.js';
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
const { judge, marginOf, scanProduct, scanProducts, summarise, VERDICT } =
  await import('../src/services/supplier/catalogScanService.js');

const c = (over = {}) => ({ supplierSku: 'x', name: 'Some listing', cost: 500,
  status: 'in_stock', availableStock: 5, ...over });

console.log('— What "best" means —');
{
  /* Not the top hit: the cheapest that could actually fulfil today. */
  const r = judge([
    c({ supplierSku: 'a', cost: 900 }),
    c({ supplierSku: 'b', cost: 400 }),
    c({ supplierSku: 'd', cost: 600 }),
  ], 1000);
  ok('the cheapest in-stock listing under our price wins',
    r.best.supplierSku === 'b' && r.verdict === VERDICT.PROFITABLE, r.best.supplierSku);

  /* In stock and too dear, or cheap and nobody has it, are different problems
     with different fixes — reprice versus wait — so they are different
     verdicts rather than one "no". */
  const oos = judge([c({ supplierSku: 'cheap', cost: 400, status: 'out_of_stock' })], 1000);
  ok('cheap but unavailable is out_of_stock, not a failure',
    oos.verdict === VERDICT.OUT_OF_STOCK && oos.best.supplierSku === 'cheap');

  const dear = judge([c({ cost: 1480 }), c({ cost: 1600 })], 999);
  ok('everything above our price is below_cost', dear.verdict === VERDICT.BELOW_COST);
  ok('…and the nearest one is still returned, so you can see how far off it is',
    dear.best.cost === 1480, String(dear.best.cost));

  ok('nothing found is not_found', judge([], 999).verdict === VERDICT.NOT_FOUND);
  ok('…with no candidate invented', judge([], 999).best === null);

  /* A product with no price has nothing to be profitable against. Calling that
     "profitable" would be a green tick derived from a missing number. */
  const np = judge([c({ cost: 400 })], 0);
  ok('a product with no price is no_price, never profitable', np.verdict === VERDICT.NO_PRICE);
  ok('…but still shows what it would cost', np.best.cost === 400);

  /* An in-stock listing at EXACTLY our price is refused by the guard, so it
     must not be called profitable here. */
  const exact = judge([c({ cost: 999 })], 999);
  ok('equal to our price is not profitable — the guard refuses it',
    exact.verdict === VERDICT.BELOW_COST, exact.verdict);
}

console.log('\n— The margin, and the guard it has to agree with —');
{
  const m = marginOf(c({ cost: 700 }), 1000);
  ok('margin in cents', m.marginCents === 300);
  ok('…and as a percentage of what we charge', m.marginPct === 30, String(m.marginPct));
  ok('…and it would not be refused', m.wouldRefuseAutoBuy === false);

  const bad = marginOf(c({ cost: 1480 }), 999);
  ok('a loss is negative, not clamped', bad.marginPct === -48.1, String(bad.marginPct));
  ok('…and flagged as refused', bad.wouldRefuseAutoBuy === true);

  ok('no candidate means no margin, not zero',
    marginOf(null, 999).marginPct === null && marginOf(null, 999).wouldRefuseAutoBuy === null);
  ok('no price means no margin either', marginOf(c(), 0).marginPct === null);

  /* The comparison must be the one fulfillmentService actually performs. */
  const guard = codeOf('server/src/services/fulfillmentService.js');
  ok('the guard still refuses at or above the sell price',
    /cost == null \|\| cost >= effectiveUnit/.test(guard));
  const svc = codeOf('server/src/services/supplier/catalogScanService.js');
  ok('…and the scan uses the same comparison',
    /wouldRefuseAutoBuy: best\.cost >= priceCents/.test(svc));
}

console.log('\n— The shop writes 1,000 and the supplier writes 1000 —');
{
  const tried = [];
  const connector = {
    supportsSearch: true,
    async searchCatalog(term) {
      tried.push(term);
      return term === 'Robux' ? [c({ supplierSku: '444', name: 'Roblox 1000 Robux Card', cost: 1480 })] : [];
    },
  };
  const row = await scanProduct(connector, { id: 'p1', name: '1,000 Robux', price: 999 });
  ok('the shop\'s own product name is tried first', tried[0] === '1000 Robux', tried[0]);
  ok('…then shorter terms, until one finds something', tried.includes('Robux'), tried.join(' | '));
  ok('…and it stops there rather than asking again', tried.length === 2, tried.join(' | '));
  ok('the term that actually answered is reported', row.searchedFor === 'Robux');
  ok('…and every term tried is kept, so "nothing found" is not read as "we barely looked"',
    row.tried.length === 2);
  ok('the verdict is the honest one', row.verdict === VERDICT.BELOW_COST, row.verdict);
  ok('…with the real numbers attached', row.marginPct === -48.1 && row.best.supplierSku === '444');

  const none = await scanProduct(
    { supportsSearch: true, async searchCatalog() { return []; } },
    { id: 'p2', name: '1,155 Diamonds — Mobile Legends', price: 1599 });
  ok('a product the supplier does not carry says so', none.verdict === VERDICT.NOT_FOUND);
  ok('…after trying all three terms, including the game name',
    none.tried.includes('Mobile Legends') && none.tried.length === 3, none.tried.join(' | '));

  /* A supplier that throws must not take the whole scan down: one bad product
     out of seventy is not a reason to lose the other sixty-nine. */
  const angry = await scanProduct(
    { supportsSearch: true, async searchCatalog() { throw new Error('rate limited'); } },
    { id: 'p3', name: 'Discord Nitro', price: 999 });
  ok('a supplier error becomes "not found" for that row, not a dead scan',
    angry.verdict === VERDICT.NOT_FOUND);
}

console.log('\n— A batch —');
{
  const calls = [];
  const connector = {
    supportsSearch: true,
    async searchCatalog(term) {
      calls.push({ term, at: Date.now() });
      await new Promise((r) => setTimeout(r, 5));
      return term.includes('Robux') ? [c({ cost: 400 })] : [];
    },
  };
  const products = [
    { id: 'a', name: '1,000 Robux', price: 999 },
    { id: 'b', name: 'Nothing At All', price: 500 },
    { id: 'd', name: '2,000 Robux', price: 1999 },
  ];
  const rows = await scanProducts(connector, products);
  ok('one row per product, in the order asked',
    rows.map((r) => r.productId).join(',') === 'a,b,d', rows.map((r) => r.productId).join(','));
  /* Sequential, not Promise.all: firing seventy parallel requests at someone
     else's API is how an integration gets rate-limited. */
  ok('the supplier is called one at a time',
    calls.every((c2, i) => i === 0 || c2.at >= calls[i - 1].at));
  ok('the service does not fan out', !/Promise\.all/.test(codeOf('server/src/services/supplier/catalogScanService.js')));

  const s = summarise(rows);
  ok('the summary counts what can be sourced', s.profitable === 2, String(s.profitable));
  ok('…and what cannot, by reason',
    s.notFound === 1 && s.scanned === 3, JSON.stringify(s));
  ok('the average margin is over the profitable ones only',
    s.averageMarginPct === 70, String(s.averageMarginPct));
  /* Null, not 0: "no margin to report" and "an average margin of zero" are
     different statements — the rule this codebase runs on. */
  ok('…and is null when nothing is profitable',
    summarise([{ verdict: VERDICT.NOT_FOUND }]).averageMarginPct === null);
  ok('summarising nothing does not crash', summarise([]).scanned === 0);
}

console.log('\n— It proposes. It never maps —');
{
  const svc = read('server/src/services/supplier/catalogScanService.js');
  ok('the scan service writes nothing at all',
    !/\brun\(|INSERT|UPDATE|DELETE/i.test(svc.replace(/\/\*[\s\S]*?\*\//g, ' ')));
  ok('…and does not import the database', !/from '\.\.\/\.\.\/db/.test(svc));

  const route = codeOf('server/src/routes/admin/suppliers.js');
  ok('the scan endpoint exists', /router\.post\('\/:id\/scan'/.test(route));
  ok('…behind the suppliers.read permission — it only reads',
    /'\/:id\/scan', requirePermission\('suppliers\.read'\)/.test(route));
  /* The cap is what keeps a request inside the function timeout. It is not a
     tuning knob; raising it is the failure mode. */
  ok('…and caps the batch, because the cap is the timeout guard',
    /productIds: z\.array\(z\.string\(\)\)\.min\(1\)\.max\(10\)/.test(route));
  ok('…answers are never cached', /\/:id\/scan[\s\S]{0,1400}Cache-Control', 'no-store'/.test(route));
  ok('the page can ask what there is to scan',
    /router\.get\('\/:id\/scan-targets'/.test(route));
  ok('…active products only — nobody can buy the rest',
    /FROM products WHERE active = 1 ORDER BY name ASC/.test(route));

  const page = codeOf('src/components/admin/CatalogScan.jsx');
  ok('the page walks batches rather than asking for everything at once',
    /i \+= BATCH/.test(page) && /const BATCH = \d+/.test(page));
  ok('…and shows how far it has got', /pct/.test(page) && /of \{total\}/.test(page));
  ok('mapping is a click per row, never automatic',
    /onClick=\{\(\) => mapOne\(r\)\}/.test(page) && !/rows\.forEach[\s\S]{0,80}mapOne/.test(page));
  ok('…and only offered for rows that would actually work',
    /r\.verdict === 'profitable' &&/.test(page));
  ok('every candidate shows the SUPPLIER\'s own title, not ours',
    /\{r\.best\.name\}/.test(page) && /r\.best\.region/.test(page));
  ok('…and the page says out loud that a name match is a suggestion',
    /Matched on name/.test(page) && /did not order/.test(page));
  ok('every term tried is shown when nothing was found',
    /r\.tried \|\| \[r\.searchedFor\]/.test(page));
  ok('the panel uses the dark palette the admin renders in',
    !/text-slate-(700|800|900)/.test(page));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} catalog-scan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
