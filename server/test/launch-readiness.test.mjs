/**
 * Launch readiness: the promises the shop makes in writing, checked against the
 * code that has to keep them.
 *
 * The two failures this suite exists for were both invisible from inside the
 * code. Nothing threw, no test went red, and the site looked correct:
 *
 *  1. Email delivery was OPTIONAL in production. Without a transport `sendEmail`
 *     writes to `email_log` and resolves happily, so an order completes, the
 *     track page tells the buyer their code was mailed, and the code sits in a
 *     table nobody reads. A shop that takes money and delivers nothing, with a
 *     console.warn as the only trace.
 *  2. The refund policy — part of the terms — promised "open your order page and
 *     request a refund there, you only need your order number, no account".
 *     The only refund route required a session, so on a shop whose default is
 *     guest checkout the promise held for almost nobody.
 *
 * Both are the same class of bug: a written promise with no code behind it. So
 * the assertions here start from the promise.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_launch';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { createOrder, markPaymentReceived, getOrder } = await import('../src/services/orderService.js');
const { listRefundRequests } = await import('../src/services/supportService.js');
const { all } = await import('../src/db/index.js');
const fs = await import('node:fs');

const tag = Date.now() % 1000000;
const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const product = await createProduct({ name: `Launch Pack ${tag}`, category: 'giftcard', price: 2500, announce: false });
await addProductCodes(product.id, [`LAUNCH-${tag}-1`, `LAUNCH-${tag}-2`, `LAUNCH-${tag}-3`]);

const paidOrder = async (email) => {
  const o = await createOrder({
    consent: true, consentText: 'test consent', email,
    items: [{ productId: product.id, quantity: 1 }],
  });
  await markPaymentReceived(o.id, `tx-${o.number}`, { actorId: 'test' });
  return o;
};

// ── 1. Email is not optional for SELLING ────────────────────────────────────
console.log('— A shop that cannot deliver must not take the money —');
{
  const { assertProductionConfig, commerceBlockers } = await import('../src/config/env.js');
  const src = fs.readFileSync(new URL('../src/config/env.js', import.meta.url), 'utf8');

  // This started as a console.warn, became a refusal to boot, and is now a
  // refusal to sell. The middle version was right about the danger and wrong
  // about the blast radius: it took the storefront, order tracking and the admin
  // panel down over one unset variable. See commerce-blockers.test.mjs.
  ok('a missing email transport still blocks orders',
    /commerceBlockers[\s\S]{0,600}(RESEND_API_KEY|SMTP_URL)/.test(src),
    'nothing stops the shop selling without a way to deliver');
  ok('it is not merely a console.warn',
    !/console\.warn\([\s\S]{0,200}(RESEND_API_KEY|SMTP_URL)/.test(src),
    'back to only warning about a missing transport');
  ok('…and it really does refuse right now', commerceBlockers().length > 0,
    'no blocker reported despite no transport being configured');
  ok('assertProductionConfig is exported and callable', typeof assertProductionConfig === 'function');

  // Both entry points must run it, or the check only guards one deployment.
  const serverEntry = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const vercelEntry = fs.readFileSync(new URL('../../api/index.js', import.meta.url), 'utf8');
  ok('the node server asserts production config', /assertProductionConfig\s*\(/.test(serverEntry));
  ok('the vercel function asserts production config', /assertProductionConfig\s*\(/.test(vercelEntry));
}

// ── 2. A guest can request a refund with only a number and an email ─────────
console.log('\n— Guest refund request (what the refund policy promises) —');
{
  const email = `refund${tag}@x.dev`;
  const o = await paidOrder(email);

  const wrongEmail = await post(`/api/track/${o.number}/refund-request`, { email: `someone-else${tag}@x.dev` });
  ok('the wrong email is refused', wrongEmail.status === 404, `status=${wrongEmail.status}`);

  const unknown = await post('/api/track/FM-2026-NOTREAL/refund-request', { email });
  ok('an unknown order number is refused', unknown.status === 404, `status=${unknown.status}`);
  // Identical answers on purpose: a different message would turn this into a way
  // to ask "has this address ever bought here?".
  ok('both refusals give the same answer', (await wrongEmail.json()).error?.message === (await unknown.json()).error?.message);

  const created = await post(`/api/track/${o.number}/refund-request`, { email, reason: 'Code does not work' });
  ok('a guest with the right number + email can request a refund', created.status === 201, `status=${created.status}`);

  // The buyer who is not sure it worked presses it again.
  const twice = await post(`/api/track/${o.number}/refund-request`, { email, reason: 'Code does not work' });
  ok('asking twice is accepted', twice.ok, `status=${twice.status}`);
  ok('asking twice does not create a second request', (await twice.json()).alreadyRequested === true);

  const queue = await listRefundRequests({});
  const mine = queue.filter((r) => r.order_id === o.id);
  ok('exactly one request reached the owner queue', mine.length === 1, `rows=${mine.length}`);
  ok('the reason the buyer typed is in the queue', mine[0]?.reason === 'Code does not work', mine[0]?.reason);
  ok('the request is attributed to a guest, not a user', !mine[0]?.user_id, `user_id=${mine[0]?.user_id}`);

  const logged = await all("SELECT * FROM audit_logs WHERE action='refund.request'");
  ok('the request is written to the audit log', logged.length >= 1, `rows=${logged.length}`);

  // Requesting must not move the order by itself — that decision is a person's.
  ok('the order status is untouched by the request',
    (await getOrder(o.id)).status !== 'refunded', 'requesting a refund refunded the order');
}

// ── 3. Nothing to refund is answered honestly ───────────────────────────────
console.log('\n— Orders where a refund makes no sense —');
{
  const email = `unpaid${tag}@x.dev`;
  const o = await createOrder({
    consent: true, consentText: 'test consent', email,
    items: [{ productId: product.id, quantity: 1 }],
  });
  const r = await post(`/api/track/${o.number}/refund-request`, { email });
  ok('an unpaid order answers "not paid" instead of queueing work', (await r.json()).notPaid === true);

  const queue = await listRefundRequests({});
  ok('no refund request was created for the unpaid order',
    !queue.some((x) => x.order_id === o.id), 'unpaid order landed in the refund queue');
}

// ── 4. The policy text and the code agree ───────────────────────────────────
console.log('\n— The written promise matches a route that exists —');
{
  const { REFUND_DOC } = await import('../../src/content/refunds.js');
  const flat = JSON.stringify(REFUND_DOC.nl) + JSON.stringify(REFUND_DOC.en);
  const promisesSelfService = /bestelpagina|geen account|order page|no account/i.test(flat);

  const routes = fs.readFileSync(new URL('../src/routes/catalog.js', import.meta.url), 'utf8');
  ok('the refund policy still promises a no-account route', promisesSelfService,
    'the promise was removed — either restore it or drop this test');
  ok('…and that route is mounted', /track\/:number\/refund-request/.test(routes));

  // The page that has to offer it.
  const trackPage = fs.readFileSync(new URL('../../src/pages/Track.jsx', import.meta.url), 'utf8');
  ok('the track page calls the refund route', /refund-request/.test(trackPage));
  ok('it is offered on paid orders, not only delivered ones',
    /payment_received[\s\S]{0,160}GuestRefund|GuestRefund[\s\S]{0,160}payment_received/.test(trackPage)
    || /'payment_received', 'processing', 'awaiting_fulfillment', 'completed'/.test(trackPage),
    'refund form is gated to completed orders only');

  // Every string the new form shows must have a Dutch translation: an untranslated
  // refund form on a Dutch shop is the most expensive place to fall back to English.
  const i18n = fs.readFileSync(new URL('../../src/lib/i18n.jsx', import.meta.url), 'utf8');
  const used = [...trackPage.matchAll(/t\('(refundReq\.[a-zA-Z]+)'/g)].map((m) => m[1]);
  ok('the refund form uses translated strings', used.length >= 8, `keys=${used.length}`);
  const untranslated = used.filter((k) => !i18n.includes(`'${k}'`));
  ok('every one of them has a Dutch translation', untranslated.length === 0, untranslated.join(', '));
}

// ── 5. The refund queue is reachable by the owner ───────────────────────────
console.log('\n— The queue a request lands in is actually worked —');
{
  const adminRoutes = fs.readFileSync(new URL('../src/routes/admin/support.js', import.meta.url), 'utf8');
  ok('the owner has a route to list refund requests', /listRefundRequests/.test(adminRoutes),
    'requests pile up with no way to see them');
  ok('…and a route to decide them', /decideRefund|resolveRefund/.test(adminRoutes),
    'no decision route: requests can be read but never answered');
}

// ── 6. The owner's readiness dashboard tells the truth ──────────────────────
console.log('\n— The launch dashboard agrees with the checkout —');
{
  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const { config } = await import('../src/config/env.js');
  const r = await launchChecks();
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));

  // The dashboard existed before Mollie and only knew about Stripe and the
  // manual links. That is the exact failure it is supposed to prevent: an owner
  // reading "no way to pay" while Mollie is live, or a green light on a shop
  // whose checkout dead-ends.
  const src = fs.readFileSync(new URL('../src/services/launchCheckService.js', import.meta.url), 'utf8');
  ok('the payment check knows about Mollie', /mollieEnabled\s*\(/.test(src),
    'the dashboard still only checks Stripe and manual links');
  ok('it flags a test_ key as a failure, not a warning', /mollieTestKey\s*\(\)\s*\?\s*'fail'/.test(src));
  ok('its fix hint names MOLLIE_API_KEY', /MOLLIE_API_KEY/.test(src));

  // Every check must carry an actionable detail — a red light with no next step
  // is a dashboard the owner learns to ignore.
  ok('every check has an id, a label and a detail',
    r.checks.every((c) => c.id && c.label && c.detail && ['ok', 'warn', 'fail'].includes(c.status)));
  ok('`ready` is false while anything is failing',
    r.ready === !r.checks.some((c) => c.status === 'fail'), `ready=${r.ready}`);

  // With no MOLLIE_API_KEY, no manual links and demo mode off, the answer must
  // be a blocker — the state a fresh deployment is actually in.
  const provider = config.payments.mollie.apiKey ? 'mollie'
    : config.payments.demoMode ? 'demo' : 'none';
  ok('the payment check is not silently green on an unconfigured shop',
    provider !== 'none' || by.payments?.status === 'fail',
    `status=${by.payments?.status}`);

  // Seller identity: legally required, and only the owner can supply it.
  const { legalComplete } = await import('../../src/lib/legalIdentity.js');
  ok('the dashboard checks who is selling', !!by.identity, 'no seller-identity check');
  ok('an empty legal identity is a blocker, not a warning',
    legalComplete() ? by.identity.status !== 'fail' : by.identity.status === 'fail',
    `status=${by.identity?.status}`);
  ok('…and it says which file to edit', /legalIdentity\.js/.test(by.identity?.detail || ''));
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
