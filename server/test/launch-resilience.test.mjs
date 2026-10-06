/**
 * What the launch-week simulation found, fixed — and the refund choice.
 *
 *   1. A burst of payments: every order the supplier can fill is filled by the
 *      supplier, none is left paid and untouched (the queue stopped after 25,
 *      and dropped orders paid while it was letting go).
 *   2. Maintenance drains the supplier queue BEFORE the sweep.
 *   3. Two failed deliveries no longer bar a supplier for a day: after
 *      PROBE_AFTER_MINUTES one order may try it again.
 *   4. Every outside call on the order path has a timeout (Discord bot,
 *      Stripe, the Radar lookup, SMTP).
 *   5. Discord role sync and the delivery DM no longer sit on the payment path.
 *   6. Failed mails: code-carrying mails first, spaced retries, a deadline.
 *   7. Refund as money or store credit — the buyer chooses, the owner's
 *      approval does exactly that, and nothing is credited twice.
 */
import './_selling-shop.mjs';   // must come first — see that file
import { readFileSync } from 'node:fs';
import { ensureReady } from '../src/app.js';
import { get, all, run, nowIso } from '../src/db/index.js';
import { SupplierConnector } from '../src/services/supplier/SupplierConnector.js';
import { registerConnector } from '../src/services/supplier/registry.js';
import { createSupplier, mapSupplierProduct } from '../src/services/supplier/supplierService.js';
import { fitness, FAILOVER } from '../src/services/supplier/supplierFailoverService.js';
import { createProduct } from '../src/services/productService.js';
import { createOrder, transitionOrder, getOrder } from '../src/services/orderService.js';
import { addEntry, balanceOf } from '../src/services/walletService.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

await ensureReady();
const tag = Date.now().toString(36);
const at = nowIso();

console.log('— 1. A burst of payments all reach the supplier —');
{
  class Slowish extends SupplierConnector {
    static kind = `lr_slowish_${tag}`;
    get supportsFulfillment() { return true; }
    async testConnection() { return { ok: true }; }
    async createFulfillment(req) {
      await sleep(40);
      return { status: 'fulfilled', externalRef: `r-${req.orderNumber}`, deliveries: [{ type: 'code', content: `LR-${req.orderNumber}` }] };
    }
  }
  registerConnector(Slowish);
  const sup = await createSupplier({ name: `LR sup ${tag}`, connectorKind: Slowish.kind, config: {} });
  const prod = await createProduct({ name: `LR Robux ${tag}`, category: 'robux', price: 2000, announce: false });
  await mapSupplierProduct({ supplierId: sup.id, productId: prod.id, supplierSku: `LR-${tag}`, cost: 900, priority: 1 });
  const orders = [];
  for (let i = 0; i < 40; i++) {
    orders.push(await createOrder({ consent: true, consentText: 'test', email: `lr${i}-${tag}@example.com`,
      items: [{ productId: prod.id, quantity: 1 }] }, { actorId: 'test' }));
  }
  // All paid at once, the way a drop or a video lands.
  await Promise.all(orders.map((o) => transitionOrder(o.id, 'payment_received', { actorId: 'test' })));
  const ids = orders.map((o) => o.id);
  let left = ids.length;
  for (let i = 0; i < 80 && left; i++) {
    await sleep(250);
    left = (await get(`SELECT COUNT(*)::int AS n FROM orders WHERE id = ANY(@ids) AND status <> 'completed'`, { ids })).n;
  }
  ok('all 40 orders completed by the supplier', left === 0, `${left} not completed`);
  const manual = (await get(`SELECT COUNT(*)::int AS n FROM fulfillment_requests WHERE order_id = ANY(@ids) AND mode='manual'`, { ids })).n;
  ok('…and none was handed to a person', manual === 0, `${manual}`);
  const fsrc = src('services/fulfillmentService.js');
  ok('the queue is bounded by time, not by a count of 25', !/maxOrders = 25/.test(fsrc) && /budgetMs/.test(fsrc));
  ok('a lease outlives a killed function by 90 s, not 5 minutes', /LEASE_TTL_MS = 90_000/.test(fsrc) && !/ttlMs = 5 \* 60_000/.test(fsrc));
}

console.log('\n— 2. Maintenance: supplier queue before the sweep —');
{
  const m = src('services/maintenanceService.js');
  const q = m.indexOf("drainSupplierQueue({ actorId: 'system' }, { budgetMs: 8_000 })");
  const sweep = m.indexOf('sweepUnfulfilledPaidOrders({ limit: 50 })');
  ok('the queue runs first', q > 0 && sweep > 0 && q < sweep, `${q} / ${sweep}`);
}

console.log('\n— 3. A barred supplier is tried again after a pause —');
{
  const m = (over) => ({ supplierName: 'S', supplierStatus: 'active', lastSyncStatus: 'success', skuStatus: 'in_stock',
    stock: 10, cost: 500, failStreak: 2, ...over });
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  ok('two failures, the last one just now → not used', !fitness(m({ lastFailAt: ago(1) }), { priceCents: 2000 }).ok);
  ok(`…${FAILOVER.PROBE_AFTER_MINUTES} minutes later → one order may try it`, fitness(m({ lastFailAt: ago(FAILOVER.PROBE_AFTER_MINUTES + 1) }), { priceCents: 2000 }).ok);
  ok('without a failure time (older callers) → still barred, as before', !fitness(m({}), { priceCents: 2000 }).ok);
  ok('a supplier that just failed THIS order is not probed straight back',
    /lastFailAt: nowIso\(\)/.test(src('services/supplier/supplierFailoverService.js')));
}

console.log('\n— 4. Timeouts on every outside call of the order path —');
{
  ok('Discord bot API: 5 s', /signal: AbortSignal\.timeout\(DISCORD_TIMEOUT_MS\)/.test(src('services/discordRolesService.js')));
  const st = src('services/stripeService.js');
  ok('Stripe client: 8 s, one retry (was 80 s × 3)', /timeout: 8_000, maxNetworkRetries: 1/.test(st));
  ok('Radar lookup in the webhook: 3 s at most', /Radar lookup timed out/.test(st));
  ok('SMTP: connect, greeting and socket timeouts', /connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 8_000/.test(src('services/emailService.js')));
}

console.log('\n— 5. Discord off the payment path —');
{
  const o = src('services/orderService.js');
  ok('role sync is not awaited', /keepAlive\(syncMemberRoles\(/.test(o) && !/await syncMemberRoles\(/.test(o));
  ok('the delivery DM is not awaited', /keepAlive\(sendDeliveryDm\(/.test(o) && !/await sendDeliveryDm\(/.test(o));
}

console.log('\n— 6. Failed mails —');
{
  const { retryFailedEmails } = await import('../src/services/emailService.js');
  const to = `mail-${tag}@example.com`;
  const ins = (template, when, ctx = { order: { number: 'X' } }) => run(
    `INSERT INTO email_log (id, template_id, to_email, subject, status, error, context, created_at)
     VALUES (@id,@t,@to,'x','failed','ECONNRESET',@ctx,@at)`,
    { id: `eml_${tag}_${Math.random().toString(36).slice(2, 8)}`, t: template, to, ctx: JSON.stringify(ctx), at: when });
  // A newsletter-ish mail from earlier and a delivery mail from later: the code goes first.
  await ins('order_received', new Date(Date.now() - 60_000).toISOString());
  await ins('order_completed', nowIso());
  await retryFailedEmails({ limit: 1 });
  const tried = await all(`SELECT template_id FROM email_log WHERE to_email=@to AND status='retried'`, { to });
  ok('the mail with the code is retried first', tried.length === 1 && tried[0].template_id === 'order_completed', JSON.stringify(tried));
  // Three attempts in the last minutes: the next waits (1 h after the third).
  const to2 = `wait-${tag}@example.com`;
  for (let i = 0; i < 3; i++) {
    await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, error, context, created_at)
       VALUES (@id,'order_completed',@to,'x',@st,'ECONNRESET','{"order":{"number":"Y"}}',@at)`,
      { id: `eml_w_${tag}_${i}`, to: to2, st: i < 2 ? 'retried' : 'failed', at: new Date(Date.now() - (3 - i) * 60_000).toISOString() });
  }
  await retryFailedEmails({});
  const still = await get(`SELECT status FROM email_log WHERE id=@id`, { id: `eml_w_${tag}_2` });
  ok('a third failure a minute ago is not hammered again', still?.status === 'failed', still?.status);
  ok('a deadline bounds the run', /if \(Date\.now\(\) >= deadline\) break;/.test(src('services/emailService.js')));
}

console.log('\n— 7. Refund: money back or store credit —');
{
  const { refundOrder } = await import('../src/services/refundService.js');
  const { requestRefund } = await import('../src/services/supportService.js');
  const uid = `usr_lr_${tag}`;
  await run(`INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES (@id,@e,'LR',@at,@at)`,
    { id: uid, e: `${uid}@example.com`, at });
  const prod = await createProduct({ name: `LR Refund ${tag}`, category: 'giftcard', price: 2500, announce: false, deliveryMode: 'manual' });

  // An account order that used €5 of store credit, paid the rest.
  await addEntry({ userId: uid, amount: 500, type: 'grant', description: 'test' });
  const o = await createOrder({ consent: true, consentText: 'test', email: `${uid}@example.com`, userId: uid, useCredit: 500,
    items: [{ productId: prod.id, quantity: 1 }] }, { actorId: uid });
  await transitionOrder(o.id, 'payment_received', { actorId: 'test' });
  const paidOrder = await getOrder(o.id);
  ok('the order paid €20 and used €5 of credit', paidOrder.total === 2000 && (await balanceOf(uid)) === 0,
    `${paidOrder.total} / ${await balanceOf(uid)}`);

  const req = await requestRefund({ orderId: o.id, userId: uid, reason: 'changed my mind', method: 'credit' });
  ok('the request remembers the choice', req.method === 'credit');
  ok('…and asks for everything the order took (€25)', Number(req.amount) === 2500, `${req.amount}`);

  const out = await refundOrder(o.id, { method: 'credit', actorId: 'test', reason: 'test' });
  ok('the order is refunded', out.order.status === 'refunded');
  ok('€25 is in the wallet — paid part and credit part, once', (await balanceOf(uid)) === 2500, `${await balanceOf(uid)}`);
  const entries = await all(`SELECT amount FROM credit_transactions WHERE order_id=@o AND type='refund'`, { o: o.id });
  ok('one refund entry, not two', entries.length === 1, JSON.stringify(entries));
  const again = await refundOrder(o.id, { method: 'credit', actorId: 'test' });
  ok('refunding twice credits nothing more', again.already === true && (await balanceOf(uid)) === 2500);

  // A guest order cannot take credit — refused, not silently turned into money.
  const g = await createOrder({ consent: true, consentText: 'test', email: `guest-${tag}@example.com`,
    items: [{ productId: prod.id, quantity: 1 }] }, { actorId: 'test' });
  await transitionOrder(g.id, 'payment_received', { actorId: 'test' });
  let refused = null;
  try { await requestRefund({ orderId: g.id, reason: 'x', method: 'credit' }); } catch (e) { refused = e; }
  ok('a guest asking for store credit is told it needs an account', refused && /account/i.test(refused.message), refused?.message);
  let refused2 = null;
  try { await refundOrder(g.id, { method: 'credit', actorId: 'test' }); } catch (e) { refused2 = e; }
  ok('…and the owner cannot credit a guest either', !!refused2);
  const money = await refundOrder(g.id, { method: 'money', actorId: 'test' });
  ok('money back on a hand-paid guest order: refunded, sent back by hand', money.order.status === 'refunded' && money.refund.provider === 'manual');

  // The mail says what happened.
  const { renderOrderEmail } = await import('../src/services/orderService.js');
  const mail = await renderOrderEmail(o.id, 'refund_issued', { refundAs: 'credit' });
  ok('the refund mail says it went to the account, in full', /tegoed in je account/.test(mail.html) && /volledige bedrag/.test(mail.html) && /25,00/.test(mail.html),
    mail.html.slice(0, 200));

  // Approval follows the buyer's choice, through the same path.
  const sup = src('routes/admin/support.js');
  ok('approving a request refunds through refundOrder (not just a status flip)', /refundOrder\(request\.order_id, \{ method: how/.test(sup) && !/transitionOrder\(decision\.order_id, 'refunded'/.test(sup));
}

console.log('\n— 8. A guest sees their codes on the track page —');
{
  const { createApp } = await import('../src/app.js');
  const { deliverOrder } = await import('../src/services/orderService.js');
  const prod = await createProduct({ name: `LR Codes ${tag}`, category: 'giftcard', price: 1500, announce: false, deliveryMode: 'manual' });
  const email = `codes-${tag}@example.com`;
  const o = await createOrder({ consent: true, consentText: 'test', email, items: [{ productId: prod.id, quantity: 1 }] }, { actorId: 'test' });
  const srv = createApp().listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const ask = (number, e) => fetch(`${base}/api/track/${number}/codes`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` },
    body: JSON.stringify({ email: e }) });
  await transitionOrder(o.id, 'payment_received', { actorId: 'test' });
  const early = await (await ask(o.number, email)).json();
  ok('before delivery: no codes, and no error', Array.isArray(early.codes) && early.codes.length === 0, JSON.stringify(early));
  const full = await getOrder(o.id);
  await deliverOrder(o.id, [{ orderItemId: full.items[0].id, type: 'code', content: `GIFT-${tag}` }], { actorId: 'test' });
  const r = await ask(o.number, email.toUpperCase());
  const body = await r.json();
  ok('with the right email: the code, with the product name', r.ok && body.codes?.[0]?.content === `GIFT-${tag}` && /LR Codes/.test(body.codes[0].item || ''), JSON.stringify(body));
  const wrong = await ask(o.number, 'someone-else@example.com');
  ok('with another email: the same "not found" as a wrong number', wrong.status === 404);
  const nope = await ask('FM-NOPE-0000', email);
  ok('…and a wrong number gives exactly that answer', nope.status === 404);
  ok('never cached anywhere', r.headers.get('cache-control') === 'no-store');
  const seen = await get(`SELECT 1 FROM audit_logs WHERE action='delivery.view_guest' AND target_id=@id`, { id: o.id });
  ok('every view is in the audit log', !!seen);
  srv.close();
}

console.log('\n— 9. The rest of the list —');
{
  const { readFileSync, existsSync } = await import('node:fs');
  const wf = new URL('../../.github/workflows/maintenance.yml', import.meta.url);
  const yml = existsSync(wf) ? readFileSync(wf, 'utf8') : '';
  ok('maintenance runs every hour (GitHub Actions — the Vercel plan allows only daily)', /cron: '17 \* \* \* \*'/.test(yml) && /api\/cron\/maintenance/.test(yml));
  ok('…and skips quietly when the secret is not set', /CRON_SECRET is not set/.test(yml));
  const { config } = await import('../src/config/env.js');
  ok('a shared mobile IP is allowed 40 orders a day (was 15)', process.env.LIMIT_ORDERS_PER_IP_DAY != null || config.security.orderLimits.perIpPerDay === 40,
    `${config.security.orderLimits.perIpPerDay}`);
  const co = readFileSync(new URL('../../src/pages/Checkout.jsx', import.meta.url), 'utf8');
  ok('card payment down → the pay screen for the other methods, not a dead end', /checkout\.cardDown/.test(co) && /setPlaced\(order\)/.test(co));
  const ss = src('services/stripeSettlement.js');
  ok('a Stripe payment whose webhook never came is found by maintenance', /export async function reconcileStripeSessions/.test(ss)
    && /reconcileStripeSessions/.test(src('services/maintenanceService.js')));
  ok('…through the webhook\'s own checks (amount, currency, risk)', /export async function markPaid/.test(ss) && /from '..\/services\/stripeSettlement.js'/.test(src('routes/payments.js')));
  ok('one alert per failing endpoint, not per order id', /req\.route\?\.path/.test(src('middleware/error.js')));
}

console.log(`\n${fail ? '❌' : '✅'} launch-resilience: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
