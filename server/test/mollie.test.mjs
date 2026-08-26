/**
 * Mollie payments.
 *
 * Everything here is about money moving, so the tests are about the ways that
 * goes wrong rather than the happy path alone:
 *
 *  - Amounts. Mollie speaks decimal strings ("10.00"), not minor units. Send it
 *    1000 for a tenner and you have charged a thousand euro. One conversion,
 *    tested from both sides.
 *  - Trust. The webhook body is `id=tr_xxx` with no signature. Anyone can POST
 *    one. Nothing may be believed except what the API answers for that id, and
 *    a payment whose amount does not match the order must never settle it.
 *  - Repetition. Mollie fires the same webhook again on a refund, and retries
 *    anything that did not return 2xx. Every path has to survive being run twice.
 *
 * The Mollie API itself is stubbed at `fetch`, so the real client code runs —
 * headers, URL building, amount parsing and all — against canned responses.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_mollie';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';
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

process.env.MOLLIE_API_KEY = 'test_stubbedkey';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

// ── Stubbed Mollie API ───────────────────────────────────────────────────────
// Keyed by payment id. Tests mutate these to move a payment along, exactly as
// Mollie would between two webhook calls for the same id.
const payments = new Map();
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.mollie.com/')) return realFetch(url, init);
  calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {},
    body: init.body ? JSON.parse(init.body) : null });

  const json = (status, data) => new Response(JSON.stringify(data), { status });

  const m = u.match(/\/v2\/payments\/([^/?]+)$/);
  if (m) {
    const p = payments.get(decodeURIComponent(m[1]));
    return p ? json(200, p) : json(404, { detail: 'No payment exists with token' });
  }
  if (/\/v2\/payments$/.test(u) && init.method === 'POST') {
    const body = JSON.parse(init.body);
    const id = `tr_created${payments.size}`;
    const p = { id, status: 'open', amount: body.amount, metadata: body.metadata,
      _links: { checkout: { href: `https://www.mollie.com/checkout/${id}` } } };
    payments.set(id, p);
    return json(201, p);
  }
  if (/\/refunds$/.test(u) && init.method === 'POST') {
    const body = JSON.parse(init.body);
    return json(201, { id: 're_1', status: 'pending', amount: body.amount });
  }
  if (/\/v2\/methods/.test(u)) {
    return json(200, { _embedded: { methods: [
      { id: 'ideal', description: 'iDEAL', image: { svg: 'https://x/ideal.svg' } },
      { id: 'bancontact', description: 'Bancontact' },
      { id: 'giropay', description: 'giropay' },   // not offered by this shop
    ] } });
  }
  return json(404, { detail: `unstubbed ${u}` });
};

await (await import('../src/app.js')).ensureReady();
const mollie = await import('../src/services/mollieService.js');
const { applyPayment } = await import('../src/routes/mollie.js');
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes, availableCount, claimCodes, releaseCodes } =
  await import('../src/services/codeStockService.js');
const { createOrder, getOrder, getPspPayment, transitionOrder, deliverOrder } =
  await import('../src/services/orderService.js');
const { all } = await import('../src/db/index.js');

const tag = Date.now() % 1000000;

// ── Amounts ──────────────────────────────────────────────────────────────────
console.log('— Cents ⇄ Mollie decimal strings —');
{
  ok('1000 cents is "10.00", not 1000', mollie.toAmount(1000).value === '10.00',
    JSON.stringify(mollie.toAmount(1000)));
  ok('a single cent keeps both decimals', mollie.toAmount(1).value === '0.01');
  ok('999999 cents is "9999.99"', mollie.toAmount(999999).value === '9999.99');
  ok('a third of a cent is rounded, not truncated', mollie.toAmount(1499.6).value === '15.00');
  ok('currency is upper-cased', mollie.toAmount(500, 'eur').currency === 'EUR');
  let threw = false;
  try { mollie.toAmount(0); } catch { threw = true; }
  ok('a zero amount is refused rather than sent', threw);
  threw = false;
  try { mollie.toAmount(-100); } catch { threw = true; }
  ok('a negative amount is refused', threw);

  ok('"10.00" comes back as 1000 cents', mollie.fromAmount({ value: '10.00' }) === 1000);
  ok('"0.07" comes back as 7 cents', mollie.fromAmount({ value: '0.07' }) === 7);
  ok('"14.38" survives the float round-trip', mollie.fromAmount({ value: '14.38' }) === 1438);
  ok('a missing amount is 0, not NaN', mollie.fromAmount(undefined) === 0);
  // Every price in the shop, both ways. A rounding bug that only bites at one
  // amount is exactly the kind that reaches production.
  let roundTripOk = true;
  for (let c = 1; c <= 20000; c++) {
    if (mollie.fromAmount(mollie.toAmount(c)) !== c) { roundTripOk = false; console.log(`     broke at ${c}`); break; }
  }
  ok('every amount from €0.01 to €200 round-trips exactly', roundTripOk);
}

// ── Status mapping ───────────────────────────────────────────────────────────
console.log('— What a Mollie status means for an order —');
{
  const base = { amountCents: 1000, refundedCents: 0, chargedBackCents: 0, method: 'ideal' };
  const eff = (over) => mollie.orderEffect({ ...base, ...over }).effect;

  ok('paid settles the order', eff({ status: 'paid' }) === 'paid');
  ok('authorized settles the order', eff({ status: 'authorized' }) === 'paid');
  ok('open does nothing yet', eff({ status: 'open' }) === 'none');
  ok('pending does nothing yet', eff({ status: 'pending' }) === 'none');
  // The buyer backed out, timed out or was declined. All recoverable — closing
  // the order here would kill a sale that is still alive.
  ok('canceled leaves the order retryable', eff({ status: 'canceled' }) === 'retryable');
  ok('expired leaves the order retryable', eff({ status: 'expired' }) === 'retryable');
  ok('failed leaves the order retryable', eff({ status: 'failed' }) === 'retryable');

  ok('a full refund refunds the order',
    eff({ status: 'paid', refundedCents: 1000 }) === 'refunded');
  ok('a partial refund does NOT refund the whole order',
    eff({ status: 'paid', refundedCents: 400 }) === 'partial_refund');
  ok('a chargeback outranks everything else',
    eff({ status: 'paid', refundedCents: 1000, chargedBackCents: 1000 }) === 'chargeback');
  ok('the reason names the method the buyer used',
    /ideal/.test(mollie.orderEffect({ ...base, status: 'paid' }).reason));
}

// ── Test-key guard ───────────────────────────────────────────────────────────
console.log('— A test key must never run a live shop —');
{
  ok('isTestKey spots the sandbox key', mollie.isTestKey() === true);
  // The production guard is what stops a deploy that would take buyers to
  // Mollie's sandbox and mark their orders paid without a cent moving.
  const src = await import('node:fs').then((fs) => fs.readFileSync('src/config/env.js', 'utf8'));
  ok('assertProductionConfig refuses a test_ key', /\/\^test_\/\.test\(config\.payments\.mollie\.apiKey\)/.test(src));
}

// ── A real order through the webhook ─────────────────────────────────────────
console.log('— Applying a payment to an order —');
const product = await createProduct({
  name: `Mollie Test Card ${tag}`, price: 1250, currency: 'EUR',
  category: 'giftcards', active: 1, deliveryMode: 'auto',
});
await addProductCodes(product.id, [`MOLLIE-${tag}-A`, `MOLLIE-${tag}-B`, `MOLLIE-${tag}-C`]);

// A fresh address per order: the shop caps how many orders one email may place
// in a day, and this suite makes more than that.
let seq = 0;
const newOrder = async () => createOrder({
  email: `mollie${tag}-${++seq}@example.com`,
  items: [{ productId: product.id, quantity: 1 }],
  currency: 'EUR',
  consent: true, consentText: 'Immediate delivery, waiving withdrawal.',
});

/**
 * Wait for the background fulfilment pipeline to finish with an order.
 *
 * Paying kicks off auto-dispense asynchronously. A test that refunds in the same
 * millisecond is racing the shop rather than testing it — and a real refund
 * arrives seconds later at the very least.
 */
const settled = async (orderId, ms = 4000) => {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    last = (await getOrder(orderId)).status;
    if (['completed', 'awaiting_fulfillment', 'refunded', 'cancelled', 'failed'].includes(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
};

const stubPayment = (id, order, over = {}) => {
  payments.set(id, {
    id, status: 'paid', method: 'ideal',
    amount: mollie.toAmount(order.total, 'EUR'),
    metadata: { orderId: order.id, orderNumber: order.number },
    ...over,
  });
  return id;
};

{
  const order = await newOrder();
  stubPayment('tr_paid1', order);
  const r = await applyPayment('tr_paid1');
  const after = await getOrder(order.id);
  ok('a paid payment moves the order out of pending', r.effect === 'paid' && after.status !== 'pending',
    `${r.effect} / ${after.status}`);
  ok('the psp payment is recorded against the order',
    (await getPspPayment(order.id))?.paymentId === 'tr_paid1');

  // Mollie retries anything that did not return 2xx, and fires again on any
  // later change. The second delivery must change nothing at all. Waited out
  // first so the comparison is against a finished order, not a moving one.
  await settled(order.id);
  const before = await getOrder(order.id);
  const r2 = await applyPayment('tr_paid1');
  const after2 = await getOrder(order.id);
  ok('a replayed webhook is a no-op', r2.ok && r2.skipped === 'already settled', JSON.stringify(r2));
  ok('a replayed webhook does not re-run the state machine',
    before.status === after2.status && before.history.length === after2.history.length);
}

{
  // The one that costs money: a payment for less than the order is owed.
  const order = await newOrder();
  payments.set('tr_short', {
    id: 'tr_short', status: 'paid', method: 'ideal',
    amount: { currency: 'EUR', value: '0.01' },
    metadata: { orderId: order.id, orderNumber: order.number },
  });
  const r = await applyPayment('tr_short');
  const after = await getOrder(order.id);
  ok('a payment for the wrong amount is refused', r.ok === false && r.reason === 'amount mismatch',
    JSON.stringify(r));
  ok('…and the order stays pending', after.status === 'pending', after.status);
  const trail = await all("SELECT action FROM audit_logs WHERE target_id=@id", { id: order.id })
    .catch(() => []);
  ok('…and the mismatch is written to the audit trail',
    trail.some((a) => a.action === 'order.payment_mismatch'), JSON.stringify(trail));
}

{
  // A webhook for an id we have never issued, or with no order behind it.
  const r1 = await applyPayment('tr_unknownpayment').catch((e) => ({ threw: e.message }));
  ok('an unknown payment id fails loudly rather than settling something',
    r1.ok !== true, JSON.stringify(r1));

  payments.set('tr_nometa', { id: 'tr_nometa', status: 'paid', amount: { currency: 'EUR', value: '1.00' }, metadata: {} });
  const r2 = await applyPayment('tr_nometa');
  ok('a payment without an orderId is ignored', r2.ok === false && /orderId/.test(r2.reason));
}

{
  // Mollie sends the SAME webhook when a refund is issued — the payment is
  // still `paid`, only amountRefunded has appeared.
  const order = await newOrder();
  stubPayment('tr_refundme', order);
  await applyPayment('tr_refundme');
  await settled(order.id);
  payments.get('tr_refundme').amountRefunded = mollie.toAmount(order.total, 'EUR');

  const r = await applyPayment('tr_refundme');
  const after = await getOrder(order.id);
  ok('a refund on the same payment refunds the order', r.effect === 'refunded' && after.status === 'refunded',
    `${r.effect} / ${after.status}`);
  ok('the payment status is marked refunded too', after.paymentStatus === 'refunded', after.paymentStatus);
  const r2 = await applyPayment('tr_refundme');
  ok('refunding twice is a no-op', r2.skipped === 'already refunded', JSON.stringify(r2));
}

{
  // A refund has to land whatever the order was doing. `transitionOrder` guards
  // its UPDATE on the status it observed and silently returns the order
  // unchanged when it loses a race — right for delivery (nothing is dispensed
  // twice), dangerous for a refund, which used to report success on an order
  // that never moved. Hand-delivered products here so nothing runs in the
  // background and each status is exactly what the test put it in.
  const manualProduct = await createProduct({
    name: `Mollie Manual ${tag}`, price: 1250, currency: 'EUR',
    category: 'giftcards', active: 1, deliveryMode: 'manual',
  });
  const stuck = [];
  const PATHS = {
    payment_received: ['payment_received'],
    processing: ['payment_received', 'processing'],
    awaiting_fulfillment: ['payment_received', 'processing', 'awaiting_fulfillment'],
    completed: ['payment_received', 'processing', 'completed'],
  };
  for (const [from, path] of Object.entries(PATHS)) {
    const order = await createOrder({
      email: `mollie${tag}-m${++seq}@example.com`, currency: 'EUR',
      items: [{ productId: manualProduct.id, quantity: 1 }],
      consent: true, consentText: 'Immediate delivery, waiving withdrawal.',
    });
    for (const step of path) await transitionOrder(order.id, step, { actorId: 'test' });

    const id = stubPayment(`tr_race_${from}`, order);
    payments.get(id).amountRefunded = mollie.toAmount(order.total, 'EUR');
    const res = await applyPayment(id);
    const after = await getOrder(order.id);
    if (!(res.ok && after.status === 'refunded')) stuck.push(`${from} → ${after.status} (${JSON.stringify(res)})`);
  }
  ok('a refund lands from every live status an order can be in',
    stuck.length === 0, stuck.join(', '));
}

{
  // The race that made the test above flaky in the first place, pinned down.
  //
  // Auto-dispense starts the moment an order is paid and runs in the background.
  // A refund landing while it is in flight used to lose: deliverOrder force-
  // completes "from any state", so it dragged the order straight back out of
  // `refunded` into `completed`. The buyer kept the code AND the money, and
  // nothing in the dashboard would ever have shown it.
  const order = await newOrder();
  stubPayment('tr_racefix', order);
  await applyPayment('tr_racefix');
  await settled(order.id);
  payments.get('tr_racefix').amountRefunded = mollie.toAmount(order.total, 'EUR');
  await applyPayment('tr_racefix');
  ok('the order is refunded before the guard is tested',
    (await getOrder(order.id)).status === 'refunded');

  let threw = false;
  try { await deliverOrder(order.id, [{ content: 'SHOULD-NEVER-SHIP', type: 'code' }], { actorId: 'test' }); }
  catch { threw = true; }
  ok('a refunded order refuses delivery instead of force-completing', threw);
  ok('…and it is still refunded afterwards', (await getOrder(order.id)).status === 'refunded');

  // Codes are claimed before delivery, so a refused delivery must put them back
  // rather than leave them marked used against an order nobody ever received.
  // A separate, never-delivered order: claiming for an order that already holds
  // codes is idempotent and would take nothing new out of stock.
  const unpaid = await newOrder();
  await addProductCodes(product.id, [`MOLLIE-${tag}-R1`, `MOLLIE-${tag}-R2`]);
  const inStock = await availableCount(product.id);
  const claimed = await claimCodes(product.id, 1, unpaid.id);
  const afterClaim = await availableCount(product.id);
  ok('claiming a code takes it out of stock',
    claimed.length === 1 && afterClaim === inStock - 1, `${inStock} → ${afterClaim}`);
  const freed = await releaseCodes(unpaid.id);
  const afterRelease = await availableCount(product.id);
  ok('releasing an undelivered code puts it back on the shelf',
    freed === 1 && afterRelease === inStock, `freed ${freed}, ${afterClaim} → ${afterRelease}`);
}

{
  // A partial refund is not a cancelled order — the buyer keeps what they bought.
  const order = await newOrder();
  stubPayment('tr_partial', order);
  await applyPayment('tr_partial');
  const before = await settled(order.id);
  payments.get('tr_partial').amountRefunded = { currency: 'EUR', value: '1.00' };

  const r = await applyPayment('tr_partial');
  const after = await getOrder(order.id);
  ok('a partial refund does not refund the order', r.effect === 'partial_refund' && after.status === before,
    `${r.effect} / ${after.status}`);
}

{
  // A cancelled payment must leave the order payable. Failing it here would
  // close a sale the buyer is still in the middle of.
  const order = await newOrder();
  stubPayment('tr_cancel', order, { status: 'canceled' });
  const r = await applyPayment('tr_cancel');
  const after = await getOrder(order.id);
  ok('a cancelled payment leaves the order pending and payable',
    r.effect === 'retryable' && after.status === 'pending', `${r.effect} / ${after.status}`);
}

// ── The client itself ────────────────────────────────────────────────────────
console.log('— The API client —');
{
  const order = await newOrder();
  calls.length = 0;
  const p = await mollie.createPayment(order, {
    redirectUrl: 'https://forgemarket.nl/checkout/success',
    webhookUrl: 'https://forgemarket.nl/api/payments/mollie/webhook',
    method: 'ideal',
  });
  const c = calls.find((x) => x.method === 'POST');
  ok('the amount sent is a decimal string', c.body.amount.value === (order.total / 100).toFixed(2),
    JSON.stringify(c.body.amount));
  ok('the order id travels in metadata, not in the redirect URL',
    c.body.metadata.orderId === order.id);
  ok('the create is keyed to the order so a double tap cannot bill twice',
    (c.headers['idempotency-key'] || '') === `order-${order.id}`, JSON.stringify(c.headers));
  ok('the API key is sent as a bearer token',
    (c.headers.authorization || '') === 'Bearer test_stubbedkey');
  ok('the webhook URL is passed to Mollie', c.body.webhookUrl.endsWith('/api/payments/mollie/webhook'));
  ok('the description carries the order number for the bank statement',
    c.body.description.includes(order.number));
  ok('a checkout URL comes back', /^https:\/\/www\.mollie\.com\/checkout\//.test(p.checkoutUrl));

  // A method this shop does not offer must never be forwarded.
  calls.length = 0;
  await mollie.createPayment(order, { redirectUrl: 'x', webhookUrl: 'y', method: 'giropay' });
  ok('an unsupported method is dropped rather than sent',
    calls.find((x) => x.method === 'POST').body.method === undefined);
}

{
  const methods = await mollie.availableMethods({ cents: 1250 });
  ok('all five requested methods are supported by the shop',
    ['ideal', 'bancontact', 'applepay', 'creditcard', 'paypal']
      .every((m) => mollie.SUPPORTED_METHODS.includes(m)), mollie.SUPPORTED_METHODS.join(','));
  ok('methods Mollie offers but the shop does not are filtered out',
    !methods.some((m) => m.id === 'giropay'), JSON.stringify(methods));
  ok('the amount is sent so Mollie can apply its per-method limits',
    calls.at(-1).url.includes('amount%5Bvalue%5D=12.50'), calls.at(-1).url);
}

{
  calls.length = 0;
  const r = await mollie.refundPayment('tr_paid1', { cents: 1250, description: 'Refund FM-1' });
  const c = calls.at(-1);
  ok('a refund posts a decimal amount too', c.body.amount.value === '12.50');
  ok('a refund is idempotency-keyed so a retry cannot pay out twice',
    (c.headers['idempotency-key'] || '').startsWith('refund-tr_paid1-'));
  ok('the refund comes back with an id', r.id === 're_1');
}

// ── Wiring ───────────────────────────────────────────────────────────────────
console.log('— Wiring —');
{
  const fs = await import('node:fs');
  const app = fs.readFileSync('src/app.js', 'utf8');
  // Mollie posts form data. Behind express.json() the body would be empty and
  // every confirmation silently dropped.
  const urlencodedAt = app.indexOf("'/api/payments/mollie/webhook', express.urlencoded");
  const jsonAt = app.indexOf('express.json(');
  ok('the webhook parser is mounted before the JSON parser',
    urlencodedAt > 0 && urlencodedAt < jsonAt, `${urlencodedAt} vs ${jsonAt}`);
  // Mollie retries for two days on a non-2xx. A 429 from our own rate limiter
  // would be self-inflicted.
  const webhookRoute = app.indexOf("app.use('/api/payments', mollieWebhook)");
  const apiLimit = app.indexOf("rateLimit({ bucket: 'api' })");
  ok('the webhook route is mounted before the general API rate limit',
    webhookRoute > 0 && webhookRoute < apiLimit, `${webhookRoute} vs ${apiLimit}`);

  const admin = fs.readFileSync('src/routes/admin/orders.js', 'utf8');
  const refundCall = admin.indexOf('refundPayment(psp.paymentId');
  const statusChange = admin.indexOf("transitionOrder(req.params.id, 'refunded'");
  ok('the admin refund sends the money back BEFORE marking the order refunded',
    refundCall > 0 && refundCall < statusChange, `${refundCall} vs ${statusChange}`);

  const routes = fs.readFileSync('src/routes/mollie.js', 'utf8');
  ok('the webhook returns 500 on a thrown error so Mollie retries',
    /res\.status\(500\)/.test(routes));
  ok('the webhook ignores a body it cannot use instead of looping forever',
    /res\.status\(200\)\.send\('ignored'\)/.test(routes));
  ok('the webhook never trusts a status from the request body',
    !/req\.body\??\.\s*status/.test(routes));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} mollie: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
