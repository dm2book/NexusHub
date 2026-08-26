/**
 * A bundle must cost the same everywhere a buyer can see it.
 *
 * It did not. The bundle card sold "FPS Duo Pack — €14.38", the cart then showed
 * €15.98 because it rendered the plain subtotal, and checkout showed €14.38
 * again. The server was charging the right amount the whole time, so nobody was
 * ever overcharged — but a cart that quotes €1.60 more than the card that sold
 * it is the moment a buyer decides the shop is broken and leaves.
 *
 * The rule lived in two places (checkout had it, the cart did not). It now lives
 * in src/lib/bundles.js, and this pins both that rule and the server's, which
 * have to agree.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_bundles';
process.env.NODE_ENV ||= 'development';
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
const { createBundle, pricedBundles, bestBundleDiscount } = await import('../src/services/bundleService.js');
const { createOrder } = await import('../src/services/orderService.js');
// The storefront rule, imported straight from the frontend source.
const { matchBundle } = await import('../../src/lib/bundles.js');
const tag = Date.now() % 1000000;

const a = await createProduct({ name: `Alpha ${tag}`, category: 'apex', price: 799, announce: false });
const b = await createProduct({ name: `Beta ${tag}`, category: 'valorant', price: 799, announce: false });
const c = await createProduct({ name: `Gamma ${tag}`, category: 'robux', price: 1500, announce: false });
await createBundle({ name: `Duo ${tag}`, productIds: [a.id, b.id], discountPercent: 10, active: true });

const priced = (await pricedBundles()).find((x) => x.name === `Duo ${tag}`);
const cartLine = (p, qty = 1) => ({ id: p.id, price: p.price, qty });

console.log('— The price on the card —');
{
  ok('the bundle is priced', !!priced);
  ok('subtotal is the sum of its products', priced.subtotal === 1598, `${priced.subtotal}`);
  ok('discount is 10%', priced.discount === 160, `${priced.discount}`);
  ok('the card total is subtotal minus discount', priced.total === 1438, `${priced.total}`);
}

console.log('\n— The storefront rule (cart + checkout) —');
{
  const items = [cartLine(a), cartLine(b)];
  const m = matchBundle(items, [priced]);
  ok('a complete bundle is recognised', !!m);
  ok('the discount matches the card', m.discount === priced.discount, `${m?.discount}`);
  ok('cart total equals the card total',
    items.reduce((s, i) => s + i.price * i.qty, 0) - m.discount === priced.total);

  const partial = matchBundle([cartLine(a)], [priced]);
  ok('half a bundle gets nothing', partial === null);

  const withExtra = matchBundle([cartLine(a), cartLine(b), cartLine(c)], [priced]);
  ok('an unrelated item is not discounted', withExtra.discount === priced.discount, `${withExtra?.discount}`);

  // Two of each: the discount has to scale, or a buyer doubling up silently
  // loses half of it.
  const doubled = matchBundle([cartLine(a, 2), cartLine(b, 2)], [priced]);
  ok('quantity scales the discount', doubled.discount === priced.discount * 2, `${doubled?.discount}`);

  ok('no bundles, no crash', matchBundle([cartLine(a)], []) === null);
  ok('empty cart, no crash', matchBundle([], [priced]) === null);
}

console.log('\n— The server agrees —');
{
  const items = [{ product_id: a.id, unit_price: a.price, quantity: 1 },
    { product_id: b.id, unit_price: b.price, quantity: 1 }];
  const server = await bestBundleDiscount(items);
  ok('server discount matches the storefront', server.discount === priced.discount, `${server.discount}`);

  const order = await createOrder({ consent: true, consentText: 'test consent', email: `bundle${tag}@x.dev`, items: [{ productId: a.id, quantity: 1 }, { productId: b.id, quantity: 1 }] });
  ok('the order total is the price the buyer was shown', order.total === priced.total, `${order.total} vs ${priced.total}`);
  ok('the discount is recorded on the order', order.billing?.bundleDiscount === priced.discount, `${order.billing?.bundleDiscount}`);
  ok('the bundle name is recorded', !!order.billing?.bundle);

  const solo = await createOrder({ consent: true, consentText: 'test consent', email: `solo${tag}@x.dev`, items: [{ productId: a.id, quantity: 1 }] });
  ok('a single product gets no bundle discount', solo.total === a.price, `${solo.total}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
