/**
 * The release audit of 12 October 2026, pinned. Each case was reproduced on
 * the code before the fix.
 *
 *   A product without a price was sold for nothing: a €0 order is settled as
 *   "covered in full by store credit" and auto-delivered.
 *   The payment-verification queue carried every uploaded screenshot inline, so
 *   a few of them took it past Vercel's 4.5 MB response limit — and the page
 *   then said "Queue is empty" while paid orders waited.
 *   The 14-day sweep cancelled orders whose buyer had sent proof nobody had
 *   reviewed yet, and the reminder told them their payment had not arrived.
 *   A leftover second proof could be confirmed or rejected after the order was
 *   paid: "not verified, resubmit" mailed to a buyer who had paid.
 *   Reopening a failed order that used store credit kept the discount while the
 *   credit was already back in the wallet.
 *   A code handed out by hand from the owner's list stayed 'available' in
 *   stock and was auto-sold to the next buyer.
 *   "Deliver & complete" in the admin delivered an unpaid order.
 *   Guesses at a login code sent in parallel were all compared against an
 *   allowance of five: a burst of 30 walked the owner's code.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_release_audit';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
await (await import('../src/services/bootUpkeep.js')).claimInterval('maintenance_auto', 3_600_000);
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const os = await import('../src/services/orderService.js');
const ps = await import('../src/services/productService.js');
const proofs = await import('../src/services/paymentProofService.js');
const { credit } = await import('../src/services/walletService.js');

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api`;
const stamp = Date.now();

const person = async (role) => {
  const id = newId('usr');
  const e = `${role}-${stamp}-${id.slice(-4)}@example.test`.toLowerCase();
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'Audit', @at, @at)`,
    { id, e, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, @r, @at)`, { u: id, r: role, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id }), {});
  return { id, email: e, H: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' } };
};
const owner = await person('owner');
const call = async (method, path, body, H = owner.H) => {
  const r = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, bytes: text.length };
};
async function product(name, price, { codes = 0 } = {}) {
  const p = await ps.createProduct({ name, category: 'robux', price, announce: false, active: true, metadata: { deliveryMode: 'auto' } });
  for (let i = 0; i < codes; i++) {
    await run(`INSERT INTO product_codes (id, product_id, code, status, created_at) VALUES (@i,@p,@c,'available',@at)`,
      { i: newId('pcd'), p: p.id, c: `${name}-${i}-${stamp}`, at: nowIso() });
  }
  return p;
}
const guestOrder = (productId, extra = {}) => os.createOrder({
  email: `buyer-${newId('x').slice(-6)}@example.test`, consent: true, consentText: 'ok',
  items: [{ productId, quantity: 1 }], ...extra });

console.log('— A product without a price is not for sale —');
{
  const free = await product('Unpriced', 0, { codes: 2 });
  let refused = null;
  try { await guestOrder(free.id); } catch (e) { refused = e.message; }
  ok('an order for a €0 product is refused', !!refused && /not available/i.test(refused), String(refused));
  const q = await call('POST', '/checkout/quote', { items: [{ productId: free.id, quantity: 1 }] });
  ok('…and the quote refuses it too', q.status >= 400, `${q.status}`);
  const codesLeft = (await get(`SELECT COUNT(*)::int AS n FROM product_codes WHERE product_id=@p AND status='available'`, { p: free.id })).n;
  ok('…and no code went out', codesLeft === 2, `${codesLeft}`);
  const listed = (await ps.listProducts({ activeOnly: true })).some((p) => p.id === free.id);
  ok('the shop does not list it', !listed && ps.isSellable({ active: true, kind: 'digital', price: 0 }) === false);

  const draft = await product('DraftUnpriced', 0);
  await run('UPDATE products SET active=0 WHERE id=@id', { id: draft.id });
  const patch = await call('PATCH', `/admin/products/${draft.id}`, { active: true });
  ok('the admin cannot switch an unpriced product on', patch.status === 400, `${patch.status} ${JSON.stringify(patch.json)}`);
  const priced = await product('PricedForBulk', 499);
  await run('UPDATE products SET active=0 WHERE id = ANY(@ids)', { ids: [priced.id, draft.id] });
  const bulk = await call('POST', '/admin/products/bulk', { ids: [priced.id, draft.id], action: 'active', value: true });
  const states = await all('SELECT id, active FROM products WHERE id = ANY(@ids)', { ids: [priced.id, draft.id] });
  ok('showing a selection skips the unpriced one and names it',
    bulk.status === 200 && states.find((s) => s.id === priced.id).active === 1 && states.find((s) => s.id === draft.id).active === 0
      && (bulk.json.skipped || []).includes('DraftUnpriced'), JSON.stringify({ bulk: bulk.json, states }));
}

console.log('\n— The payment-verification queue stays loadable —');
const paid = await product('Proofed', 1500, { codes: 3 });
{
  const o = await guestOrder(paid.id);
  const big = `data:image/png;base64,${'A'.repeat(1_250_000)}`;
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    const r = await call('POST', `/orders/${o.id}/proof`, { transactionId: `TX-${i}-${stamp}`, screenshotUrl: big, email: o.email }, { 'content-type': 'application/json' });
    statuses.push(r.status);
  }
  ok('a fourth waiting proof for one order is refused', statuses.slice(0, 3).every((s) => s === 201) && statuses[3] === 400, JSON.stringify(statuses));
  const q = await call('GET', '/admin/orders/payment/queue');
  ok(`the queue carries no inline images (${Math.round(q.bytes / 1024)} KB for ${q.json?.proofs?.length} proofs)`,
    q.status === 200 && q.bytes < 50_000 && q.json.proofs.every((p) => !p.screenshotUrl || !p.screenshotUrl.startsWith('data:')), `${q.status} ${q.bytes}`);
  ok('…and says which ones have an uploaded screenshot', q.json.proofs.filter((p) => p.orderId === o.id).every((p) => p.screenshotUploaded === true));
  ok('…with the full count', q.json.total >= 3);
  const one = q.json.proofs.find((p) => p.orderId === o.id);
  const shot = await call('GET', `/admin/orders/payment/proofs/${one.id}/screenshot`);
  ok('the screenshot loads on its own when opened', shot.status === 200 && shot.json.screenshotUrl === big);
  const anon = await call('GET', `/admin/orders/payment/proofs/${one.id}/screenshot`, null, {});
  ok('…and not without a login', anon.status === 401 || anon.status === 403, `${anon.status}`);

  console.log('\n— Confirming one proof settles the order\'s others —');
  const mailsBefore = (await all(`SELECT id FROM email_log WHERE to_email=@e AND subject LIKE 'Payment not verified%'`, { e: o.email })).length;
  await proofs.confirmProof(one.id, { user: { id: owner.id } });
  const left = await all(`SELECT status FROM payment_proofs WHERE order_id=@o`, { o: o.id });
  ok('the other waiting proofs are closed', left.filter((p) => p.status === 'pending').length === 0
    && left.filter((p) => p.status === 'superseded').length === 2, JSON.stringify(left));
  const other = (await all(`SELECT id FROM payment_proofs WHERE order_id=@o AND status='superseded'`, { o: o.id }))[0];
  let rejectErr = null;
  try { await proofs.rejectProof(other.id, 'cleanup'); } catch (e) { rejectErr = e.message; }
  const mailsAfter = (await all(`SELECT id FROM email_log WHERE to_email=@e AND subject LIKE 'Payment not verified%'`, { e: o.email })).length;
  ok('a leftover cannot be rejected afterwards, and the paid buyer gets no "not verified" mail',
    !!rejectErr && mailsAfter === mailsBefore, `${rejectErr} ${mailsBefore}->${mailsAfter}`);
}
{
  /* A proof for an order that is no longer open is refused before anything
     is claimed — and stays in the queue for a person to look at. */
  const o = await guestOrder(paid.id);
  const r = await call('POST', `/orders/${o.id}/proof`, { transactionId: `TX-C-${stamp}`, email: o.email }, { 'content-type': 'application/json' });
  await os.transitionOrder(o.id, 'cancelled', { force: true, reason: 'test' });
  let err = null;
  try { await proofs.confirmProof(r.json.id, { user: { id: owner.id } }); } catch (e) { err = e.message; }
  const st = (await get('SELECT status FROM payment_proofs WHERE id=@id', { id: r.json.id })).status;
  ok('confirming a proof of a cancelled order is refused and the proof stays pending', !!err && st === 'pending', `${err} ${st}`);
}

console.log('\n— A buyer who sent proof is not cancelled or chased —');
{
  const withProof = await guestOrder(paid.id);
  await call('POST', `/orders/${withProof.id}/proof`, { transactionId: `TX-W-${stamp}`, email: withProof.email }, { 'content-type': 'application/json' });
  const without = await guestOrder(paid.id);
  const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
  await run('UPDATE orders SET created_at=@at WHERE id = ANY(@ids)', { at: old, ids: [withProof.id, without.id] });
  const { runMaintenance } = await import('../src/services/maintenanceService.js');
  await runMaintenance();
  const a = (await get('SELECT status FROM orders WHERE id=@id', { id: withProof.id })).status;
  const b = (await get('SELECT status FROM orders WHERE id=@id', { id: without.id })).status;
  ok('the 14-day sweep leaves an order with a waiting proof alone', a === 'pending', a);
  ok('…and still cancels one without', b === 'cancelled', b);

  const fresh = await guestOrder(paid.id);
  await call('POST', `/orders/${fresh.id}/proof`, { transactionId: `TX-R-${stamp}`, email: fresh.email }, { 'content-type': 'application/json' });
  await run('UPDATE orders SET created_at=@at WHERE id=@id', { at: new Date(Date.now() - 2 * 3_600_000).toISOString(), id: fresh.id });
  await os.sendPaymentReminders({ afterMinutes: 60 });
  const reminded = (await get('SELECT reminder_sent_at FROM orders WHERE id=@id', { id: fresh.id })).reminder_sent_at;
  ok('…and gets no "we have not received your payment" reminder', !reminded, String(reminded));
}

console.log('\n— A failed order that used store credit is not reopened —');
{
  const buyer = await person('customer');
  await credit(buyer.id, 1000, 'adjustment', 'test');
  const o = await os.createOrder({ email: buyer.email, userId: buyer.id, consent: true, consentText: 'ok',
    items: [{ productId: paid.id, quantity: 1 }], useCredit: 1000 });
  await os.transitionOrder(o.id, 'failed', { reason: 'fraud block' });
  let err = null;
  try { await os.transitionOrder(o.id, 'pending', { reason: 'reopen' }); } catch (e) { err = e.message; }
  ok('reopening it is refused with the reason', !!err && /new order/i.test(err), String(err));
  const plain = await guestOrder(paid.id);
  await os.transitionOrder(plain.id, 'failed', { reason: 'test' });
  const reopened = await os.transitionOrder(plain.id, 'pending', { reason: 'reopen' });
  ok('…while one without credit or a code still can be', reopened.status === 'pending', reopened.status);
}

console.log('\n— A code handed out by hand leaves the stock —');
{
  const stocked = await product('HandStock', 900, { codes: 3 });
  const manual = await ps.createProduct({ name: 'HandOnly', category: 'robux', price: 700, announce: false, active: true,
    metadata: { deliveryMode: 'manual' } });
  const o = await os.createOrder({ email: `mixed-${stamp}@example.test`, consent: true, consentText: 'ok',
    items: [{ productId: stocked.id, quantity: 1 }, { productId: manual.id, quantity: 1 }] });
  await os.markPaymentReceived(o.id, `pay_mixed_${stamp}`);
  await new Promise((r) => setTimeout(r, 3000));
  const handed = `HandStock-0-${stamp}`;
  const r = await call('POST', `/admin/orders/${o.id}/deliver`, { deliveries: [{ content: handed }, { content: 'ROBLOX-TOPUP-DONE', type: 'message' }] });
  ok('staff deliver the mixed order by hand', r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  const row = await get(`SELECT status, order_id FROM product_codes WHERE code=@c`, { c: handed });
  ok('the stocked copy of the code they handed out is no longer available', row.status === 'used' && row.order_id === o.id, JSON.stringify(row));
  const next = await guestOrder(stocked.id);
  await os.markPaymentReceived(next.id, `pay_next_${stamp}`);
  await new Promise((r) => setTimeout(r, 3000));
  const got = (await all('SELECT content FROM deliveries WHERE order_id=@o', { o: next.id })).map((d) => d.content);
  ok('the next buyer is not sold the same code', got.length === 1 && !got.includes(handed), JSON.stringify(got));
}

console.log('\n— Delivering needs a paid order —');
{
  const o = await guestOrder(paid.id);
  const r = await call('POST', `/admin/orders/${o.id}/deliver`, { deliveries: [{ content: 'FREE-FOR-ALL' }] });
  const after = await get('SELECT status, payment_status FROM orders WHERE id=@id', { id: o.id });
  ok('"deliver & complete" on an unpaid order is refused', r.status === 409 && after.status === 'pending', `${r.status} ${JSON.stringify(after)}`);
  const none = await get('SELECT COUNT(*)::int AS n FROM deliveries WHERE order_id=@o', { o: o.id });
  ok('…and nothing was delivered', none.n === 0);
}

console.log('\n— One code, one product —');
{
  const a = await product('DupA', 999);
  const b = await product('DupB', 999);
  const { addProductCodes } = await import('../src/services/codeStockService.js');
  await addProductCodes(a.id, [`SHARED-${stamp}`]);
  const added = await addProductCodes(b.id, [`SHARED-${stamp}`, `OWN-${stamp}`]);
  ok('a code already stocked under another product is not loaded again', (typeof added === 'number' ? added : added.added) === 1, JSON.stringify(added));
}

console.log('\n— Thirty guesses at once still get five —');
{
  /* The correct code is guess number 20 of a burst of 30 sent in parallel.
     Before, every one of them was compared and the 20th signed in. */
  const { verifyEmailOtp, verifyPhoneOtp } = await import('../src/services/authService.js');
  const { sha256 } = await import('../src/utils/crypto.js');
  const plant = async (table, col, val, code) => run(
    `INSERT INTO ${table} (id, ${col}, code_hash, attempts, expires_at, created_at) VALUES (@id, @v, @h, 0, @exp, @at)`,
    { id: newId('otp'), v: val, h: sha256(code), exp: new Date(Date.now() + 600_000).toISOString(), at: nowIso() });
  const victim = `owner-${stamp}@example.test`;
  await plant('otp_codes', 'email', victim, '424242');
  const guesses = Array.from({ length: 30 }, (_, i) => (i === 19 ? '424242' : String(100000 + i)));
  const results = await Promise.allSettled(guesses.map((g) => verifyEmailOtp(victim, g, { ip: `198.51.100.${guesses.indexOf(g) % 250}` })));
  const signedIn = results.filter((r) => r.status === 'fulfilled').length;
  const compared = results.filter((r) => r.status === 'rejected' && /Incorrect code/.test(r.reason?.message)).length;
  const row = await get('SELECT attempts, consumed_at FROM otp_codes WHERE email=@e', { e: victim });
  ok(`no more than five guesses are compared (${compared} compared, attempts ${row.attempts})`, compared + signedIn <= 5 && row.attempts <= 5,
    JSON.stringify({ compared, signedIn, attempts: row.attempts }));
  ok('…so the correct code as guess 20 does not sign in', signedIn === 0, String(signedIn));
  ok('…and the code is burnt', !!row.consumed_at);

  const phone = '+31612340000';
  await plant('sms_verifications', 'phone', phone, '515151');
  const r2 = await Promise.allSettled(guesses.map((g) => verifyPhoneOtp(phone, g === '424242' ? '515151' : g, {})));
  ok('the same holds for an SMS code', r2.filter((r) => r.status === 'fulfilled').length === 0
    && r2.filter((r) => r.status === 'rejected' && /Incorrect code/.test(r.reason?.message)).length <= 5);

  await plant('otp_codes', 'email', `honest-${stamp}@example.test`, '777777');
  const fine = await verifyEmailOtp(`honest-${stamp}@example.test`, '777777', {});
  ok('a correct first guess still signs in', !!(fine.accessToken || fine.totpRequired), JSON.stringify(Object.keys(fine)));
}

console.log('\n— Signing in cannot be blocked or hijacked from outside —');
{
  /* Junk checks against an address with no code used to count as failures:
     ten of them and the owner could not request a login code for 15 minutes. */
  const target = `lockme-${stamp}@example.test`;
  // From three connections (the per-connection limit allows five a minute each).
  const senders = [await person('customer'), await person('customer'), await person('customer')];
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${base}/auth/otp/verify`, { method: 'POST', headers: senders[i % 3].H,
      body: JSON.stringify({ identifier: target, code: '000000' }) });
    codes.push(r.status);
  }
  // The owner signs in from their own connection, not the attacker's.
  const { recentFailures } = await import('../src/services/deviceService.js');
  const counted = await recentFailures(target, '203.0.113.99');
  ok(`twelve junk checks do not lock an address out of signing in (${counted} counted, limit 10)`, counted < 10, `${counted} ${codes.join(',')}`);

  const fs = await import('node:fs');
  const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  ok('the sign-in callback carries no access token in the URL',
    !/#token=\$\{/.test(read('server/src/routes/auth.js')) && !/params\.get\('token'\)/.test(read('src/pages/AuthCallback.jsx')));
  ok('…and takes the session from the httpOnly cookie instead', /api\.refresh\(\)/.test(read('src/pages/AuthCallback.jsx')));
  ok('one token refresh at a time in the browser (a second use of a rotated secret revoked the session)',
    /if \(!refreshing\) refreshing = doRefresh\(\)/.test(read('src/lib/api.js')));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} release-audit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
