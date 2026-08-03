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

const { PAGES, LANDING, ALIASES, NOINDEX, SITE, metaFor, canonicalFor, productLd, faqLd } =
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
  // robots.txt asks a crawler not to LOOK; noindex tells it not to LIST. Both
  // are needed, and the file says why so nobody "tidies" one away.
  ok('…and explains why both robots.txt and noindex exist', /noindex/.test(robots));
}

// ── The focus keywords ──────────────────────────────────────────────────────
console.log('— Landing pages for what this shop sells —');
{
  const want = ['/robux', '/v-bucks', '/valorant-points', '/giftcards', '/game-currency'];
  for (const r of want) {
    const h = htmlFor(r);
    ok(`${r} is a real page`, !!h);
    if (!h) continue;
    const term = r.slice(1).replace(/-/g, ' ');
    ok(`…and its title is about ${term}`,
      new RegExp(term.split(' ')[0], 'i').test(title(h) || ''), title(h));
  }

  // A landing route must pin a category the products genuinely carry, or the
  // page ranks for a term and then shows an empty shelf.
  const catalog = readFileSync(join(ROOT, 'src/lib/sampleCatalog.js'), 'utf8');
  const bad = Object.entries(LANDING)
    .filter(([, def]) => def.category && !catalog.includes(`'${def.category}'`));
  ok('every landing category exists in the catalogue', bad.length === 0,
    bad.map(([r, d]) => `${r}→${d.category}`).join(', '));

  // A page nothing links to is a page a crawler has to be told about twice.
  const footer = readFileSync(join(ROOT, 'src/components/store/StoreFooter.jsx'), 'utf8');
  ok('they are linked from the footer', want.every((r) => footer.includes(`'${r}'`)));
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
  const shouldList = [...Object.keys(PAGES), ...Object.keys(LANDING)]
    .filter((r) => !NOINDEX.has(r) && r !== '/');
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
