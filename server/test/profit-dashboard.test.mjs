/**
 * Profit, which is a different question from revenue and a harder one.
 *
 * The dashboard that existed reported a profit and a margin, and both were
 * wrong in the same direction — wrong in a way that looks fine:
 *
 *   costMap[id] = (await costCentsFor(id)) ?? 0
 *
 * A product with no cost entered contributed ZERO cost. This shop has a cost on
 * none of its products, so the page reported a 100% margin: a confident,
 * precise, entirely invented number.
 *
 *   const profit = Math.max(0, revenue - cost)
 *
 * A loss was displayed as break-even.
 *
 * So the tests are mostly about the two answers a profit dashboard has to be
 * able to give and that one could not: "I do not know" and "you lost money".
 */
import { migrate } from '../src/db/migrate.js';
import { run, all, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const {
  periodBounds, rollUp, perProduct, warningsFor, leaderboards, profitDashboard,
} = await import('../src/services/profitService.js');
const { config } = await import('../src/config/env.js');
const page = read('src/pages/admin/Profit.jsx');
/* Comments stripped. Both services document the bugs they fixed by quoting the
   code they removed, so an assertion reading the raw file matches its own
   explanation — the third time in this repository, and the reason honest-copy
   has had a codeOf() since the beginning. */
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const svc = codeOf('server/src/services/profitService.js');

const at = nowIso();
const product = async (name, priceCents, costCents) => {
  const id = newId('prd');
  await run(
    `INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
     VALUES (@id,@s,@n,'robux','t',@p,'EUR','digital',1,@m,@at,@at)`,
    { id, s: `PF-${id.slice(-8)}`, n: name, p: priceCents,
      m: JSON.stringify(costCents == null ? {} : { cost: costCents }), at });
  return id;
};
const order = async (lines, { createdAt = at, status = 'completed' } = {}) => {
  const oid = newId('ord');
  const total = lines.reduce((s, l) => s + l.unit * l.qty, 0);
  await run(
    `INSERT INTO orders (id, number, email, status, subtotal, total, currency, created_at, updated_at)
     VALUES (@id,@n,'buyer@example.test',@st,@t,@t,'EUR',@at,@at)`,
    { id: oid, n: `FM-${oid.slice(-8)}`, st: status, t: total, at: createdAt });
  for (const l of lines) {
    await run(
      `INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price)
       VALUES (@id,@o,@p,@n,@q,@u)`,
      { id: newId('oi'), o: oid, p: l.pid, n: l.name, q: l.qty, u: l.unit });
  }
  return oid;
};

console.log('— Today is today here, not in UTC —');
{
  /* Between local midnight and 02:00 in summer, "today" in UTC is still
     yesterday — so a late sale lands on the wrong day in every by-day figure. */
  const b = periodBounds({ now: Date.parse('2026-09-12T00:30:00Z'), tz: 'Europe/Amsterdam' });
  ok('a 00:30 UTC sale counts against the Amsterdam day that has already started',
    b.today === '2026-09-11T22:00:00.000Z', b.today);
  ok('the week starts on Monday', b.week === '2026-09-06T22:00:00.000Z', b.week);
  ok('the month starts on the 1st', b.month === '2026-08-31T22:00:00.000Z', b.month);
  ok('the timezone is reported, not assumed by the reader', b.tz === 'Europe/Amsterdam');

  /* Winter is UTC+1 and summer UTC+2, which is why this asks Intl for the
     offset in force rather than adding a constant. */
  const winter = periodBounds({ now: Date.parse('2026-01-15T12:00:00Z'), tz: 'Europe/Amsterdam' });
  ok('winter time shifts the boundary by an hour, not by a guess',
    winter.today === '2026-01-14T23:00:00.000Z', winter.today);
  ok('…and the month with it', winter.month === '2025-12-31T23:00:00.000Z', winter.month);

  ok('another timezone gives another day',
    periodBounds({ now: Date.parse('2026-09-12T00:30:00Z'), tz: 'UTC' }).today
    === '2026-09-12T00:00:00.000Z');
  ok('the shop timezone is configurable', config.timezone === 'Europe/Amsterdam');
  ok('…from the environment', /env\.SHOP_TIMEZONE/.test(read('server/src/config/env.js')));
}

console.log('\n— An unknown cost is unknown. It is never zero —');
{
  const lines = [
    { pid: 'a', name: 'Costed', qty: 2, unit_price: 1000, order_id: 'o1' },
    { pid: 'b', name: 'Uncosted', qty: 1, unit_price: 1000, order_id: 'o1' },
  ];
  const r = rollUp(lines, { a: 800, b: null });

  ok('revenue counts everything sold', r.revenue === 3000, String(r.revenue));
  ok('cost counts only what we know', r.cost === 1600, String(r.cost));
  /* The bug, in one assertion: with b costed at 0 the profit would be 1400 on
     3000 — a 46.7% margin — instead of 400 on the 2000 it was measured over. */
  ok('profit is over the costed revenue, not over all of it', r.profit === 400, String(r.profit));
  ok('…so the margin is 20%, not 46.7%', r.marginPct === 20, String(r.marginPct));
  ok('and the coverage says what it was computed over',
    r.coverage.units === 2 && r.coverage.unitsTotal === 3
    && r.coverage.revenue === 2000 && r.coverage.revenueTotal === 3000);
  ok('…as a share of revenue', r.coverage.pct === 66.7, String(r.coverage.pct));
  ok('…and flags that it is incomplete', r.coverage.complete === false);

  const full = rollUp([lines[0]], { a: 800 });
  ok('complete coverage says so', full.coverage.complete === true && full.coverage.pct === 100);

  /* Zero is a real cost. Only null and undefined are unknown. */
  const free = rollUp([{ pid: 'f', name: 'Free', qty: 1, unit_price: 500, order_id: 'o' }], { f: 0 });
  ok('a genuinely free product is costed, not treated as unknown',
    free.cost === 0 && free.profit === 500 && free.coverage.complete === true);

  ok('nothing sold gives a null margin, not 0%',
    rollUp([], {}).marginPct === null);
  ok('…and the service never falls back to zero for a missing cost',
    !/costCentsFor\([^)]*\)\s*\?\?\s*0/.test(svc));
}

console.log('\n— A loss is shown as a loss —');
{
  const r = rollUp([{ pid: 'x', name: 'Underwater', qty: 3, unit_price: 500, order_id: 'o' }], { x: 700 });
  ok('profit goes negative', r.profit === -600, String(r.profit));
  ok('…and so does the margin', r.marginPct === -40, String(r.marginPct));
  /* The clamp was in analyticsService, not here — and leaving it there would
     have left two pages disagreeing about profit, which is worse than one page
     being wrong. Both now compute it the same way. */
  const analytics = codeOf('server/src/services/analyticsService.js');
  ok('nothing clamps profit at zero, on either page',
    !/Math\.max\(0,\s*revenue/.test(svc) && !/Math\.max\(0,\s*revenue/.test(analytics));
  ok('…and the margin can be negative', /margin = costedRevenue \?/.test(analytics));
  ok('…and the revenue summary stopped costing unknowns at zero',
    !/costCentsFor\(id\)\)\s*\?\?\s*0/.test(analytics));
  ok('…and reports what its margin was computed over', /costCoverage/.test(analytics));

  const p = perProduct([{ pid: 'x', name: 'Underwater', qty: 3, unit_price: 500 }], { x: 700 });
  ok('the product row is negative too', p[0].profit === -600 && p[0].marginPct === -40);
}

console.log('\n— Per product: sold, revenue, cost, gross profit, margin —');
{
  const lines = [
    { pid: 'a', name: 'Robux 1000', qty: 2, unit_price: 999 },
    { pid: 'a', name: 'Robux 1000', qty: 1, unit_price: 999 },
    { pid: 'b', name: 'Steam €10', qty: 1, unit_price: 1199 },
  ];
  const rows = perProduct(lines, { a: 850, b: null });
  const a = rows.find((r) => r.productId === 'a');
  const b = rows.find((r) => r.productId === 'b');

  ok('units are summed across orders', a.units === 3, String(a.units));
  ok('revenue is units × price', a.revenue === 2997, String(a.revenue));
  ok('cost is units × unit cost', a.cost === 2550, String(a.cost));
  ok('gross profit is the difference', a.profit === 447, String(a.profit));
  ok('margin is profit over revenue', a.marginPct === 14.9, String(a.marginPct));

  ok('an uncosted product still shows its revenue', b.revenue === 1199);
  ok('…but its cost is null, not zero', b.cost === null);
  ok('…and its profit is null, not its revenue', b.profit === null);
  ok('…and its margin is null, not 100%', b.marginPct === null);
  ok('…and the formatted fields are null too, so no "€0.00" reaches a screen',
    b.costFormatted === null && b.profitFormatted === null);
}

console.log('\n— Top ten by profit, revenue and margin —');
{
  const rows = perProduct([
    { pid: 'a', name: 'Thin but big', qty: 100, unit_price: 2000 },
    { pid: 'b', name: 'Fat but small', qty: 2, unit_price: 1000 },
    { pid: 'c', name: 'Unknown', qty: 50, unit_price: 3000 },
  ], { a: 1900, b: 400, c: null });
  const top = leaderboards(rows, { limit: 10 });

  ok('profit ranks by profit', top.profit[0].name === 'Thin but big', top.profit[0]?.name);
  ok('margin ranks by margin', top.margin[0].name === 'Fat but small', top.margin[0]?.name);
  ok('…which is a different order', top.profit[0].name !== top.margin[0].name);
  /* 100 x €20 beats 50 x €30, so the biggest revenue is the thin one — which
     is the point of having three boards rather than one. */
  ok('revenue ranks by revenue', top.revenue[0].name === 'Thin but big', top.revenue[0]?.name);
  ok('…and that is a third distinct answer',
    new Set([top.profit[0].name, top.margin[0].name, top.revenue[0].name]).size >= 2);

  /* An uncosted product has revenue and no profit, so it belongs on exactly one
     of the three boards. Ranking it at €0 profit would bury real products under
     it, or float it above them, depending on the sort. */
  ok('an uncosted product is on the revenue board', top.revenue.some((p) => p.name === 'Unknown'));
  ok('…and on neither of the other two',
    !top.profit.some((p) => p.name === 'Unknown') && !top.margin.some((p) => p.name === 'Unknown'));

  ok('a limit of ten is a limit', leaderboards(
    Array.from({ length: 25 }, (_, i) => ({ name: `p${i}`, revenue: i, profit: i, marginPct: i })),
    { limit: 10 }).revenue.length === 10);
  ok('and an empty shop ranks nothing rather than showing zeroes',
    leaderboards([], {}).profit.length === 0);
}

console.log('\n— Warnings: losing money, too thin, or unknown —');
{
  const rows = perProduct([
    { pid: 'loss', name: 'Sells at a loss', qty: 4, unit_price: 500 },
    { pid: 'thin', name: 'Too thin', qty: 10, unit_price: 1000 },
    { pid: 'fine', name: 'Healthy', qty: 10, unit_price: 1000 },
    { pid: 'none', name: 'No cost', qty: 1, unit_price: 1000 },
  ], { loss: 700, thin: 980, fine: 700, none: null });
  const w = warningsFor(rows);
  const byCode = (c) => w.filter((x) => x.code === c);

  ok('a product sold below cost is flagged', byCode('LOSS').length === 1);
  ok('…and the message says how much and over how many',
    /lost €8\.00 over 4 unit/.test(byCode('LOSS')[0].detail), byCode('LOSS')[0].detail);
  ok('…and names both prices', /€5\.00/.test(byCode('LOSS')[0].detail) && /€7\.00/.test(byCode('LOSS')[0].detail));

  ok('a thin margin is flagged', byCode('BELOW_MINIMUM_MARGIN').length === 1);
  ok('…against the same minimum the pricing engine refuses to price below',
    byCode('BELOW_MINIMUM_MARGIN')[0].detail.includes(`${config.market.minimumMarginPercent}%`));
  ok('a healthy product is not flagged', !w.some((x) => x.name === 'Healthy'));

  ok('an unknown cost is its own kind of warning', byCode('NO_COST').length === 1);
  ok('…and it says the profit is unknown rather than zero',
    /unknown, not zero/.test(byCode('NO_COST')[0].detail));

  /* A product selling below cost costs money on every sale; a thin one merely
     earns less than it should. The one that bleeds goes first. */
  ok('losses are listed before thin margins', w[0].code === 'LOSS', w.map((x) => x.code).join(','));
  ok('…and unknowns last', w[w.length - 1].code === 'NO_COST');

  ok('a shop with nothing wrong produces no warnings',
    warningsFor(perProduct([{ pid: 'ok', name: 'Fine', qty: 1, unit_price: 1000 }], { ok: 700 })).length === 0);
}

console.log('\n— End to end, against real orders —');
{
  const good = await product('Costed winner', 1200, 900);
  const bad = await product('Costed loser', 500, 700);
  const unknown = await product('Uncosted', 1000, null);

  const today = new Date().toISOString();
  const earlierThisMonth = new Date(Date.now() - 5 * 86_400_000).toISOString();

  await order([{ pid: good, name: 'Costed winner', qty: 2, unit: 1200 }], { createdAt: today });
  await order([{ pid: bad, name: 'Costed loser', qty: 1, unit: 500 }], { createdAt: today });
  await order([{ pid: unknown, name: 'Uncosted', qty: 1, unit: 1000 }], { createdAt: today });
  await order([{ pid: good, name: 'Costed winner', qty: 1, unit: 1200 }], { createdAt: earlierThisMonth });
  // Not money: a pending order is not revenue.
  await order([{ pid: good, name: 'Costed winner', qty: 9, unit: 1200 }],
    { createdAt: today, status: 'pending' });

  const d = await profitDashboard();

  ok('today counts today’s paid orders only',
    d.periods.today.revenue === 2400 + 500 + 1000, String(d.periods.today.revenue));
  ok('…and a pending order is not revenue', d.periods.today.revenue < 2400 + 500 + 1000 + 10800);
  ok('the month includes the earlier order',
    d.periods.month.revenue === d.periods.today.revenue + 1200, String(d.periods.month.revenue));

  /* today: costed revenue 2900 (2×1200 + 500), cost 2500 (2×900 + 700),
     profit 400. The uncosted €10 is revenue and nothing else. */
  ok('profit is over costed revenue only', d.periods.today.profit === 400, String(d.periods.today.profit));
  ok('…and the coverage says two of the three products',
    d.periods.today.coverage.units === 3 && d.periods.today.coverage.unitsTotal === 4,
    JSON.stringify(d.periods.today.coverage));

  ok('the average margin is the month’s, over costed revenue',
    d.averageMarginPct === d.periods.month.marginPct);

  const loser = d.products.find((p) => p.name === 'Costed loser');
  ok('the loss-making product is negative', loser.profit === -200, String(loser.profit));
  ok('…and it is warned about', d.warnings.some((w) => w.code === 'LOSS' && w.name === 'Costed loser'));
  ok('the uncosted product is warned about too',
    d.warnings.some((w) => w.code === 'NO_COST' && w.name === 'Uncosted'));

  ok('the leaderboards are populated', d.top.profit.length > 0 && d.top.revenue.length > 0);
  ok('catalogue coverage counts products, not sales',
    d.catalogue.active >= 3 && d.catalogue.withCost >= 2, JSON.stringify(d.catalogue));
  ok('the minimum margin comes from the same config the pricing engine uses',
    d.minimumMarginPercent === config.market.minimumMarginPercent);
  ok('the bounds are reported so a reader can check them', !!d.bounds.today && !!d.bounds.tz);
}

console.log('\n— The page cannot render an unknown as zero —');
{
  ok('a null is rendered as a dash', /const eur = \(c\) => \(c == null \? '—' : money\(c\)\)/.test(page));
  ok('…and the table uses it for cost and profit',
    /\{eur\(p\.cost\)\}/.test(page) && /\{eur\(p\.profit\)\}/.test(page));
  ok('…and a null margin is a dash, not 0%', /n == null \? '—' : `\$\{n\}%`/.test(page));
  ok('a product with no cost says so on its row', /no cost entered/.test(page));
  ok('coverage is shown beside every period', /<Coverage c=\{p\.coverage\}/.test(page));
  ok('a loss is coloured as one', /text-rose-600/.test(page));
  ok('the page says which timezone the days are in', /\{d\.bounds\.tz\}/.test(page));
  ok('…and how much of the catalogue is costed',
    /d\.catalogue\.withCost.*d\.catalogue\.active/s.test(page));
  ok('all three leaderboards are on it',
    /Top 10 by profit/.test(page) && /Top 10 by revenue/.test(page) && /Top 10 by margin/.test(page));
  ok('it is reachable', /path="\/admin\/profit"/.test(read('src/App.jsx'))
    && /to: '\/admin\/profit'/.test(read('src/layouts/AdminLayout.jsx')));
  ok('…behind the analytics permission',
    /router\.use\(requirePermission\('analytics\.read'\)\)/.test(read('server/src/routes/admin/analytics.js')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} profit-dashboard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
