/**
 * Write a real HTML file per route, with that route's metadata already in it.
 *
 * The problem this solves, measured before it existed: every URL on the site
 * returned byte-identical `<head>`. Sharing a Robux product on Discord showed
 * "ForgeMarket — Digital Goods Marketplace" and the generic homepage image,
 * because a link scraper does not execute JavaScript and React's meta tags
 * therefore never happened for it. There was no canonical in the HTML at all.
 *
 * Why files rather than a server:
 *
 * Vercel checks the filesystem before applying rewrites, so `dist/shop/index.html`
 * is served for `/shop` without any config and without a function invocation.
 * The pages stay static, stay on the CDN, and keep every millisecond of the
 * performance work. A server-rendered `<head>` would have cost a cold start on
 * the exact pages that most need to be fast.
 *
 * Product pages cannot be built this way — their content lives in the database
 * and changes — so those are handled at request time by the API function, which
 * injects the same tags from the same module. See server/src/routes/seo.js.
 *
 * Run automatically after `vite build`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const { PAGES, LANDING, ALIASES, NOINDEX, SITE, metaFor, canonicalFor, organizationLd, websiteLd, breadcrumbLd,
  collectionLd } =
  await import(join(ROOT, 'src/content/seo.js'));

const template = readFileSync(join(DIST, 'index.html'), 'utf8');

/**
 * Announce the chunk a route needs, in that route's own HTML.
 *
 * Shop, ProductDetail and Login are lazily imported, which keeps them out of
 * the entry bundle every visitor downloads. The cost of a lazy route is that
 * the browser only learns it exists once the entry chunk has been parsed and
 * the router has matched — an extra round trip, on the slowest connection, on
 * the page somebody actually asked for.
 *
 * Since these pages are prerendered anyway, the route is known at build time
 * and so is the chunk. A `modulepreload` in the head starts it alongside the
 * entry bundle instead of after it, which is what makes the split free rather
 * than a trade.
 *
 * Chunks the entry already preloads (react, router, icons) are skipped —
 * repeating them would only add bytes to the HTML.
 */
const manifestPath = join(DIST, '.vite', 'manifest.json');
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : null;
if (!manifest) {
  console.warn('  ! no dist/.vite/manifest.json — lazy routes will cost an extra round trip');
}

/** Everything already named in the template, so nothing is announced twice. */
const alreadyPreloaded = new Set(
  [...template.matchAll(/(?:modulepreload[^>]*|type="module"[^>]*)href="\/([^"]+)"|src="\/([^"]+)"/g)]
    .flatMap((m) => [m[1], m[2]]).filter(Boolean));

/** A source file → its chunk and the chunks it needs, flattened. */
function chunksFor(src, seen = new Set()) {
  if (!manifest || seen.has(src)) return [];
  seen.add(src);
  const entry = manifest[src];
  if (!entry) return [];
  const own = entry.file ? [entry.file] : [];
  const deps = (entry.imports || []).flatMap((i) => chunksFor(i, seen));
  return [...own, ...deps];
}

/** The lazy page each prerendered route lands on, where it has one. */
const ROUTE_CHUNKS = {
  '/': 'src/pages/HomeStore.jsx',
  '/shop': 'src/pages/Shop.jsx',
  '/login': 'src/pages/Login.jsx',
};

function withRouteChunk(html, route) {
  const src = ROUTE_CHUNKS[route];
  if (!src) return html;
  const links = [...new Set(chunksFor(src))]
    .filter((f) => !alreadyPreloaded.has(f))
    .map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`);
  if (!links.length) return html;
  return html.replace('</head>', `    ${links.join('\n    ')}\n  </head>`);
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Replace the head of the template.
 *
 * The template's tags are removed rather than added to: a page with two
 * `og:title` tags gets whichever the scraper happens to read first, which is
 * exactly the kind of bug that only shows up in someone else's chat window.
 */
function renderHead(path, { title, description, canonical, noindex, ld = [], og = {} }) {
  let html = template;

  const drop = [
    /\s*<title>[\s\S]*?<\/title>/,
    /\s*<meta name="description"[^>]*>/,
    /\s*<meta property="og:(?:type|url|site_name|title|description|image|image:width|image:height)"[^>]*>/g,
    /\s*<meta name="twitter:(?:card|title|description|image)"[^>]*>/g,
    /\s*<link rel="canonical"[^>]*>/g,
  ];
  for (const re of drop) html = html.replace(re, '');

  const image = og.image
    ? (og.image.startsWith('http') ? og.image : SITE.url + og.image)
    : SITE.url + SITE.ogImage;

  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(canonical)}" />`,
    noindex ? '<meta name="robots" content="noindex, follow" />' : '',
    `<meta property="og:type" content="${og.type || 'website'}" />`,
    `<meta property="og:site_name" content="${SITE.name}" />`,
    `<meta property="og:url" content="${esc(canonical)}" />`,
    `<meta property="og:title" content="${esc(og.title || title)}" />`,
    `<meta property="og:description" content="${esc(og.description || description)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:locale" content="nl_NL" />`,
    `<meta property="og:locale:alternate" content="en_US" />`,
    // summary_large_image needs an image at least 300px wide; og.jpg is 1200.
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(og.title || title)}" />`,
    `<meta name="twitter:description" content="${esc(og.description || description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    ...ld.map((d) => `<script type="application/ld+json">${JSON.stringify(d)}</script>`),
  ].filter(Boolean).join('\n    ');

  return html.replace('</head>', `    ${head}\n  </head>`);
}

/**
 * The catalogue, baked into the pages that show it.
 *
 * earlyFetch already starts the request during HTML parse; it cannot remove
 * the request. This does: the shelves paint out of the first byte, with no
 * round trip to a function and a database in another datacentre, and the live
 * fetch still runs and replaces what is here.
 *
 * Only the fields a first paint needs. The full row is 69KB of JSON per page
 * — most of it stock bookkeeping, image geometry and timestamps that nothing
 * on a shelf reads. What is kept is what a card draws, in four languages,
 * because the page's language is chosen in the browser and this file cannot
 * know it.
 *
 * A build with no database writes no seed and every page behaves exactly as it
 * did before. That is deliberate: this may only ever remove waiting.
 */
async function bakeCatalogue() {
  try {
    const { listProducts } = await import(join(ROOT, 'server/src/services/productService.js'));
    const { availableCounts } = await import(join(ROOT, 'server/src/services/codeStockService.js'));
    const { stockLeftFor, instantFor } = await import(join(ROOT, 'server/src/services/productPayload.js'));
    const { withCopy } = await import(join(ROOT, 'server/src/services/productCopy.js'));
    const rows = await listProducts({ activeOnly: true });
    const counts = await availableCounts(rows.map((p) => p.id));
    return rows.map((p) => {
      const full = withCopy({
        ...p, stockLeft: stockLeftFor(p, counts[p.id] || 0), instant: instantFor(p, counts[p.id] || 0),
      });
      return {
        id: full.id, name: full.name, category: full.category, price: full.price,
        currency: full.currency, image: full.image, active: full.active,
        featured: full.featured, instant: full.instant, stockLeft: full.stockLeft,
        compareAtPrice: full.compareAtPrice, sold: full.sold,
        description: full.description, descriptionNl: full.descriptionNl,
        descriptionDe: full.descriptionDe, descriptionFr: full.descriptionFr,
      };
    });
  } catch (err) {
    console.log(`  · no catalogue baked in (${String(err.message || err).slice(0, 60)}) — pages will fetch as before`);
    return null;
  }
}

const SEED = await bakeCatalogue();
/* Only the routes that draw products. Baking 40KB into the privacy policy buys
   nothing and costs every reader of it. */
const SEEDED_ROUTES = new Set(['/', '/shop', ...Object.keys(LANDING)]);

const seedTag = (route) => {
  if (!SEED || !SEEDED_ROUTES.has(route)) return '';
  const json = JSON.stringify({ products: SEED, builtAt: new Date().toISOString() })
    /* `</script>` inside a string would end the tag early, and a lone U+2028
       is a newline to a JS parser but not to JSON.stringify. Both turn a data
       blob into a syntax error on someone else's page. */
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script>window.__FM_SEED=${json}</script>`;
};

const write = (route, html) => {
  const dir = route === '/' ? DIST : join(DIST, route);
  mkdirSync(dir, { recursive: true });
  const tag = seedTag(route);
  const out = withRouteChunk(html, route);
  writeFileSync(join(dir, 'index.html'),
    tag ? out.replace('</body>', `  ${tag}\n</body>`) : out);
};

// Emitted on every page: a search engine building an entity for this site
// should not have to find the one page that happens to mention it.
let legal = {};
try {
  ({ LEGAL: legal } = await import(join(ROOT, 'src/lib/legalIdentity.js')));
} catch { /* identity not filled in yet — organizationLd leaves those fields out */ }
let email = '';
try {
  ({ SUPPORT_EMAIL: email } = await import(join(ROOT, 'src/lib/support.js')));
} catch { /* optional */ }

/* What the shop can actually be paid with, read from the same config the
   checkout reads — not a list written down once and left behind. Empty when
   nothing is configured, and organizationLd then omits the field rather than
   claiming five providers the checkout has never heard of. */
let paymentAccepted = '';
try {
  const { config, manualPayMethods } = await import(join(ROOT, 'server/src/config/env.js'));
  const names = [
    ...manualPayMethods().map((m) => m.label),
    /* One key switches Mollie on, and it is Mollie that decides which of these
       a given buyer is offered — so this is what the shop CAN be paid with,
       which is the question schema.org asks. */
    ...(config.payments.mollie.apiKey ? ['iDEAL', 'Bancontact', 'Apple Pay', 'Credit Card', 'PayPal'] : []),
    ...(config.payments.stripe.secretKey ? ['Credit Card'] : []),
  ].filter(Boolean);
  paymentAccepted = [...new Set(names)].join(', ');
} catch { /* no config at build time — the field is left out, which is honest */ }

const org = organizationLd({ email, legal, paymentAccepted });
const site = websiteLd();

const NAME = { '/': 'Home', '/shop': 'Shop' };
let count = 0;

for (const route of Object.keys(PAGES)) {
  const m = metaFor(route, 'nl');
  const ld = [org, site];
  if (route !== '/') {
    ld.push(breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: NAME[route] || m.title, path: route },
    ]));
  }
  write(route, renderHead(route, {
    title: `${m.title} · ${SITE.name}`,
    description: m.description,
    canonical: canonicalFor(route),
    noindex: NOINDEX.has(route),
    ld,
  }));
  count++;
}

// The keyword landing pages. Same treatment as any other route — they are real
// pages with their own copy, not a redirect to a filtered shop.
for (const [route, def] of Object.entries(LANDING)) {
  const m = def.nl;
  write(route, renderHead(route, {
    title: `${m.title} · ${SITE.name}`,
    description: m.description,
    canonical: canonicalFor(route),
    ld: [org, site, collectionLd(route, { name: m.h1, description: m.description }),
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Shop', path: '/shop' },
        { name: m.h1, path: route },
      ])],
  }));
  count++;
}

// Dutch aliases get their own file so the URL works, but they point their
// canonical at the English route rather than competing with it for the same
// content. Not noindex: a canonical consolidates, noindex would throw the
// page away entirely.
for (const [alias, target] of Object.entries(ALIASES)) {
  const m = metaFor(target, 'nl');
  write(alias, renderHead(alias, {
    title: `${m.title} · ${SITE.name}`,
    description: m.description,
    canonical: canonicalFor(target),
    ld: [org, site],
  }));
  count++;
}

// Routes with no copy of their own still need to not be indexed as duplicates
// of the homepage.
for (const route of NOINDEX) {
  if (PAGES[route]) continue;
  const m = metaFor('/', 'nl');
  write(route, renderHead(route, {
    title: `${SITE.name}`,
    description: m.description,
    canonical: canonicalFor(route),
    noindex: true,
    ld: [],
  }));
  count++;
}

/**
 * Hand the server the built shell.
 *
 * Product pages cannot be prerendered — their content lives in the database and
 * changes without a deploy — so the API function has to inject their metadata at
 * request time. To do that it needs the same HTML, including the hashed asset
 * filenames this build just produced.
 *
 * Written as a module rather than read from dist/ at runtime: a serverless
 * function is bundled separately from the static output and cannot rely on that
 * directory existing next to it.
 */
const shellDir = join(ROOT, 'server/src/generated');
mkdirSync(shellDir, { recursive: true });
writeFileSync(join(shellDir, 'appShell.js'),
  '/* GENERATED by scripts/prerender.mjs — do not edit. Rebuilt on every build. */\n'
  + '/* The built index.html, so the API can serve product pages with their own\n'
  + '   metadata already in the head. Asset filenames are hashed, which is why\n'
  + '   this is regenerated rather than written by hand. */\n'
  + `export const APP_SHELL = ${JSON.stringify(template)};\n`);

/* The product page's chunk, for the API.
   Product pages are rendered at request time by server/src/routes/seo.js — they
   cannot be prerendered because their content is in the database — so the same
   modulepreload has to reach them a different way. The filename is hashed, so
   it is generated here alongside the shell rather than written by hand. */
writeFileSync(join(shellDir, 'routeChunks.js'),
  '/* GENERATED by scripts/prerender.mjs — do not edit. Rebuilt on every build. */\n'
  + '/* Chunks a route needs that the entry bundle does not already preload, so\n'
  + '   a lazily-imported page starts downloading with the entry instead of\n'
  + '   after it. Hashed filenames, hence generated. */\n'
  + `export const ROUTE_CHUNKS = ${JSON.stringify({
    product: [...new Set(chunksFor('src/pages/ProductDetail.jsx'))]
      .filter((f) => !alreadyPreloaded.has(f)),
  }, null, 2)};\n`);

/**
 * robots.txt, pointed at the host the rest of the site claims to live on.
 *
 * It is a hand-written file in public/, and it named the APEX — the first
 * comment line and, worse, the `Sitemap:` directive. Every canonical on the
 * site says https://www.forgemarket.nl, the apex is not attached to the Vercel
 * project, and Google's only route to the sitemap is that one line. So a
 * crawler read robots.txt on www, was sent to a host that serves nothing, and
 * the shop's own map of itself was never fetched.
 *
 * Rewritten here rather than corrected by hand, because a second copy of the
 * site's address is a second thing to get wrong the next time it moves.
 */
{
  const src = join(ROOT, 'public', 'robots.txt');
  if (existsSync(src)) {
    const host = SITE.url.replace(/\/+$/, '');
    const fixed = readFileSync(src, 'utf8')
      .replace(/https?:\/\/[^/\s]*forgemarket\.nl/g, host);
    writeFileSync(join(DIST, 'robots.txt'), fixed);
    console.log(`  · robots.txt points at ${host}`);
  }
}

console.log(`prerendered ${count} routes with their own metadata`);
