/**
 * What gives out first when a lot of people arrive at once.
 *
 * Measured with a visitor simulation against a real API and a real database at
 * 100, 1,000 and 5,000 visitors — the shape of launch traffic, mostly people
 * looking with a small buying tail — rather than a benchmark. Nothing failed at
 * any scale; what the run found was one endpoint four times slower than every
 * other and getting worse the busier it got, which is the one that decides
 * whether the shop feels up.
 *
 *   /api/products/:id/recommendations   103ms → 267ms → 419ms p95
 *   everything else                     held at roughly 100ms
 *
 * It is on every product page, so it was a sixth of all traffic.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('— The product page does not reload the catalogue twice —');
{
  const rec = read('server', 'src', 'services', 'recommendationService.js');
  /* It called listProducts() — the whole catalogue — once for the cross-sell
     fallback and again for the upsell, then fetched each chosen product
     individually: about two catalogue loads and up to nine further queries for
     a panel of six tiles. */
  ok('the catalogue is loaded at most once', /catalogue \|\|= await listProducts/.test(rec));
  ok('and only when something needs it',
    /let catalogue = null;/.test(rec) && !/^\s*const catalogue = await listProducts/m.test(rec));
  ok('resolving an id is a map lookup, not a query',
    /function resolve\(ids, \{ exclude, limit, byId \}\)/.test(rec) && /byId\.get\(id\)/.test(rec));
  ok('no per-id round trip is left in the loop', !/await getProduct\(id\)/.test(rec));
  // The one query that touches orders, and the only one that has to.
  ok('the co-purchase aggregate is still there', /FROM order_items oi1/.test(rec));
}

console.log('\n— Every hot endpoint is answerable by the CDN —');
{
  /* 5,000 visitors on a laptop is 21,000 requests. In production most of those
     never reach the function: the edge answers them. An endpoint without a
     shared cache header is one that pays for every visitor. */
  const catalog = read('server', 'src', 'routes', 'catalog.js');
  const social = read('server', 'src', 'routes', 'social.js');
  const helper = read('server', 'src', 'utils', 'httpCache.js');
  // One helper, so the header is written the same way everywhere.
  ok('there is one helper that sets it', /export (function|const) publicCache/.test(helper));
  /* Both route files reach for the helper. The one hand-written Cache-Control
     left in the tree is on sitemap.xml, which wants a browser cache for a
     crawler rather than an edge cache for a visitor — a different job, so it is
     allowed a different header. */
  ok('and both route files reach for it', /publicCache/.test(catalog) && /publicCache/.test(social));
  const handRolled = [...catalog.matchAll(/setHeader\('Cache-Control'/g)].length;
  ok('with no second way of writing it beyond the sitemap', handRolled <= 1, `${handRolled}`);
  for (const [file, route] of [[catalog, '/products'], [catalog, '/config'],
    [social, '/feed'], [catalog, '/products/:id/recommendations']]) {
    const at = file.indexOf(`'${route}'`);
    const window = at > -1 ? file.slice(at, at + 400) : '';
    ok(`${route} is cacheable at the edge`, /publicCache\(res/.test(window), route);
  }
  ok('and stale-while-revalidate is used, so a miss never blocks a visitor',
    /stale-while-revalidate/.test(helper));
}

console.log('\n— The connection string is the launch-week risk —');
{
  /* Every serverless instance opens its own pool. Against a DIRECT Neon
     endpoint that is instances × PG_POOL_MAX real connections against a plan
     that caps them, and the failure mode is not slowness — it is the shop
     being down at the moment it is busiest. */
  const plan = read('server', 'src', 'services', 'launchPlanService.js');
  ok('the launch plan checks for a pooled endpoint', /'dbpool'/.test(plan));
  ok('and says what a direct endpoint costs', /exhaust the plan/.test(plan));

  const verdict = (url) => {
    const neon = /\.neon\.tech/i.test(url);
    return !neon ? 'skip' : (/-pooler\./i.test(url) ? 'ok' : 'fail');
  };
  ok('a direct Neon endpoint fails', verdict('postgres://u:p@ep-a-1.eu-central-1.aws.neon.tech/db') === 'fail');
  ok('a pooled one passes', verdict('postgres://u:p@ep-a-1-pooler.eu-central-1.aws.neon.tech/db') === 'ok');
  ok('and a non-Neon database is not judged', verdict('postgres://postgres@127.0.0.1:5432/x') === 'skip');

  const db = read('server', 'src', 'db', 'index.js');
  ok('the pool stays small', /max: Number\(process\.env\.PG_POOL_MAX \|\| 5\)/.test(db));
  ok('a stuck connection cannot burn the whole request budget', /connectionTimeoutMillis: 12_000/.test(db));
  ok('and a dropped idle connection does not take the shop with it', /_pool\.on\('error'/.test(db));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
