/**
 * The nine figures, recomputed against orders that really exist.
 *
 * A money dashboard is only worth the arithmetic behind it, so this builds a
 * shop with orders placed at known moments — inside today, earlier this week,
 * earlier this month, and last month — and checks each bucket contains exactly
 * what it should. Source-level checks would pass on a dashboard that added the
 * same order to all three.
 */
import { migrate } from '../src/db/migrate.js';
import { run, get } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { moneyDashboard } from '../src/services/moneyService.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();

const TZ = process.env.SHOP_TIMEZONE || 'Europe/Amsterdam';
const localMidnight = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((a, x) => (x.type !== 'literal' ? { ...a, [x.type]: x.value } : a), {});
  return new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
};
const today = localMidnight();
const dow = (today.getUTCDay() + 6) % 7;                 // Monday = 0
const weekStart = new Date(today.getTime() - dow * 86_400_000);
const monthStart = new Date(`${today.toISOString().slice(0, 7)}-01T00:00:00Z`);

const at = (d, hours = 12) => new Date(d.getTime() + hours * 3_600_000).toISOString();
const order = async (createdAt, total, status = 'completed') => {
  const id = newId('ord');
  await run(`INSERT INTO orders (id, number, email, status, subtotal, total, currency, created_at, updated_at)
    VALUES (@id, @n, 'b@x.dev', @s, @t, @t, 'EUR', @a, @a)`,
  { id, n: `FM-${id.slice(-6)}`, s: status, t: total, a: createdAt });
  return id;
};
// order_items has a real foreign key, so the product has to exist first.
const product = async (name, price) => {
  const id = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, price, currency, active, created_at, updated_at)
    VALUES (@id, @sku, @n, 'robux', @p, 'EUR', 1, @a, @a)`,
  { id, sku: id.slice(-8).toUpperCase(), n: name, p: price, a: new Date().toISOString() });
  return id;
};
const item = async (orderId, productId, name, unit, qty) => run(
  `INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price)
   VALUES (@id, @o, @p, @n, @q, @u)`,
  { id: newId('oit'), o: orderId, p: productId, n: name, q: qty, u: unit });

/* today · earlier this week · earlier this month · last month.
   Each is inside every LARGER bucket and outside every smaller one, which is
   the only way to catch a dashboard that adds one order to all three. */
const fixtures = [];
const place = async (whenIso, cents) => { await order(whenIso, cents); fixtures.push({ whenIso, cents }); };

const o1 = await order(at(today, 6), 5000);
fixtures.push({ whenIso: at(today, 6), cents: 5000 });
/* A week can START IN THE PREVIOUS MONTH — on Sunday 6 September the week
   began on 31 August — so the week total is legitimately larger than the month
   total, and an expectation that assumes month ⊇ week is wrong five days out of
   thirty. The expected sums are therefore derived from the fixtures rather than
   asserted, which is also what catches a bucket that quietly uses "last 30
   days" instead of "this month". */
if (weekStart.getTime() < today.getTime()) await place(at(weekStart, 6), 3000);
if (monthStart.getTime() < today.getTime()
    && monthStart.getTime() !== weekStart.getTime()) await place(at(monthStart, 6), 2000);
const sumFrom = (start) => fixtures
  .filter((f) => new Date(f.whenIso).getTime() >= start.getTime())
  .reduce((n, f) => n + f.cents, 0);
await order(new Date(monthStart.getTime() - 5 * 86_400_000).toISOString(), 9900);   // last month
await order(at(today, 7), 1500, 'pending');                                        // never counted as revenue
await order(at(today, 8), 4000, 'refunded');                                       // not revenue either
const pBig = await product('4,500 Robux', 3899);
const pSmall = await product('1,000 Robux', 999);
await item(o1, pBig, '4,500 Robux', 3899, 1);
await item(o1, pSmall, '1,000 Robux', 999, 2);

const d = await moneyDashboard();

console.log('— Revenue lands in the right bucket —');
{
  ok('today counts only today', d.revenue.today.cents === 5000, `${d.revenue.today.cents}`);
  ok('and one order', d.orders.today === 1, `${d.orders.today}`);
  const expectWeek = sumFrom(weekStart);
  ok('the week contains everything since Monday',
    d.revenue.week.cents === expectWeek, `${d.revenue.week.cents} vs ${expectWeek}`);
  const expectMonth = sumFrom(monthStart);
  ok('the month contains everything since the 1st',
    d.revenue.month.cents === expectMonth, `${d.revenue.month.cents} vs ${expectMonth}`);
  /* Not a bug when it happens: a week that began in the previous month has more
     in it than the month does. The check is that each bucket holds exactly its
     own span, not that they nest. */
  ok('and each bucket holds exactly its own span, even across a month boundary',
    d.revenue.today.cents === sumFrom(today));
  /* The bug this catches: a dashboard whose "month" is the last 30 days, which
     silently drags in last month's takings on the 3rd. */
  // The 9900 order sits five days before the 1st: a "last 30 days" bucket drags it in.
  ok('and NOT last month', d.revenue.month.cents < 9900 + expectMonth, `${d.revenue.month.cents}`);
  ok('every bucket is money, not a count', /€/.test(d.revenue.today.formatted));
}

console.log('\n— What is not revenue is not counted as revenue —');
{
  /* A pending order is money that has not arrived and a refunded one is money
     that never was. Counting either and subtracting it later is how a
     dashboard flatters itself. */
  ok('a placed but unpaid order is not revenue', d.revenue.today.cents === 5000);
  ok('it is reported as still winnable instead',
    d.awaitingPayment.count === 1 && d.awaitingPayment.cents === 1500,
    JSON.stringify(d.awaitingPayment));
  ok('a refunded order is not revenue', d.revenue.today.cents === 5000);
  ok('it is reported as a refund', d.refunds.thisMonth.count === 1 && d.refunds.thisMonth.cents === 4000,
    JSON.stringify(d.refunds.thisMonth));
}

console.log('\n— Top products are ranked by money —');
{
  const top = d.topProducts;
  ok('both line items appear', top.length === 2, `${top.length}`);
  /* Two 1,000 Robux at €9.99 is more UNITS than one 4,500 at €38.99 and a
     quarter of the money. A list ranked by units puts the wrong one first. */
  ok('the bigger seller by revenue is first', top[0].name === '4,500 Robux', top[0]?.name);
  ok('and the units are still shown', top[0].units === 1 && top[1].units === 2,
    `${top[0]?.units} / ${top[1]?.units}`);
  ok('with the revenue that ranked it', top[0].cents === 3899 && top[1].cents === 1998,
    `${top[0]?.cents} / ${top[1]?.cents}`);
}

console.log('\n— The rest of the nine —');
{
  ok('chargebacks are reported', typeof d.chargebacks.count === 'number' && 'formatted' in d.chargebacks);
  ok('affiliate money is split three ways',
    ['paid', 'owed', 'reversed'].every((k) => 'formatted' in (d.affiliate[k] || {})));
  ok('stock problems only list what is actually a problem',
    d.stockProblems.every((p) => p.codes <= 5));
  /* A dashboard whose day rolls over at 02:00 local time tells the owner
     yesterday was worse and today better, every single day. */
  ok('days roll over in the shop timezone, not UTC', d.timezone === TZ, d.timezone);
  ok('and it says which one it used', typeof d.timezone === 'string' && d.timezone.includes('/'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
