/**
 * A cost entered once has to reach everything that needs it.
 *
 * The critical input for the whole shop is what a product costs to buy: the
 * pricing engine blocks every recommendation with NO_COST without it, and no
 * margin, no comparison and no profit figure exists until it does.
 *
 * It had three names, and one of them pointed at a column that does not exist:
 *
 *   the admin form WRITES        metadata.cost
 *   analyticsService READ        metadata.cost         ✓
 *   market/engine costFor READ   metadata.costCents    ✗
 *   audit-commercial READ        metadata.costCents    ✗
 *   costFor's supplier lookup    supplier_products.cost_cents — no such column,
 *                                inside .catch(() => null), so it said nothing
 *
 * Nothing errored. An owner could fill in the purchase price of all seventy-two
 * products, watch gross margin appear on the analytics page, and still have
 * every pricing recommendation refused for want of the same number.
 */
import { migrate } from '../src/db/migrate.js';
import { run, get } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { costCentsFor, costCentsFromMetadata, countWithCost } from '../src/services/costService.js';
import { costFor } from '../src/services/market/engine.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const at = new Date().toISOString();
const product = async (meta) => {
  const id = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, price, currency, active, metadata, created_at, updated_at)
    VALUES (@id, @sku, 'Test', 'robux', 2999, 'EUR', 1, @m, @a, @a)`,
  { id, sku: id.slice(-8), m: JSON.stringify(meta), a: at });
  return id;
};

console.log('— Every name the codebase has used still works —');
{
  /* Nothing already typed in may be lost. `cost` is what the admin form writes
     today; `costCents` is what the engine and the audits were looking for;
     `buyPrice` is the oldest, and it is in EUROS. */
  ok('metadata.cost — what the admin form writes', costCentsFromMetadata({ cost: 1500 }) === 1500);
  ok('metadata.costCents — what the engine looked for', costCentsFromMetadata({ costCents: 1500 }) === 1500);
  ok('metadata.buyPrice — euros, converted here and not in four call sites',
    costCentsFromMetadata({ buyPrice: 15 }) === 1500);
  ok('costCents wins when both are present', costCentsFromMetadata({ costCents: 1500, cost: 9999 }) === 1500);

  /* Null, never 0. A missing cost and a free product are different answers, and
     returning 0 for the first is how "revenue minus nothing" ends up on a
     screen labelled profit. */
  ok('nothing gives null, not zero', costCentsFromMetadata({}) === null);
  ok('and a zero cost is still a cost', costCentsFromMetadata({ cost: 0 }) === 0);
}

console.log('\n— A cost entered in the admin reaches the pricing engine —');
{
  // This is the bug, in one assertion: the form's key, read by the engine.
  const p = await product({ cost: 1500 });
  ok('costService sees it', (await costCentsFor(p)) === 1500);
  ok('and so does the engine that was blocking on it', (await costFor(p)) === 15);

  const legacy = await product({ costCents: 2200 });
  ok('a cost stored under the old name still works', (await costFor(legacy)) === 22);
  const oldest = await product({ buyPrice: 9.5 });
  ok('and the oldest one too', (await costFor(oldest)) === 9.5);

  const none = await product({});
  ok('a product with no cost is still null, so NO_COST still fires',
    (await costFor(none)) === null);
}

console.log('\n— A supplier mapping is the live cost and wins —');
{
  /* The lookup queried supplier_products.cost_cents. The column is `cost`, and
     the query sat in a .catch(() => null) — so a mapped supplier cost reached
     nobody, and said nothing about why. */
  const p = await product({ cost: 5000 });
  const sid = newId('sup');
  await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at)
    VALUES (@id, 'Test', 'api', 'active', '{}', @a, @a)`, { id: sid, a: at });
  await run(`INSERT INTO supplier_products (id, supplier_id, product_id, supplier_sku, cost, priority)
    VALUES (@id, @s, @p, @sku, 4200, 1)`, { id: newId('sp'), s: sid, p, sku: `SKU-${p.slice(-6)}` });
  ok('the mapping is used over the hand-entered figure', (await costCentsFor(p)) === 4200);
  ok('and it reaches the engine', (await costFor(p)) === 42);

  /* An inactive supplier is not what we would buy from. */
  await run(`UPDATE suppliers SET status='paused' WHERE id=@id`, { id: sid });
  ok('a paused supplier falls back to the hand-entered cost', (await costCentsFor(p)) === 5000);
}

console.log('\n— Saving a product does not drop what the form does not know —');
{
  /* updateProduct REPLACES metadata; it does not merge. That is what the bulk
     actions rely on to delete a key, and it is also why the admin form has to
     send back the keys it does not render — otherwise correcting a price
     silently discards the image framing and any cost stored under an older
     name. Pin the behaviour, because the client fix depends on it. */
  const p = await product({ cost: 1500, imageFit: 'cover', imageScale: 1.2 });
  const { updateProduct, getProduct } = await import('../src/services/productService.js');
  await updateProduct(p, { metadata: { cost: 1600 } });
  const after = await getProduct(p);
  ok('metadata is replaced, not merged', after.metadata.imageFit === undefined);
  ok('so the form must resend — spreading keeps the rest', after.metadata.cost === 1600);

  await updateProduct(p, { metadata: { ...after.metadata, imageFit: 'cover', cost: 1700 } });
  const merged = await getProduct(p);
  ok('a spread save keeps the framing', merged.metadata.imageFit === 'cover');
  ok('and still writes the new cost', (await costCentsFor(p)) === 1700);
}

console.log('\n— The audits count the same costs —');
{
  const rows = [
    { metadata: JSON.stringify({ cost: 100 }) },
    { metadata: JSON.stringify({ costCents: 200 }) },
    { metadata: JSON.stringify({ buyPrice: 3 }) },
    { metadata: '{}' },
    { metadata: null },
  ];
  ok('countWithCost sees all three spellings and neither blank', countWithCost(rows) === 3,
    String(countWithCost(rows)));
  /* The number that made this worth finding: "0 of 72 products carry a cost" is
     what every audit reported, and it would have stayed 0 after a month of
     typing. */
  ok('and it is the number the audits print', typeof countWithCost([]) === 'number');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
