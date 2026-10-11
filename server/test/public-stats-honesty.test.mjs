/**
 * "Geen fake nieuws" for the figures the storefront shows (publicStatsService):
 *   delivered / customers   real paid sales only — not demo payments, not the
 *                           shop's own (staff) orders, not unpaid cancellations
 *   delivery time           the MEDIAN from the buyer paying to delivery, over
 *                           real sales, hidden below MIN_SAMPLE orders
 *   success rate            delivered ÷ settled PAID orders, hidden below MIN_SAMPLE
 *   Discord                 the live "online" count or nothing — never a typed-in number
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady } from '../src/app.js';
import { run, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const { publicStats } = await import('../src/services/publicStatsService.js');
const { MIN_SAMPLE } = await import('../src/services/socialProofService.js');
const stamp = Date.now().toString(36);
let n = 0;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

/* An order with its own history: paid at `paidAgo`, delivered `took` ms later. */
async function order({ status = 'completed', total = 999, email, paymentRef = null, paidAgo = 3_600_000, took = 600_000, paid = true }) {
  const id = newId('ord');
  await run(`INSERT INTO orders (id, number, email, status, currency, subtotal, total, billing, payment_ref, created_at, updated_at)
             VALUES (@id, @num, @e, @s, 'EUR', @t, @t, '{}', @ref, @c, @u)`,
    { id, num: `FM-HON-${stamp}-${++n}`, e: email || `buyer-${stamp}-${n}@example.test`, s: status, t: total,
      ref: paymentRef, c: iso(paidAgo + 60_000), u: nowIso() });
  const hist = (to, at) => run(`INSERT INTO order_status_history (id, order_id, from_status, to_status, created_at)
                                VALUES (@id, @o, NULL, @to, @at)`, { id: newId('osh'), o: id, to, at });
  if (paid) await hist('payment_received', iso(paidAgo));
  if (status === 'completed' && paid) await hist('completed', iso(paidAgo - took));
  return id;
}

console.log('— Nothing yet: nothing shown —');
{
  const s = await publicStats();
  ok('no sales: zero delivered, no delivery time, no success rate', s.delivered === 0 && s.medianDeliverySeconds === null && s.successRate === null,
    JSON.stringify({ d: s.delivered, m: s.medianDeliverySeconds, r: s.successRate }));
  ok('no typed-in Discord number stands in for the live one', s.discordOnline === null || s.discordOnline > 0);
}

console.log('— Only real sales count —');
{
  // The shop rehearsing: a demo self-payment, a staff order, an unpaid cancellation, a free order.
  await order({ paymentRef: 'demo_123' });
  const staff = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'S', @at, @at)`,
    { id: staff, e: `staff-${stamp}@example.test`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'admin', @at)`, { u: staff, at: nowIso() });
  await order({ email: `staff-${stamp}@example.test` });
  await order({ status: 'cancelled', paid: false });
  await order({ total: 0 });
  const s = await publicStats();
  ok('a demo payment, a staff order, an unpaid cancellation and a free order count for nothing', s.delivered === 0, String(s.delivered));
}

console.log('— A median, and only over enough orders —');
{
  const takes = [60_000, 120_000, 180_000, 240_000];          // 1, 2, 3, 4 minutes
  for (const t of takes) await order({ took: t });
  let s = await publicStats();
  ok(`below ${MIN_SAMPLE} timed orders no delivery time is shown`, s.medianDeliverySeconds === null && s.delivered === takes.length,
    JSON.stringify({ m: s.medianDeliverySeconds, d: s.delivered }));
  await order({ took: 86_400_000 * 3 });                       // one stuck for three days
  s = await publicStats();
  ok('at five it is the median: 3 minutes, not dragged up to hours by the one stuck order',
    s.medianDeliverySeconds === 180 && s.deliverySample === 5, JSON.stringify({ m: s.medianDeliverySeconds, n: s.deliverySample }));
  ok('…and the slow one still counts (nothing over a day is thrown away)', s.deliverySample === 5);
}

console.log('— Success rate over paid orders —');
{
  const s = await publicStats();
  ok('five delivered paid orders: 100%, said to be over 5', s.successRate === 100 && s.successSample === 5, JSON.stringify({ r: s.successRate, n: s.successSample }));
  // A paid order that was refunded counts against it; the unpaid cancellation above never did.
  await order({ status: 'refunded' });
  const t = await publicStats();
  ok('a paid-then-refunded order counts against it (5 of 6)', t.successRate === 83.3 && t.successSample === 6, JSON.stringify({ r: t.successRate, n: t.successSample }));
}

console.log(`\n${fail ? '❌' : '✅'} public-stats-honesty: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
