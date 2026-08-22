/**
 * The pipeline, driven rather than read.
 *
 * Real orders, real codes, real transitions, concurrent callers, against a real
 * database. Everything here reproduces something that either did happen or can:
 *
 *   Half an order was marked fulfilled. availableCount() and claimCodes() are
 *   two separate reads and the claim takes rows FOR UPDATE SKIP LOCKED, so two
 *   orders for two copies each, against three codes, both pass the availability
 *   check and one comes back holding a single code. It was delivered and
 *   completed. The buyer paid for two and received one.
 *
 *   The same code was written to an order twice. Three separate bare INSERTs —
 *   staff delivery, auto-dispense, supplier connector — and claimCodes is
 *   idempotent, so a retry produced identical rows rather than being caught.
 *
 *   A refunded order could be dragged back to completed. Auto-dispense
 *   force-completes; a refund landing between its status read and its UPDATE
 *   lost the race, and making forced transitions retry turned that from
 *   occasional into reliable.
 *
 *   A paid order could sit undelivered forever. Delivery is started without
 *   being awaited so the webhook answers fast, and on a serverless host the
 *   function can be frozen the instant that 200 is written.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_pipeline_test';
process.env.NODE_ENV ||= 'development';
process.env.DEMO_MODE = 'true';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

const { ensureReady } = await import('../src/app.js');
await ensureReady();
await new Promise((r) => setTimeout(r, 4000));

const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const os = await import('../src/services/orderService.js');
const cs = await import('../src/services/codeStockService.js');
const fs_ = await import('../src/services/fulfillmentService.js');
const mt = await import('../src/services/maintenanceService.js');

/* Background delivery is fire-and-forget by design. Everything below has to
   wait for it the way a real observer would. */
const settle = async (n = 2) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1500)); };

async function product(name, { codes = 0, mode = 'auto' } = {}) {
  const id = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,@sku,@n,'robux','test',1000,'EUR','digital',1,@m,@at,@at)`,
    { id, sku: `T-${id.slice(-8)}`, n: name,
      m: JSON.stringify({ deliveryMode: mode, image: '/products/icons/robux.webp' }), at: nowIso() });
  for (let i = 0; i < codes; i++) {
    await run(`INSERT INTO product_codes (id, product_id, code, status, created_at) VALUES (@i,@p,@c,'available',@at)`,
      { i: newId('pcd'), p: id, c: `${name}-CODE-${i}`, at: nowIso() });
  }
  return id;
}
const order = (productId, qty = 1) => os.createOrder({
  email: `buyer-${newId('x').slice(-6)}@example.com`, consent: true, consentText: 'ok',
  items: [{ productId, quantity: qty }],
});
const state = async (id) => {
  const o = await get(`SELECT status, payment_status, email FROM orders WHERE id=@id`, { id });
  const d = await all(`SELECT content FROM deliveries WHERE order_id=@id`, { id });
  const c = await all(`SELECT status FROM product_codes WHERE order_id=@id`, { id });
  const e = await all(`SELECT template_id FROM email_log WHERE to_email=@q`, { q: o?.email });
  return { status: o?.status, paid: o?.payment_status, deliveries: d.map((x) => x.content), codes: c.length, emails: e };
};

console.log('— Purchase → payment → order → reservation → deduction → delivery → email —');
{
  const p = await product('Happy', { codes: 3 });
  const o = await order(p);
  await os.markPaymentReceived(o.id, 'pay_happy');
  await settle();
  const s = await state(o.id);
  ok('the order completes', s.status === 'completed', s.status);
  ok('payment is recorded', s.paid === 'paid', s.paid);
  ok('one code is delivered', s.deliveries.length === 1, JSON.stringify(s.deliveries));
  ok('one code is deducted', s.codes === 1, `${s.codes}`);
  ok('the rest stays on the shelf', (await cs.availableCount(p)) === 2, `${await cs.availableCount(p)}`);
  ok('the buyer is emailed', s.emails.some((e) => e.template_id === 'order_completed'),
    JSON.stringify(s.emails.map((e) => e.template_id)));
}

console.log('\n— The same webhook, replayed —');
{
  const p = await product('Replay', { codes: 3 });
  const o = await order(p);
  await os.markPaymentReceived(o.id, 'pay_replay');
  await settle();
  await os.markPaymentReceived(o.id, 'pay_replay').catch(() => {});
  await settle();
  const s = await state(o.id);
  ok('one delivery, not two', s.deliveries.length === 1, JSON.stringify(s.deliveries));
  ok('one code consumed, not two', s.codes === 1, `${s.codes}`);
  ok('stock is untouched by the replay', (await cs.availableCount(p)) === 2, `${await cs.availableCount(p)}`);
}

console.log('\n— Three webhooks at the same instant —');
{
  const p = await product('Concurrent', { codes: 3 });
  const o = await order(p);
  await Promise.allSettled([1, 2, 3].map(() => os.markPaymentReceived(o.id, 'pay_conc')));
  await settle(3);
  const s = await state(o.id);
  ok('one delivery', s.deliveries.length === 1, JSON.stringify(s.deliveries));
  ok('one code consumed', s.codes === 1, `${s.codes}`);
  ok('one completion email',
    s.emails.filter((e) => e.template_id === 'order_completed').length === 1,
    JSON.stringify(s.emails.map((e) => e.template_id)));
}

console.log('\n— Two orders, one code —');
{
  const p = await product('LastOne', { codes: 1 });
  const a = await order(p); const b = await order(p);
  await Promise.allSettled([os.markPaymentReceived(a.id, 'pa'), os.markPaymentReceived(b.id, 'pb')]);
  await settle(3);
  const sa = await state(a.id), sb = await state(b.id);
  ok('the code goes out exactly once', sa.deliveries.length + sb.deliveries.length === 1,
    `a=${sa.deliveries.length} b=${sb.deliveries.length}`);
  ok('exactly one order completes',
    [sa.status, sb.status].filter((x) => x === 'completed').length === 1, `${sa.status} / ${sb.status}`);
  ok('nothing is left on the shelf', (await cs.availableCount(p)) === 0, `${await cs.availableCount(p)}`);
  const orphan = await all(
    `SELECT id FROM product_codes WHERE product_id=@p AND status='used' AND order_id IS NULL`, { p });
  ok('no code is used but unassigned', orphan.length === 0, `${orphan.length}`);
}

console.log('\n— Not enough stock to fill the order —');
{
  const p = await product('Partial', { codes: 3 });
  const a = await order(p, 2); const b = await order(p, 2);
  await Promise.allSettled([os.markPaymentReceived(a.id, 'p8a'), os.markPaymentReceived(b.id, 'p8b')]);
  await settle(3);
  const sa = await state(a.id), sb = await state(b.id);
  for (const [n, s] of [['A', sa], ['B', sb]]) {
    ok(`order ${n} is completed only if it got everything (${s.deliveries.length}/2, ${s.status})`,
      s.status !== 'completed' || s.deliveries.length === 2, JSON.stringify(s.deliveries));
  }
  const used = await get(
    `SELECT COUNT(*)::int AS n FROM product_codes WHERE product_id=@p AND status='used'`, { p });
  ok('no code is lost', Number(used.n) + (await cs.availableCount(p)) === 3,
    `used=${used.n} avail=${await cs.availableCount(p)}`);
  ok('the short order is not sitting on codes it never received',
    Number(used.n) === sa.deliveries.length + sb.deliveries.length,
    `used=${used.n} delivered=${sa.deliveries.length + sb.deliveries.length}`);
}

console.log('\n— Delivering the same thing twice —');
{
  const p = await product('DoubleHand', { codes: 3 });
  const o = await order(p);
  await os.markPaymentReceived(o.id, 'pay_dbl');
  await settle();
  const before = await state(o.id);
  await os.deliverOrder(o.id, [{ content: before.deliveries[0], type: 'code' }], { reason: 'double click' })
    .catch(() => {});
  const after = await state(o.id);
  ok('the same code is not recorded twice', after.deliveries.length === before.deliveries.length,
    JSON.stringify(after.deliveries));

  const fresh = await os.deliverOrder(o.id, [{ content: 'REPLACEMENT-CODE', type: 'code' }],
    { reason: 'replacement' }).catch(() => null);
  ok('a genuinely new code still gets through', !!fresh
    && (await state(o.id)).deliveries.includes('REPLACEMENT-CODE'));
}

console.log('\n— Money going back beats a delivery in flight —');
{
  const p = await product('RefundRace', { codes: 2 });
  const o = await order(p);
  os.markPaymentReceived(o.id, 'pay_refund').catch(() => {});
  await new Promise((r) => setTimeout(r, 15));
  await os.transitionOrder(o.id, 'refunded', { force: true, reason: 'race' }).catch(() => {});
  await settle(3);
  const s = await state(o.id);
  ok('a refunded order never reads completed', s.status === 'refunded', s.status);
  ok('no code is lost', (await cs.availableCount(p)) + s.deliveries.length === 2,
    `avail=${await cs.availableCount(p)} delivered=${s.deliveries.length}`);
}

console.log('\n— A refunded order cannot be resurrected —');
{
  const p = await product('NoResurrect', { codes: 2 });
  const o = await order(p);
  await os.markPaymentReceived(o.id, 'pay_res');
  await settle();
  await os.transitionOrder(o.id, 'refunded', { force: true, reason: 'refund' });
  for (const to of ['completed', 'payment_received']) {
    let threw = null;
    await os.transitionOrder(o.id, to, { force: true, reason: 'should not work' })
      .catch((e) => { threw = e; });
    ok(`force cannot move refunded → ${to}`, !!threw, `no error for ${to}`);
  }
  ok('the order is still refunded',
    (await get(`SELECT status FROM orders WHERE id=@id`, { id: o.id })).status === 'refunded');
}

console.log('\n— Nothing to deliver: the queue, not a completed order —');
{
  const p = await product('NoStock', { codes: 0 });
  const o = await order(p);
  await os.markPaymentReceived(o.id, 'pay_none');
  await settle(3);
  const s = await state(o.id);
  ok('the order is not completed', s.status !== 'completed', s.status);
  ok('nothing was delivered', s.deliveries.length === 0, JSON.stringify(s.deliveries));
  const req = await all(`SELECT status, mode FROM fulfillment_requests WHERE order_id=@id`, { id: o.id });
  ok('a person has been given the job', req.length > 0, JSON.stringify(req));
  ok('and the buyer sees a real status',
    ['payment_received', 'processing', 'awaiting_fulfillment'].includes(s.status), s.status);

  await fs_.ensureManualFulfillment(o.id, {}).catch(() => {});
  await fs_.ensureManualFulfillment(o.id, {}).catch(() => {});
  const again = await all(`SELECT id FROM fulfillment_requests WHERE order_id=@id`, { id: o.id });
  ok('poking the queue does not duplicate the job', again.length === req.length, `${again.length}`);
}

console.log('\n— The order nobody picked up —');
{
  const p = await product('Stuck', { codes: 3 });
  const o = await order(p);
  // Exactly the state a serverless host leaves behind when the function is
  // frozen the instant the webhook's 200 is written: paid, in stock, nothing
  // delivered, nothing waiting for it.
  await run(`UPDATE orders SET status='payment_received', payment_status='paid', updated_at=@at WHERE id=@id`,
    { at: nowIso(), id: o.id });
  const summary = await mt.runMaintenance();
  const s = await state(o.id);
  ok('maintenance recovers it', s.status === 'completed', s.status);
  ok('…by delivering, not by paging a human', s.deliveries.length === 1
    && Number(summary.autoDispensed || 0) >= 1, `${JSON.stringify(summary.autoDispensed)} ${s.deliveries.length}`);
  ok('stock is deducted once', (await cs.availableCount(p)) === 2, `${await cs.availableCount(p)}`);

  // And running it again changes nothing.
  await mt.runMaintenance();
  const s2 = await state(o.id);
  ok('a second sweep delivers nothing new', s2.deliveries.length === 1, JSON.stringify(s2.deliveries));
}

console.log('\n— Discord hears about it once —');
{
  const p = await product('DiscordOnce', { codes: 2 });
  const o = await order(p);
  await Promise.allSettled([os.markPaymentReceived(o.id, 'pd'), os.markPaymentReceived(o.id, 'pd')]);
  await settle(3);
  const num = (await get(`SELECT number FROM orders WHERE id=@id`, { id: o.id })).number;
  const mine = (await all(`SELECT payload FROM discord_outbox`)).filter((b) => (b.payload || '').includes(num));
  const bodies = mine.map((b) => b.payload);
  ok('no message is queued twice', bodies.length === new Set(bodies).size,
    `${bodies.length} queued, ${new Set(bodies).size} distinct`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
