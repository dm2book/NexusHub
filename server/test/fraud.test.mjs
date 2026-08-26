/**
 * Fraud controls for digital goods.
 *
 * The thing that makes this different from fraud on a physical shop is that
 * there is no parcel to stop. A code, once read, is gone: it cannot be recalled,
 * the stock cannot be recovered, and the chargeback arrives weeks later with
 * nothing left to reclaim. So the only moment where stopping is still possible
 * is between the payment landing and the code going out — and that is what most
 * of this file is about.
 *
 * The shop already scored every order and then delivered it anyway. That is the
 * regression these tests exist to prevent coming back.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_fraud';
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

// Pinned so a change to the shipped defaults cannot silently rewrite what these
// tests assert. The behaviour under test is the mechanism, not the numbers.
process.env.FRAUD_REVIEW_THRESHOLD = '60';
process.env.FRAUD_BLOCK_THRESHOLD = '85';
process.env.LIMIT_ORDERS_PER_EMAIL_DAY = '4';
process.env.LIMIT_ORDERS_PER_IP_DAY = '6';
process.env.LIMIT_VALUE_PER_EMAIL_DAY = '15000';
process.env.LIMIT_MAX_ORDER_VALUE = '9000';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };
const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

await (await import('../src/app.js')).ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes, availableCount } = await import('../src/services/codeStockService.js');
const {
  createOrder, getOrder, transitionOrder, markPaymentReceived, deliverOrder,
  autoDispenseFromStock, releaseFraudHold, rejectFraudHold,
} = await import('../src/services/orderService.js');
const { scoreOrder, listFlaggedOrders, heldOrderCount, holdMessage } =
  await import('../src/services/fraudService.js');
const { recordChargeback, chargebackCountForEmail, chargebackCountForIp, chargebackSummary } =
  await import('../src/services/chargebackService.js');
const { assertOrderLimits } = await import('../src/services/orderLimitService.js');
const netRisk = await import('../src/utils/netRisk.js');
const { run, get } = await import('../src/db/index.js');

const tag = Date.now() % 1000000;
let n = 0;
const freshEmail = () => `fraud${tag}-${++n}@example.com`;

// Addresses are unique per run. A suite that only passes against a virgin
// database is a suite that stops being run.
let ipN = 0;
const freshIp = () => `84.29.${(tag + ipN) % 250}.${(++ipN % 250) + 1}`;      // consumer space
const freshHostingIp = () => `167.99.${(tag + ipN) % 250}.${(++ipN % 250) + 1}`; // DigitalOcean

const product = await createProduct({
  name: `Fraud Test Card ${tag}`, price: 2500, currency: 'EUR',
  category: 'giftcards', active: 1, deliveryMode: 'auto',
});
await addProductCodes(product.id, Array.from({ length: 40 }, (_, i) => `FRAUD-${tag}-${i}`));

const place = (over = {}, ctx = {}) => createOrder({
  email: over.email || freshEmail(),
  items: [{ productId: product.id, quantity: over.quantity || 1 }],
  currency: 'EUR', consent: true, consentText: 'Immediate delivery, waiving withdrawal.',
  ...over,
}, ctx);

/** Auto-dispense runs in the background; wait for the order to stop moving. */
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

// ── Network risk ─────────────────────────────────────────────────────────────
console.log('— What we can and cannot tell about an IP —');
{
  ok('a loopback address is not treated as a customer', netRisk.isPrivateIp('127.0.0.1'));
  ok('an RFC1918 address is private', netRisk.isPrivateIp('192.168.1.40') && netRisk.isPrivateIp('10.4.4.4'));
  ok('172.16/12 is private but 172.32 is not',
    netRisk.isPrivateIp('172.16.0.1') && !netRisk.isPrivateIp('172.32.0.1'));
  ok('a normal public address is not private', !netRisk.isPrivateIp('84.29.7.15'));

  ok('a DigitalOcean address is recognised as hosting', netRisk.isHostingRange('167.99.12.34'));
  ok('a Hetzner address is recognised as hosting', netRisk.isHostingRange('88.99.1.2'));
  ok('an Amazon address is recognised as hosting', netRisk.isHostingRange('3.120.4.5'));
  // The cost of a wrong range is a customer turned away, so the list stays
  // conservative — this asserts it has not crept into consumer space.
  ok('a Dutch consumer address is NOT called hosting', !netRisk.isHostingRange('84.29.7.15'));
  ok('a Belgian consumer address is NOT called hosting', !netRisk.isHostingRange('81.164.30.7'));
  ok('an IPv4-mapped IPv6 address is still matched', netRisk.isHostingRange('::ffff:167.99.12.34'));
  ok('nonsense input does not match anything', !netRisk.isHostingRange('not-an-ip'));

  const local = await netRisk.assessIp('127.0.0.1');
  ok('a local address produces no signal at all', local.hosting === false && local.confidence === 'none');

  const dc = await netRisk.assessIp('167.99.12.34');
  ok('a known hosting range is high confidence, no DNS needed',
    dc.hosting === true && dc.confidence === 'high', JSON.stringify(dc));

  // The honest limit, asserted so nobody later reads more into this than it can
  // deliver: a consumer VPN on a residential exit is indistinguishable here.
  ok('an unknown public address is not guessed at',
    (await netRisk.assessIp('84.29.7.15').then((r) => r.hosting)) === false);

  ok('countryOf reads the platform header',
    netRisk.countryOf({ headers: { 'x-vercel-ip-country': 'nl' } }) === 'NL');
  ok('countryOf returns null rather than guessing', netRisk.countryOf({ headers: {} }) === null);
  ok('countryOf rejects a junk value', netRisk.countryOf({ headers: { 'cf-ipcountry': 'XX' } }) === null);
}

// ── Order limits ─────────────────────────────────────────────────────────────
console.log('— Hard ceilings —');
{
  const email = freshEmail();
  const e1 = await throws(() => assertOrderLimits({ email, ip: null, total: 9_001 }));
  ok('an order over the single-order ceiling is refused', !!e1, e1?.message);
  ok('…and says what the ceiling is', /90[.,]00/.test(e1?.message || ''), e1?.message);

  ok('an order exactly at the ceiling is allowed',
    (await throws(() => assertOrderLimits({ email, ip: null, total: 9_000 }))) === null);

  // Four orders is the configured daily cap for this suite.
  const capped = freshEmail();
  const cappedIp = freshIp();
  for (let i = 0; i < 4; i++) await place({ email: capped }, { ip: cappedIp });
  const e2 = await throws(() => place({ email: capped }, { ip: cappedIp }));
  ok('a fifth order in a day is refused', !!e2 && e2.status === 429, `${e2?.status} ${e2?.message}`);

  // Cancelled orders must not count, or a buyer whose payment kept failing is
  // locked out of the shop for a day because of it.
  const forgiven = freshEmail();
  for (let i = 0; i < 4; i++) {
    const o = await place({ email: forgiven });
    await transitionOrder(o.id, 'cancelled', { actorId: 'test' });
  }
  const e3 = await throws(() => place({ email: forgiven }));
  ok('cancelled orders do not count against the daily limit', e3 === null, e3?.message);

  // The daily VALUE cap (€150 here) is a separate wall from the daily COUNT cap:
  // three €25 orders is well inside four orders, but a €90 fourth one still
  // breaks the total. Both totals below sit under the single-order ceiling, so
  // this can only be the value rule firing and not that one by accident.
  const spender = freshEmail();
  for (let i = 0; i < 3; i++) await place({ email: spender });   // 3 × €25 = €75
  ok('spending under the daily ceiling is allowed',
    (await throws(() => assertOrderLimits({ email: spender, ip: null, total: 7_000 }))) === null);
  const e4 = await throws(() => assertOrderLimits({ email: spender, ip: null, total: 9_000 }));
  ok('the daily value ceiling is enforced',
    !!e4 && /24 hours/.test(e4.message), e4?.message);
  ok('…and the message tells them what to do next',
    /email us/i.test(e4?.message || ''), e4?.message);

  // Per IP: looser than per email, because a household shares one.
  const ip = freshIp();
  for (let i = 0; i < 6; i++) await place({}, { ip });
  const e5 = await throws(() => place({}, { ip }));
  ok('the per-IP ceiling catches many emails from one connection',
    !!e5 && e5.status === 429, `${e5?.status} ${e5?.message}`);
}

// ── Scoring ──────────────────────────────────────────────────────────────────
console.log('— Risk scoring —');
{
  const cleanIp = freshIp();
  const clean = await place({}, { ip: cleanIp });
  const s1 = await scoreOrder({ order: clean, email: clean.email, ip: cleanIp });
  ok('an ordinary order scores clean', s1.decision === 'ok', `${s1.score} ${JSON.stringify(s1.signals)}`);

  const dcIp = freshHostingIp();
  const dc = await place({}, { ip: dcIp });
  const s2 = await scoreOrder({ order: dc, email: dc.email, ip: dcIp });
  ok('a datacenter/VPN address is flagged as a signal',
    s2.signals.some((x) => x.rule === 'hosting_ip'), JSON.stringify(s2.signals));
  ok('…and the signal explains itself rather than naming a rule id',
    /hosting provider|hostname/.test(s2.signals.find((x) => x.rule === 'hosting_ip')?.detail || ''));
  ok('a VPN alone does not hold an order — plenty of real buyers use one',
    s2.decision === 'ok', `${s2.score}`);

  const farIp = freshIp();
  const far = await place({}, { ip: farIp });
  const s3 = await scoreOrder({ order: far, email: far.email, ip: farIp, country: 'BR' });
  ok('a country the shop does not sell to is a signal',
    s3.signals.some((x) => x.rule === 'foreign_country'));
  const near = await scoreOrder({ order: far, email: far.email, ip: farIp, country: 'NL' });
  ok('a home country is not', !near.signals.some((x) => x.rule === 'foreign_country'));

  const disposable = await place({ email: `burner${tag}@mailinator.com` });
  const s4 = await scoreOrder({ order: disposable, email: disposable.email });
  ok('a disposable email address is a signal',
    s4.signals.some((x) => x.rule === 'disposable_email'));

  // One address, several emails, in a day. The single clearest signal a small
  // shop can compute for itself.
  const sharedIp = freshIp();
  await place({}, { ip: sharedIp });
  await place({}, { ip: sharedIp });
  const third = await place({}, { ip: sharedIp });
  const s5 = await scoreOrder({ order: third, email: third.email, ip: sharedIp });
  ok('one IP ordering under several emails is a signal',
    s5.signals.some((x) => x.rule === 'ip_velocity'), JSON.stringify(s5.signals));

  // Card testing: a real buyer whose payment fails three times emails us. They
  // do not queue up six more attempts.
  const tester = freshEmail();
  for (let i = 0; i < 3; i++) {
    const o = await place({ email: tester });
    await transitionOrder(o.id, 'failed', { actorId: 'test' });
  }
  const live = await place({ email: tester });
  const s6 = await scoreOrder({ order: live, email: tester });
  ok('repeated failed payments look like card testing',
    s6.signals.some((x) => x.rule === 'failed_payment_attempts'), JSON.stringify(s6.signals));

  ok('the score is capped at 100', s6.score <= 100 && s5.score <= 100);
  ok('every signal carries a weight and a human-readable reason',
    [...s5.signals, ...s6.signals].every((x) => x.weight > 0 && typeof x.detail === 'string' && x.detail.length > 8));
}

// ── Chargebacks ──────────────────────────────────────────────────────────────
console.log('— Chargeback ledger —');
{
  const email = freshEmail();
  const cbIp = freshIp();
  const order = await place({ email }, { ip: cbIp });

  ok('no chargebacks to start with', (await chargebackCountForEmail(email)) === 0);

  const r1 = await recordChargeback({
    order: { ...order, ip: cbIp }, amount: order.total, currency: 'EUR',
    provider: 'mollie', paymentId: `tr_cb${tag}`, reason: 'Cardholder disputes', source: 'psp',
  });
  ok('a chargeback is recorded', !r1.duplicate);
  ok('…and counts against the email', (await chargebackCountForEmail(email)) === 1);
  ok('…and against the IP it came from', (await chargebackCountForIp(cbIp)) === 1);

  // The PSP fires the same webhook more than once. A second row would double
  // this buyer's apparent history and could push their next order into a block.
  const r2 = await recordChargeback({
    order: { ...order, ip: cbIp }, amount: order.total,
    provider: 'mollie', paymentId: `tr_cb${tag}`, source: 'psp',
  });
  ok('the same chargeback reported twice is recorded once',
    r2.duplicate === true && (await chargebackCountForEmail(email)) === 1);

  const sum = await chargebackSummary();
  ok('the summary counts what it cost', sum.count >= 1 && sum.totalCents >= order.total);

  // The point of the ledger: it changes what happens next. Scored against a
  // hypothetical order rather than a placed one, because placing it is exactly
  // what the block threshold now prevents — that is asserted separately below.
  const s = await scoreOrder({
    order: { total: 2500, email, billing: {} }, email, ip: cbIp,
  });
  ok('a buyer who has charged back is scored against it',
    s.signals.some((x) => x.rule === 'prior_chargeback'), JSON.stringify(s.signals));
  ok('…and an address that has charged back counts too',
    s.signals.some((x) => x.rule === 'chargeback_from_ip'));
  ok('…so their next order does not sail through',
    s.decision !== 'ok', `${s.score} / ${s.decision}`);

  // A refund the shop chose to give is not the same fact and must not be
  // conflated with one taken back against its will.
  const refundedEmail = freshEmail();
  const ro = await place({ email: refundedEmail });
  await transitionOrder(ro.id, 'payment_received', { actorId: 'test' });
  await settled(ro.id);
  await transitionOrder(ro.id, 'refunded', { actorId: 'test' });
  ok('a voluntary refund is not logged as a chargeback',
    (await chargebackCountForEmail(refundedEmail)) === 0);
}

// ── The whole point: a held order delivers nothing ────────────────────────────
console.log('— A high-risk order is not delivered —');
{
  // Built from a real signal rather than by writing the column directly, so the
  // test exercises the path an actual attempt takes.
  //
  // ONE signal on purpose: a prior chargeback on this email (70) lands between
  // the review and block thresholds, which is a hold. Stacking a hosting IP and
  // an IP-velocity hit on top would clear 85 and refuse the order outright —
  // correct behaviour, but a different test, and it is below.
  const email = freshEmail();
  const ip = freshIp();
  const first = await place({ email }, { ip: freshIp() });
  await recordChargeback({
    order: { ...first, ip: freshIp() }, amount: first.total, provider: 'mollie',
    paymentId: `tr_hold${tag}`, reason: 'Disputed', source: 'psp',
  });

  const stockBefore = await availableCount(product.id);
  const order = await place({ email }, { ip });
  const held = await getOrder(order.id);

  ok('the order is held', held.fraudHold === true, `hold=${held.fraudHold} score=${held.fraudScore}`);
  ok('…and records why, in words', (held.fraudHoldReason || '').length > 10, held.fraudHoldReason);
  ok('…and is a perfectly normal pending order otherwise', held.status === 'pending');

  // Money arrives. Everything downstream of a payment now runs.
  await markPaymentReceived(order.id, `pay_${tag}`, { actorId: 'test' });
  await new Promise((r) => setTimeout(r, 1500));

  const after = await getOrder(order.id);
  ok('the payment is accepted — a held order is still a paid order',
    after.status === 'payment_received', after.status);
  ok('NOTHING was delivered', (after.deliveries || []).length === 0,
    JSON.stringify(after.deliveries || []));
  ok('and no code left stock', (await availableCount(product.id)) === stockBefore,
    `${stockBefore} → ${await availableCount(product.id)}`);

  // Every door, not just the automatic one.
  ok('auto-dispense refuses a held order',
    (await autoDispenseFromStock(order.id, { actorId: 'test' })) === false);
  const e = await throws(() => deliverOrder(order.id, [{ content: 'HAND-DELIVERED', type: 'code' }], { actorId: 'staff' }));
  ok('staff delivering by hand is refused too', !!e && /held/i.test(e.message), e?.message);
  const still = await getOrder(order.id);
  ok('…and that attempt delivered nothing either', (still.deliveries || []).length === 0);

  // The supplier queue BUYS before it delivers, so it must skip held orders
  // before spending money rather than fail at the end.
  const { drainSupplierQueue } = await import('../src/services/fulfillmentService.js');
  await drainSupplierQueue({ actorId: 'test' }).catch(() => {});
  ok('the supplier queue does not pick up a held order',
    ((await getOrder(order.id)).deliveries || []).length === 0);

  ok('the buyer is told something true, without naming the rule',
    /checked by a person/i.test(holdMessage()) && !/score|rule|VPN/i.test(holdMessage()));

  ok('it appears in the review queue',
    (await listFlaggedOrders()).some((r) => r.id === order.id));
  ok('the held count is not zero', (await heldOrderCount()) >= 1);

  // ── Approving releases it ──
  const released = await releaseFraudHold(order.id, { actorId: 'tester' });
  ok('approving clears the hold', released.order.fraudHold === false);
  ok('…and records who decided', !!released.order.fraudReviewedAt);
  await settled(order.id);
  const done = await getOrder(order.id);
  ok('…and the code is finally delivered', (done.deliveries || []).length > 0,
    `status ${done.status}, ${(done.deliveries || []).length} deliveries`);
  ok('approving twice is harmless',
    (await releaseFraudHold(order.id, { actorId: 'tester' })).alreadyReleased === true);
}

console.log('— Rejecting a held order —');
{
  const email = freshEmail();
  const ip = freshIp();
  const first = await place({ email }, { ip: freshIp() });
  await recordChargeback({
    order: { ...first, ip: freshIp() }, amount: first.total, provider: 'mollie',
    paymentId: `tr_rej${tag}`, source: 'psp',
  });
  const order = await place({ email }, { ip });
  ok('the second order is held', (await getOrder(order.id)).fraudHold === true);

  const rejected = await rejectFraudHold(order.id, { actorId: 'tester', reason: 'Confirmed fraud' });
  ok('rejecting keeps the hold in place — it is the record that it was stopped',
    rejected.fraudHold === true);
  ok('…and marks it blocked', rejected.fraudStatus === 'block');
  ok('…and keeps the reason a person gave', /Confirmed fraud/.test(rejected.fraudHoldReason || ''));
}

// ── The block threshold ──────────────────────────────────────────────────────
console.log('— Refused outright —');
{
  // Stacked signals clear 85: a prior chargeback on the email (70), the same
  // address having charged back (35), a datacenter connection (25) and several
  // emails from that one address today (35).
  //
  // The seeding orders are placed BEFORE the chargeback is recorded, because
  // once it exists the same address is already enough to hold an order — and a
  // held seed would throw here for the right reason at the wrong moment.
  const email = freshEmail();
  const ip = freshHostingIp();
  const seed = await place({ email }, { ip });
  await place({}, { ip });   // a second email from the same address
  await place({}, { ip });   // and a third
  await recordChargeback({
    order: { ...seed, ip }, amount: seed.total, provider: 'mollie',
    paymentId: `tr_blk${tag}`, source: 'psp',
  });

  const e = await throws(() => place({ email }, { ip }));
  ok('an order over the block threshold is refused at checkout', !!e, 'no error thrown');
  ok('…and the buyer is told nothing was charged',
    /nothing has been charged/i.test(e?.message || ''), e?.message);
  ok('…and is not told which signal caught them',
    !/(chargeback|VPN|datacenter|score)/i.test(e?.message || ''), e?.message);

  // The refused attempt is kept: deleting it would throw away the history the
  // NEXT attempt is scored against.
  const row = await get(
    "SELECT status, fraud_status FROM orders WHERE email=@e ORDER BY created_at DESC LIMIT 1", { e: email });
  ok('the blocked attempt is kept as evidence, marked failed',
    row?.status === 'failed' && row?.fraud_status === 'block', JSON.stringify(row));
}

// ── Wiring that must not regress ─────────────────────────────────────────────
console.log('— Wiring —');
{
  const fs = await import('node:fs');
  const orderSrc = fs.readFileSync('src/services/orderService.js', 'utf8');
  ok('auto-dispense checks the hold before claiming any code',
    orderSrc.indexOf('order.fraudHold') < orderSrc.indexOf('claimCodes('),
    'the hold check must come first or stock is spent on a held order');
  ok('the order records the IP it was placed from', /ip: ctx\.ip \|\| null/.test(orderSrc));
  ok('limits are checked before the order row is written',
    orderSrc.indexOf('assertOrderLimits') < orderSrc.indexOf('INSERT INTO orders'));

  const fulfil = fs.readFileSync('src/services/fulfillmentService.js', 'utf8');
  ok('the supplier queue filters held orders in SQL, before it buys anything',
    /o\.fraud_hold = 0/.test(fulfil));

  const limiter = fs.readFileSync('src/middleware/rateLimit.js', 'utf8');
  ok('the shared limiter counts in a single statement',
    /DO UPDATE SET count = rate_limit_hits\.count \+ 1[\s\S]*RETURNING count/.test(limiter));
  ok('the shared limiter fails open rather than closing the shop',
    /Fail open/.test(limiter));

  const catalog = fs.readFileSync('src/routes/catalog.js', 'utf8');
  ok('placing an order uses the shared, cross-instance limit',
    /bucket: 'checkout'[^)]*shared: true/.test(catalog));

  const maint = fs.readFileSync('src/services/maintenanceService.js', 'utf8');
  ok('the new ip columns are swept by the retention job',
    /orders: \d+/.test(maint) && /chargebacks: \d+/.test(maint));
}

// A held order must never be sitting in the manual fulfilment queue as a task
// staff cannot action.
{
  const stuck = await get(
    `SELECT COUNT(*) AS n FROM fulfillment_requests fr
       JOIN orders o ON o.id = fr.order_id WHERE o.fraud_hold = 1`);
  ok('no held order is queued for hand delivery', Number(stuck?.n || 0) === 0, JSON.stringify(stuck));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} fraud: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
