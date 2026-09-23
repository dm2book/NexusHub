/**
 * Cost prices, pasted in one go — and the decimal that must never be guessed.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Not one product in this shop carries a purchase cost, so every margin it
 * reports is blank: the profit page cannot subtract, the pricing engine refuses
 * with NO_COST, the supplier comparison has nothing to compare. The numbers are
 * the owner's and nobody can invent them — but entering them meant opening 72
 * products one at a time, and an hour of clicking is a good reason to leave it
 * undone forever.
 *
 * ── AND WHY MOST OF IT IS ABOUT REFUSING ──────────────────────────────────
 * A cost is not a display value. A decimal read wrong is a product that reports
 * a profit it does not make, on every order, until somebody checks the bank.
 * "APEX-2150,12,50" is both "three comma-separated fields" and "a SKU and a
 * Dutch decimal", and the naive split takes the cost as 50 cents — silently, on
 * a line that looks fine. Every ambiguous shape below is either resolved by a
 * stated rule or refused by name; none of them is guessed.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const imp = await import('../src/services/costImportService.js');
const { all, get } = await import('../src/db/index.js');
const { createProduct, getProduct } = await import('../src/services/productService.js');
const { costCentsFromMetadata } = await import('../src/services/costService.js');

console.log('\n— What people actually paste —');
{
  const cases = [
    ['12.50', 1250], ['12,50', 1250], ['€12,50', 1250], [' 12 ', 1200],
    ['1.234,56', 123456], ['1,234.56', 123456],
    /* A lone comma before three digits is a thousands separator, not a
       decimal: reading "1,234" as 1.234 turns twelve hundred into one. */
    ['1,234', 123400],
    ['0', 0], ['abc', null], ['', null], ['-5', null],
  ];
  for (const [input, want] of cases) {
    ok(`"${input}" → ${want}`, imp.parseMoney(input) === want, String(imp.parseMoney(input)));
  }
}

console.log('\n— The line, and the shapes that are not one —');
{
  ok('a tab-separated line reads', imp.parseLine('APEX-1000\t6.20').cents === 620);
  ok('a semicolon works too', imp.parseLine('APEX-1000;6,20').cents === 620);
  ok('a product name in the middle does no harm',
    imp.parseLine('APEX-1000,1,000 Apex Coins,6.20') === null
      || imp.parseLine('APEX-1000\t1,000 Apex Coins\t6.20').cents === 620);

  /* The one that would have been silently wrong. */
  const dutch = imp.parseLine('APEX-2150,12,50');
  ok('"SKU,12,50" is read as €12.50, not 50 cents', dutch.cents === 1250, JSON.stringify(dutch));

  /* And the one that cannot be resolved by any rule, so it is refused. */
  const ambiguous = imp.parseLine('APEX-2150,1,234');
  ok('a line that could be either is refused, not guessed', !!ambiguous.error, JSON.stringify(ambiguous));
  ok('…and says what to do about it', /tab or a semicolon/.test(ambiguous.error), ambiguous.error);

  ok('a comment line is skipped', imp.parseLine('# supplier list, october') === null);
  ok('a blank line is skipped', imp.parseLine('   ') === null);
  ok('a line with no amount is reported', /not an amount/.test(imp.parseLine('APEX-1000\tfree').error));
  ok('a line with no separator is reported', /no separator/.test(imp.parseLine('APEX-1000').error));
}

console.log('\n— Against the real catalogue —');
{
  const stamp = Date.now();
  const a = await createProduct({ name: 'Cost Test A', sku: `COSTA-${stamp}`, category: 'robux',
    price: 1000, currency: 'EUR', active: true, announce: false, metadata: {} });
  const b = await createProduct({ name: 'Cost Test B', sku: `COSTB-${stamp}`, category: 'robux',
    price: 2000, currency: 'EUR', active: true, announce: false, metadata: {} });

  const text = [
    `${a.sku}\t6.20`,
    `${b.sku}\t12,50`,
    'NOSUCHSKU-9999\t1.00',
  ].join('\n');

  const dry = await imp.importCosts(text, { apply: false });
  ok('the paste matches on SKU', dry.matched === 2, JSON.stringify(dry.matched));
  ok('…and both would change', dry.changed === 2);
  /* A typo'd SKU that vanishes is how somebody comes back sure they entered a
     cost they did not. */
  ok('…and the line that matched nothing is NAMED', dry.unmatched === 1
    && dry.problems.some((p) => /NOSUCHSKU/.test(p.raw)), JSON.stringify(dry.problems));
  ok('…while nothing was written', dry.applied === false
    && costCentsFromMetadata((await getProduct(a.id)).metadata) == null);

  const applied = await imp.importCosts(text, { apply: true, actor: { id: 'usr_staff' } });
  ok('applying writes the costs', applied.applied === true && applied.changed === 2);
  const after = await getProduct(a.id);
  ok('…which the product carries', costCentsFromMetadata(after.metadata) === 620,
    String(costCentsFromMetadata(after.metadata)));
  /* Three readers in this codebase disagree about the field name; costService
     documents exactly that. Writing one of them leaves the pricing engine
     blind, which is the bug this would otherwise recreate. */
  ok('…under BOTH names the shop reads', after.metadata.cost === 620 && after.metadata.costCents === 620,
    JSON.stringify({ cost: after.metadata.cost, costCents: after.metadata.costCents }));
  ok('…and the European decimal landed as €12.50',
    costCentsFromMetadata((await getProduct(b.id)).metadata) === 1250);

  /* The same paste twice is not two edits. */
  const again = await imp.importCosts(text, { apply: true, actor: { id: 'usr_staff' } });
  ok('running it again changes nothing', again.changed === 0 && again.unchanged === 2,
    JSON.stringify({ changed: again.changed, unchanged: again.unchanged }));

  /* The figure the owner is actually watching. */
  ok('the report counts the catalogue, not the paste',
    again.catalogue.withCost >= 2 && again.catalogue.total >= 2, JSON.stringify(again.catalogue));

  const logs = await all(`SELECT metadata FROM audit_logs WHERE action='product.costs_imported'`);
  ok('applying is audited', logs.length >= 1, String(logs.length));
}

console.log('\n— A cost above the price is flagged, not refused —');
{
  const stamp = Date.now();
  const c = await createProduct({ name: 'Cost Test C', sku: `COSTC-${stamp}`, category: 'robux',
    price: 500, currency: 'EUR', active: true, announce: false, metadata: {} });
  /* Selling below cost is a real decision somebody might make on purpose — a
     loss leader — so it is applied. It is also what a decimal in the wrong
     place looks like, so it is never applied quietly. */
  const r = await imp.importCosts(`${c.sku}\t9.00`, { apply: true, actor: { id: 'usr_staff' } });
  ok('it is applied', costCentsFromMetadata((await getProduct(c.id)).metadata) === 900);
  ok('…and flagged', r.warnings === 1 && /not below the €5.00 sell price/.test(r.rows[0].warning),
    JSON.stringify(r.rows[0]));
}

console.log('\n— A margin that is only there before BTW —');
{
  /* The case this screen used to show in green. €10.00 is the price, €9.00 the
     cost: 10% margin on the face of it. At 21% BTW €8.26 of that €10.00 is the
     seller's, so every sale loses 74 cents — and nothing about the row said so,
     because the cost is below the price and that was the only thing checked. */
  const stamp = Date.now();
  const e = await createProduct({ name: 'Cost Test E', sku: `COSTE-${stamp}`, category: 'robux',
    price: 1000, currency: 'EUR', active: true, announce: false, metadata: {} });
  const r = await imp.importCosts(`${e.sku}\t9.00`, { apply: false });
  const row = r.rows[0];
  ok('the price after BTW is what the seller keeps', row.netPrice === 826, String(row.netPrice));
  ok('…so the margin is negative, not 10%', row.netMarginPct < 0, String(row.netMarginPct));
  ok('…and the row says it loses money, with the numbers',
    /loses money after 21% BTW/.test(row.warning || '') && /€8\.26/.test(row.warning || ''),
    String(row.warning));

  /* A healthy product is not flagged by the same rule. */
  const f = await createProduct({ name: 'Cost Test F', sku: `COSTF-${stamp}`, category: 'robux',
    price: 1000, currency: 'EUR', active: true, announce: false, metadata: {} });
  const ok2 = await imp.importCosts(`${f.sku}\t6.00`, { apply: false });
  ok('a cost well under the net price is not flagged', ok2.rows[0].warning == null
    && ok2.rows[0].netMarginPct > 20, JSON.stringify(ok2.rows[0]));

  /* Before a btw-nummer exists the shop has no rate of its own; the preview
     still measures after the standard one, and says that it does. */
  ok('the report names the rate it measured after', r.vat?.pct === 21 && r.vat.registered === false,
    JSON.stringify(r.vat));
}

console.log('\n— The same SKU twice in one paste —');
{
  const stamp = Date.now();
  const d = await createProduct({ name: 'Cost Test D', sku: `COSTD-${stamp}`, category: 'robux',
    price: 1000, currency: 'EUR', active: true, announce: false, metadata: {} });
  const r = await imp.importCosts(`${d.sku}\t1.00\n${d.sku}\t2.00`, { apply: false });
  /* Letting the last line win is a defensible rule and an indefensible silence:
     the owner pasted two different answers and should be told. */
  ok('the duplicate is reported', r.unmatched === 1
    && /more than once/.test(r.problems[0].error), JSON.stringify(r.problems));
  ok('…and only the first is counted', r.matched === 1 && r.rows[0].after === 100);
}

console.log(`\n${fail ? '❌' : '✅'} cost-import: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
