/**
 * Pay. (pay.nl), end to end, against a Pay. that answers the way its
 * documentation says it does.
 *
 * Only Pay.'s server is stubbed (connect.pay.nl). Our service, routes, state
 * machine and delivery are the real ones, reached over real HTTP.
 *
 * What this pins, because each is money:
 *   - only Pay.'s API decides "paid": a forged exchange that claims code 100
 *     settles nothing;
 *   - amount, currency, reference, service and sandbox must all match;
 *   - Pay. has no idempotency key, so two clicks open ONE payment;
 *   - a buyer who starts iDEAL, then Bancontact, and finishes the FIRST one
 *     after all is still settled — and a second finished payment reaches the
 *     owner instead of vanishing;
 *   - a refund through Pay. is reported as still to be made in my.pay.nl,
 *     never as done;
 *   - a missed exchange is caught by reconciliation.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_paynl_test';
process.env.NODE_ENV ||= 'development';
process.env.LAUNCH_MODE ||= 'open';
process.env.PAYNL_SERVICE_ID = 'SL-1234-5678';
process.env.PAYNL_SERVICE_SECRET = 'a'.repeat(40);
process.env.APP_URL = 'http://localhost:3000';
process.env.DEMO_PAYMENTS = 'true';
process.env.PAY_TIKKIE = 'https://tikkie.me/pay/test123';   // to prove the demo self-pay route closes under Pay.
delete process.env.MOLLIE_API_KEY;
delete process.env.STRIPE_SECRET_KEY;

import net from 'node:net';
import fs from 'node:fs';
const sink = net.createServer((sock) => {
  let buf = '', inData = false;
  sock.write('220 sink ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    for (;;) {
      const i = buf.indexOf('\r\n');
      if (i < 0) break;
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) { if (line === '.') { inData = false; sock.write('250 OK\r\n'); } continue; }
      const cmd = line.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-sink\r\n250 8BITMIME\r\n');
      else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => sink.listen(0, r));
process.env.SMTP_URL = `smtp://127.0.0.1:${sink.address().port}`;

/* Pay., as far as our code can tell. */
const orders = new Map();
const calls = [];
let failNext = 0;
const realFetch = globalThis.fetch;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://connect.pay.nl/')) return realFetch(url, init);
  calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
  if (failNext > 0) { failNext--; return json({ message: 'down' }, 503); }
  if ((init.method || 'GET') === 'POST' && /\/v1\/orders$/.test(u)) {
    const b = JSON.parse(init.body);
    // A small delay, so two concurrent starts genuinely overlap.
    await new Promise((r) => setTimeout(r, 150));
    const id = `${Math.random().toString(16).slice(2, 10)}-aaaa-bbbb-cccc-${Date.now().toString(16)}`;
    const o = { id, orderId: `51${Math.floor(Math.random() * 1e9)}X`, serviceId: b.serviceId, reference: b.reference,
      description: b.description, amount: b.amount, status: { code: 20, action: 'PENDING' },
      integration: { test: !!b.integration?.test }, payments: [{ paymentMethod: { id: b.paymentMethod?.id ?? null } }],
      links: { redirect: `https://checkout.pay.nl/test/${id}`, status: `https://connect.pay.nl/v1/orders/${id}/status` } };
    orders.set(id, o);
    return json(o, 201);
  }
  const m = u.match(/\/v1\/orders\/([A-Za-z0-9-]+)\/status$/);
  if (m) {
    const o = orders.get(m[1]);
    return o ? json(o) : json({ message: 'Order not found' }, 404);
  }
  return json({ message: 'unexpected' }, 404);
};

const { ensureReady, createApp } = await import('../src/app.js');
await ensureReady();
await (await import('../src/services/bootUpkeep.js')).claimInterval('maintenance_auto', 3_600_000);
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const svc = await import('../src/services/paynlService.js');
const { reconcilePaynl } = await import('../src/routes/paynl.js');
const { refundOrder } = await import('../src/services/refundService.js');
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };
const settle = () => new Promise((r) => setTimeout(r, 2500));

async function product(name, codes = 4, mode = 'auto') {
  const id = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,@s,@n,'robux','t',999,'EUR','digital',1,@m,@at,@at)`,
    { id, s: `P-${id.slice(-8)}`, n: name, m: JSON.stringify({ deliveryMode: mode, image: '/products/icons/robux.webp' }), at: nowIso() });
  for (let i = 0; i < codes; i++) {
    await run(`INSERT INTO product_codes (id, product_id, code, status, created_at) VALUES (@i,@p,@c,'available',@at)`,
      { i: newId('pcd'), p: id, c: `${name}-C${i}-${id.slice(-5)}`, at: nowIso() });
  }
  return id;
}
const place = async (pid) => {
  const r = await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `b-${newId('x').slice(-6)}@example.com`, consent: true, consentText: 'ok',
      items: [{ productId: pid, quantity: 1 }] }) });
  const b = await r.json();
  if (!b.order) throw new Error(`order not placed: ${JSON.stringify(b).slice(0, 200)}`);
  return b.order;
};
const start = async (order, method = 'ideal') => {
  const r = await fetch(`${base}/api/orders/${order.id}/paynl`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: order.email, method }) });
  return { status: r.status, body: await r.json() };
};
const exchangeForm = (id) => fetch(`${base}/api/payments/paynl/exchange`, { method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `action=new_ppt&order_id=${id}` });
const exchangeJson = (obj) => fetch(`${base}/api/payments/paynl/exchange`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const snap = async (id) => {
  const o = await get(`SELECT status, payment_status, payment_ref, psp_provider, psp_status, psp_payment_id FROM orders WHERE id=@id`, { id });
  const d = await all(`SELECT 1 FROM deliveries WHERE order_id=@id`, { id });
  const a = await all(`SELECT action FROM audit_logs WHERE target_id=@id ORDER BY created_at`, { id });
  return { ...o, deliveries: d.length, audit: a.map((x) => x.action) };
};
const setCode = (id, code, patch = {}) => { const o = orders.get(id); o.status = { code, action: String(code) }; Object.assign(o, patch); };

console.log('\n━━ Status codes ━━');
{
  ok('only 100 is paid', svc.statusFromCode(100) === 'paid' && [20, 50, 85, 90, 95, 97].every((c) => svc.statusFromCode(c) !== 'paid'));
  ok('85 (Pay. VERIFY) waits for review, not paid', svc.orderEffect({ status: svc.statusFromCode(85) }).effect === 'verify');
  ok('cancel / expire / fail leave the order payable',
    [-90, -80, -60].every((c) => svc.orderEffect({ status: svc.statusFromCode(c) }).effect === 'retryable'));
  ok('refund and chargeback codes ask for the owner',
    [-81, -82, -71].every((c) => svc.orderEffect({ status: svc.statusFromCode(c) }).effect === 'attention'));
  ok('the reference is the order number in letters and digits', svc.referenceFor('FM-2026-AB7K9XQ2') === 'FM2026AB7K9XQ2');
  let threw = false; try { svc.toCents(0); } catch { threw = true; }
  ok('a zero amount is refused', threw);
}

console.log('\n━━ The shop runs on Pay. ━━');
{
  const cfg = await (await fetch(`${base}/api/config`)).json();
  ok('the checkout provider is Pay.', cfg.paymentProvider === 'paynl', cfg.paymentProvider);
  ok('iDEAL and Bancontact are offered', JSON.stringify((cfg.paynlMethods || []).map((m) => m.id)) === '["ideal","bancontact"]',
    JSON.stringify(cfg.paynlMethods));
  ok('ordering is not paused', cfg.orderingPaused === false, String(cfg.orderingPaused));
}

console.log('\n━━ Starting a payment ━━');
const p1 = await product('PayA');
const o1 = await place(p1);
{
  const r = await start(o1);
  ok('a Pay. checkout link comes back', r.status === 201 && /checkout\.pay\.nl/.test(r.body.checkoutUrl || ''), JSON.stringify(r.body));
  const c = calls.find((x) => x.method === 'POST');
  ok('authenticated with the SL-code and secret',
    c.headers.authorization === `Basic ${Buffer.from(`SL-1234-5678:${'a'.repeat(40)}`).toString('base64')}`);
  ok('the amount is the order total, in cents', c.body.amount.value === o1.total && c.body.amount.currency === 'EUR',
    JSON.stringify(c.body.amount));
  ok('the reference is our order number', c.body.reference === svc.referenceFor(o1.number), c.body.reference);
  ok('iDEAL is preselected (payment option 10)', c.body.paymentMethod?.id === 10);
  ok('Pay. is told where to call back', /\/api\/payments\/paynl\/exchange$/.test(c.body.exchangeUrl), c.body.exchangeUrl);
  ok('not a sandbox payment', !c.body.integration, JSON.stringify(c.body.integration));
  const s = await snap(o1.id);
  ok('the payment is stored on the order, still pending', s.psp_provider === 'paynl' && s.status === 'pending' && s.deliveries === 0);

  const again = await start(o1);
  ok('coming back resumes the same payment', again.body.resumed === true && again.body.paymentId === r.body.paymentId,
    JSON.stringify(again.body));
}

console.log('\n━━ A double tap opens one payment ━━');
{
  const o = await place(await product('PayDouble'));
  const before = calls.filter((x) => x.method === 'POST').length;
  const [a, b] = await Promise.all([start(o), start(o)]);
  const created = calls.filter((x) => x.method === 'POST').length - before;
  ok(`two simultaneous starts create one Pay. order (${created})`, created === 1 && a.body.paymentId === b.body.paymentId,
    JSON.stringify([a.body, b.body]));
}

console.log('\n━━ The exchange call is a hint, never evidence ━━');
{
  const s0 = await snap(o1.id);
  const r = await exchangeJson({ event: 'status_changed', type: 'order', id: s0.psp_payment_id,
    object: { id: s0.psp_payment_id, status: { code: 100, action: 'PAID' }, amount: { value: o1.total } } });
  const body = await r.json();
  ok('a JSON exchange is answered {result: true}', r.status === 200 && body.result === true, JSON.stringify(body));
  const s = await snap(o1.id);
  ok('…and a forged "paid" while Pay. says pending settles nothing', s.status === 'pending' && s.deliveries === 0, s.status);
  const src = fs.readFileSync(new URL('../src/routes/paynl.js', import.meta.url), 'utf8');
  ok('the route never reads a status or action from the request',
    !/req\.(body|query)(\?\.|\.)?\s*(status|action|statusAction|statusCode)/.test(src) && !/obj\.status/.test(src));
}

console.log('\n━━ Paid ━━');
{
  const s0 = await snap(o1.id);
  setCode(s0.psp_payment_id, 100);
  const r = await exchangeForm(s0.psp_payment_id);
  const text = await r.text();
  ok('a form exchange is answered TRUE|', r.status === 200 && text.startsWith('TRUE|'), `${r.status} ${text}`);
  await settle();
  const s = await snap(o1.id);
  ok('the order is completed with one code', s.status === 'completed' && s.deliveries === 1, `${s.status} ${s.deliveries}`);
  ok('payment_status paid, payment_ref is the Pay. id', s.payment_status === 'paid' && s.payment_ref === s0.psp_payment_id);
  ok('audited as received', s.audit.includes('order.payment_received'));

  await Promise.all([1, 2, 3, 4].map(() => exchangeForm(s0.psp_payment_id)));
  await settle();
  const s2 = await snap(o1.id);
  ok('four more exchanges deliver nothing more', s2.deliveries === 1, `${s2.deliveries}`);
  const r2 = await fetch(`${base}/api/payments/paynl/exchange?order_id=${s0.psp_payment_id}`);
  ok('a GET exchange works too', r2.status === 200 && (await r2.text()).startsWith('TRUE|'));
}

console.log('\n━━ Nothing but an exact match settles ━━');
for (const [label, patch] of [
  ['a wrong amount', (o) => ({ amount: { value: o.total - 1, currency: 'EUR' } })],
  ['a wrong currency', (o) => ({ amount: { value: o.total, currency: 'USD' } })],
  ['another order\'s reference', () => ({ reference: 'FM2026ZZZZZZZZ' })],
  ['another service', () => ({ serviceId: 'SL-9999-9999' })],
  ['a sandbox payment on a live shop', () => ({ integration: { test: true } })],
]) {
  const o = await place(await product(`PayMis${label.length}`));
  const r = await start(o);
  setCode(r.body.paymentId, 100, patch(o));
  await exchangeForm(r.body.paymentId);
  await settle();
  const s = await snap(o.id);
  ok(`${label}: still pending, nothing delivered, mismatch audited`,
    s.status === 'pending' && s.deliveries === 0 && s.audit.includes('order.payment_mismatch'), `${s.status} ${JSON.stringify(s.audit)}`);
}

console.log('\n━━ Not paid yet ━━');
for (const code of [85, 95, 50, -90, -80]) {
  const o = await place(await product(`PayCode${Math.abs(code)}`));
  const r = await start(o);
  setCode(r.body.paymentId, code);
  await exchangeForm(r.body.paymentId);
  const s = await snap(o.id);
  ok(`code ${code} delivers nothing`, s.status === 'pending' && s.deliveries === 0, s.status);
}

console.log('\n━━ iDEAL started, Bancontact started, iDEAL finished after all ━━');
{
  const o = await place(await product('PaySwitch'));
  const first = await start(o, 'ideal');
  const second = await start(o, 'bancontact');
  ok('switching method opens a new payment', second.body.paymentId && second.body.paymentId !== first.body.paymentId);
  const attempts = await all(`SELECT payment_id FROM psp_attempts WHERE order_id=@o`, { o: o.id });
  ok('both attempts are kept', attempts.length === 2, `${attempts.length}`);
  setCode(first.body.paymentId, 100);
  const r = await exchangeForm(first.body.paymentId);
  ok('the exchange for the first payment is accepted', r.status === 200);
  await settle();
  const s = await snap(o.id);
  ok('the order is settled by the payment the buyer finished', s.status === 'completed' && s.payment_ref === first.body.paymentId,
    `${s.status} ${s.payment_ref}`);

  setCode(second.body.paymentId, 100);
  await exchangeForm(second.body.paymentId);
  await settle();
  const s2 = await snap(o.id);
  ok('a second finished payment reaches the owner and changes nothing else',
    s2.audit.includes('order.payment_stray') && s2.deliveries === 1 && s2.payment_ref === first.body.paymentId,
    JSON.stringify(s2.audit));
}

console.log('\n━━ When Pay. or the exchange misbehaves ━━');
{
  const r1 = await exchangeForm('ffffffff-0000-0000-0000-000000000000');
  ok('an unknown id is acknowledged, not retried forever', r1.status === 200 && (await r1.text()).startsWith('TRUE|'));
  const r2 = await exchangeForm('<script>');
  ok('a malformed id is acknowledged', r2.status === 200);
  const o = await place(await product('PayDown'));
  const st = await start(o);
  failNext = 1;
  const r3 = await exchangeForm(st.body.paymentId);
  const t3 = await r3.text();
  ok('Pay.\'s API down → FALSE and 500, so Pay. retries', r3.status === 500 && t3.startsWith('FALSE|'), `${r3.status} ${t3}`);
}

console.log('\n━━ A missed exchange is caught by reconciliation ━━');
{
  const o = await place(await product('PayRecon'));
  const r = await start(o);
  setCode(r.body.paymentId, 100);
  const res = await reconcilePaynl({ olderThanMs: 0, limit: 50, deadline: Date.now() + 20_000 });
  await settle();
  const s = await snap(o.id);
  ok(`reconciliation settles it (${JSON.stringify(res)})`, s.status === 'completed' && s.deliveries === 1, s.status);
}

console.log('\n━━ The return page ━━');
{
  const o = await place(await product('PaySync'));
  const r = await start(o);
  setCode(r.body.paymentId, 100);
  const sync = await (await fetch(`${base}/api/orders/${o.id}/payment/sync`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number: o.number }) })).json();
  ok('the sync re-checks Pay. and reports paid', ['payment_received', 'processing', 'completed'].includes(sync.status), JSON.stringify(sync));
  const wrong = await fetch(`${base}/api/orders/${o.id}/payment/sync`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number: 'FM-0000-NOTTHIS' }) });
  ok('without the order number it is refused', wrong.status >= 400, `${wrong.status}`);
}

console.log('\n━━ Resuming from the track page ━━');
{
  const o = await place(await product('PayTrack'));
  await start(o);
  const t = await (await fetch(`${base}/api/track/${o.number}`)).json();
  ok('a pending Pay. order offers its payment link', /checkout\.pay\.nl/.test(t.payUrl || ''), String(t.payUrl));
}

console.log('\n━━ Refunds ━━');
{
  const o = await place(await product('PayRefund', 4, 'manual'));
  const r = await start(o);
  setCode(r.body.paymentId, 100);
  await exchangeForm(r.body.paymentId);
  await settle();
  const postsBefore = calls.length;
  const out = await refundOrder(o.id, { method: 'money', actorId: 'staff', reason: 'test' });
  ok('the order is refunded here', out.order.status === 'refunded', out.order.status);
  ok('…reported as a refund still to make in my.pay.nl', out.refund.via === 'paynl' && out.refund.provider === 'manual'
    && out.refund.cents === o.total, JSON.stringify(out.refund));
  ok('…and no money-moving call went to Pay.', calls.slice(postsBefore).every((c) => c.method === 'GET'));

  const o2 = await place(await product('PayChargeback', 4, 'manual'));
  const r2 = await start(o2);
  setCode(r2.body.paymentId, 100);
  await exchangeForm(r2.body.paymentId);
  await settle();
  setCode(r2.body.paymentId, -71);
  await exchangeForm(r2.body.paymentId);
  const s = await snap(o2.id);
  ok('a chargeback from Pay. alerts instead of moving the order', s.status !== 'refunded' && s.audit.includes('order.psp_attention'),
    `${s.status} ${JSON.stringify(s.audit)}`);
}

console.log('\n━━ The demo self-pay route is closed ━━');
{
  const o = await place(await product('PayDemo'));
  const r = await fetch(`${base}/api/orders/${o.id}/pay`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: o.email }) });
  const s = await snap(o.id);
  ok('/pay answers 404 and the order stays pending', r.status === 404 && s.status === 'pending', `${r.status} ${s.status}`);
}


console.log('\n━━ Review findings ━━');
{
  // Two paid attempts settled at the same moment: one wins, the other reaches the owner.
  const o = await place(await product('PayRace'));
  const a = await start(o, 'ideal');
  const b = await start(o, 'bancontact');
  setCode(a.body.paymentId, 100); setCode(b.body.paymentId, 100);
  await Promise.all([exchangeForm(a.body.paymentId), exchangeForm(b.body.paymentId),
    fetch(`${base}/api/orders/${o.id}/payment/sync`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ number: o.number }) })]);
  await settle();
  const s = await snap(o.id);
  const strays = s.audit.filter((x) => x === 'order.payment_stray').length;
  ok(`two paid attempts at once: one delivery, the other reported (${strays})`,
    s.deliveries === 1 && strays >= 1 && [a.body.paymentId, b.body.paymentId].includes(s.payment_ref), JSON.stringify(s));

  // A paid payment on an order the sweep already cancelled is reported, not dropped.
  const c = await place(await product('PayCancelled'));
  const cs = await start(c);
  await run(`UPDATE orders SET status='cancelled' WHERE id=@id`, { id: c.id });
  setCode(cs.body.paymentId, 100);
  const rc = await exchangeForm(cs.body.paymentId);
  const sc = await snap(c.id);
  ok('paid on a cancelled order → owner told, nothing delivered', rc.status === 200 && sc.deliveries === 0
    && sc.audit.includes('order.payment_stray'), JSON.stringify(sc.audit));

  // Wrong credentials are not "Pay.'s final answer": retried and reported.
  const d = await place(await product('PayAuth'));
  const ds = await start(d);
  const realStatus = orders.get(ds.body.paymentId);
  orders.delete(ds.body.paymentId);
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://connect.pay.nl/')
    ? new Response('{"message":"unauthorized"}', { status: 401 }) : saved(url, init));
  const ra = await exchangeForm(ds.body.paymentId);
  globalThis.fetch = saved;
  orders.set(ds.body.paymentId, realStatus);
  ok('a 401 from Pay. answers FALSE so Pay. retries', ra.status === 500 && (await ra.text()).startsWith('FALSE|'));

  // An older attempt, named by the exchange, is found even after many newer ones.
  const e = await place(await product('PayMany'));
  const first = await start(e, 'ideal');
  for (let i = 0; i < 4; i++) { await start(e, i % 2 ? 'ideal' : 'bancontact'); }
  // the abandoned ones are closed at Pay.
  for (const [id, ord] of orders) if (ord.reference === svc.referenceFor(e.number) && id !== first.body.paymentId) setCode(id, -90);
  setCode(first.body.paymentId, 100);
  await exchangeForm(first.body.paymentId);
  await settle();
  const se = await snap(e.id);
  ok('the first of many attempts still settles the order', se.status === 'completed' && se.payment_ref === first.body.paymentId,
    `${se.status} ${se.payment_ref}`);

  // A payment Pay. holds for review blocks a second payment.
  const f = await place(await product('PayVerify'));
  const fs1 = await start(f, 'ideal');
  setCode(fs1.body.paymentId, 85);
  await exchangeForm(fs1.body.paymentId);
  const again = await start(f, 'bancontact');
  ok('no second payment while the first is under review', again.status === 409, `${again.status} ${JSON.stringify(again.body)}`);

  // The account page's Pay button (no method) resumes the Bancontact payment.
  const g = await place(await product('PayResumeBc'));
  const gs = await start(g, 'bancontact');
  const r = await fetch(`${base}/api/orders/${g.id}/paynl`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: g.email }) });
  const gb = await r.json();
  ok('Pay with no method resumes the open Bancontact payment', gb.resumed === true && gb.paymentId === gs.body.paymentId,
    JSON.stringify(gb));

  // A forged call with no id does nothing at all.
  const before = calls.length;
  const rf = await fetch(`${base}/api/payments/paynl/exchange`, { method: 'POST' });
  ok('an exchange without any id costs no Pay. request', rf.status === 200 && calls.length === before, `${calls.length - before}`);
  await Promise.all([1, 2, 3].map(() => exchangeForm('deadbeef-0000-1111-2222-333344445555')));
  const sweeps = calls.slice(before).length;
  ok(`unmatched ids sweep at most once per 30 seconds (${sweeps} Pay. requests for 3 calls)`, sweeps <= 6);

  // Pay. echoes the service id in capitals; a lower-case entry is the same service.
  const { config } = await import('../src/config/env.js');
  config.payments.paynl.serviceId = 'sl-1234-5678';
  const h = await place(await product('PayCase'));
  const hs = await start(h);
  orders.get(hs.body.paymentId).serviceId = 'SL-1234-5678';
  setCode(hs.body.paymentId, 100);
  await exchangeForm(hs.body.paymentId);
  config.payments.paynl.serviceId = 'SL-1234-5678';
  await settle();
  ok('a lower-case service id still settles', (await snap(h.id)).status === 'completed');

  // With Pay. live, the order mail and track page do not offer manual links.
  const { manualPayMethods: _m } = await import('../src/config/env.js');
  const t = await (await fetch(`${base}/api/track/${f.number}`)).json();
  ok('no manual pay links on a Pay. order', (t.payMethods || []).length === 0, JSON.stringify(t.payMethods));
}

console.log('\n━━ Wiring ━━');
{
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  ok('the exchange parsers come before the JSON parser',
    app.indexOf("'/api/payments/paynl/exchange'") < app.indexOf("app.use(express.json({ limit: '3mb' }))"));
  ok('the exchange is mounted before the general API limiter',
    app.indexOf("app.use('/api/payments', paynlExchange)") < app.indexOf("bucket: 'api'"));
  const route = fs.readFileSync(new URL('../src/routes/paynl.js', import.meta.url), 'utf8');
  ok('starting a payment is behind the launch gate', /paynlApi\.post\('\/orders\/:id\/paynl', requireLaunched/.test(route));
  const service = fs.readFileSync(new URL('../src/services/paynlService.js', import.meta.url), 'utf8');
  ok('every Pay. call has a deadline', /AbortController/.test(service));
}

srv.close(); sink.close();
console.log(`\n${fail ? '❌' : '✅'} paynl: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
