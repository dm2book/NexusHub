/**
 * "Make sure I make a profit."
 *
 * Code cannot make anybody buy. What it can do is refuse to sell at a loss, and
 * that is what this checks: every product that loses money after 21% BTW and
 * the payment fee is found, the price that stops it is the pricing engine's own
 * floor, and nothing is guessed — a product with no known cost is counted, not
 * repriced, and a profitable product is never made cheaper.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { run } = await import('../src/db/index.js');
const { createProduct, getProduct } = await import('../src/services/productService.js');
const lp = await import('../src/services/lossPriceService.js');

console.log('\n— The arithmetic —');
{
  ok('prices round UP to .49', lp.roundUpToEnding(1123) === 1149);
  ok('…or .99', lp.roundUpToEnding(1150) === 1199);
  ok('…and an ending already there stays', lp.roundUpToEnding(1099) === 1099);

  /* €10 with a €9 cost: a 10% margin on the face of it. */
  const now = lp.profitAt(1000, 900, { vatPct: 21 });
  ok('€10 on a €9 cost loses money after BTW', now.profitCents < 0, JSON.stringify(now));
  const floor = lp.floorPrice(900, { vatPct: 21 });
  const at = lp.profitAt(floor, 900, { vatPct: 21 });
  ok('the floor price earns at least the minimum profit', at.profitCents >= 50, `${floor} → ${at.profitCents}`);
  ok('…and at least the minimum margin', at.marginPct >= 6, String(at.marginPct));
  /* The case that decides between "reprice" and "hide": Kinguin's 1,000 Robux. */
  ok('1,000 Robux bought at €10.14 needs €13.99', lp.floorPrice(1014, { vatPct: 21 }) === 1399,
    String(lp.floorPrice(1014, { vatPct: 21 })));
}

console.log('\n— Against the catalogue —');
{
  /* Only the products this test makes: the seeded catalogue is set aside. */
  await run(`UPDATE products SET active = 0`);
  const stamp = Date.now();
  const mk = (name, price, cost) => createProduct({ name, sku: `LP-${name.replace(/\W+/g, '')}-${stamp}`,
    category: 'robux', price, currency: 'EUR', active: true, announce: false,
    metadata: cost == null ? {} : { cost, costCents: cost } });
  const loss = await mk('Loss 1000', 1000, 900);
  const thin = await mk('Thin 2000', 2000, 1500);
  const fine = await mk('Fine 3000', 3000, 1000);
  const blind = await mk('No Cost 4000', 4000, null);

  const r = await lp.lossReport({ vatPct: 21 });
  const row = (p) => r.rows.find((x) => x.id === p.id);
  ok('the losing product is found', row(loss)?.state === 'loss', JSON.stringify(row(loss)));
  ok('…with what it loses per sale', row(loss).profitCents < 0);
  ok('the thin one is flagged separately', row(thin)?.state === 'thin', JSON.stringify(row(thin)));
  ok('a profitable product is left alone', !row(fine) && r.fine === 1);
  /* At least one: the shop also creates its starter products in the
     background, and those have no cost either. */
  ok('a product with no cost is counted, never guessed', !row(blind) && r.unknown >= 1, String(r.unknown));
  ok('every proposal is a raise, never a cut', r.rows.every((x) => x.proposedPrice >= x.price));
  ok('…and every proposal earns money', r.rows.every((x) => x.proposedProfitCents > 0));

  const done = await lp.applyFloor([loss.id, fine.id]);
  const after = await getProduct(loss.id);
  ok('repricing writes the floor price', after.price === row(loss).proposedPrice, `${after.price}`);
  ok('…which now earns money', lp.profitAt(after.price, 900, { vatPct: 21 }).profitCents > 0);
  ok('a product that was fine is not touched even when asked', (await getProduct(fine.id)).price === 3000
    && done.changed === 1, JSON.stringify(done));

  const hid = await lp.applyFloor([thin.id], { action: 'hide' });
  ok('"hide" takes a product off the shelf instead', hid.changed === 1 && !(await getProduct(thin.id)).active);
}

console.log(`\n${fail ? '❌' : '✅'} loss-prices: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
