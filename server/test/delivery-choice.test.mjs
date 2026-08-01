/** Delivery choice (gift code vs direct account top-up) + the order-summary
 *  breakdown that fixes the item-price/total mismatch in emails. */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

await (await import('../src/app.js')).ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { createOrder, getOrder, markPaymentReceived, renderOrderEmail } = await import('../src/services/orderService.js');
const { listManualQueue, completeManualFulfillment } = await import('../src/services/fulfillmentService.js');
const { createCoupon } = await import('../src/services/couponService.js');
const { all } = await import('../src/db/index.js');
const tag = Date.now() % 1000000;

// A product that offers the choice AND keeps code stock.
const p = await createProduct({ name: `Robux Choice ${tag}`, category: 'robux', price: 999, announce: false,
  metadata: { deliveryField: 'Roblox username', deliveryChoice: true } });
ok('product exposes deliveryChoice + deliveryField', p.deliveryChoice === true && p.deliveryField === 'Roblox username', `${p.deliveryChoice}/${p.deliveryField}`);
await addProductCodes(p.id, [`GC-${tag}-A`, `GC-${tag}-B`, `GC-${tag}-C`]);

// ── Account top-up: must NOT auto-dispense a code even though stock exists ────
console.log('— Account top-up delivery —');
{
  const o = await createOrder({ consent: true, consentText: 'test consent', email: `acc${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }],
    billing: { deliveryMethod: 'account', deliveryDetails: 'CoolGamer123', deliveryLabel: 'Roblox username' } });
  ok('order stored deliveryMethod=account', o.billing?.deliveryMethod === 'account', o.billing?.deliveryMethod);
  await markPaymentReceived(o.id, `t_${tag}_a`, {});
  await new Promise((r) => setTimeout(r, 800));
  const fresh = await getOrder(o.id);
  ok('account order is NOT auto-completed from stock', fresh.status !== 'completed', fresh.status);
  const row = (await listManualQueue()).find((q) => q.order_number === o.number);
  ok('account order lands in the manual queue as an account top-up', row?.deliveryMethod === 'account' && row?.deliveryDetails === 'CoolGamer123', JSON.stringify({ m: row?.deliveryMethod, d: row?.deliveryDetails }));
  // Owner clicks Deliver with NO code (top-up done in-game).
  await completeManualFulfillment(row.id, { deliveries: [], note: 'topped up' }, {});
  const done = await getOrder(o.id);
  ok('account order completes after the owner confirms', done.status === 'completed', done.status);
  const email = await renderOrderEmail(o.id, 'order_completed');
  ok('completed email shows the account confirmation (not a code)', /account/i.test(email.html) && email.html.includes('CoolGamer123'), '');
  ok('completed email does NOT leak a stock code', !/GC-/.test(email.html), '');
}

// ── Gift code: normal auto-dispense from stock ───────────────────────────────
console.log('\n— Gift-code delivery —');
{
  const o = await createOrder({ consent: true, consentText: 'test consent', email: `code${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }],
    billing: { deliveryMethod: 'code' } });
  ok('order stored deliveryMethod=code', o.billing?.deliveryMethod === 'code', o.billing?.deliveryMethod);
  ok('code order has no stray delivery target', !o.billing?.deliveryDetails, JSON.stringify(o.billing));
  await markPaymentReceived(o.id, `t_${tag}_c`, {});
  await new Promise((r) => setTimeout(r, 800));
  const fresh = await getOrder(o.id);
  ok('code order auto-completes from stock', fresh.status === 'completed', fresh.status);
  const dels = await all('SELECT content FROM deliveries WHERE order_id=@o', { o: o.id });
  ok('a real code was dispensed', dels.some((d) => /GC-/.test(d.content)), JSON.stringify(dels.map((d) => d.content)));
  const email = await renderOrderEmail(o.id, 'order_completed');
  ok('completed email contains the delivered code', dels.length && email.html.includes(dels[0].content), '');
}

// ── Price breakdown: item price + coupon must reconcile to the total ─────────
console.log('\n— Order summary breakdown (price-bug fix) —');
{
  const coup = await createCoupon({ code: `SUM${tag}`, kind: 'fixed', value: 300, announce: false }); // €3 off
  const o = await createOrder({ consent: true, consentText: 'test consent', email: `sum${tag}@x.dev`, coupon: coup.code, items: [{ productId: p.id, quantity: 1 }],
    billing: { deliveryMethod: 'code' } });
  ok('order total reflects the €3 coupon (999 → 699)', o.total === 699, `total=${o.total}`);
  const email = await renderOrderEmail(o.id, 'order_received');
  const html = email.html;
  ok('email summary shows a Subtotal line', /Subtotal/i.test(html), '');
  ok('email summary shows the coupon discount line', /Coupon/i.test(html) && html.includes(coup.code), '');
  ok('email summary shows the correct total (€6.99)', /6[.,]99/.test(html), '');
  ok('email summary still shows the list price (€9.99)', /9[.,]99/.test(html), '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
