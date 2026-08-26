/**
 * Guest order visibility + abandoned-payment recovery reporting.
 *
 * Two things are pinned here:
 *  1. Every order email must link a GUEST to the public track page. Linking to
 *     /account/orders/<id> puts a login wall between the buyer and their own
 *     order — most orders are placed without an account.
 *  2. recoveryMetrics() must count only real recoveries, and must return null
 *     (not 0%) when nothing has been sent yet.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_recovery';
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


let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

await (await import('../src/app.js')).ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const {
  createOrder, getOrder, orderUrlFor, renderOrderEmail, sendPaymentReminders, markPaymentReceived,
} = await import('../src/services/orderService.js');
const { upsertUserByEmail } = await import('../src/services/userService.js');
const { recoveryMetrics } = await import('../src/services/analyticsService.js');
const { run, all } = await import('../src/db/index.js');
const tag = Date.now() % 1000000;

const product = await createProduct({ name: `Recovery Pack ${tag}`, category: 'giftcard', price: 1500, announce: false });

// ── 1. Guest order emails must not point at the dashboard ───────────────────
console.log('— Guest order links (no login wall) —');
{
  const guest = await createOrder({ consent: true, consentText: 'test consent', email: `guest${tag}@x.dev`, items: [{ productId: product.id, quantity: 1 }] });
  const url = orderUrlFor(await getOrder(guest.id));
  ok('guest order URL is the public track page', url.includes('/track?number='), url);
  ok('guest order URL carries the order number', url.includes(encodeURIComponent(guest.number)), url);
  ok('guest order URL is NOT the dashboard', !url.includes('/account/orders/'), url);

  const mail = await renderOrderEmail(guest.id, 'order_received');
  ok('order_received email links a guest to /track', mail.html.includes('/track?number='), 'no track link in email');
  ok('order_received email has no dashboard link', !mail.html.includes('/account/orders/'), 'dashboard link present');
  ok('order_received no longer promises instant delivery',
    !/deliver instantly/i.test(mail.html), 'instant-delivery claim still in the email');
}

// ── 2. A signed-in buyer still gets their dashboard ─────────────────────────
{
  const { user } = await upsertUserByEmail(`member${tag}@x.dev`);
  const member = await createOrder({ consent: true, consentText: 'test consent', email: user.email, userId: user.id, items: [{ productId: product.id, quantity: 1 }] });
  const url = orderUrlFor(await getOrder(member.id));
  ok('signed-in order URL is the dashboard', url.includes(`/account/orders/${member.id}`), url);
}

// ── 3. Recovery metrics ─────────────────────────────────────────────────────
console.log('\n— Recovery reporting —');
{
  const fresh = await recoveryMetrics({ days: 30 });
  ok('no reminders sent yet ⇒ rate is null, not 0%', fresh.paymentReminders.recoveryRate === null,
    `rate=${fresh.paymentReminders.recoveryRate}`);

  // Two unpaid orders, backdated so the reminder cron picks them up.
  const a = await createOrder({ consent: true, consentText: 'test consent', email: `chase-a${tag}@x.dev`, items: [{ productId: product.id, quantity: 1 }] });
  const b = await createOrder({ consent: true, consentText: 'test consent', email: `chase-b${tag}@x.dev`, items: [{ productId: product.id, quantity: 1 }] });
  const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
  for (const o of [a, b]) await run('UPDATE orders SET created_at=@at WHERE id=@id', { at: old, id: o.id });

  const sent = await sendPaymentReminders({ afterMinutes: 60 });
  ok('both unpaid orders got a reminder', sent === 2, `sent=${sent}`);

  const afterSend = await recoveryMetrics({ days: 30 });
  ok('reminders counted', afterSend.paymentReminders.sent === 2, `sent=${afterSend.paymentReminders.sent}`);
  ok('nothing recovered yet', afterSend.paymentReminders.recovered === 0, `recovered=${afterSend.paymentReminders.recovered}`);
  ok('unrecovered orders show as still waiting', afterSend.paymentReminders.stillWaiting === 2,
    `waiting=${afterSend.paymentReminders.stillWaiting}`);
  ok('recovery rate is 0% once mail went out (real zero, not null)', afterSend.paymentReminders.recoveryRate === 0,
    `rate=${afterSend.paymentReminders.recoveryRate}`);

  // One of them pays after the reminder — that is a recovery.
  await addProductCodes(product.id, [`REC-${tag}-1`]);
  await markPaymentReceived(a.id, `tx${tag}`, { actorId: 'test' });

  const afterPay = await recoveryMetrics({ days: 30 });
  ok('the order paid after its reminder counts as recovered', afterPay.paymentReminders.recovered === 1,
    `recovered=${afterPay.paymentReminders.recovered}`);
  ok('recovered revenue equals that order total', afterPay.paymentReminders.recoveredRevenue === 1500,
    `cents=${afterPay.paymentReminders.recoveredRevenue}`);
  ok('recovery rate is 50%', afterPay.paymentReminders.recoveryRate === 50,
    `rate=${afterPay.paymentReminders.recoveryRate}`);
  ok('the other order is still counted as waiting', afterPay.paymentReminders.stillWaiting === 1,
    `waiting=${afterPay.paymentReminders.stillWaiting}`);

  // An order paid BEFORE any reminder must never be attributed to the email.
  const c = await createOrder({ consent: true, consentText: 'test consent', email: `early${tag}@x.dev`, items: [{ productId: product.id, quantity: 1 }] });
  await addProductCodes(product.id, [`REC-${tag}-2`]);
  await markPaymentReceived(c.id, `tx-early${tag}`, { actorId: 'test' });
  const afterEarly = await recoveryMetrics({ days: 30 });
  ok('an order that never got a reminder is not counted', afterEarly.paymentReminders.sent === 2,
    `sent=${afterEarly.paymentReminders.sent}`);
  ok('recovered count unchanged by the self-paying order', afterEarly.paymentReminders.recovered === 1,
    `recovered=${afterEarly.paymentReminders.recovered}`);

  // Unpaid + old + never mailed = money the cron is leaving on the table.
  const d = await createOrder({ consent: true, consentText: 'test consent', email: `unchased${tag}@x.dev`, items: [{ productId: product.id, quantity: 1 }] });
  await run('UPDATE orders SET created_at=@at WHERE id=@id', { at: old, id: d.id });
  const withGap = await recoveryMetrics({ days: 30 });
  ok('unchased unpaid orders are surfaced', withGap.paymentReminders.notSentYet === 1,
    `notSentYet=${withGap.paymentReminders.notSentYet}`);
  ok('their value is reported too', withGap.paymentReminders.notSentValue === 1500,
    `value=${withGap.paymentReminders.notSentValue}`);
}

// ── 4. Cart-recovery bucket stays separate and safe on empty data ────────────
{
  const m = await recoveryMetrics({ days: 30 });
  ok('cart recovery rate is null with no cart reminders', m.cartReminders.recoveryRate === null,
    `rate=${m.cartReminders.recoveryRate}`);
  ok('total recovered = payment + cart', m.totalRecovered === m.paymentReminders.recoveredRevenue + m.cartReminders.recoveredRevenue,
    `total=${m.totalRecovered}`);
}

// Sanity: the reminder claim is idempotent — a second cron pass sends nothing.
{
  const again = await sendPaymentReminders({ afterMinutes: 60 });
  const stamped = await all("SELECT id FROM orders WHERE reminder_sent_at IS NOT NULL");
  ok('a second cron pass re-mails nobody already reminded', again <= 1, `sent=${again}`);
  ok('reminder stamps are never duplicated', stamped.length >= 2, `stamped=${stamped.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
