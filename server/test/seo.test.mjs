/**
 * SEO, as facts rather than intentions.
 *
 * What a crawler saw before any of this, measured by fetching the raw HTML:
 * every single URL returned a byte-identical `<head>`. Same title, same
 * description, same social image, and no canonical at all. React set them per
 * page, but a link scraper — Discord, WhatsApp, Twitter, Slack — does not
 * execute JavaScript, so sharing a Robux product showed
 * "ForgeMarket — Digital Goods Marketplace" and the generic homepage picture.
 *
 * That class of bug is invisible from inside the app: every page looks correct
 * in a browser, because the browser runs the code the scraper never will. So
 * these tests read the BUILT files the way a crawler would, and the duplicate
 * check below is the one that would have caught the original problem.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const ROOT = join(process.cwd(), '..');
const DIST = join(ROOT, 'dist');

if (!existsSync(join(DIST, 'index.html'))) {
  console.log('  ⏭  dist/ not built — skipping');
  console.log('\n✅ seo: skipped');
  process.exit(0);
}

const { PAGES, LANDING, ALIASES, NOINDEX, SITE, metaFor, canonicalFor, productLd, faqLd, landingPathFor } =
  await import(join(ROOT, 'src/content/seo.js'));

const htmlFor = (route) => {
  const p = route === '/' ? join(DIST, 'index.html') : join(DIST, route, 'index.html');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const tag = (html, re) => (html.match(re) || [])[1] || null;
const title = (h) => tag(h, /<title>([^<]*)<\/title>/);
const desc = (h) => tag(h, /<meta name="description" content="([^"]*)"/);
const canonical = (h) => tag(h, /<link rel="canonical" href="([^"]*)"/);
const ogv = (h, k) => tag(h, new RegExp(`<meta property="og:${k}" content="([^"]*)"`));
const twv = (h, k) => tag(h, new RegExp(`<meta name="twitter:${k}" content="([^"]*)"`));
const jsonld = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);

const ROUTES = [...Object.keys(PAGES), ...Object.keys(LANDING)];

// ── Every route is actually built ───────────────────────────────────────────
console.log('— A real HTML file per route —');
{
  const missing = ROUTES.filter((r) => !htmlFor(r));
  ok(`all ${ROUTES.length} routes with copy are prerendered`, missing.length === 0, missing.join(', '));
  const aliasMissing = Object.keys(ALIASES).filter((r) => !htmlFor(r));
  ok('the Dutch URLs are built too', aliasMissing.length === 0, aliasMissing.join(', '));
}

// ── The bug that started this ───────────────────────────────────────────────
console.log('— No two pages share a title or a description —');
{
  // The original failure, stated as a test: if this passes trivially because
  // everything is identical, the whole exercise was pointless.
  const seenT = new Map(), seenD = new Map();
  const dupT = [], dupD = [];
  for (const r of ROUTES) {
    const h = htmlFor(r);
    if (!h) continue;
    const t = title(h), d = desc(h);
    if (seenT.has(t)) dupT.push(`${r} == ${seenT.get(t)}`); else seenT.set(t, r);
    if (seenD.has(d)) dupD.push(`${r} == ${seenD.get(d)}`); else seenD.set(d, r);
  }
  ok('every title is unique', dupT.length === 0, dupT.join(' | '));
  ok('every description is unique', dupD.length === 0, dupD.join(' | '));
  ok('…and none of them is the old generic one',
    ![...seenT.keys()].some((t) => /Digital Goods Marketplace/.test(t || '')));
}

console.log('— Titles and descriptions are the right shape —');
{
  const longT = [], longD = [], shortD = [];
  for (const r of ROUTES) {
    const h = htmlFor(r);
    if (!h) continue;
    const t = title(h) || '', d = desc(h) || '';
    // Past these lengths a search result truncates, and what gets cut is always
    // the end you cared about.
    if (t.length > 70) longT.push(`${r} (${t.length})`);
    if (d.length > 165) longD.push(`${r} (${d.length})`);
    if (d.length < 70) shortD.push(`${r} (${d.length})`);
  }
  ok('no title runs past ~70 characters', longT.length === 0, longT.join(', '));
  ok('no description runs past ~165 characters', longD.length === 0, longD.join(', '));
  ok('no description is a stub under 70 characters', shortD.length === 0, shortD.join(', '));
}

// ── Canonicals ──────────────────────────────────────────────────────────────
console.log('— Canonical URLs —');
{
  const bad = [];
  for (const r of ROUTES) {
    const h = htmlFor(r);
    if (!h) continue;
    const c = canonical(h);
    if (c !== canonicalFor(r)) bad.push(`${r} → ${c}`);
  }
  ok('every page points its canonical at itself', bad.length === 0, bad.join(', '));
  ok('canonicals are absolute and https',
    ROUTES.every((r) => (canonical(htmlFor(r)) || '').startsWith('https://')));

  // The Dutch URL and the English one are the same page. A canonical
  // consolidates them; two self-canonicals would have them compete.
  const aliasBad = Object.entries(ALIASES)
    .filter(([alias, target]) => canonical(htmlFor(alias)) !== `${SITE.url}${target}`);
  ok('a Dutch alias points at the page it duplicates', aliasBad.length === 0,
    aliasBad.map(([a]) => a).join(', '));

  // Exactly one. Two canonicals is the same as none.
  const twice = ROUTES.filter((r) => (htmlFor(r).match(/rel="canonical"/g) || []).length !== 1);
  ok('exactly one canonical per page', twice.length === 0, twice.join(', '));
}

// ── Open Graph and Twitter ──────────────────────────────────────────────────
console.log('— Link previews —');
{
  const missing = [];
  for (const r of ROUTES) {
    const h = htmlFor(r);
    for (const k of ['type', 'url', 'title', 'description', 'image', 'site_name']) {
      if (!ogv(h, k)) missing.push(`${r}:og:${k}`);
    }
    for (const k of ['card', 'title', 'description', 'image']) {
      if (!twv(h, k)) missing.push(`${r}:twitter:${k}`);
    }
  }
  ok('every page carries a full Open Graph and Twitter set', missing.length === 0,
    missing.slice(0, 6).join(', '));

  const home = htmlFor('/');
  ok('og:title matches the page title', ogv(home, 'title') === title(home));
  ok('og:url matches the canonical', ogv(home, 'url') === canonical(home));
  ok('the card type shows a large image', twv(home, 'card') === 'summary_large_image');
  ok('the social image is absolute', (ogv(home, 'image') || '').startsWith('https://'));
  ok('its dimensions are declared',
    /og:image:width" content="1200"/.test(home) && /og:image:height" content="630"/.test(home));

  // Duplicated tags are worse than missing ones: the scraper takes whichever it
  // reads first, and which that is depends on the scraper.
  const dupes = ROUTES.filter((r) => (htmlFor(r).match(/property="og:title"/g) || []).length !== 1);
  ok('no page has two og:title tags', dupes.length === 0, dupes.join(', '));
}

// ── Indexing ────────────────────────────────────────────────────────────────
console.log('— What should and should not be indexed —');
{
  for (const r of NOINDEX) {
    const h = htmlFor(r);
    if (!h) continue;
    ok(`${r} is noindex`, /name="robots" content="noindex/.test(h));
  }
  const wrong = ROUTES.filter((r) => !NOINDEX.has(r) && /name="robots" content="noindex/.test(htmlFor(r)));
  ok('nothing that should rank is accidentally noindexed', wrong.length === 0, wrong.join(', '));

  const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
  ok('robots.txt points at the sitemap', /Sitemap: https:\/\/forgemarket\.nl\/sitemap\.xml/.test(robots));
  ok('…allows the shop', /^Allow: \/$/m.test(robots));
  for (const p of ['/account', '/admin', '/checkout', '/api/']) {
    ok(`…disallows ${p}`, new RegExp(`^Disallow: ${p.replace('/', '\\/')}`, 'm').test(robots));
  }
  // Filters and referral links mint endless crawlable duplicates.
  ok('…and keeps crawlers off the query-string duplicates', /Disallow: \/\*\?ref=/.test(robots));
  /* ?category= joined them once every category the shop stocks in depth got a
     path of its own. It is the shop's own filter now, not an address. */
  ok('…including the category filter, now that categories have real paths',
    /Disallow: \/\*\?category=/.test(robots));
  // robots.txt asks a crawler not to LOOK; noindex tells it not to LIST. Both
  // are needed, and the file says why so nobody "tidies" one away.
  ok('…and explains why both robots.txt and noindex exist', /noindex/.test(robots));
}

// ── The focus keywords ──────────────────────────────────────────────────────
console.log('— Landing pages for what this shop sells —');
{
  /* The original five. Kept named here because they are the URLs that have
     been live and linked, and a rename would throw away whatever they have
     earned. */
  const want = ['/robux', '/v-bucks', '/valorant-points', '/giftcards', '/game-currency'];
  for (const r of want) ok(`${r} is still a real page at the same URL`, !!htmlFor(r));

  /* Every landing page, not just those five. There were five of these against
     twenty-one categories the shop stocks — sixteen categories, forty-six of
     the seventy-one products, had no address of their own and no way to rank
     for the thing they are. */
  ok('every category the shop stocks in depth has a page of its own',
    Object.keys(LANDING).length >= 20, String(Object.keys(LANDING).length));

  const untitled = Object.keys(LANDING).filter((r) => {
    const h = htmlFor(r);
    if (!h) return true;
    // The first word of the path has to appear in the title, or the page is
    // reachable at a URL that is not about what it says it is about.
    const first = r.slice(1).replace(/-/g, ' ').split(' ')[0];
    return !new RegExp(first, 'i').test(title(h) || '');
  });
  ok('…and each one is a real page whose title is about its own subject',
    untitled.length === 0, untitled.join(', '));

  // Distinct copy, or twenty pages compete with each other for one result.
  const titles = Object.keys(LANDING).map((r) => title(htmlFor(r)));
  ok('no two landing pages share a title', new Set(titles).size === titles.length);
  const descs = Object.keys(LANDING).map((r) => tag(htmlFor(r), /<meta name="description" content="([^"]*)"/));
  ok('nor a description', new Set(descs).size === descs.length);

  // A landing route must pin a category the products genuinely carry, or the
  // page ranks for a term and then shows an empty shelf.
  const catalog = readFileSync(join(ROOT, 'src/lib/sampleCatalog.js'), 'utf8');
  const bad = Object.entries(LANDING)
    .filter(([, def]) => def.category && !catalog.includes(`'${def.category}'`));
  ok('every landing category exists in the catalogue', bad.length === 0,
    bad.map(([r, d]) => `${r}→${d.category}`).join(', '));

  /* …and holds enough of it. One product is not a category; it is the product
     page again at a second URL, which is what a doorway page is. */
  const counts = {};
  for (const m of catalog.matchAll(/', '([a-z-]+)', \d/g)) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const thin = Object.entries(LANDING)
    .filter(([, def]) => def.category && (counts[def.category] || 0) < 2);
  ok('…with at least two products behind it', thin.length === 0,
    thin.map(([r, d]) => `${r}→${d.category}:${counts[d.category] || 0}`).join(', '));

  // Every entry needs the heading and the sentence the page renders, or the
  // page a visitor reads and the title a crawler reads drift apart.
  const incomplete = Object.entries(LANDING)
    .filter(([, d]) => !d.nl?.h1 || !d.nl?.sub || !d.en?.h1 || !d.en?.sub);
  ok('every landing page carries its own heading and its own line of prose',
    incomplete.length === 0, incomplete.map(([r]) => r).join(', '));

  // A page nothing links to is a page a crawler has to be told about twice.
  const footer = readFileSync(join(ROOT, 'src/components/store/StoreFooter.jsx'), 'utf8');
  ok('the five original ones are linked from the footer', want.every((r) => footer.includes(`'${r}'`)));

  /* The rest are linked from the homepage's category tiles. Those tiles used to
     point at `/shop?category=x` — a URL whose canonical is `/shop`, so the
     strongest page on the site spent all of its category link equity on one
     destination and the category pages received none of it. */
  const home = readFileSync(join(ROOT, 'src/pages/HomeStore.jsx'), 'utf8');
  ok('the homepage links categories to their own page, not to a query string',
    /landingPathFor\(/.test(home) && !/to=\{`\/shop\?category=/.test(home));

  /* And from every product page, which is where the depth is: seventy-one
     pages that all linked only to /shop. */
  const pdp = readFileSync(join(ROOT, 'src/pages/ProductDetail.jsx'), 'utf8');
  ok('a product page links up to its own category', /landingPathFor\(product\.category\)/.test(pdp));

  /* The catalogue page's own category navigation. It was twenty-one <button>s
     calling setCategory — a crawler cannot press a button, so the deepest
     navigation on the site was invisible to one. It was also broken for a
     visitor on a landing route: `category` reads landingCategory first, so on
     /robux the URL changed and the shelf did not. */
  const shop = readFileSync(join(ROOT, 'src/pages/Shop.jsx'), 'utf8');
  ok('the shop\u2019s category navigation is links a crawler can follow',
    /<Link key=\{c\} to=\{landingPathFor\(c\)\}/.test(shop));
  ok('\u2026and no longer a button that only rewrites a query string',
    !/setCategory\(c\)/.test(shop));

  // The helper must never hand out a link to a shelf that does not exist.
  ok('a category with no page of its own still gets a working link',
    landingPathFor('spotify') === '/shop?category=spotify');
  ok('and one with a page gets the page', landingPathFor('eafc') === '/fc-points');
  ok('and no category at all is the whole shop', landingPathFor('') === '/shop');
}

// ── Structured data ─────────────────────────────────────────────────────────
console.log('— schema.org —');
{
  const home = jsonld(htmlFor('/'));
  const types = home.map((d) => d['@type']);
  ok('the homepage declares the organisation', types.includes('OnlineStore'), types.join(','));
  ok('…and the website, with its search action',
    types.includes('WebSite') && !!home.find((d) => d['@type'] === 'WebSite')?.potentialAction);

  const org = home.find((d) => d['@type'] === 'OnlineStore');
  ok('the organisation has a stable @id other blocks can reference',
    org['@id'] === `${SITE.url}/#organization`);
  ok('…names the payment methods actually accepted', /iDEAL/.test(org.paymentAccepted || ''));
  // legalIdentity.js is still empty. An invented address in structured data is
  // exactly the kind of mismatch that earns a manual action, so it is left out
  // rather than filled with a placeholder.
  ok('…and omits the address rather than inventing one',
    !org.address || (!!org.address.streetAddress && !!org.address.addressLocality));

  const shop = jsonld(htmlFor('/shop'));
  ok('inner pages carry a breadcrumb',
    shop.some((d) => d['@type'] === 'BreadcrumbList'));
  // canonicalFor('/') is `https://forgemarket.nl/` — with the slash — so the
  // breadcrumb's first item is too. Consistency matters more than which one.
  ok('…that starts at the homepage',
    shop.find((d) => d['@type'] === 'BreadcrumbList').itemListElement[0].item === canonicalFor('/'));

  ok('every JSON-LD block on every page parses',
    ROUTES.every((r) => {
      const raw = [...htmlFor(r).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      return raw.every((m) => { try { JSON.parse(m[1]); return true; } catch { return false; } });
    }));
}

console.log('— Product markup —');
{
  // Stock is asserted from the shop's own honest flags. Claiming InStock for
  // something that has to be bought in first is the most common way a merchant
  // loses rich results, and it would contradict the page's own delivery copy.
  const inStock = productLd({ id: 'p1', name: 'A', price: 1000, currency: 'EUR', instant: true });
  const toOrder = productLd({ id: 'p2', name: 'B', price: 1000, currency: 'EUR', instant: false, stockLeft: 0 });
  ok('an in-stock product says InStock', inStock.offers.availability.endsWith('InStock'));
  ok('a made-to-order product does not', toOrder.offers.availability.endsWith('PreOrder'));
  ok('the price is a decimal string, not cents', inStock.offers.price === '10.00');
  ok('the return policy links to the refund page',
    inStock.offers.hasMerchantReturnPolicy.merchantReturnLink.endsWith('/refunds'));

  // schema.org will happily accept an aggregate rating with nothing behind it.
  // Google treats that as spam, and this shop has spent several rounds removing
  // exactly that kind of claim.
  ok('no rating is asserted without reviews', !inStock.aggregateRating);
  const rated = productLd({ id: 'p3', name: 'C', price: 500 }, { reviewCount: 4, ratingValue: 4.75 });
  ok('a rating appears once reviews exist', rated.aggregateRating.reviewCount === 4);
  ok('…rounded to one decimal', rated.aggregateRating.ratingValue === '4.8');

  const seo = readFileSync(join(ROOT, 'server/src/routes/seo.js'), 'utf8');
  ok('product pages are rendered by the server, not left to JavaScript',
    /router\.get\('\/product\/:id'/.test(seo));
  ok('…and are cached at the edge so the function runs rarely',
    /s-maxage=\d+.*stale-while-revalidate/.test(seo));
  ok('…with the template tags replaced rather than appended',
    /og:\[\^"\]\*"\[\^>\]\*>\/g|drop/.test(seo) && /for \(const re of drop\)/.test(seo));

  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  ok('…and routed there by vercel.json',
    vercel.rewrites.some((r) => r.source.startsWith('/product/') && r.destination === '/api'));
  // Filesystem beats rewrites on Vercel, so the prerendered files win over the
  // SPA fallback. If the fallback were listed first this would all be dead.
  ok('the SPA fallback is last, so the prerendered files win',
    vercel.rewrites[vercel.rewrites.length - 1].destination === '/index.html');
}

// ── Sitemap ─────────────────────────────────────────────────────────────────
console.log('— Sitemap —');
{
  const src = readFileSync(join(ROOT, 'server/src/routes/catalog.js'), 'utf8');
  const listed = [...src.matchAll(/\['(\/[a-z-]*)', '[\d.]+', '\w+'\]/g)].map((m) => m[1]);
  /* The landing pages are no longer typed out here. They were, in parallel with
     the list in src/content/seo.js — which is how five pages could exist, five
     be listed, and sixteen categories have neither. The sitemap now maps over
     the same object, filtered to categories the catalogue genuinely stocks. */
  ok('the sitemap reads the landing pages rather than repeating them',
    /Object\.entries\(LANDING\)/.test(src));
  ok('…and only lists a category page the catalogue can actually fill',
    /perCategory\[String\(def\.category\)\.toLowerCase\(\)\] \|\| 0\) >= 2/.test(src));
  const shouldList = Object.keys(PAGES).filter((r) => !NOINDEX.has(r) && r !== '/');
  const absent = shouldList.filter((r) => !listed.includes(r));
  ok('every indexable page is in the sitemap', absent.length === 0, absent.join(', '));
  ok('nothing noindexed is in the sitemap',
    ![...NOINDEX].some((r) => listed.includes(r)), [...NOINDEX].filter((r) => listed.includes(r)).join(', '));
  ok('products carry a lastmod so a price change is re-crawled',
    /lastmod.*updated_at|mod: p\.updated_at/.test(src));
  ok('entries declare how often they change', /changefreq/.test(src));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} seo: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
