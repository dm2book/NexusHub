/**
 * A paid order is delivered exactly once, and a delivery that is refused gives
 * its codes back — even when two things try at the same moment.
 *
 *   Two dispenses of one order at once (the payment's own, the maintenance
 *   sweep, a fraud approval) each claimed a full set of codes: a two-code order
 *   delivered four.
 *   Two approvals of one held order (two tabs, a double click) both delivered.
 *   A delivery refused after its codes were claimed (refund, cancellation or a
 *   fraud hold landing in between) left them marked used against an order
 *   nobody received — stock lost for good.
 *
 * These run against the real services and a real database, without timing
 * tricks: the races are made to happen, not hoped for.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_delivery_races';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
// The automatic maintenance a first request starts also dispenses; keep it out.
await (await import('../src/services/bootUpkeep.js')).claimInterval('maintenance_auto', 3_600_000);

const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const os = await import('../src/services/orderService.js');

async function product(name, codes) {
  const id = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,@sku,@n,'robux','test',1000,'EUR','digital',1,@m,@at,@at)`,
    { id, sku: `R-${id.slice(-8)}`, n: name, m: JSON.stringify({ deliveryMode: 'auto' }), at: nowIso() });
  for (let i = 0; i < codes; i++) {
    await run(`INSERT INTO product_codes (id, product_id, code, status, created_at) VALUES (@i,@p,@c,'available',@at)`,
      { i: newId('pcd'), p: id, c: `${name}-${i}-${id.slice(-6)}`, at: nowIso() });
  }
  return id;
}
/* A paid order that has not been dispensed yet: paid by the guarded status
   update itself, so the payment's own background dispense never starts and the
   test decides exactly who dispenses and when. */
async function paidOrder(productId, qty, { held = false } = {}) {
  const o = await os.createOrder({ email: `race-${newId('x').slice(-6)}@example.com`, consent: true, consentText: 'ok',
    items: [{ productId, quantity: qty }] });
  await run(`UPDATE orders SET status='payment_received', payment_status='paid', fraud_hold=@h WHERE id=@id`,
    { id: o.id, h: held ? 1 : 0 });
  return o;
}
const counts = async (orderId, productId) => ({
  deliveries: (await get('SELECT COUNT(*)::int AS n FROM deliveries WHERE order_id=@o', { o: orderId })).n,
  used: (await get(`SELECT COUNT(*)::int AS n FROM product_codes WHERE product_id=@p AND status='used'`, { p: productId })).n,
  available: (await get(`SELECT COUNT(*)::int AS n FROM product_codes WHERE product_id=@p AND status='available'`, { p: productId })).n,
});

console.log('— Two dispenses of one paid order at the same moment —');
for (let round = 1; round <= 3; round++) {
  const p = await product(`Twice${round}`, 6);
  const o = await paidOrder(p, 2);
  const results = await Promise.allSettled([os.autoDispenseFromStock(o.id), os.autoDispenseFromStock(o.id)]);
  const c = await counts(o.id, p);
  ok(`round ${round}: the order gets its two codes, not four (${c.deliveries} delivered, ${c.used} used)`,
    c.deliveries === 2 && c.used === 2, JSON.stringify({ c, results: results.map((r) => r.status) }));
}

console.log('\n— Two approvals of one held order —');
{
  const p = await product('Approve', 6);
  const o = await paidOrder(p, 2, { held: true });
  const [a, b] = await Promise.all([os.releaseFraudHold(o.id, { actorId: 'staff-a' }), os.releaseFraudHold(o.id, { actorId: 'staff-b' })]);
  const c = await counts(o.id, p);
  ok(`the order is delivered once (${c.deliveries} delivered, ${c.used} used)`, c.deliveries === 2 && c.used === 2, JSON.stringify(c));
  ok('…and only one of the two clicks says it delivered', [a, b].filter((r) => r.delivered).length === 1,
    JSON.stringify([a.delivered, b.delivered, a.alreadyReleased, b.alreadyReleased]));
}

console.log('\n— A delivery refused after the codes were claimed —');
{
  /* The hold lands at the instant the codes are claimed: after the dispense's
     own checks, before the delivery's. A trigger makes that moment certain. */
  const p = await product('Refused', 2);
  const o = await paidOrder(p, 1);
  await run(`CREATE OR REPLACE FUNCTION fm_test_hold() RETURNS trigger AS $$
             BEGIN UPDATE orders SET fraud_hold = 1 WHERE id = NEW.order_id; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await run(`CREATE TRIGGER fm_test_hold AFTER UPDATE OF status ON product_codes
             FOR EACH ROW WHEN (NEW.status = 'used') EXECUTE FUNCTION fm_test_hold()`);
  let refused = null;
  try { await os.autoDispenseFromStock(o.id); } catch (e) { refused = e.message; }
  await run('DROP TRIGGER fm_test_hold ON product_codes');
  const c = await counts(o.id, p);
  ok('the delivery is refused', !!refused && /held/i.test(refused), String(refused));
  ok(`…and the claimed code goes back on the shelf (${c.available} available, ${c.used} used)`,
    c.deliveries === 0 && c.used === 0 && c.available === 2, JSON.stringify(c));
  const left = await all(`SELECT id FROM product_codes WHERE order_id=@o`, { o: o.id });
  ok('…no longer tied to the order', left.length === 0, String(left.length));
}

console.log('\n— A normal delivery still keeps its codes —');
{
  const p = await product('Normal', 2);
  const o = await paidOrder(p, 1);
  ok('it delivers', await os.autoDispenseFromStock(o.id) === true);
  const c = await counts(o.id, p);
  ok(`one code used, one left (${c.used}/${c.available})`, c.deliveries === 1 && c.used === 1 && c.available === 1, JSON.stringify(c));
  ok('…and a second dispense afterwards adds nothing', (await os.autoDispenseFromStock(o.id)) === false
    && (await counts(o.id, p)).deliveries === 1);
}

console.log(`\n${fail ? '❌' : '✅'} delivery-races: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
