/**
 * Real sales feed — "Steam Wallet €20 sold · 4 minutes ago · Netherlands · Gift cards".
 *
 * What a feed like this gets wrong is publishing something that did not happen,
 * so most checks here are about what must NOT appear:
 *
 *   an order that was never paid;
 *   an order that was delivered and then refunded — the snapshot is still there;
 *   a payment taken on a provider's TEST key — a rehearsal, not a sale;
 *   a giveaway or 100% coupon — something was delivered, nothing was sold;
 *   a row the owner hid;
 *   a country nobody told us — shown as none, never guessed;
 *   the buyer's name, city or email.
 *
 * And the filters only ever offer what actually sold.
 */
import './_selling-shop.mjs';   // must come first — see that file
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { config } = await import('../src/config/env.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, transitionOrder } = await import('../src/services/orderService.js');
const social = await import('../src/services/socialProofService.js');
const { bustSocialCaches } = await import('../src/routes/social.js');

const stamp = Date.now();
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const feed = async (qs = '') => {
  const r = await fetch(`${base}/api/social/sales${qs}`);
  return { status: r.status, headers: r.headers, body: await r.json() };
};

console.log('\n— Before anything sells, the feed is empty — not filled —');
{
  const { status, body } = await feed();
  ok('the page answers', status === 200);
  ok('…with no sales', body.sales.length === 0 && body.total === 0, JSON.stringify(body).slice(0, 200));
  ok('…and no filter options to pick from', body.filters.categories.length === 0 && body.filters.countries.length === 0);
}

const product = (name, category, price) => createProduct({ name, sku: `SF-${name.replace(/\W+/g, '')}-${stamp}`,
  category, price, currency: 'EUR', active: true, announce: false });
const steam = await product('Steam Wallet €20', 'giftcard', 2199);
const nitro = await product('Discord Nitro', 'discord-nitro', 999);
const robux = await product('1,700 Robux', 'robux', 1999);

let n = 0;
/** A real order through the real pipeline; `before` runs between paying and delivering. */
async function sale(p, { country = null, billing = {}, complete = true, before = null } = {}) {
  n += 1;
  const email = `sf-${n}-${stamp}@test.local`;
  const uid = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'B', @at, @at)`,
    { id: uid, e: email, at: nowIso() });
  const o = await createOrder({ consent: true, consentText: 'test', email, userId: uid,
    billing: { full_name: 'Jan de Vries', city: 'Utrecht', ...billing },
    items: [{ productId: p.id, quantity: 1 }] }, { actorId: uid, country });
  if (before) await before(o);
  if (complete) await transitionOrder(o.id, 'completed', { actorId: 'admin', force: true, reason: 'test' });
  return o;
}

const a = await sale(steam, { country: 'NL' });
const b = await sale(nitro, { country: 'BE' });
const unpaid = await sale(robux, { country: 'NL', complete: false });          // never paid
const refunded = await sale(robux, { country: 'DE' });
await transitionOrder(refunded.id, 'refunded', { actorId: 'admin', force: true, reason: 'test' });
const keyStripe = config.payments.stripe.secretKey;
await sale(robux, { country: 'FR', before: async (o) => {                       // paid on a test key
  config.payments.stripe.secretKey = 'sk_test_123';
  await run(`UPDATE orders SET psp_provider='stripe' WHERE id=@id`, { id: o.id });
} });
config.payments.stripe.secretKey = keyStripe;
await sale(robux, { country: 'ES', before: (o) =>                              // a giveaway
  run(`UPDATE orders SET total=0, billing='{}' WHERE id=@id`, { id: o.id }) });
const credit = await sale(robux, { country: 'NL', before: (o) =>               // paid with store credit
  run(`UPDATE orders SET total=0, billing=@b WHERE id=@id`, { id: o.id, b: JSON.stringify({ creditApplied: 1999 }) }) });
const hidden = await sale(nitro, { country: 'IT' });
const noCountry = await sale(steam, { country: null, billing: { country: 'Nederland' } });
const typed = await sale(nitro, { country: 'BE', billing: { country: 'de' } });
const old = await sale(steam, { country: 'NL' });

const evOf = (o) => get(`SELECT * FROM social_events WHERE order_id=@id`, { id: o.id });
await social.setEventStatus((await evOf(hidden)).id, 'hidden');
await run(`UPDATE social_events SET created_at=@at WHERE order_id=@id`,
  { id: old.id, at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
bustSocialCaches();

console.log('\n— Only real, paid, still-completed sales —');
const all = (await feed()).body;
const ids = new Map(await Promise.all([a, b, credit, noCountry, typed, old].map(async (o) => [(await evOf(o)).id, o])));
{
  ok('exactly the six real sales are listed', all.total === 6 && all.sales.length === 6
    && all.sales.every((s) => ids.has(s.id)), JSON.stringify(all.sales.map((s) => s.product)));
  ok('an order never paid is not a sale', !(await evOf(unpaid)));
  ok('a refunded order is not a sale', !all.sales.some((s) => s.country === 'DE' && s.product.includes('Robux')));
  ok('…even though its snapshot still exists', !!(await evOf(refunded)));
  ok('a payment on a test key is not a sale', !all.sales.some((s) => s.country === 'FR'));
  ok('…and is marked as a test where it is kept', (await get(
    `SELECT test FROM social_events s JOIN orders o ON o.id=s.order_id WHERE o.country='FR'`))?.test === 1);
  ok('a giveaway is not a sale', !all.sales.some((s) => s.country === 'ES'));
  ok('store credit is money: an order paid with it is a sale', all.sales.some((s) => ids.get(s.id) === credit));
  ok('a row the owner hid stays hidden', !all.sales.some((s) => s.country === 'IT'));
  ok('newest first', all.sales[0].secondsAgo <= all.sales[all.sales.length - 1].secondsAgo
    && ids.get(all.sales[all.sales.length - 1].id) === old);
}

console.log('\n— Product, time ago, country, category — and nothing about the buyer —');
{
  const s = all.sales.find((x) => ids.get(x.id) === a);
  ok('the product name', s?.product === 'Steam Wallet €20', s?.product);
  ok('how long ago, from the real delivery time', s.secondsAgo >= 1 && s.secondsAgo < 120 && !Number.isNaN(Date.parse(s.at)));
  ok('the country the checkout came from', s.country === 'NL');
  ok('the category', s.category === 'giftcard');
  ok('two days ago is two days ago', all.sales.find((x) => ids.get(x.id) === old).secondsAgo >= 2 * 86_400 - 5);
  ok('a typed country name is not turned into a guess', all.sales.find((x) => ids.get(x.id) === noCountry).country === null);
  ok('…a typed two-letter code is used, upper-cased', all.sales.find((x) => ids.get(x.id) === typed).country === 'DE');
  const raw = JSON.stringify(all);
  ok('no first name, city or email in the response', !/Jan|Vries|Utrecht|@test\.local/.test(raw));
  ok('no field that could carry one', all.sales.every((x) =>
    JSON.stringify(Object.keys(x).sort()) === JSON.stringify(['at', 'category', 'country', 'id', 'product', 'secondsAgo'])));
}

console.log('\n— Filters —');
{
  const gc = (await feed('?category=giftcard')).body;
  ok('by category', gc.total === 3 && gc.sales.every((s) => s.category === 'giftcard'), JSON.stringify(gc.sales));
  const be = (await feed('?country=be')).body;
  ok('by country (case does not matter)', be.total === 1 && be.sales[0].country === 'BE' && be.sales[0].product === 'Discord Nitro');
  const day = (await feed('?period=24h')).body;
  ok('by period: the sale from two days ago is outside 24 hours', day.total === 5 && !day.sales.some((s) => ids.get(s.id) === old));
  ok('…and inside 7 days', (await feed('?period=7d')).body.total === 6);
  const both = (await feed('?category=giftcard&country=NL&period=24h')).body;
  ok('filters combine', both.total === 1 && ids.get(both.sales[0].id) === a);
  ok('a filter that matches nothing returns nothing — not a fallback', (await feed('?category=robux&country=BE')).body.total === 0);

  const cats = Object.fromEntries(all.filters.categories.map((c) => [c.key, c.count]));
  ok('category options are what sold, with real counts',
    JSON.stringify(cats) === JSON.stringify({ giftcard: 3, 'discord-nitro': 2, robux: 1 }), JSON.stringify(cats));
  const countries = Object.fromEntries(all.filters.countries.map((c) => [c.code, c.count]));
  ok('country options likewise — no refunded, test or giveaway countries, no blank one',
    JSON.stringify(countries) === JSON.stringify({ NL: 3, BE: 1, DE: 1 }), JSON.stringify(countries));
  ok('…and narrow with the other filter', (await feed('?country=BE')).body.filters.categories
    .every((c) => c.key === 'discord-nitro'));

  const junk = await feed(`?category=${encodeURIComponent("x'; DROP TABLE orders;--")}&country=Netherlands&period=forever&limit=9999`);
  ok('a malformed filter is ignored, not an error', junk.status === 200 && junk.body.total === 6 && junk.body.period === 'all');
  ok('…and the limit is capped', (await feed('?limit=2')).body.sales.length === 2);
}

console.log('\n— A sale that is undone leaves at once —');
{
  await transitionOrder(b.id, 'refunded', { actorId: 'admin', force: true, reason: 'test' });
  const after = (await feed()).body;
  ok('refunding a listed sale removes it', after.total === 5 && !after.sales.some((s) => ids.get(s.id) === b));
  const live = await social.liveFeed({ limit: 50 });
  ok('the existing live ticker drops it too', !live.some((e) => e.id === [...ids].find(([, o]) => o === b)[0]));
  const testRow = await get(`SELECT s.id FROM social_events s JOIN orders o ON o.id=s.order_id WHERE o.country='FR'`);
  ok('…and the ticker never shows the test payment', !live.some((e) => e.id === testRow.id));
}

console.log('\n— Served so the edge can cache it, briefly —');
{
  const { headers } = await feed();
  const cc = headers.get('cache-control') || '';
  ok('public, with a shared-cache age', /public/.test(cc) && /s-maxage=30\b/.test(cc), cc);
  ok('…and a short stale window, so a refund leaves within a minute or so', /stale-while-revalidate=60\b/.test(cc), cc);
  ok('no cookie', !headers.get('set-cookie'));
}

console.log('\n— Country codes —');
{
  ok('"nl" is NL', social.countryCodeOf('nl') === 'NL');
  ok('"Nederland" is no country', social.countryCodeOf('Nederland') === null);
  ok('"XX" (unknown) is no country', social.countryCodeOf('XX') === null);
  ok('nothing is nothing', social.countryCodeOf(null) === null);
  const o = await get(`SELECT country FROM orders WHERE id=@id`, { id: noCountry.id });
  ok('an order with no edge country stores none', o.country === null);
}

console.log('\n— The page —');
{
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const page = read('src/pages/info/Sales.jsx');
  ok('the page reads the real endpoint', page.includes('/api/social/sales'));
  ok('…and has no sample data to fall back on', !/sample|fake|placeholder|Math\.random/i.test(page.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^import .*$/gm, '')));  // the icon helper lives in sampleCatalog.js
  ok('it is routed', /path="\/sales"/.test(read('src/App.jsx')));
  const seo = await import('../../src/content/seo.js');
  ok('it has its own title in every language', ['nl', 'en', 'de', 'fr'].every((l) =>
    /verkopen|sales|Verkäufe|Ventes/.test(seo.metaFor('/sales', l)?.title || '')), seo.metaFor('/sales', 'nl')?.title);
  ok('it is in the sitemap', /\['\/sales'/.test(read('server/src/routes/catalog.js')));
  for (const l of ['de', 'fr']) {
    const d = read(`src/lib/i18n/${l}.js`);
    ok(`its text exists in ${l}`, ['sales.title', 'sales.sold', 'sales.empty', 'sales.country', 'footer.sales'].every((k) => d.includes(`'${k}'`)));
  }
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} sales-feed: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
