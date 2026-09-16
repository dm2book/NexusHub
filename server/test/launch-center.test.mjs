/**
 * The launch command centre.
 *
 * Ten numbers on one screen, refreshing on their own. Which makes two failure
 * modes much worse than they are anywhere else in this admin:
 *
 *   1. NUMBERS THAT DO NOT ADD UP. "New customers" and "returning customers"
 *      sit side by side. If they are computed separately they will disagree
 *      with each other and with the order count, and the person reading them
 *      cannot tell which one is lying. They are one query here, and the test
 *      that matters is new + returning = buyers, over every shape of day.
 *
 *   2. A NUMBER THAT LOOKS LIVE AND IS NOT. There is no push here — this shop
 *      is one serverless function, where a held-open stream dies on the
 *      function timeout and leaves a frozen figure looking current. So the page
 *      polls and renders the AGE of what it has. The payload has to carry that
 *      age, and the endpoint has to forbid caching, or "live" is decoration.
 *
 * The rest is the discipline the profit and supply rounds already established:
 * an unknown cost is not zero, a guest is still a customer, and a refund and a
 * chargeback are opposite facts that must never be added together.
 */
import { migrate } from '../src/db/migrate.js';
import { run, all, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const {
  launchCenter, customersToday, failedDeliveries, lowStock, activeAds, awaitingPayment,
  STALE_AFTER_SECONDS, UNDELIVERED_AFTER_MINUTES,
} = await import('../src/services/launchCenterService.js');
const { periodBounds } = await import('../src/services/profitService.js');
const { stockTierFor } = await import('../src/services/codeStockService.js');

const svc = codeOf('server/src/services/launchCenterService.js');
const at = nowIso();
const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const today = () => periodBounds().today;

const product = async (name, { price = 1000, metaCost, active = 1 } = {}) => {
  const id = newId('prd');
  await run(
    `INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
     VALUES (@id,@s,@n,'robux','t',@p,'EUR','digital',@a,@m,@at,@at)`,
    { id, s: `LC-${id.slice(-8)}`, n: name, p: price, a: active,
      m: JSON.stringify(metaCost == null ? {} : { cost: metaCost }), at });
  return id;
};
const order = async ({ email, status = 'completed', createdAt = at, updatedAt, lines = [], total } = {}) => {
  const oid = newId('ord');
  const sum = total ?? lines.reduce((s, l) => s + l.unit * l.qty, 0);
  await run(
    `INSERT INTO orders (id, number, email, status, subtotal, total, currency, created_at, updated_at)
     VALUES (@id,@n,@e,@st,@t,@t,'EUR',@c,@u)`,
    { id: oid, n: `FM-${oid.slice(-8)}`, e: email, st: status, t: sum,
      c: createdAt, u: updatedAt || createdAt });
  for (const l of lines) {
    await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price)
               VALUES (@id,@o,@p,@n,@q,@u)`,
      { id: newId('oi'), o: oid, p: l.pid, n: l.name || 'x', q: l.qty, u: l.unit });
  }
  return oid;
};
const codes = async (pid, howMany) => {
  for (let i = 0; i < howMany; i++) {
    await run(`INSERT INTO product_codes (id, product_id, code, status, created_at)
               VALUES (@id,@p,@c,'available',@at)`,
      { id: newId('pcd'), p: pid, c: `${pid.slice(-4)}-${i}`, at });
  }
};
const wipeOrders = async () => {
  await run('DELETE FROM order_items');
  await run('DELETE FROM orders');
};

console.log('— New plus returning is the number of buyers, or the board lies —');
{
  await wipeOrders();
  const t = today();
  await order({ email: 'first@example.test', createdAt: at });                     // brand new
  await order({ email: 'again@example.test', createdAt: daysAgo(9) });             // history
  await order({ email: 'again@example.test', createdAt: at });                     // …back today
  /* Anchored to the local day this card reports on, not to "two hours ago".
     periodBounds resolves `today` in the shop's timezone, so between local
     midnight and 02:00 an order made 120 minutes ago belongs to YESTERDAY —
     and twice@ then has history and counts as returning. This suite went red
     every night for those two hours and green again by morning, which is the
     worst kind of guard: one nobody trusts and everybody re-runs. */
  const justAfterMidnight = new Date(Date.parse(t) + 60_000).toISOString();
  await order({ email: 'twice@example.test', createdAt: justAfterMidnight });      // new, twice today
  await order({ email: 'twice@example.test', createdAt: at });

  const c = await customersToday(t);
  ok('a first-ever buyer counts as new', c.new === 2, String(c.new));
  ok('a buyer with history counts as returning', c.returning === 1, String(c.returning));
  /* The invariant the whole card rests on. Two separately-computed halves would
     double-count "twice@" and this would read 4 = 3. */
  ok('new + returning = buyers, exactly', c.new + c.returning === c.buyers && c.buyers === 3,
    JSON.stringify(c));
  ok('…and ordering twice in one day is still one buyer', c.buyers === 3);

  /* Guest checkout is the normal case here: orders carry an email and a NULL
     user_id. Counting user ids would report every guest as new forever and
     returning customers as a permanent zero. */
  ok('a buyer is an email, not a user row',
    /LOWER\(email\)/.test(svc) && !/user_id/.test(svc));
  await order({ email: 'CASE@Example.test', createdAt: daysAgo(3) });
  await order({ email: 'case@example.test', createdAt: at });
  const c2 = await customersToday(t);
  ok('…and the same address in different case is the same person',
    c2.returning === 2 && c2.buyers === 4, JSON.stringify(c2));

  await order({ email: 'unpaid@example.test', status: 'pending', createdAt: at });
  const c3 = await customersToday(t);
  ok('an unpaid order does not make a customer', c3.buyers === 4, JSON.stringify(c3));

  await wipeOrders();
  const empty = await customersToday(t);
  ok('a day with no orders is zero, and still adds up',
    empty.new === 0 && empty.returning === 0 && empty.buyers === 0);
}

console.log('\n— Money today —');
{
  await wipeOrders();
  const costed = await product('costed', { price: 1000, metaCost: 600 });
  const bare = await product('uncosted', { price: 1000 });
  await order({ email: 'a@example.test', lines: [{ pid: costed, qty: 2, unit: 1000 }] });
  await order({ email: 'b@example.test', lines: [{ pid: bare, qty: 1, unit: 1000 }] });
  await order({ email: 'old@example.test', createdAt: daysAgo(2), lines: [{ pid: costed, qty: 5, unit: 1000 }] });
  await order({ email: 'c@example.test', status: 'pending', lines: [{ pid: costed, qty: 9, unit: 1000 }] });

  const d = await launchCenter();
  ok('orders today counts today only', d.today.orders === 2, String(d.today.orders));
  ok('…and paid only', d.today.revenueCents === 3000, String(d.today.revenueCents));
  ok('units today are the units sold today', d.today.units === 3, String(d.today.units));
  /* 2 × (1000 − 600) = 800 over the costed half. If the uncosted line were
     costed at zero the answer would be 1800 on 3000 — a 60% margin invented out
     of a product nobody has priced. */
  ok('profit is over the costed revenue only', d.today.profitCents === 800, String(d.today.profitCents));
  ok('…and says what share that was',
    d.today.coverage.revenue === 2000 && d.today.coverage.revenueTotal === 3000,
    JSON.stringify(d.today.coverage));
  ok('…and is not complete', d.today.coverage.complete === false);

  await wipeOrders();
  await order({ email: 'z@example.test', lines: [{ pid: bare, qty: 1, unit: 1000 }] });
  const none = await launchCenter();
  ok('with nothing costed, profit is null rather than equal to revenue',
    none.today.profitCents === null && none.today.revenueCents === 1000,
    JSON.stringify(none.today));
  ok('…and the margin too', none.today.marginPct === null);

  /* The headline is the order total, which carries discounts and coupons; the
     line sum is what the products cost before any of that. They are different
     questions and the file says which is which. */
  await wipeOrders();
  await order({ email: 'disc@example.test', total: 700, lines: [{ pid: costed, qty: 1, unit: 1000 }] });
  const disc = await launchCenter();
  ok('revenue follows the order total, not the line sum',
    disc.today.revenueCents === 700, String(disc.today.revenueCents));
}

console.log('\n— A refund and a chargeback are opposite facts —');
{
  await wipeOrders();
  const oid = await order({ email: 'r@example.test', total: 2500, status: 'refunded', updatedAt: at });
  await run(`INSERT INTO refund_requests (id, order_id, reason, amount, status, created_at, updated_at)
             VALUES (@id,@o,'changed mind',2500,'requested',@at,@at)`,
    { id: newId('rfq'), o: oid, at });
  await run(`INSERT INTO chargebacks (id, order_id, email, amount, provider, reason, source, created_at)
             VALUES (@id,@o,'r@example.test',2500,'stripe','fraudulent','psp',@at)`,
    { id: newId('cbk'), o: oid, at });
  await run(`INSERT INTO chargebacks (id, order_id, email, amount, provider, reason, source, created_at)
             VALUES (@id,NULL,'old@example.test',1000,'stripe','product_not_received','psp',@at)`,
    { id: newId('cbk'), at: daysAgo(10) });
  await run(`INSERT INTO chargebacks (id, order_id, email, amount, provider, reason, source, created_at)
             VALUES (@id,NULL,'ancient@example.test',9900,'stripe','other','psp',@at)`,
    { id: newId('cbk'), at: daysAgo(200) });

  const d = await launchCenter();
  ok('a chargeback today is counted today', d.chargebacks.today === 1, String(d.chargebacks.today));
  ok('…and the last 30 days separately', d.chargebacks.last30Days === 2, String(d.chargebacks.last30Days));
  ok('…and one from 200 days ago is in the total but not the window',
    d.chargebacks.total === 3 && d.chargebacks.last30Days === 2, JSON.stringify(d.chargebacks));
  ok('the amount lost in the window is reported',
    d.chargebacks.last30DaysCents === 3500, String(d.chargebacks.last30DaysCents));

  ok('a pending refund request is actionable and counted as such',
    d.refunds.pendingRequests === 1 && d.refunds.requestedToday === 1, JSON.stringify(d.refunds));
  ok('a refunded order is counted where the money actually went',
    d.refunds.refundedOrdersToday === 1 && d.refunds.refundedCentsToday === 2500,
    JSON.stringify(d.refunds));
  /* They are the same €25 seen from two sides. Summed, the board reports €50 of
     damage from one incident. */
  ok('refunds and chargebacks are never added together',
    !/chargeback[\s\S]{0,80}\+[\s\S]{0,20}refund/i.test(svc));
  ok('a refunded order is not revenue today', d.today.revenueCents === 0, String(d.today.revenueCents));
}

console.log('\n— Deliveries that did not happen, in both of the ways —');
{
  await wipeOrders();
  const pid = await product('deliverable');
  const failed = await order({ email: 'f@example.test', status: 'processing', createdAt: ago(60) });
  await run(`INSERT INTO fulfillment_requests (id, order_id, mode, status, created_at, updated_at)
             VALUES (@id,@o,'api','failed',@c,@u)`, { id: newId('ful'), o: failed, c: ago(60), u: at });
  await run(`INSERT INTO fulfillment_requests (id, order_id, mode, status, created_at, updated_at)
             VALUES (@id,@o,'api','failed',@c,@u)`,
    { id: newId('ful'), o: failed, c: daysAgo(4), u: daysAgo(4) });

  /* The expensive one: paid, undelivered, and no fulfilment row anywhere to
     raise a failure against — no supplier mapped and no codes on the shelf.
     Nothing in this codebase counted these before. */
  await order({ email: 'silent@example.test', status: 'payment_received', createdAt: ago(45),
    lines: [{ pid, qty: 1, unit: 1000 }] });
  await order({ email: 'fresh@example.test', status: 'payment_received', createdAt: ago(2) });
  await order({ email: 'done@example.test', status: 'completed', createdAt: ago(90) });

  const d = await launchCenter();
  ok('a failure today is counted today', d.failedDeliveries.failedToday === 1,
    String(d.failedDeliveries.failedToday));
  ok('…and every open failure is counted too', d.failedDeliveries.openFailures === 2,
    String(d.failedDeliveries.openFailures));
  ok('a paid order nobody delivered is counted even with no failure row',
    d.failedDeliveries.undeliveredPaidOrders === 2,
    String(d.failedDeliveries.undeliveredPaidOrders));
  ok('…but an order two minutes old is still in flight, not a failure',
    d.failedDeliveries.thresholdMinutes === UNDELIVERED_AFTER_MINUTES
    && UNDELIVERED_AFTER_MINUTES >= 5, String(UNDELIVERED_AFTER_MINUTES));
  ok('…and a completed order is not a failed delivery',
    d.failedDeliveries.undeliveredPaidOrders === 2);
  ok('the oldest one is reported in minutes, so you know how angry they are',
    d.failedDeliveries.oldestUndeliveredMinutes >= 44,
    String(d.failedDeliveries.oldestUndeliveredMinutes));

  const clean = await failedDeliveries(today(), { now: Date.now() });
  ok('the helper agrees with the board', clean.undeliveredPaidOrders === 2);
}

console.log('\n— Low stock means the shelf, at the tier Discord already uses —');
{
  const out = await product('sold out');
  const crit = await product('nearly gone');
  const low = await product('getting low');
  const fine = await product('plenty');
  const off = await product('discontinued', { active: 0 });
  await codes(crit, 3);
  await codes(low, 8);
  await codes(fine, 500);
  await codes(off, 0);

  const s = await lowStock();
  ok('a product with no codes is out of stock', s.outOfStock >= 1, String(s.outOfStock));
  ok('three left is critical', s.critical >= 1, String(s.critical));
  ok('eight left is low', s.low >= 1, String(s.low));
  ok('five hundred left is not flagged at all',
    !s.products.some((p) => p.productId === fine));
  ok('an inactive product is not flagged — nobody can buy it',
    !s.products.some((p) => p.productId === off));
  ok('the tiers come from the shared function, not a second hand-written number',
    /import \{ stockTierFor \}/.test(read('server/src/services/launchCenterService.js')));
  ok('…and agree with it row by row',
    s.products.every((p) => p.tier === stockTierFor(p.codes)));
  ok('the emptiest shelf is listed first',
    s.products.every((p, i) => i === 0 || s.products[i - 1].codes <= p.codes));

  /* A product bought per order from a supplier is SUPPOSED to hold no codes.
     Counting those as out of stock put 68 of 72 products on this alarm the
     first time it ran against real data — a catalogue listing, not a launch
     board. Found by looking at the numbers, not by reading the query. */
  const live = await product('sourced live');
  const sup = newId('sup');
  await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at)
             VALUES (@id,'Live Co','api','active','{}',@at,@at)`, { id: sup, at });
  await run(`INSERT INTO supplier_products (id, supplier_id, product_id, supplier_sku, cost, available_stock, priority, last_synced_at)
             VALUES (@id,@s,@p,'SKU-LIVE',400,500,10,@at)`,
    { id: newId('sprd'), s: sup, p: live, at });
  const s2 = await lowStock();
  ok('a product sourced live from a supplier is not called out of stock',
    !s2.products.some((p) => p.productId === live), JSON.stringify(s2.products.map((p) => p.name)));
  ok('…and is counted as such rather than silently dropped',
    s2.sourcedLive >= 1, String(s2.sourcedLive));

  /* …but only while that supplier can actually deliver. A paused supplier is a
     supplier on paper, and the shelf behind it is empty. */
  await run(`UPDATE suppliers SET status = 'paused' WHERE id = @id`, { id: sup });
  const s3 = await lowStock();
  ok('a paused supplier does not excuse an empty shelf',
    s3.products.some((p) => p.productId === live), String(s3.sourcedLive));

  await run(`UPDATE suppliers SET status = 'active' WHERE id = @id`, { id: sup });
  await run(`UPDATE supplier_products SET available_stock = 0 WHERE product_id = @p`, { p: live });
  const s4 = await lowStock();
  ok('…nor does a supplier that reports none left',
    s4.products.some((p) => p.productId === live));
  ok('the gate matches the one fulfilment routing uses',
    /supplier_status IS NULL OR sp\.supplier_status = 'in_stock'/.test(
      read('server/src/services/launchCenterService.js')));
}

console.log('\n— Adverts that are delivering, not adverts that are switched on —');
{
  const visit = async (creative, campaign, network, createdAt) => run(
    `INSERT INTO ad_visits (id, network, campaign, creative_id, landing_path, created_at)
     VALUES (@id,@n,@c,@cr,'/',@at)`,
    { id: newId('adv'), n: network, c: campaign, cr: creative, at: createdAt });
  await visit('hook-a', 'launch', 'tiktok', ago(30));
  await visit('hook-a', 'launch', 'tiktok', ago(90));
  await visit('hook-b', 'launch', 'youtube', ago(200));
  await visit('hook-old', 'pre-launch', 'tiktok', daysAgo(5));

  const a = await activeAds();
  ok('a creative seen in the last 24h is active', a.activeCreatives === 2, String(a.activeCreatives));
  ok('…and one last seen five days ago is not', !a.top.some((t) => t.creative === 'hook-old'));
  ok('campaigns are counted once across networks', a.activeCampaigns === 1, String(a.activeCampaigns));
  ok('visits are totalled', a.visits === 3, String(a.visits));
  ok('the networks in play are listed',
    a.networks.includes('tiktok') && a.networks.includes('youtube'));
  ok('the busiest creative is first', a.top[0].creative === 'hook-a' && a.top[0].visits === 2);
  /* ad_visits is written only with marketing consent, so a running campaign
     whose visitors all declined records nothing. Zero here does not mean the
     ads are off, and the payload has to say so rather than let the page imply
     a census. */
  ok('the payload admits the figure is consent-limited', a.consentLimited === true);
  ok('…and the window it measured', a.windowHours === 24);
}


console.log('\n— Placed, and not paid for —');
{
  /* Nothing counted these. The sidebar badge counts payment PROOFS a buyer
     submitted; the orders badge counts what is already paid and waiting to be
     delivered. An order sitting in `pending` with no proof appeared in neither
     — and in a shop whose whole payment flow is "transfer with your order
     number as the reference", that is the queue the owner works from. */
  await wipeOrders();
  await run('DELETE FROM payment_proofs').catch(() => {});
  const empty = await awaitingPayment();
  ok('an empty queue is zero, not null', empty.orders === 0 && empty.ifAllPaidCents === 0);
  ok('…and has no oldest', empty.oldestMinutes === null);

  const p = await product('waiting', { price: 999 });
  await order({ email: 'a@example.test', status: 'pending', createdAt: ago(20),
    lines: [{ pid: p, qty: 1, unit: 999 }], total: 999 });
  await order({ email: 'b@example.test', status: 'pending', createdAt: ago(3000), total: 2499 });
  /* Paid and completed orders are somebody else's problem. */
  await order({ email: 'c@example.test', status: 'completed', total: 5000 });
  await order({ email: 'd@example.test', status: 'cancelled', total: 700 });

  const w = await awaitingPayment();
  ok('only orders still awaiting payment are counted', w.orders === 2, String(w.orders));
  ok('…with what they would be worth if everyone paid', w.ifAllPaidCents === 3498, String(w.ifAllPaidCents));
  /* Deliberately not called revenue: an abandoned checkout is indistinguishable
     from an unmatched transfer here, so a total labelled "money waiting" would
     be an invented figure. */
  ok('…under a name that cannot be read as money in the bank',
    'ifAllPaidCents' in w && !('revenueCents' in w));
  ok('the oldest one is aged, so a forgotten order is visible',
    w.oldestMinutes >= 2999, String(w.oldestMinutes));

  const oid = (await all("SELECT id FROM orders WHERE status = 'pending' LIMIT 1"))[0].id;
  await run(`INSERT INTO payment_proofs (id, order_id, method, status, created_at)
             VALUES (@id,@o,'bank','pending',@at)`, { id: newId('pp'), o: oid, at });
  const w2 = await awaitingPayment();
  ok('a submitted proof is counted separately — that is the actionable half',
    w2.proofsWaiting === 1 && w2.orders === 2, JSON.stringify(w2));

  const d = await launchCenter();
  ok('the board carries it', d.awaitingPayment.orders === 2);
  const page = codeOf('src/pages/admin/Live.jsx');
  ok('…and the page shows it', /Awaiting payment/.test(page));
  ok('…calling it "if all paid", never revenue',
    /if all paid/.test(page) && !/wait\.ifAllPaidCents[^}]*revenue/i.test(page));
  ok('…and surfaces the proofs that can be acted on now',
    /proof\(s\) to review/.test(page));
}

console.log('\n— "Live" has to mean something —');
{
  const d = await launchCenter();
  ok('the payload says when it was generated', !!Date.parse(d.generatedAt));
  ok('…how long it took, so a slow board is visible', Number.isFinite(d.tookMs));
  ok('…and when it should stop being called current',
    d.staleAfterSeconds === STALE_AFTER_SECONDS && STALE_AFTER_SECONDS > 0);
  ok('the day is the shop\'s day, not UTC', d.bounds.tz === 'Europe/Amsterdam', d.bounds.tz);

  const route = read('server/src/routes/admin/index.js');
  ok('the endpoint exists', /router\.get\('\/launch-center'/.test(route));
  /* A cached "live" number is worse than a stale one that admits it. */
  ok('…and forbids caching',
    /launch-center'[\s\S]{0,300}Cache-Control', 'no-store'/.test(route));
  ok('…behind the analytics permission',
    /'\/launch-center', requirePermission\('analytics\.read'\)/.test(route));

  const page = codeOf('src/pages/admin/Live.jsx');
  ok('the page polls rather than pretending to stream', /setInterval|setTimeout/.test(page));
  /* A laptop left open on this page all night is a request every few seconds
     forever, against a database billed by the hour. */
  ok('…and stops polling when the tab is hidden', /visibilitychange|document\.hidden/.test(page));
  ok('…and renders the age of what it has, not the word "live" alone',
    /ago|Updated/i.test(page));
  ok('the page uses the dark palette the admin renders in',
    !/text-slate-(700|800|900)/.test(page));
}

console.log('\n— Cheap enough to poll —');
{
  /* Polling something expensive is how a live page takes the shop down on its
     busiest day. This used to be 2 queries PER PRODUCT through costCentsFor. */
  ok('the cost map is read in bulk, not per product',
    /costCentsForMany/.test(svc) && !/costCentsFor\(/.test(svc));
  ok('…in profitService too', /costCentsForMany/.test(codeOf('server/src/services/profitService.js')));
  ok('…and in the analytics overview',
    /costCentsForMany/.test(codeOf('server/src/services/analyticsService.js')));
  ok('the board is gathered in parallel, not one query after another',
    /await Promise\.all\(\[/.test(svc));

  const t0 = Date.now();
  await launchCenter();
  const ms = Date.now() - t0;
  ok(`the whole board answers in well under the poll interval (${ms}ms)`, ms < 3000, `${ms}ms`);
}

console.log('\n— An empty shop —');
{
  await wipeOrders();
  const d = await launchCenter();
  ok('every figure is present on a shop that has sold nothing',
    d.today.orders === 0 && d.today.revenueCents === 0
    && d.customers.buyers === 0 && d.refunds.pendingRequests >= 0
    && d.chargebacks.total >= 0 && d.ads.activeCreatives >= 0);
  ok('…and profit is null, not zero', d.today.profitCents === null, String(d.today.profitCents));
  ok('…and nothing claims a margin', d.today.marginPct === null);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} launch-center: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
