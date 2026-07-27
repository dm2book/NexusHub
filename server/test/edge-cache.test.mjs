/**
 * What the CDN is allowed to hold — and what it must never touch.
 *
 * A cold serverless start measured ~3.4s of module imports plus ~1.2s in the
 * migrate/seed check before a query even runs, which is where "sometimes ten
 * seconds for the products" came from. The fix is to let Vercel's edge answer
 * the public catalogue instead of the function.
 *
 * That fix has one dangerous edge. `Cache-Control: public, s-maxage=…` on a
 * response that is NOT the same for everyone means the CDN hands one person's
 * data to the next visitor who asks for the same URL. On this shop the obvious
 * victim is /track/:number — a guest order lookup keyed only by order number.
 * A shared cache entry there would show one buyer's order, email and payment
 * link to whoever loaded the page next.
 *
 * So this suite asserts both halves: the public routes carry a cache header,
 * and the personal ones carry none. The second half is the one that matters.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_cache';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const head = async (p) => (await fetch(`${base}${p}`)).headers.get('cache-control') || '';

const productId = await fetch(`${base}/api/products`).then((r) => r.json()).then((j) => j.products[0]?.id);
ok('the catalogue has products to test with', !!productId);

console.log('— The public catalogue is edge-cacheable —');
for (const [path, min] of [
  ['/api/products', 30], ['/api/products/trending', 30], ['/api/config', 30],
  ['/api/stats', 30], ['/api/reviews', 30], ['/api/bundles', 30], ['/api/drops', 30],
  [`/api/products/${productId}`, 30],
]) {
  const c = await head(path);
  const m = c.match(/s-maxage=(\d+)/);
  ok(`${path} is cached at the edge`, !!m && Number(m[1]) >= min, c || '(none)');
  // Without stale-while-revalidate the first visitor after expiry still pays
  // the full cold start — which is the whole problem this is solving.
  ok(`${path} revalidates in the background`, /stale-while-revalidate=\d+/.test(c), c);
}

console.log('\n— Nothing personal may ever be shared by the CDN —');
{
  // Each of these is either keyed by something guessable (an order number) or
  // depends on who is asking. A shared cache entry is a data leak, not a
  // performance win.
  const personal = [
    ['/api/track/FM-0000-TEST', 'a guest order lookup'],
    ['/api/coupons/TESTCODE', 'coupon eligibility depends on the user'],
    [`/api/products/${productId}/mystery`, 'mystery odds are per-order'],
    ['/api/auth/providers', 'cheap, and config changes must show up at once'],
  ];
  for (const [path, why] of personal) {
    const c = await head(path);
    ok(`not cached: ${path} (${why})`, !/s-maxage/.test(c), c);
  }
}

console.log('\n— A cached response must not carry a session —');
{
  // Set-Cookie on a cacheable response would pin one visitor's session into
  // the shared cache entry.
  const res = await fetch(`${base}/api/products`);
  ok('the products response sets no cookie',
    !res.headers.get('set-cookie'), String(res.headers.get('set-cookie')).slice(0, 60));
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
