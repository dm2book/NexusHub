/**
 * Nothing on the shelf that cannot be delivered.
 *
 * Two things were found by writing this and then reading the code they check:
 *
 *   A guest could buy a mystery box. The checkout took the money, and
 *   settleMysteryForOrder() begins `if (!order.userId) return []` — no roll, no
 *   prize, no pull recorded, and nothing a human in the fulfillment queue could
 *   do either, because store credit needs an account to live in. The product
 *   page meanwhile promised that every box wins a real prize. (Boxes have
 *   since been retired altogether — nobody can buy one — see
 *   mystery-retired.test.mjs.)
 *
 *   Every product page carried TWO Product blocks of structured data saying
 *   different things: the server-rendered one said PreOrder (honest — no code in
 *   stock, delivered by hand) and React appended a second saying InStock, read
 *   off a `products.stock` column that nothing enforces, nothing decrements and
 *   nothing displays. Google reads one of them.
 *
 * Each check below breaks one thing, asserts the audit catches it by name, and
 * puts it back — so a rule that stops working fails here instead of at launch.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_catalog_audit';
process.env.NODE_ENV ||= 'development';
/* This suite exercises a shop that SELLS, so it says so.
 *
 * The launch gate's default changed: with no LAUNCH_DATE and no LAUNCH_MODE, a
 * shop that has never taken a payment refuses orders. That is the point — it is
 * what stops a deployment opening to the public by accident — and a fresh test
 * database is, by definition, a shop that has never taken a payment.
 *
 * Declaring the intent here is better than the gate having a special case for
 * tests: the production behaviour is the behaviour under test everywhere else. */
process.env.LAUNCH_MODE ||= 'open';


let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { ensureReady } = await import('../src/app.js');
await ensureReady();
await new Promise((r) => setTimeout(r, 4000));
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { auditCatalog, CATALOG_CHECKS } = await import('../src/services/catalogAuditService.js');
const { newId } = await import('../src/utils/ids.js');

const codes = async () => (await auditCatalog()).findings.map((f) => f.code);
const has = (list, code) => list.includes(code);

/** Break something, look, put it back. */
async function withBreakage(label, breakIt, expectCode) {
  const before = await codes();
  const restore = await breakIt();
  const during = await codes();
  await restore();
  const after = await codes();
  ok(`${label} → ${expectCode}`, has(during, expectCode), `saw [${[...new Set(during)]}]`);
  ok(`${label} → clears when fixed`,
    !has(after, expectCode) || has(before, expectCode),
    'the finding survived the repair');
}

console.log('— A clean catalogue passes —');
{
  const r = await auditCatalog();
  ok('the seeded catalogue has no blockers', r.ok, r.findings.filter((f) => f.level === 'FAIL')
    .map((f) => `${f.code}:${f.subject}`).join(', '));
  ok('it checked something', r.checked.active > 0, `${r.checked.active} active`);
  ok('every finding names a check the report knows about',
    r.findings.every((f) => CATALOG_CHECKS.includes(f.check)),
    [...new Set(r.findings.map((f) => f.check))].filter((c) => !CATALOG_CHECKS.includes(c)).join(', '));
  ok('every finding carries a fix', r.findings.every((f) => f.fix && f.fix.length > 10));
  ok('every finding is FAIL or WARN', r.findings.every((f) => ['FAIL', 'WARN'].includes(f.level)));
}

console.log('\n— Money taken, nothing deliverable —');
{
  const p = await get(`SELECT id, price, currency FROM products WHERE active=1 AND kind<>'mystery' LIMIT 1`);

  await withBreakage('a free product', async () => {
    await run(`UPDATE products SET price=0 WHERE id=@id`, { id: p.id });
    return () => run(`UPDATE products SET price=@v WHERE id=@id`, { v: p.price, id: p.id });
  }, 'price:zero');

  await withBreakage('a product priced in another currency', async () => {
    await run(`UPDATE products SET currency='USD' WHERE id=@id`, { id: p.id });
    return () => run(`UPDATE products SET currency=@v WHERE id=@id`, { v: p.currency, id: p.id });
  }, 'price:currency');

  await withBreakage('artwork that does not ship', async () => {
    const m = await get(`SELECT metadata FROM products WHERE id=@id`, { id: p.id });
    await run(`UPDATE products SET metadata=@m WHERE id=@id`,
      { m: JSON.stringify({ ...JSON.parse(m.metadata), image: '/products/icons/not-a-file.svg' }), id: p.id });
    return () => run(`UPDATE products SET metadata=@m WHERE id=@id`, { m: m.metadata, id: p.id });
  }, 'art:missing');
}

console.log('\n— No mystery box on the shelf —');
{
  /* The audit used to break the seeded box's reward pool three ways here.
     Boxes are retired — paid random prizes are very likely a game of chance
     under the Dutch Wet op de kansspelen — so nothing seeds one, and the shelf
     the audit reads has none to break. */
  const live = await get(`SELECT COUNT(*)::int AS n FROM products WHERE kind='mystery' AND active=1`);
  ok('the seeded catalogue holds no mystery box', Number(live?.n) === 0, `${live?.n} active`);
  ok('…so the audit has nothing to say about one', !(await codes()).some((c) => c.startsWith('mystery:')));
}

console.log('\n— A bundle whose parts cannot be bought —');
{
  const [x, y] = await all(`SELECT id FROM products WHERE active=1 LIMIT 2`);
  const bid = newId('bnd');
  await run(`INSERT INTO bundles (id,name,description,product_ids,discount_percent,active,created_at)
             VALUES (@id,'Audit test bundle','',@ids,10,1,@at)`,
    { id: bid, ids: JSON.stringify([x.id, y.id]), at: nowIso() });

  ok('a healthy bundle is not flagged', !has(await codes(), 'bundle:inactive-product'));

  await withBreakage('a bundle containing an inactive product', async () => {
    await run(`UPDATE products SET active=0 WHERE id=@id`, { id: y.id });
    return () => run(`UPDATE products SET active=1 WHERE id=@id`, { id: y.id });
  }, 'bundle:inactive-product');

  await withBreakage('a bundle pointing at a deleted product', async () => {
    await run(`UPDATE bundles SET product_ids=@ids WHERE id=@id`,
      { ids: JSON.stringify([x.id, 'prd_gone_forever']), id: bid });
    return () => run(`UPDATE bundles SET product_ids=@ids WHERE id=@id`,
      { ids: JSON.stringify([x.id, y.id]), id: bid });
  }, 'bundle:missing-product');

  await run(`DELETE FROM bundles WHERE id=@id`, { id: bid });
}

console.log('\n— Nobody can buy a mystery box —');
{
  /* This was "a guest cannot buy something only an account can receive": a
     box pays out in store credit, which needs an account. Boxes are retired
     now, so the order refuses one for a guest AND for an account — even a box
     switched back on by hand, as this one is. */
  const { createOrder } = await import('../src/services/orderService.js');
  const boxId = newId('prd');
  await run(`INSERT INTO products (id, name, category, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id, 'Audit Box', 'mystery', 4999, 'EUR', 'mystery', 1, '{}', @at, @at)`, { id: boxId, at: nowIso() });
  const order = {
    email: 'guest@example.com', consent: true, consentText: 'x',
    items: [{ productId: boxId, quantity: 1 }],
  };
  let refused = null;
  try { await createOrder(order); } catch (e) { refused = e; }
  ok('a guest mystery-box order is refused', !!refused, 'the order went through');
  ok('…and the reason says boxes are retired, not a generic error',
    /retired/i.test(refused?.message || ''), refused?.message);

  const uid = newId('usr');
  await run(`INSERT INTO users (id, email, created_at, updated_at) VALUES (@id,@e,@at,@at)`,
    { id: uid, e: `audit-${uid}@example.com`, at: nowIso() }).catch(() => {});
  let placed = null, err = null;
  try { placed = await createOrder({ ...order, userId: uid, email: `audit-${uid}@example.com` }); }
  catch (e) { err = e; }
  ok('…and so is the same order with an account', !placed && /retired/i.test(err?.message || ''), err?.message || 'the order went through');
  await run(`UPDATE products SET active=0 WHERE id=@id`, { id: boxId });
}

console.log('\n— One availability claim per page —');
{
  const fs = await import('node:fs');
  const url = (p) => new URL(p, import.meta.url);
  const seo = fs.readFileSync(url('../src/routes/seo.js'), 'utf8');
  const page = fs.readFileSync(url('../../src/pages/ProductDetail.jsx'), 'utf8');
  const meta = fs.readFileSync(url('../../src/lib/useMeta.js'), 'utf8');

  ok('the server tags its Product block with the product it describes',
    /id="jsonld-product" data-product=/.test(seo));
  ok('the SPA knows to leave that block alone', /serverFor/.test(meta) && /dataset\.product/.test(meta));
  ok('the product page passes the id it is showing', /serverFor: product\?\.id/.test(page));

  /* Availability must come from the same field on both sides. `products.stock`
     is not that field: nothing enforces it and nothing decrements it. */
  ok('the page derives availability from `instant`, not `stock`',
    /availability: product\.instant/.test(page));
  ok('…and no longer reads products.stock for it',
    !/product\.stock <= 0/.test(page));
  ok('the server derives it from real code stock',
    /availability: inStock \? 'https:\/\/schema\.org\/InStock'/.test(seo));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
