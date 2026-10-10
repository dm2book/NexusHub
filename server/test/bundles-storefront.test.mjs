/**
 * Bundles took the mystery box's place in the shop. Pinned:
 *   1  a bundle card's figures are the server's, and "Add bundle to cart" puts
 *      exactly one complete set in the cart — which the checkout quote then
 *      discounts by the amount the card showed
 *   2  the product page's "Cheaper together" adds only what is missing from a
 *      set, and a cart that refuses (before launch) is reported, not ignored
 *   3  /bundles is a real, translated page; the homepage row is lazy, deferred
 *      and holds its space; the footer links to it
 *   4  the mystery box is gone from every storefront surface — no odds on the
 *      product page, no box notices in the checkout, no reroll on an order
 *      (the prize already won stays on it), no way to make one in the admin.
 *      A paid box with random prizes is very likely a game of chance under the
 *      Dutch Wet op de kansspelen, which needs a licence this shop does not have.
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady, createApp } from '../src/app.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { createBundle } = await import('../src/services/bundleService.js');
// The storefront's own helpers, imported straight from the frontend source.
const { addBundleToCart, bundleText } = await import('../../src/lib/bundles.js');
const { metaFor } = await import('../../src/content/seo.js');

const stamp = Date.now().toString(36);
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
/* Source with comments removed, so an explanation of what went is not read as
   the thing itself. Block and line comments only: the usual extra rule for
   `{/* … *​/}` also matches a function body's `{` followed by a comment, and
   eats everything up to the next JSX comment — the whole of Bundles.jsx's
   component, the first time this ran. Removing `/* … *​/` alone leaves `{ }`. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
/** A cart the way CartContext keeps one, with the same add(): qty adds up per product. */
const cartOf = (lines = [], { open = true } = {}) => {
  const items = lines.map((l) => ({ ...l }));
  const add = (p, qty = 1) => {
    if (!open) return false;
    const found = items.find((i) => i.id === p.id);
    if (found) found.qty += qty; else items.push({ id: p.id, name: p.name, price: p.price, currency: p.currency, category: p.category, qty });
    return true;
  };
  return { items, add };
};
const quoteFor = (items) => call('POST', '/api/checkout/quote',
  { items: items.map((i) => ({ productId: i.id, quantity: i.qty })) });

// Products of their own, so no other bundle in the catalogue can match the cart.
const A = await createProduct({ name: `Bundle A ${stamp}`, category: 'apex', price: 799, announce: false });
const B = await createProduct({ name: `Bundle B ${stamp}`, category: 'valorant', price: 799, announce: false });
await createBundle({ name: `Duo ${stamp}`, productIds: [A.id, B.id], discountPercent: 10, announce: false });

console.log('— 1 The card shows the server\'s figures, and the checkout charges them —');
const list = await call('GET', '/api/bundles');
const card = (list.body.bundles || []).find((b) => b.name === `Duo ${stamp}`);
{
  ok('the bundle is listed by GET /api/bundles', list.status === 200 && !!card, `${list.status}`);
  ok('…with its products, at today\'s prices', card?.products?.map((p) => p.price).join(',') === '799,799');
  ok('…and the three figures a card shows', card?.subtotal === 1598 && card?.discount === 160 && card?.total === 1438,
    JSON.stringify({ s: card?.subtotal, d: card?.discount, t: card?.total }));
  ok('…with a name and a line in every language the shop is read in',
    ['nl', 'de', 'fr', 'en'].every((l) => bundleText(card || {}, l).name && bundleText(card || {}, l).description));

  const cart = cartOf();
  ok('"Add bundle to cart" adds', addBundleToCart(card, cart.add) === 'added');
  ok('…one of each product: one complete set',
    cart.items.length === 2 && cart.items.every((i) => i.qty === 1), JSON.stringify(cart.items));
  const q = await quoteFor(cart.items);
  ok('the checkout quote applies this bundle', q.status === 200 && q.body.bundle?.id === card?.id, `${q.status} ${JSON.stringify(q.body.bundle)}`);
  ok('…taking off exactly what the card said', q.body.bundleDiscount === card?.discount, `${q.body.bundleDiscount}`);
  ok('…so the total is the card\'s bundle price', q.body.total === card?.total, `${q.body.total}`);

  addBundleToCart(card, cart.add);
  const q2 = await quoteFor(cart.items);
  ok('pressing it again is a second set, and the server discounts both',
    q2.body.bundleDiscount === 2 * card.discount, `${q2.body.bundleDiscount}`);
}

console.log('\n— 2 The product page adds only what is missing —');
{
  const cart = cartOf([{ id: A.id, name: A.name, price: A.price, currency: 'EUR', category: 'apex', qty: 1 }]);
  ok('with A already in the cart, "Add bundle" adds', addBundleToCart(card, cart.add, cart.items) === 'added');
  ok('…only B — not a second A', cart.items.find((i) => i.id === A.id)?.qty === 1
    && cart.items.find((i) => i.id === B.id)?.qty === 1, JSON.stringify(cart.items));
  ok('with the whole set there it adds nothing, and says so',
    addBundleToCart(card, cart.add, cart.items) === 'already' && cart.items.length === 2);
  const q = await quoteFor(cart.items);
  ok('…and the quote discounts that one set', q.body.bundleDiscount === card.discount, `${q.body.bundleDiscount}`);

  // A bundle that lists a product twice needs two of it per set.
  const twice = { ...card, products: [card.products[0], card.products[0], card.products[1]] };
  const c2 = cartOf([{ id: A.id, name: A.name, price: A.price, qty: 1 }]);
  addBundleToCart(twice, c2.add, c2.items);
  ok('a product listed twice is counted, not just checked for', c2.items.find((i) => i.id === A.id)?.qty === 2,
    JSON.stringify(c2.items));

  const closed = cartOf([], { open: false });
  ok('before launch the refusal is reported', addBundleToCart(card, closed.add) === 'closed' && closed.items.length === 0);
}

console.log('\n— 3 Where bundles are offered —');
{
  const app = code('src/App.jsx');
  ok('/bundles is routed', /path="\/bundles" element=\{<Bundles \/>\}/.test(app));
  ok('…as its own chunk, like every other page', /const Bundles = lazy\(\(\) => import\('\.\/pages\/Bundles\.jsx'\)\)/.test(app));

  const page = code('src/pages/Bundles.jsx');
  ok('the page shows the server\'s figures', /b\.subtotal/.test(page) && /b\.total/.test(page) && /b\.discount\b/.test(page));
  ok('…and works none out itself', !/setDiscount|matchBundle|discountPercent\s*\/\s*100|\*\s*b\.discountPercent/.test(page));
  ok('…adds a bundle through the cart', /addBundleToCart\(b, add\)/.test(page));
  ok('…and says so when the shop could not be asked, instead of "no bundles"', /failed \?/.test(page) && /shop\.unavailable/.test(page));
  ok('its title and description come from the route\'s own copy', /usePageMeta\(\);/.test(page));
  const titles = { nl: /Bundels/, en: /Bundles/, de: /Bündel/, fr: /Packs/ };
  ok('…which exists in all four languages', Object.entries(titles).every(([l, re]) => re.test(metaFor('/bundles', l).title)),
    ['nl', 'en', 'de', 'fr'].map((l) => metaFor('/bundles', l).title).join(' | '));

  const home = code('src/pages/HomeStore.jsx');
  ok('the homepage row is its own chunk', /lazy\(\(\) => import\('\.\.\/components\/store\/BundlesShowcase\.jsx'\)\)/.test(home));
  ok('…mounted once the page is idle, holding its space until then',
    /<DeferUntilIdle fallback=\{bundleSpace\}>/.test(home) && /<Suspense fallback=\{bundleSpace\}><BundlesShowcase variant="row" \/>/.test(home));
  ok('…after the shelves and before "How it works"',
    home.indexOf('home.packs') < home.indexOf('variant="row"') && home.indexOf('variant="row"') < home.indexOf('home.howTitle'));
  const show = code('src/components/store/BundlesShowcase.jsx');
  ok('the row links to /bundles', /to="\/bundles"/.test(show));
  ok('…and hides itself when there are no bundles', /bundles\.length === 0\) return null/.test(show));

  const pdp = code('src/pages/ProductDetail.jsx');
  ok('the product page offers the bundles it is in', /<BundleOffer product=\{product\} \/>/.test(pdp));
  const offer = code('src/components/store/BundleOffer.jsx');
  ok('…adding only what the cart is missing', /addBundleToCart\(b, add, items\)/.test(offer));
  ok('…and draws nothing for a product in no bundle', /if \(!offers\.length\) return null/.test(offer));

  ok('the footer links to /bundles', /\[t\('nav\.bundles', 'Bundles'\), '\/bundles'\]/.test(code('src/components/store/StoreFooter.jsx')));
  const keys = ['nav.bundles', 'bundles.title', 'bundles.intro', 'bundles.together', 'bundles.addAll', 'bundles.youSave', 'pd.bundleNote'];
  for (const f of ['src/lib/i18n.jsx', 'src/lib/i18n/de.js', 'src/lib/i18n/fr.js']) {
    const d = read(f);
    ok(`${f.split('/').pop()} carries the bundle copy`, keys.every((k) => d.includes(`'${k}':`)),
      keys.filter((k) => !d.includes(`'${k}':`)).join(', '));
  }
}

console.log('\n— 4 No mystery box anywhere a buyer looks —');
{
  ok('the product page asks for no odds', !/\/mystery`|mysteryPool/.test(code('src/pages/ProductDetail.jsx')));
  const checkout = code('src/pages/Checkout.jsx');
  ok('the checkout has no box notices', !/creditNoMystery|couponNoBoxes|hasMystery|mystery_only/.test(checkout));
  ok('…and its minimum-order line no longer mentions boxes', !/[Mm]ystery/.test(checkout));
  ok('the cart has none either', !/[Mm]ystery/.test(code('src/pages/Cart.jsx')));

  const order = code('src/pages/account/OrderDetail.jsx');
  ok('an order offers no reroll', !/\/reroll|reroll\(/.test(order));
  ok('…but still shows the prize it paid out', /\/mystery`/.test(order) && /acc\.order\.mysteryOne/.test(order));

  ok('the admin can no longer make a product into a box',
    !/e\.target\.checked \? 'mystery'/.test(code('src/pages/admin/Products.jsx')));
  ok('…nor save a box\'s reward pool', !/api\.put\(`\/api\/admin\/products\/\$\{editing\.id\}\/mystery`/.test(read('src/pages/admin/Products.jsx')));

  ok('no category label for boxes', !/mystery:/.test(code('src/lib/catalog.js')));
  ok('no generated box description', !/mystery:/.test(code('src/lib/productCopy.js')));
  for (const f of ['src/lib/i18n.jsx', 'src/lib/i18n/de.js', 'src/lib/i18n/fr.js']) {
    ok(`${f.split('/').pop()} keeps no box copy`, !/'mystery\.|'home\.wMystery|'checkout\.(creditNoMystery|couponNoBoxes)'/.test(read(f)));
  }
  for (const l of ['nl', 'de', 'fr']) {
    const d = read(`src/lib/i18n/account.${l}.js`);
    ok(`account.${l}.js drops the reroll copy but keeps the prize record`,
      !/"acc\.order\.reroll(Info|Kept|Upgraded|Failed)?":/.test(d) && /"acc\.order\.rerolled":/.test(d) && /"acc\.order\.mysteryOne":/.test(d));
  }
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} bundles-storefront: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
