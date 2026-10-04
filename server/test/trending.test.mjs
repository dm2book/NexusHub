/**
 * The trending engine: Hot, Trending, Popular and New — from sales in the last
 * 24 hours and 7 days, revenue, conversion and age. Nothing picked by hand.
 *
 *   only real paid orders count: not unpaid, refunded, cancelled, free or
 *   test orders, and nothing older than seven days;
 *   hot is a spike, trending is rising, popular is volume, new is age — each
 *   with its own ranking, and a product carries its strongest label;
 *   conversion appears once there are enough views, and views are an
 *   anonymous daily total;
 *   a "featured" flag gets nothing — the only way onto a list is the numbers;
 *   the lists move by themselves when a sale lands.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const T = await import('../src/services/trendingService.js');
const HOUR = 3_600_000, DAY = 24 * HOUR, NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
let seq = 0;
const sale = (pid, msAgo, { qty = 1, price = 1000, status = 'completed', total = null, test = false, order = null } = {}) => ({
  product_id: pid, order_id: order || `o${++seq}`, quantity: qty, unit_price: price, status,
  total: total ?? qty * price, billing: '{}', psp_provider: null, created_at: iso(msAgo), test_event: test,
});
const prod = (id, ageDays = 60) => ({ id, created_at: iso(ageDays * DAY) });

console.log('\n— Signals —');
{
  const s = T.signalsFrom({ now: NOW, products: [prod('a')], items: [
    sale('a', 2 * HOUR, { qty: 2 }), sale('a', 3 * DAY), sale('a', 6 * DAY, { price: 2500 }),
    sale('a', 8 * DAY),                                   // older than 7 days
    sale('a', HOUR, { status: 'pending' }),               // never paid
    sale('a', HOUR, { status: 'refunded' }), sale('a', HOUR, { status: 'cancelled' }),
    sale('a', HOUR, { total: 0 }),                        // a 100% coupon or a giveaway
    sale('a', HOUR, { test: true }),                      // paid on a test key
  ] }).get('a');
  ok('sales in the last 24 hours: 2 units', s.sales24h === 2, JSON.stringify(s));
  ok('sales in the last 7 days: 4 units, nothing older', s.sales7d === 4);
  ok('revenue over 7 days, in cents', s.revenue7d === 2 * 1000 + 1000 + 2500);
  ok('unpaid, refunded, cancelled, free and test orders count for nothing', s.orders7d === 3);
  const two = T.signalsFrom({ now: NOW, products: [prod('a')], items: [sale('a', HOUR, { order: 'x' }), sale('a', HOUR, { order: 'x' })] }).get('a');
  ok('two lines of one order: 2 units, 1 order', two.sales7d === 2 && two.orders7d === 1);
  const few = T.signalsFrom({ now: NOW, products: [prod('a')], items: [sale('a', DAY * 2)], views: [{ product_id: 'a', views: 19 }] }).get('a');
  ok('conversion waits for enough views', few.conversion === null && few.views7d === 19);
  const conv = T.signalsFrom({ now: NOW, products: [prod('a')], items: [sale('a', DAY * 2), sale('a', DAY * 3)], views: [{ product_id: 'a', views: 40 }] }).get('a');
  ok('…then reads orders ÷ views (2 of 40 = 5%)', conv.conversion === 5);
}

console.log('\n— Labels —');
{
  const c = (x) => T.classify({ sales24h: 0, sales7d: 0, revenue7d: 0, conversion: null, ageDays: 60, ...x });
  ok('nothing sold, not new: no label at all', c({}).label === null);
  ok('added this week, nothing sold yet: new', c({ ageDays: 3 }).label === 'new');
  ok('4 today after a quiet week: hot', c({ sales24h: 4, sales7d: 5 }).label === 'hot');
  ok('1 today, steady: trending, not hot', c({ sales24h: 1, sales7d: 3 }).label === 'trending');
  ok('2 today against 3 a day the week before: slowing — popular, not trending', c({ sales24h: 2, sales7d: 20 }).label === 'popular');
  ok('3 today against 2 a day before: rising but under a 2× spike — trending', c({ sales24h: 3, sales7d: 15 }).label === 'trending');
  ok('9 this week, none today: popular', c({ sales24h: 0, sales7d: 9 }).label === 'popular');
  ok('the strongest label wins: hot beats new', c({ sales24h: 3, sales7d: 3, ageDays: 1 }).label === 'hot');
  ok('2 sold this week, none today: below popular, no label', c({ sales7d: 2 }).label === null);
}

console.log('\n— Ranking —');
{
  const products = ['steady', 'spike', 'bulk', 'fresh', 'old', 'featured'].map((id) => prod(id, id === 'fresh' ? 2 : 60));
  products.find((p) => p.id === 'featured').featured = true; // set by hand: must earn nothing
  const items = [
    ...[1, 2, 3, 4, 5, 6].map((d) => sale('steady', d * DAY + HOUR)), sale('steady', HOUR),
    sale('spike', HOUR), sale('spike', 2 * HOUR), sale('spike', 3 * HOUR),
    ...[...Array(12)].map((_, i) => sale('bulk', 2 * DAY + i * HOUR, { price: 5000 })),
  ];
  const { lists, rows } = T.rank(T.signalsFrom({ now: NOW, products, items }));
  const label = Object.fromEntries(rows.map((r) => [r.id, r.label]));
  ok('the spike is hot', lists.hot[0] === 'spike' && label.spike === 'hot', JSON.stringify(lists));
  ok('trending is ranked by momentum: the spike, then the steady seller', lists.trending.join() === 'spike,steady');
  ok('popular is ranked by units: bulk first', lists.popular[0] === 'bulk' && label.bulk === 'popular');
  ok('new is the product added this week', lists.new.join() === 'fresh' && label.fresh === 'new');
  ok('an old product with no sales is on no list', !Object.values(lists).flat().includes('old') && label.old === null);
  ok('a hand-set featured flag earns nothing', !Object.values(lists).flat().includes('featured') && label.featured === null);
  const svc = (await import('node:fs')).readFileSync(new URL('../src/services/trendingService.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('the engine never reads a featured, pinned or manual field', !/featured|pinned|manual|override/i.test(svc));
}

console.log('\n— Database, HTTP and updating by itself —');
{
  const { createApp, ensureReady } = await import('../src/app.js');
  await ensureReady();
  const { run } = await import('../src/db/index.js');
  const { newId } = await import('../src/utils/ids.js');
  const { createProduct } = await import('../src/services/productService.js');
  /* Start from a quiet shop: everything older than the "new" window. */
  await run(`UPDATE products SET created_at = @at`, { at: iso(60 * DAY) });
  const mk = async (name, ageDays) => {
    const p = await createProduct({ name: `${name} ${Date.now().toString(36)}`, category: 'robux', price: 999, announce: false });
    await run(`UPDATE products SET created_at = @at WHERE id = @id`, { at: iso(ageDays * DAY), id: p.id });
    return p;
  };
  const hot = await mk('Hot Robux', 60), fresh = await mk('Fresh Robux', 1), quiet = await mk('Quiet Robux', 60);
  const featured = await mk('Featured Robux', 60);
  await run(`UPDATE products SET metadata = '{"featured":true}' WHERE id = @id`, { id: featured.id });
  const place = async (p, msAgo, { total = 999, status = 'completed' } = {}) => {
    const id = newId('ord');
    await run(`INSERT INTO orders (id, number, email, status, total, subtotal, payment_status, billing, created_at, updated_at)
      VALUES (@id, @n, 'b@example.test', @st, @t, @t, 'paid', '{}', @c, @c)`, { id, n: `TR-${id.slice(-10)}`, st: status, t: total, c: iso(msAgo) });
    await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price) VALUES (@i, @o, @p, 'x', 1, 999)`, { i: newId('oi'), o: id, p: p.id });
  };
  for (const h of [1, 2, 3]) await place(hot, h * HOUR); // eslint-disable-line no-await-in-loop
  await place(quiet, HOUR, { total: 0 });            // a giveaway
  await place(quiet, HOUR, { status: 'pending' });   // unpaid

  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  for (let i = 0; i < 25; i++) await fetch(`${base}/products/${hot.id}/view`, { method: 'POST' }); // eslint-disable-line no-await-in-loop
  T.clearTrendingCache();
  const rail = (await (await fetch(`${base}/products/trending`)).json()).products;
  const at = (p) => rail.findIndex((x) => x.id === p.id);
  ok('the storefront rail leads with the hot product, labelled hot', rail[0]?.id === hot.id && rail[0].trend === 'hot', JSON.stringify(rail.map((r) => [r.name, r.trend])));
  ok('…the product added yesterday is on it, labelled new', at(fresh) > 0 && rail[at(fresh)].trend === 'new');
  ok('…the giveaway and the unpaid order put nothing on it', at(quiet) === -1);
  ok('…the featured flag puts nothing on it', at(featured) === -1);
  ok('…every product on it carries a label', rail.every((p) => ['hot', 'trending', 'popular', 'new'].includes(p.trend)));
  ok('…and the same payload as the shop (stock flag, copy)', rail.every((p) => 'instant' in p));

  const snap = await T.trendingSnapshot({ fresh: true });
  const row = snap.rows.find((r) => r.id === hot.id);
  ok('views are counted as an anonymous daily total, and give a conversion', row.views7d === 25 && row.conversion === 12);
  ok('the view counter stores no visitor', (await (await import('../src/db/index.js')).all(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'product_view_counts'`)).map((c) => c.column_name).sort().join() === 'day,product_id,views');
  ok('a view of an unknown product is ignored', (await fetch(`${base}/products/nope/view`, { method: 'POST' })).status === 204);

  /* A sale lands on the quiet product. Once the minute is up, the lists move. */
  for (const h of [1, 2]) await place(quiet, h * HOUR / 2); // eslint-disable-line no-await-in-loop
  const cached = await T.trendingSnapshot();
  ok('within the minute the cached lists are served', !cached.rows.find((r) => r.id === quiet.id)?.label);
  const later = await T.trendingSnapshot({ now: Date.now() + T.CACHE_MS + 1000 });
  ok('…after it, the quiet product is hot by itself — nobody pressed anything', later.lists.hot.includes(quiet.id));

  const { finalizeLogin } = await import('../src/services/authService.js');
  const { get, nowIso } = await import('../src/db/index.js');
  const owner = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`, { id: owner, e: `o-${owner}@example.test`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at)`, { u: owner, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id: owner }), {});
  const adm = await (await fetch(`${base}/admin/products/trending`, { headers: { authorization: `Bearer ${accessToken}` } })).json();
  ok('the admin sees all four lists and every product’s numbers', T.LABELS.every((l) => Array.isArray(adm.lists?.[l])) && adm.rows.some((r) => r.id === hot.id && r.sales24h === 3 && r.revenue7d === 2997));
  ok('…not a visitor', (await fetch(`${base}/admin/products/trending`)).status === 401);
  srv.close();

  const fs = await import('node:fs');
  const card = fs.readFileSync(new URL('../../src/components/store/LightProductCard.jsx', import.meta.url), 'utf8');
  ok('the product card shows the earned label', /TREND\[product\.trend\]/.test(card));
  const hook = fs.readFileSync(new URL('../../src/lib/useTrending.js', import.meta.url), 'utf8');
  ok('the shop rail no longer falls back to a hand-picked showcase', !/featured/.test(hook.replace(/\/\*[\s\S]*?\*\//g, '')));
  for (const f of ['../../src/lib/i18n.jsx', '../../src/lib/i18n/de.js', '../../src/lib/i18n/fr.js']) {
    const d = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    ok(`${f.split('/').pop()} names all four labels`, ['trend.hot', 'trend.trending', 'trend.popular', 'trend.new'].every((k) => d.includes(`'${k}'`)));
  }
}

console.log(`\n${fail ? '❌' : '✅'} trending: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
