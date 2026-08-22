/**
 * The product page, measured rather than hoped for.
 *
 * What a phone on regular 4G with a 4x CPU throttle experienced, five cold runs,
 * read off the page's own Performance entries:
 *
 *   LCP 2244ms, and the LCP element was the product's own picture. The request
 *   for that picture did not START until 1819ms.
 *
 * The server was not slow — the HTML was complete at 206ms. The picture was late
 * because nothing knew its URL yet: HTML → bundle → React boots → GET
 * /api/products/:id → and only then is the <img> src known. Four serial hops for
 * one picture, and the last one is the thing the visitor is waiting to see.
 *
 * The handler rendering that HTML had the URL the whole time; it is in the
 * og:image tag it already writes. So it now says so, in a preload, and inlines
 * the product itself so React draws it on its first render.
 *
 * These are the things that would silently undo that. A missing preload does not
 * break a page — it just makes it slow again, in a way nothing fails on.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_speed';
process.env.NODE_ENV ||= 'development';

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
// Assert on code, never on prose: every claim below is also written in a comment
// a few lines from the thing it describes, and a regex that matches the comment
// passes whether or not the code is still there.
/* Block comments and line comments only. The JSX-comment rule these suites
   usually carry — /\{\s*\/\*[\s\S]*?\*\/\s*\}/ — ate 7,000 characters of this
   particular file: a `{` opening some JSX expression pairs with a `*​/ }` many
   lines below, and everything between them disappears, including the very
   dependency arrays asserted on here. Removing `/* … *​/` already handles
   `{/* … *​/}`; what is left is `{ }`, which matches nothing below. */
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

const products = await fetch(`${base}/api/products`).then((r) => r.json()).then((j) => j.products);
// A product whose art is a pack cover: those carry their own background, which
// is what the server-rendered hero is allowed to paint.
const product = products.find((p) => p.image?.startsWith('/products/packs/')) || products[0];
ok('there is a product to test with', !!product, `${products.length} products`);

const html = await fetch(`${base}/product/${product.id}`).then((r) => r.text());
const built = html.includes('<div id="root">');
if (!built) {
  console.log('  ⏭  no built app shell (run npm run build) — HTML checks skipped');
}

console.log('\n— The artwork is discoverable before the bundle has run —');
if (built) {
  const preload = html.match(/<link rel="preload" as="image"[^>]*>/);
  ok('the page preloads the product artwork', !!preload, 'no preload tag');
  ok('…the one the <img> will ask for, not the absolutised social card',
    !!preload && preload[0].includes(`href="${product.image}"`), preload?.[0]);
  ok('…at high priority', !!preload && /fetchpriority="high"/.test(preload[0]), preload?.[0]);

  /* Ahead of the bundle in the document. The preload scanner reads the whole
     head before anything executes, so both were discovered together either way —
     measured: the image request left at 191ms, the bundle at 197ms. But the
     order is what the browser ranks by when it has to choose, and putting the
     picture first costs nothing. */
  const iPre = html.indexOf('rel="preload" as="image"');
  const iJs = html.indexOf('<script type="module"');
  ok('the preload is ahead of the bundle in the document', iPre > -1 && iPre < iJs, `${iPre} vs ${iJs}`);
}

console.log('\n— The product is in the HTML, so React has something to draw —');
if (built) {
  const m = html.match(/window\.__FM_BOOT__=(\{[\s\S]*?\})<\/script>/);
  ok('the page inlines a boot payload', !!m, 'no __FM_BOOT__');
  let boot = null;
  try { boot = JSON.parse(m[1]); } catch { /* reported below */ }
  ok('…and it is valid JSON', !!boot?.product, m?.[1]?.slice(0, 80));
  ok('…for THIS product', boot?.product?.id === product.id, `${boot?.product?.id} vs ${product.id}`);

  /* The inlined object and the fetched one must be the same object. React
     renders the first and then replaces it with the second; a difference
     between them is a visible flicker that no test would otherwise catch. */
  const api = await fetch(`${base}/api/products/${product.id}`).then((r) => r.json());
  ok('…identical to what /api/products/:id returns',
    JSON.stringify(boot?.product) === JSON.stringify(api.product),
    'the inlined product and the fetched product disagree');

  // JSON cannot contain a literal </script>, but it can contain the characters.
  ok('the payload cannot close its own script tag', !/window\.__FM_BOOT__=[^<]*<\/script[^>]/i.test(html));
}

console.log('\n— The pre-React shell paints this product, and nothing that can go stale —');
if (built) {
  ok('the shell carries the product artwork', html.includes(`<div class="hero"><img src="${product.image}"`),
    'shell was not replaced');
  ok('…and the product name', html.includes(`<h2 class="pn">`) && html.includes(product.name));

  /* A shell that states a price is a shell that can be wrong: this HTML is
     edge-cached for five minutes. Name and picture are safe — they came out of
     the same read that wrote the title. */
  const shell = html.match(/<div id="fm-shell"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  const cents = (product.price / 100).toFixed(2);
  ok('the shell states no price', !shell.includes(cents) && !/€/.test(shell), shell.slice(0, 120));
  ok('the shell makes no stock or delivery claim',
    !/in stock|instant|voorraad|direct/i.test(shell), shell.slice(0, 120));
}

console.log('\n— Art the hero draws differently keeps the grey shell —');
{
  /* A transparent icon sits on a category GRADIENT in the real hero, not on the
     neutral panel. Painting it on the panel would change colour under the
     picture a second later, which is exactly what a shell must not do. */
  const icon = products.find((p) => /\/products\/icons\/[a-z0-9-]+\.svg$/i.test(p.image || ''));
  ok('the catalogue still has an icon-art product', !!icon, 'nothing to check');
  if (icon && built) {
    const h = await fetch(`${base}/product/${icon.id}`).then((r) => r.text());
    ok('its shell is left as shapes', !h.includes('<div class="hero">'), 'the panel was painted anyway');
    ok('…but it still preloads its artwork',
      h.includes(`<link rel="preload" as="image" href="${icon.image}"`));
    ok('…and still inlines its product', h.includes('window.__FM_BOOT__='));
  }
}

console.log('\n— Nothing was traded away for it —');
if (built) {
  // The whole point of rendering this route server-side was the crawler.
  ok('the title is still this product', new RegExp(`<title>[^<]*${product.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(html));
  ok('the canonical is still there', /<link rel="canonical"/.test(html));
  ok('the Product JSON-LD is still there', /"@type":"Product"/.test(html));
  ok('there is exactly one og:title', (html.match(/property="og:title"/g) || []).length === 1);
}

console.log('\n— The reads behind the page are issued together —');
{
  const seo = strip(read('server', 'src', 'routes', 'seo.js'));
  /* Three independent reads awaited one after another is three times the link
     latency to a managed Postgres, for one page, on every cache miss. */
  ok('stock and review totals are awaited in parallel',
    /Promise\.all\(\[\s*availableCount\(/.test(seo), 'the handler serialises them');
  ok('reviewStats is no longer awaited on its own line',
    !/const stats = await reviewStats\(\)/.test(seo));
}

console.log('\n— One definition of the product payload —');
{
  const catalog = strip(read('server', 'src', 'routes', 'catalog.js'));
  const seo = strip(read('server', 'src', 'routes', 'seo.js'));
  ok('the API builds it from the shared module', /productPayload\(p, count\)/.test(catalog));
  ok('the page builds it from the same one', /productPayload\(product, stock\)/.test(seo));
  ok('catalog.js no longer keeps its own copy of the stock rules',
    !/^const stockLeftFor =/m.test(catalog) && !/^const instantFor =/m.test(catalog));
}

console.log('\n— Below the fold does not compete with the product —');
{
  const footer = strip(read('src', 'components', 'store', 'StoreFooter.jsx'));
  ok('the footer status dot waits until it is nearly on screen',
    /IntersectionObserver/.test(footer) && /api\/health/.test(footer));
  const social = strip(read('src', 'lib', 'useSocialProof.js'));
  ok('the live feed does not fetch on mount', /delay = (\d+)/.test(social)
    && Number(social.match(/delay = (\d+)/)[1]) >= 1000, social.match(/delay = \d+/)?.[0]);
}

console.log('\n— The page asks for each thing once —');
{
  const page = strip(read('src', 'pages', 'ProductDetail.jsx'));
  /* The product now arrives twice: the server's copy on first render, then the
     revalidating fetch. Effects keyed on the OBJECT fired again for the same
     product — two /price-history calls, two recorded views of one visit. */
  ok('price history keys on the product id', /\[product\?\.id, product\?\.sample\]/.test(page));
  ok('the mystery pool keys on the product id', /\[product\?\.id, product\?\.kind\]/.test(page));
  ok('no effect depends on the product object any more',
    !/\}, \[product\]\);/.test(page), 'an effect still keys on the whole object');
  ok('the boot payload is read once and dropped',
    /delete window\.__FM_BOOT__/.test(page));
  ok('…and never answers for a different product',
    /BOOT\.id !== id/.test(page));
}

console.log('\n— The pack covers are not cropped —');
{
  const { carriesOwnBackground } = await import('../../src/lib/catalog.js');
  ok('a pack cover carries its own background', carriesOwnBackground('/products/packs/robux-1000.svg'));
  ok('a generated icon still does not', !carriesOwnBackground('/products/icons/robux.svg'));
  ok('raster art still does', carriesOwnBackground('/products/icons/robux.webp'));
  ok('an owner upload still does', carriesOwnBackground('data:image/webp;base64,AAAA'));
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
