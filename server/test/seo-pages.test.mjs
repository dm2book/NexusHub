/**
 * SEO pages generated from the catalogue: game, gift-card brand, platform and
 * gift-budget pages, each with title, meta description, FAQ, schema and links.
 *
 * What must hold:
 *   a page only where the catalogue has depth (2+ products; 4+ for a budget);
 *   titles ≤ 60 and descriptions ≤ 155 characters, cut at a word;
 *   no claim without data — no "cheapest", "instant", stars or search volume;
 *   the payment methods named are the ones the shop takes, joined with "or";
 *   the FAQPage schema is exactly the FAQ on the page;
 *   a gift card never talks about "price per 1,000";
 *   hand-written landing pages keep their path; links point at real pages;
 *   the server writes title, canonical and schema into the HTML;
 *   product pages no longer claim iDEAL when the shop does not take it.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
process.env.PAY_TIKKIE ||= 'https://tikkie.me/pay/test';
process.env.PAY_PAYPAL ||= 'https://paypal.me/test';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const S = await import('../../src/lib/seoCatalog.js');
const P = (id, name, price, category) => ({ id, name, price, category, active: true, metadata: {} });
const catalogue = [
  P('r1', '1.700 Robux', 1999, 'robux'), P('r2', '4.500 Robux', 4999, 'robux'),
  P('f1', '2,800 FC Points PlayStation', 2299, 'eafc'), P('f2', '2,800 FC Points Xbox', 2399, 'eafc'), P('f3', '1,050 FC Points PlayStation', 899, 'eafc'),
  P('s1', 'Steam Wallet €10', 1199, 'giftcard'), P('s2', 'Steam Wallet €25', 2699, 'giftcard'),
  P('n1', 'Netflix €15 NL', 1599, 'giftcard'),                 // one Netflix card: no Netflix page
  P('x1', 'Xbox €15 NL', 1599, 'giftcard'),
  P('v1', '475 Valorant Points EU', 499, 'valorant'),          // one: no Valorant page
];
const pages = S.buildSeoPages(catalogue, { landing: { robux: '/robux' }, payMethods: ['Tikkie', 'PayPal'] });
const by = (path) => pages.find((p) => p.path === path);

console.log('— Which pages exist —');
ok('Robux keeps its hand-written landing path', by('/robux')?.handWritten === true);
ok('EA FC gets a generated game page', !!by('/games/eafc'));
ok('Steam gets a gift-card page (2 cards)', !!by('/giftcards/steam'));
ok('Netflix does NOT (one card is a product page, not a category)', !by('/giftcards/netflix'));
ok('Valorant does NOT (one product)', !by('/games/valorant'));
ok('a PlayStation platform page (2 PlayStation FC packs)', by('/platform/playstation')?.products.length === 2);
ok('an Xbox platform page: Xbox FC pack + Xbox store card', by('/platform/xbox')?.products.length === 2);
ok('a gift-budget page only with 4+ products under the cap', !!by('/cadeau/onder-25-euro') && !by('/cadeau/onder-10-euro'));

console.log('\n— Every page is complete and honest —');
const all = pages.flatMap((p) => S.SEO_LANGS.flatMap((l) => [p.copy[l].title, p.copy[l].description, p.copy[l].intro, ...p.faq[l].flatMap((f) => [f.q, f.a])])).join('\n');
for (const p of pages) {
  for (const l of S.SEO_LANGS) {
    if (p.copy[l].title.length > 60 || p.copy[l].description.length > 155) {
      ok(`${p.path} ${l}: title ≤ 60 and description ≤ 155`, false, `${p.copy[l].title.length}/${p.copy[l].description.length}`);
    }
  }
}
ok('every title ≤ 60 and description ≤ 155, in all four languages', pages.every((p) => S.SEO_LANGS.every((l) => p.copy[l].title.length <= 60 && p.copy[l].description.length <= 155)));
ok('every page has an FAQ of 4+ questions in every language', pages.every((p) => S.SEO_LANGS.every((l) => p.faq[l].length >= 4)));
ok('no unproven claim (cheapest / instant / stars / search volume)',
  !/goedkoopst|cheapest|billigst|moins cher|instant|direct geleverd|sofort geliefert|\d(?:[.,]\d)?\s*\/\s*5|sterren|stars|zoekvolume|search volume/i.test(all));
ok('payment methods are the ones passed in, joined with "or"', /Tikkie of PayPal/.test(all) && /Tikkie or PayPal/.test(all) && !/iDEAL/.test(all));
ok('a gift card never mentions the price per 1,000', !S.SEO_LANGS.some((l) => by('/giftcards/steam').faq[l].some((f) => /1[.,\s]000/.test(f.a))));
ok('a game page does', by('/games/eafc').faq.nl.some((f) => /per 1\.000/.test(f.a)));
ok('a platform page says it only works on that platform', by('/platform/playstation').faq.nl.some((f) => /alleen op PlayStation/.test(f.a)));
ok('an account top-up says it never needs the password', by('/robux').faq.nl.some((f) => /nooit je wachtwoord/.test(f.a)));
ok('a gift card says the code comes by email', by('/giftcards/steam').faq.nl.some((f) => /code per e-mail/.test(f.a)));
ok('gift-card copy carries the amounts as people search them ("10 en 25 euro")', /10 en 25 euro/.test(by('/giftcards/steam').copy.nl.intro));

console.log('\n— Schema and links —');
{
  const ld = S.schemaFor(by('/giftcards/steam'), 'nl');
  const faq = ld.find((d) => d['@type'] === 'FAQPage');
  ok('FAQPage schema is exactly the FAQ on the page', JSON.stringify(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]))
    === JSON.stringify(by('/giftcards/steam').faq.nl.map((f) => [f.q, f.a])));
  ok('ItemList lists every product with its URL', ld.find((d) => d['@type'] === 'CollectionPage').mainEntity.itemListElement.length === 2);
  ok('BreadcrumbList Home → Shop → page', ld.find((d) => d['@type'] === 'BreadcrumbList').itemListElement.length === 3);
  ok('no aggregateRating anywhere (no reviews behind it)', !JSON.stringify(ld).includes('aggregateRating'));
  const paths = new Set(pages.map((p) => p.path));
  ok('every internal link points at a page that exists', pages.every((p) => p.links.every((l) => paths.has(l.path))));
  ok('the EA FC page links to the PlayStation and Xbox platform pages', ['/platform/playstation', '/platform/xbox'].every((x) => by('/games/eafc').links.some((l) => l.path === x)));
}

console.log('\n— Missing keywords —');
{
  const miss = S.missingKeywords(pages, catalogue).map((k) => k.keyword);
  ok('Netflix (one card, no page) is reported as missing', miss.some((k) => k.startsWith('netflix')));
  ok('Steam 25 euro is answered by the Steam page', !miss.includes('steam 25 euro'), miss.join(', '));
}

console.log('\n— Server: the head is in the HTML —');
{
  const { createApp, ensureReady } = await import('../src/app.js');
  await ensureReady();
  const { createProduct } = await import('../src/services/productService.js');
  const tag = Date.now().toString(36);
  await createProduct({ name: `Steam Wallet €10 ${tag}`, category: 'giftcard', price: 1199, announce: false });
  await createProduct({ name: `Steam Wallet €50 ${tag}`, category: 'giftcard', price: 5299, announce: false });
  const svc = await import('../src/services/seoPageService.js');
  await svc.seoPages({ fresh: true });
  const app = createApp(); const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const html = await (await fetch(`${base}/giftcards/steam`)).text();
  const shellBuilt = /<div id="root"/.test(html);
  if (shellBuilt) {
    ok('title is written server-side', /<title>Steam giftcard kopen/.test(html), html.slice(0, 200));
    ok('canonical points at the page', /<link rel="canonical" href="[^"]+\/giftcards\/steam"/.test(html));
    ok('FAQPage and ItemList schema are in the HTML', /"@type":"FAQPage"/.test(html) && /"@type":"ItemList"/.test(html));
    ok('the page content is in the first-paint HTML for crawlers', /<h1>Steam giftcards<\/h1>/.test(html));
  } else ok('(app shell not built — skipping HTML checks)', true);
  const api = await (await fetch(`${base}/api/seo/page?path=/giftcards/steam&lang=de`)).json();
  ok('the page API answers in the language asked', /Guthaben/.test(api.page.copy.h1 + api.page.copy.intro), JSON.stringify(api.page?.copy));
  ok('an unknown page is a 404', (await fetch(`${base}/api/seo/page?path=/giftcards/nope`)).status === 404);
  const sm = await (await fetch(`${base}/sitemap.xml`)).text();
  ok('the sitemap lists the generated pages', /\/giftcards\/steam<\/loc>/.test(sm));
  ok('the admin report needs a login', (await fetch(`${base}/api/admin/seo/pages`)).status === 401);
  const r = await svc.seoReport();
  ok('the report ranks pages and shows the signals behind each score', r.pages.every((p) => Number.isFinite(p.priority) && 'market' in p.signals && 'sales' in p.signals));
  ok('…and says plainly there is no search-volume data', /No search-volume data/.test(r.note));
  srv.close();
}

console.log('\n— Product pages stop claiming iDEAL —');
{
  const { readFileSync } = await import('node:fs');
  const seo = readFileSync(new URL('../src/routes/seo.js', import.meta.url), 'utf8');
  ok('no hard-coded "Betaal met iDEAL" in product descriptions', !/Betaal met iDEAL/.test(seo) && /payMethodLabels\(\)/.test(seo));
}

console.log(`\n${fail ? '❌' : '✅'} seo-pages: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
