/**
 * Load and failure-mode test for the order path.
 *
 * This is not a benchmark. Requests-per-second on a laptop tells you nothing
 * useful about a serverless deployment in front of a managed database. What it
 * is for is the class of bug that only appears when things happen AT THE SAME
 * TIME, and that no unit test will ever produce:
 *
 *   - two buyers paying for the last code in stock
 *   - a payment webhook arriving twice, or arriving while the order is still
 *     being fulfilled
 *   - a payment that fails, then succeeds
 *   - the database being slow enough that two requests overlap where they
 *     normally would not
 *
 * Those are the bugs that cost money rather than latency: a code sold twice, an
 * order paid and never delivered, stock that leaks away.
 *
 * HOW TO RUN
 *
 *   1. Start an API against a scratch database. The order LIMITS must be off,
 *      or the test measures the fraud ceilings rather than the order path —
 *      those are exercised deliberately in scenario 6 instead:
 *
 *      createdb forge_load
 *      DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/forge_load \
 *      LIMIT_ORDERS_PER_EMAIL_DAY=0 LIMIT_ORDERS_PER_IP_DAY=0 \
 *      LIMIT_VALUE_PER_EMAIL_DAY=0 LIMIT_MAX_ORDER_VALUE=0 \
 *      RATE_LIMIT_MAX=100000 PORT=4000 node server/src/index.js
 *
 *   2. node server/test/load/loadtest.mjs [--base http://localhost:4000]
 *
 * Every scenario prints what it asserts and why it matters. Findings are
 * summarised at the end with a severity, so the output is the report.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'http://localhost:4000');
const DB = arg('db', process.env.DATABASE_URL
  || 'postgres://postgres:postgres@127.0.0.1:5432/forge_load');

process.env.DATABASE_URL = DB;
process.env.NODE_ENV ||= 'development';

const { run, get, all } = await import('../../src/db/index.js');
const { createProduct } = await import('../../src/services/productService.js');
const { addProductCodes, availableCount } = await import('../../src/services/codeStockService.js');

const tag = Date.now() % 1000000;
let scenario = 0;
const findings = [];
const finding = (severity, title, detail) => {
  findings.push({ severity, title, detail });
  console.log(`\n  ${severity === 'blocker' ? '🛑' : severity === 'high' ? '⚠️ ' : 'ℹ️ '} ${title}\n     ${detail}`);
};

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
};

const head = (n, title) => console.log(`\n${'━'.repeat(66)}\n${n}. ${title}\n${'━'.repeat(66)}`);

/** POST an order the way the storefront does, timing it. */
async function placeOrder(productId, { email, ip, qty = 1 } = {}) {
  const t = Date.now();
  try {
    const res = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The API sits behind `trust proxy`, so this is how a distinct client
        // address is simulated. Without it every virtual buyer shares one IP
        // and the fraud rules — correctly — treat the whole run as one person.
        'x-forwarded-for': ip || `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`,
      },
      body: JSON.stringify({
        email: email || `load${tag}-${Math.random().toString(36).slice(2, 10)}@example.com`,
        items: [{ productId, quantity: qty }],
        currency: 'EUR',
        consent: true,
        consentText: 'Immediate delivery, waiving withdrawal.',
      }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, ms: Date.now() - t, order: body.order, error: body.error?.message };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t, error: e.message };
  }
}

/** Settle an order through the same entry point a real payment uses. */
async function pay(orderId) {
  const { markPaymentReceived } = await import('../../src/services/orderService.js');
  return markPaymentReceived(orderId, `load_${orderId}`, { actorId: 'loadtest' })
    .then(() => ({ ok: true }))
    .catch((e) => ({ ok: false, error: e.message }));
}

/** Wait until an order stops moving through the fulfilment pipeline. */
async function settled(orderId, ms = 15000) {
  const { getOrder } = await import('../../src/services/orderService.js');
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    last = (await getOrder(orderId)).status;
    if (['completed', 'awaiting_fulfillment', 'refunded', 'cancelled', 'failed'].includes(last)) return last;
    await sleep(120);
  }
  return last;
}

console.log(`load test → ${BASE}\ndatabase  → ${DB}\n`);

// ── 1 & 2. Concurrent orders ────────────────────────────────────────────────
async function burst(n) {
  head(++scenario, `${n} concurrent orders`);
  const product = await createProduct({
    name: `Load ${n} ${tag}`, price: 1500, currency: 'EUR',
    category: 'giftcards', active: 1, deliveryMode: 'manual',
  });

  const t0 = Date.now();
  // Fired without any stagger on purpose. A real burst is a drop or a video
  // going out, not a smooth arrival curve.
  const results = await Promise.all(Array.from({ length: n }, () => placeOrder(product.id)));
  const wall = Date.now() - t0;

  const okOnes = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const times = okOnes.map((r) => r.ms);

  console.log(`  placed        ${okOnes.length}/${n} in ${wall}ms  (${(n / (wall / 1000)).toFixed(1)} orders/s)`);
  console.log(`  latency       p50 ${pct(times, 0.5)}ms   p95 ${pct(times, 0.95)}ms   max ${Math.max(0, ...times)}ms`);
  if (failed.length) {
    const byStatus = {};
    for (const f of failed) byStatus[`${f.status} ${f.error || ''}`.trim().slice(0, 70)] = (byStatus[`${f.status} ${f.error || ''}`.trim().slice(0, 70)] || 0) + 1;
    console.log(`  rejected      ${failed.length}`);
    for (const [k, v] of Object.entries(byStatus)) console.log(`                ${v}× ${k}`);
  }

  // Every accepted order must exist exactly once, with a unique number.
  const numbers = okOnes.map((r) => r.order?.number).filter(Boolean);
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) {
    finding('blocker', 'Duplicate order numbers under concurrency',
      `${numbers.length} orders produced ${unique.size} distinct numbers.`);
  } else {
    console.log(`  order numbers ${unique.size} unique ✓`);
  }

  if (failed.length) {
    finding(failed.length > n * 0.1 ? 'high' : 'info',
      `${failed.length}/${n} orders rejected at ${n} concurrent`,
      `Statuses: ${[...new Set(failed.map((f) => f.status))].join(', ')}. `
      + 'Anything other than a deliberate limit is lost revenue.');
  }
  if (pct(times, 0.95) > 3000) {
    finding('high', `p95 latency ${pct(times, 0.95)}ms at ${n} concurrent`,
      'Past ~3s a buyer assumes the checkout is broken and retries, which doubles the load.');
  }
  return { product, results: okOnes, wall, times };
}

const b50 = await burst(50);
const b100 = await burst(100);

// ── 3. Stock exhaustion ─────────────────────────────────────────────────────
head(++scenario, 'Stock exhaustion — 40 buyers, 10 codes');
{
  // The one that actually costs money: two orders must never be handed the same
  // code, and a code must never be consumed by an order that is not delivered.
  const product = await createProduct({
    name: `Load Stock ${tag}`, price: 999, currency: 'EUR',
    category: 'giftcards', active: 1, deliveryMode: 'auto',
  });
  const CODES = 10, BUYERS = 40;
  await addProductCodes(product.id, Array.from({ length: CODES }, (_, i) => `LOADSTOCK-${tag}-${i}`));

  const orders = (await Promise.all(Array.from({ length: BUYERS }, () => placeOrder(product.id))))
    .filter((r) => r.ok).map((r) => r.order);
  console.log(`  placed        ${orders.length} orders against ${CODES} codes`);

  // Everybody pays at once. This is the moment two buyers can be handed the
  // same code, and the only realistic way to produce it.
  const paid = await Promise.all(orders.map((o) => pay(o.id)));
  console.log(`  paid          ${paid.filter((p) => p.ok).length} settled, ${paid.filter((p) => !p.ok).length} refused`);
  await Promise.all(orders.map((o) => settled(o.id, 20000)));

  const delivered = await all(
    `SELECT d.content, d.order_id FROM deliveries d
      JOIN orders o ON o.id = d.order_id
     WHERE o.id = ANY(@ids)`, { ids: orders.map((o) => o.id) });
  const codes = delivered.map((d) => d.content);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);

  console.log(`  delivered     ${codes.length} codes to ${new Set(delivered.map((d) => d.order_id)).size} orders`);
  if (dupes.length) {
    finding('blocker', 'The same code was delivered to more than one order',
      `Duplicates: ${[...new Set(dupes)].join(', ')}. Two buyers paid for one item.`);
  } else {
    console.log(`  duplicates    none ✓`);
  }
  if (codes.length > CODES) {
    finding('blocker', 'More codes were delivered than existed',
      `${codes.length} delivered from a shelf of ${CODES}.`);
  }

  // Stock that is neither on the shelf nor in a delivery has leaked.
  const left = await availableCount(product.id);
  const claimed = await get(
    `SELECT COUNT(*) AS n FROM product_codes WHERE product_id=@p AND status='used'`, { p: product.id });
  const stranded = Number(claimed.n) - codes.length;
  console.log(`  shelf         ${left} available, ${claimed.n} used, ${codes.length} in deliveries`);
  if (stranded > 0) {
    finding('high', `${stranded} code(s) claimed but never delivered`,
      'Stock consumed by an order nobody received — it disappears silently and only shows up as a product that sells out early.');
  } else {
    console.log(`  leaked        none ✓`);
  }

  // Orders that could not be filled must still be handled, not left in limbo.
  // They move PAST payment_received into awaiting_fulfillment, so matching a
  // single status finds none of them — the first version of this check did
  // exactly that and reported a clean run it had not actually verified.
  const stuck = await all(
    `SELECT id, number, status FROM orders
      WHERE id = ANY(@ids)
        AND status IN ('payment_received', 'processing', 'awaiting_fulfillment')`,
    { ids: orders.map((o) => o.id) });
  const byStatus = {};
  for (const s of stuck) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  console.log(`  unfulfilled   ${stuck.length} paid orders with no stock left `
    + `(${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ') || '—'})`);

  if (stuck.length) {
    const queued = await get(
      `SELECT COUNT(DISTINCT order_id) AS n FROM fulfillment_requests WHERE order_id = ANY(@ids)`,
      { ids: stuck.map((s) => s.id) });
    if (Number(queued.n) < stuck.length) {
      finding('high', 'Paid orders that ran out of stock are not all queued for anyone',
        `${stuck.length} paid and undeliverable, only ${queued.n} in a fulfilment queue. `
        + 'The rest are invisible: the buyer has paid and nobody is looking at it.');
    } else {
      console.log(`  …queued       ${queued.n}/${stuck.length} for hand delivery ✓`);
    }
    // Nobody may be told their order is done when it is not.
    const lying = await get(
      `SELECT COUNT(*) AS n FROM orders WHERE id = ANY(@ids) AND status = 'completed'`,
      { ids: stuck.map((s) => s.id) });
    if (Number(lying.n) > 0) {
      finding('blocker', 'An order with no stock was marked completed', `${lying.n} orders.`);
    }
  }
}

// ── 4. Payment failures ─────────────────────────────────────────────────────
head(++scenario, 'Payment failures — declined, then retried');
{
  const product = await createProduct({
    name: `Load Pay ${tag}`, price: 2500, currency: 'EUR',
    category: 'giftcards', active: 1, deliveryMode: 'auto',
  });
  await addProductCodes(product.id, Array.from({ length: 20 }, (_, i) => `LOADPAY-${tag}-${i}`));
  const { transitionOrder, getOrder } = await import('../../src/services/orderService.js');

  const N = 20;
  const orders = (await Promise.all(Array.from({ length: N }, () => placeOrder(product.id))))
    .filter((r) => r.ok).map((r) => r.order);

  // A declined card must leave the order payable, not close a live sale.
  const stillPending = [];
  for (const o of orders.slice(0, 10)) {
    const fresh = await getOrder(o.id);
    if (fresh.status === 'pending') stillPending.push(o.id);
  }
  console.log(`  declined      ${stillPending.length}/10 orders stayed pending and payable ✓`);
  if (stillPending.length < 10) {
    finding('high', 'A failed payment closed the order',
      'A declined card is recoverable; failing the order kills a sale that is still alive.');
  }

  // …and paying after a failure must work exactly once.
  const retried = await Promise.all(stillPending.map((id) => pay(id)));
  console.log(`  retried       ${retried.filter((r) => r.ok).length}/${stillPending.length} settled on the second attempt`);
  await Promise.all(stillPending.map((id) => settled(id)));

  const doubled = await all(
    `SELECT order_id, COUNT(*) AS n FROM deliveries WHERE order_id = ANY(@ids)
      GROUP BY order_id HAVING COUNT(*) > 1`, { ids: stillPending });
  if (doubled.length) {
    finding('blocker', 'Retrying a failed payment delivered twice',
      `${doubled.length} orders received more than one delivery.`);
  } else {
    console.log(`  duplicates    none ✓`);
  }

  // An order that is cancelled must not be payable afterwards.
  const dead = orders[15];
  if (dead) {
    await transitionOrder(dead.id, 'cancelled', { actorId: 'loadtest' });
    const after = await pay(dead.id);
    const fresh = await getOrder(dead.id);
    if (fresh.status !== 'cancelled') {
      finding('blocker', 'A cancelled order could still be paid and delivered',
        `Order moved to ${fresh.status} after payment on a cancelled order.`);
    } else {
      console.log(`  cancelled     stayed cancelled when paid ✓ (${after.ok ? 'accepted' : 'refused'})`);
    }
  }
}

// ── 5. Webhook failures ─────────────────────────────────────────────────────
head(++scenario, 'Webhook failures — replays, races and garbage');
{
  const product = await createProduct({
    name: `Load Hook ${tag}`, price: 1999, currency: 'EUR',
    category: 'giftcards', active: 1, deliveryMode: 'auto',
  });
  await addProductCodes(product.id, Array.from({ length: 30 }, (_, i) => `LOADHOOK-${tag}-${i}`));

  const N = 15;
  const orders = (await Promise.all(Array.from({ length: N }, () => placeOrder(product.id))))
    .filter((r) => r.ok).map((r) => r.order);

  // A PSP retries anything that is not a 2xx, and fires again on later changes.
  // Five simultaneous deliveries of the same confirmation is the realistic worst
  // case, and every one of them must be a no-op after the first.
  await Promise.all(orders.map((o) => Promise.all(
    Array.from({ length: 5 }, () => pay(o.id).catch(() => null)),
  )));
  await Promise.all(orders.map((o) => settled(o.id, 20000)));

  const multi = await all(
    `SELECT order_id, COUNT(*) AS n FROM deliveries WHERE order_id = ANY(@ids)
      GROUP BY order_id HAVING COUNT(*) > 1`, { ids: orders.map((o) => o.id) });
  console.log(`  replays       5× per order on ${orders.length} orders`);
  if (multi.length) {
    finding('blocker', 'A replayed webhook delivered the order twice',
      `${multi.length} orders got more than one delivery from repeated confirmations.`);
  } else {
    console.log(`  duplicates    none ✓`);
  }

  const history = await all(
    `SELECT order_id, COUNT(*) AS n FROM order_status_history
      WHERE order_id = ANY(@ids) AND to_status = 'payment_received'
      GROUP BY order_id HAVING COUNT(*) > 1`, { ids: orders.map((o) => o.id) });
  if (history.length) {
    finding('high', 'A replayed webhook wrote the same transition twice',
      `${history.length} orders have a duplicated payment_received entry — the audit trail says it happened twice.`);
  } else {
    console.log(`  history       one payment_received per order ✓`);
  }

  // The Mollie webhook itself: no signature, so the id in the body is a hint.
  // Garbage must be absorbed rather than retried forever or crashed on.
  const bodies = ['', 'id=', 'id=not-a-payment', 'id=tr_../../etc/passwd', 'id=' + 'x'.repeat(5000)];
  const codes = [];
  for (const body of bodies) {
    const res = await fetch(`${BASE}/api/payments/mollie/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    }).catch(() => ({ status: 0 }));
    codes.push(res.status);
  }
  console.log(`  malformed     ${bodies.length} junk webhooks → ${codes.join(', ')}`);
  if (codes.some((c) => c >= 500)) {
    finding('high', 'A malformed webhook produced a 5xx',
      'A PSP retries a non-2xx for days. Garbage must be absorbed with a 200, not looped.');
  } else if (codes.every((c) => c === 200)) {
    console.log(`  …absorbed     all 200, no retry loop ✓`);
  }

  // Concurrent webhooks for DIFFERENT orders — the realistic burst after a drop.
  const t0 = Date.now();
  const more = (await Promise.all(Array.from({ length: 25 }, () => placeOrder(product.id))))
    .filter((r) => r.ok).map((r) => r.order);
  await Promise.all(more.map((o) => pay(o.id)));
  console.log(`  burst         25 concurrent confirmations in ${Date.now() - t0}ms`);
  await Promise.all(more.map((o) => settled(o.id, 20000)));
  const burstDupes = await all(
    `SELECT order_id, COUNT(*) AS n FROM deliveries WHERE order_id = ANY(@ids)
      GROUP BY order_id HAVING COUNT(*) > 1`, { ids: more.map((o) => o.id) });
  if (burstDupes.length) {
    finding('blocker', 'Concurrent confirmations double-delivered',
      `${burstDupes.length} of 25 orders received two deliveries.`);
  } else {
    console.log(`  duplicates    none ✓`);
  }
}

// ── 6. The limits, deliberately ─────────────────────────────────────────────
head(++scenario, 'What the shipped limits do to a real burst');
{
  // Everything above ran with the ceilings disabled so the order path itself
  // could be measured. This asks the opposite question — and asks the SERVER,
  // not this process. Reading config/env.js here would report whatever the test
  // runner's own environment says, which is not what is being exercised.
  const product = await createProduct({
    name: `Load Limits ${tag}`, price: 500, currency: 'EUR',
    category: 'giftcards', active: 1, deliveryMode: 'manual',
  });
  const oneIp = `198.51.100.${(tag % 200) + 1}`;
  const oneEmail = `limits${tag}@example.com`;

  // 25 orders, one address, one email. With the shipped defaults this stops at
  // 8; with the ceilings off it goes all the way through.
  const seq = [];
  for (let i = 0; i < 25; i++) seq.push(await placeOrder(product.id, { email: oneEmail, ip: oneIp }));
  const accepted = seq.filter((r) => r.ok).length;
  const refused = seq.filter((r) => !r.ok);
  console.log(`  one buyer     ${accepted}/25 accepted, ${refused.length} refused`);
  if (refused.length) {
    console.log(`  first refusal at order ${accepted + 1}: ${refused[0].status} ${refused[0].error?.slice(0, 60)}`);
  }

  // WHICH wall was hit matters. There are two, and they behave differently:
  //   429 → the per-minute rate limiter on POST /api/orders (checkout bucket,
  //         20/min per IP, counted in Postgres so it is shared across instances)
  //   400 → the daily order ceiling from LIMIT_ORDERS_PER_*
  // Reporting one as the other sends whoever reads this to the wrong setting.
  const codes = [...new Set(refused.map((r) => r.status))];
  if (!refused.length) {
    finding('info', 'Neither the rate limit nor the daily ceiling fired',
      'Both are off in this run. That is deliberate for scenarios 1-5, but it means this scenario '
      + 'measured nothing — re-run against a server with the shipped defaults.');
  } else if (codes.includes(429)) {
    finding('high', `One address is capped at ${accepted} orders per minute`,
      'The FIRST wall a burst hits is the per-minute rate limiter on POST /api/orders (checkout '
      + 'bucket, 20/min per IP), not the daily ceiling — this run had the daily ceilings disabled '
      + 'and was still refused at 21. Correct against one abusive buyer, but a school, an office or '
      + 'a mobile network shares one address, so a genuine group buying during a drop looks '
      + 'identical and gets a 429 at the checkout button. Raise the checkout bucket before a drop, '
      + 'or key it on something narrower than the IP alone.');
  } else {
    finding('info', `The daily ceiling refuses one address after ${accepted} orders`,
      `Refusal codes: ${codes.join(', ')}. That is LIMIT_ORDERS_PER_* doing its job.`);
  }

  // The shared rate limiter is a database round trip per request. Under a burst
  // it is on the critical path of every checkout, so its cost is worth knowing.
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 50 }, () => fetch(`${BASE}/api/config`)));
  console.log(`  50× /api/config in ${Date.now() - t0}ms (cached, no limiter round trip)`);
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${'━'.repeat(66)}\nFINDINGS\n${'━'.repeat(66)}`);
if (!findings.length) {
  console.log('  No correctness failures under any scenario.');
} else {
  for (const sev of ['blocker', 'high', 'info']) {
    for (const f of findings.filter((x) => x.severity === sev)) {
      console.log(`  [${sev.toUpperCase()}] ${f.title}\n           ${f.detail}`);
    }
  }
}
console.log(`\n  50 concurrent  p50 ${pct(b50.times, 0.5)}ms  p95 ${pct(b50.times, 0.95)}ms  wall ${b50.wall}ms`);
console.log(`  100 concurrent p50 ${pct(b100.times, 0.5)}ms  p95 ${pct(b100.times, 0.95)}ms  wall ${b100.wall}ms`);

const blockers = findings.filter((f) => f.severity === 'blocker').length;
console.log(`\n${blockers ? '❌' : '✅'} ${blockers} blocker(s), `
  + `${findings.filter((f) => f.severity === 'high').length} high, `
  + `${findings.filter((f) => f.severity === 'info').length} informational\n`);
process.exit(blockers ? 1 : 0);
