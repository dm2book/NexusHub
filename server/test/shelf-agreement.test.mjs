/**
 * One product, one delivery promise — whichever shelf you found it on.
 *
 * The storefront shows the same product in several rails: the shop grid, the
 * product page, the "popular right now" rail on the cart page, the trending
 * row on the homepage. Each card prints a badge from `product.instant`:
 * "In stock" when it is true, "By hand, few hours" when it is not.
 *
 * `/api/products/trending` did not send that field at all. A card reads a
 * missing flag as false, so 1,000 Robux — a product with codes actually sitting
 * in stock — said "In stock" in the shop and "By hand" in the cart rail, about
 * the same product, at the same moment. Nothing errored and nothing looked
 * broken; the shop just quietly made two different promises about when your
 * code would arrive, and the buyer had no way to know which one was true.
 *
 * The same gap swallowed the German and French descriptions, which are attached
 * by the same helper.
 *
 * So this does not check that trending returns products. It checks that every
 * endpoint handing out a product hands out the SAME product.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_shelf';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const get = (p) => fetch(`${base}${p}`).then((r) => r.json());

const { products: shop } = await get('/api/products');
const { products: trending } = await get('/api/products/trending');

console.log('— Both shelves are stocked —');
ok(`the shop lists ${shop.length} products`, shop.length > 0);
ok(`the trending rail lists ${trending.length} products`, trending.length > 0);

console.log('\n— …and they describe the same products the same way —');
{
  /* Delivery promise first: it is the one a buyer plans around. */
  const byId = new Map(shop.map((p) => [p.id, p]));
  const shared = trending.filter((p) => byId.has(p.id));
  ok(`${shared.length} of the trending products are also in the shop`, shared.length > 0);

  const disagree = shared.filter((p) => !!p.instant !== !!byId.get(p.id).instant);
  ok('no product promises "in stock" on one shelf and "by hand" on the other',
    disagree.length === 0,
    disagree.map((p) => `${p.name}: trending=${p.instant} shop=${byId.get(p.id).instant}`).join(' | '));

  const missing = trending.filter((p) => !('instant' in p));
  ok('every trending product actually carries the flag',
    missing.length === 0,
    `${missing.length} carry no 'instant' at all — a card reads that as "by hand"`);

  const noLeft = shared.filter((p) => (p.stockLeft ?? null) !== (byId.get(p.id).stockLeft ?? null));
  ok('…and the same "only N left"', noLeft.length === 0,
    noLeft.map((p) => `${p.name}: ${p.stockLeft} vs ${byId.get(p.id).stockLeft}`).join(' | '));
}

console.log('\n— …in every language —');
{
  const FIELDS = ['descriptionNl', 'descriptionDe', 'descriptionFr'];
  for (const f of FIELDS) {
    const short = trending.filter((p) => !p[f]);
    ok(`the trending rail carries ${f}`, short.length === 0,
      `${short.length} of ${trending.length} products would fall back to English`);
  }
}

console.log('\n— The product page agrees with both —');
{
  const p = trending[0];
  const { product: detail } = await get(`/api/products/${p.id}`);
  ok('the product page can be opened for a trending product', !!detail, p?.id);
  if (detail) {
    ok('it makes the same delivery promise', !!detail.instant === !!p.instant,
      `detail=${detail.instant} trending=${p.instant}`);
    ok('it shows the same stock left', (detail.stockLeft ?? null) === (p.stockLeft ?? null));
    ok('it writes the same German description', detail.descriptionDe === p.descriptionDe);
  }
}

console.log('\n— Both shelves go stale at the same rate —');
{
  /* A delivery promise the CDN holds five times longer than the shop's is the
     same disagreement again, arriving later. */
  const age = async (p) => {
    const h = (await fetch(`${base}${p}`)).headers.get('cache-control') || '';
    return Number(h.match(/s-maxage=(\d+)/)?.[1] ?? -1);
  };
  const shopAge = await age('/api/products');
  const trendAge = await age('/api/products/trending');
  ok(`the shop is cached for ${shopAge}s`, shopAge > 0);
  ok(`the trending rail is cached no longer (${trendAge}s)`, trendAge > 0 && trendAge <= shopAge,
    `${trendAge}s vs ${shopAge}s`);
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
