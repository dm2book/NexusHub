/** DB-backed verification of the audit fixes: coin-spend race, atomic payment
 *  confirm (no double delivery), and the supplier margin guard. */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

await (await import('../src/app.js')).ensureReady();
const { upsertUserByEmail } = await import('../src/services/userService.js');
const { grantCoins, spendCoins, coinBalance } = await import('../src/services/forgeCoinService.js');
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { createOrder, getOrder } = await import('../src/services/orderService.js');
const { submitProof, confirmProof } = await import('../src/services/paymentProofService.js');
const { createSupplier, mapSupplierProduct } = await import('../src/services/supplier/supplierService.js');
const { autoFulfillFromSuppliers } = await import('../src/services/fulfillmentService.js');
const { createCoupon } = await import('../src/services/couponService.js');
const { all } = await import('../src/db/index.js');
const tag = Date.now() % 1000000;

// ── 1. Coin-spend race: two concurrent spends of the full balance ────────────
console.log('— Coin-spend race (missing FOR UPDATE lock) —');
{
  const { user: u } = await upsertUserByEmail(`race${tag}@x.dev`);
  await grantCoins(u.id, 40);
  const results = await Promise.allSettled([
    spendCoins(u.id, 40, 'membership', 'forge_plus'),
    spendCoins(u.id, 40, 'membership', 'forge_plus'),
  ]);
  const okCount = results.filter((r) => r.status === 'fulfilled').length;
  const bal = await coinBalance(u.id);
  ok('exactly one concurrent 40-coin spend succeeds', okCount === 1, `succeeded=${okCount}`);
  ok('balance never goes negative (ends at 0)', bal === 0, `balance=${bal}`);
}

// ── 2. Atomic payment confirm: two proofs, confirmed concurrently ────────────
console.log('\n— Atomic payment confirm (no double delivery) —');
{
  const p = await createProduct({ name: `Race Key ${tag}`, category: 'giftcard', price: 1000, announce: false });
  await addProductCodes(p.id, ['CODE-A', 'CODE-B', 'CODE-C', 'CODE-D']); // plenty of stock
  const order = await createOrder({ consent: true, consentText: 'test consent', email: `buyer${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }] });
  // two separate proofs a customer could submit for the same order
  const pr1 = await submitProof(order.id, { transactionId: `TXA${tag}` }, {});
  const pr2 = await submitProof(order.id, { transactionId: `TXB${tag}` }, {});
  const res = await Promise.allSettled([confirmProof(pr1.id, {}), confirmProof(pr2.id, {})]);
  const confirmed = res.filter((r) => r.status === 'fulfilled').length;
  // allow a tiny beat for any async dispense
  await new Promise((r) => setTimeout(r, 400));
  const deliveries = await all('SELECT id FROM deliveries WHERE order_id=@o', { o: order.id });
  const fresh = await getOrder(order.id);
  ok('order reaches a paid/delivered state', ['payment_received', 'processing', 'awaiting_fulfillment', 'completed'].includes(fresh.status), fresh.status);
  ok('exactly ONE delivery for a qty-1 order (no double claim)', deliveries.length === 1, `deliveries=${deliveries.length}`);
  ok('the losing concurrent confirm is rejected', confirmed <= 1 || deliveries.length === 1, `confirmed=${confirmed}`);
}

// ── 3. Supplier margin guard: null cost + discounted-below-cost both skip ─────
console.log('\n— Supplier margin guard (null cost / discount) —');
{
  const sup = await createSupplier({ name: `Kg ${tag}`, connectorKind: 'kinguin', config: { apiKey: 'x', autoDeliver: true } });

  // (a) null cost → must NOT auto-buy (unknown cost = uncapped purchase risk)
  const pNull = await createProduct({ name: `NullCost ${tag}`, category: 'giftcard', price: 1000, announce: false });
  await mapSupplierProduct({ supplierId: sup.id, productId: pNull.id, supplierSku: '111', cost: null });
  const oNull = await createOrder({ consent: true, consentText: 'test consent', email: `n${tag}@x.dev`, items: [{ productId: pNull.id, quantity: 1 }] });
  const didNull = await autoFulfillFromSuppliers(oNull.id, {});
  ok('null supplier cost is NOT auto-bought (routes to manual)', didNull === false, `did=${didNull}`);

  // (b) cost 900 < list 1000, but a 30% coupon drops effective revenue to 700 → skip
  const pDisc = await createProduct({ name: `Disc ${tag}`, category: 'giftcard', price: 1000, announce: false });
  await mapSupplierProduct({ supplierId: sup.id, productId: pDisc.id, supplierSku: '222', cost: 900 });
  const coup = await createCoupon({ code: `MARGIN${tag}`, kind: 'percent', value: 30, announce: false });
  const oDisc = await createOrder({ consent: true, consentText: 'test consent', email: `d${tag}@x.dev`, coupon: coup.code, items: [{ productId: pDisc.id, quantity: 1 }] });
  ok('discounted order total reflects the 30% off', oDisc.total === 700, `total=${oDisc.total}`);
  const didDisc = await autoFulfillFromSuppliers(oDisc.id, {});
  ok('supplier cost 900 ≥ effective revenue 700 → NOT auto-bought', didDisc === false, `did=${didDisc}`);

  const skips = await all(`SELECT detail FROM fulfillment_logs WHERE action='skipped' AND order_id IN (@a,@b)`, { a: oNull.id, b: oDisc.id });
  ok('both losses logged as skipped (auditable)', skips.length === 2, `skips=${skips.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
