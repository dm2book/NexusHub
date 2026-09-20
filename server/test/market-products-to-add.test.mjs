/**
 * "Products to Add", end to end: observations in, a ranked table out.
 *
 * The pure arithmetic is covered in market-opportunity.test.mjs. This is about
 * the parts that only exist once there is a database and an HTTP request:
 *
 *   · only candidates this shop does NOT already sell are proposed;
 *   · the three sorts the admin offers actually re-order the table, and an
 *     unknown margin sorts LAST in "highest margin" rather than first;
 *   · the endpoint is staff-only and read-only — no route here can add a
 *     product to the catalogue;
 *   · and the report says WHY it is thin, because an empty table has four
 *     different causes and they need four different actions.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
import { sha256 } from '../src/utils/crypto.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { recordObservation } = await import('../src/services/market/observations.js');
const { runDiscovery } = await import('../src/services/market/discovery.js');
const { productsToAdd, evidenceState } = await import('../src/services/market/opportunity.js');
const { createProduct } = await import('../src/services/productService.js');
const { requestEmailOtp } = await import('../src/services/authService.js');
const { run, get, all } = await import('../src/db/index.js');

const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

// ── Staff session, the same way the admin gets one ────────────────────────
const email = 'mohamedelhannouti51@gmail.com';
await requestEmailOtp(email, {});
const row = await get(
  `SELECT id FROM otp_codes WHERE email=@e AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  { e: email });
await run(`UPDATE otp_codes SET code_hash=@h WHERE id=@id`, { h: sha256('654321'), id: row.id });
const login = await (await fetch(`${base}/api/auth/otp/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, code: '654321' }) })).json();
const auth = { authorization: `Bearer ${login.accessToken}` };
ok('staff signs in', !!login.accessToken);

// ── Something this shop already sells, so discovery can tell them apart ───
await createProduct({ name: '1,000 Robux', category: 'robux', price: 999, announce: false });

/* Three marketplaces carrying a product we do NOT sell, and one carrying the
   product we do. Every observation is real in the sense that matters here: it
   has a source, a URL and a timestamp, which is what the table refuses to
   store without. */
const seen = async (source, title, cents, id) => recordObservation(source, {
  title, priceCents: cents, currency: 'EUR', availability: 'in_stock',
  url: `https://example.test/${source}/${encodeURIComponent(title)}`,
  sourceProductId: id, observedAt: new Date().toISOString(),
});

await seen('manual', '2,000 Robux', 1799, 'a1');
await seen('manual', '2,000 Robux', 1899, 'a2');
await seen('manual', '2,000 Robux', 1999, 'a3');
await seen('manual', '5,000 V-Bucks', 2299, 'b1');
await seen('manual', '1,000 Robux', 999, 'c1');

await runDiscovery();

console.log('\n— Only things we do not already sell are proposed —');
{
  const report = await productsToAdd({ limit: 100 });
  const names = report.products.map((p) => p.name);
  ok('the table has candidates', report.products.length > 0, String(report.products.length));
  ok('the product we already sell is not proposed',
    !report.products.some((p) => /^1,000 Robux$/.test(String(p.name))), names.join(' | '));
  ok('every row carries the numbers the brief asks for',
    report.products.every((p) => 'lowEur' in p && 'meanEur' in p && 'highEur' in p
      && 'offerCount' in p && 'competition' in p && 'margin' in p && 'revenue' in p
      && 'grade' in p));
  ok('and every row is graded', report.products.every(
    (p) => ['high', 'medium', 'low', 'unrated'].includes(p.grade)));
  ok('the counts add up to the rows',
    Object.values(report.counts).reduce((a, b) => a + b, 0) === report.products.length,
    JSON.stringify(report.counts));
}

console.log('\n— The three sorts actually sort —');
{
  const byComp = await productsToAdd({ sort: 'competition', limit: 100 });
  const scores = byComp.products.map((p) => p.competition.score ?? Infinity);
  ok('lowest competition first',
    scores.every((s, i) => i === 0 || scores[i - 1] <= s), scores.join(','));

  const byRev = await productsToAdd({ sort: 'revenue', limit: 100 });
  const rev = byRev.products.map((p) => p.revenue.score ?? -1);
  ok('highest opportunity first', rev.every((s, i) => i === 0 || rev[i - 1] >= s), rev.join(','));

  const byMargin = await productsToAdd({ sort: 'margin', limit: 100 });
  ok('with no cost anywhere, no row claims a margin',
    byMargin.products.every((p) => p.margin.marginPct == null));
}

console.log('\n— A cost price turns the margin on, and only then —');
{
  /* Two products in the same category with BOTH a cost price and an observed
     market low. One is an anecdote; two is a basis — so this is the smallest
     amount of evidence the engine will accept, and it is built here rather
     than assumed. */
  const { costCentsFromMetadata } = await import('../src/services/costService.js');
  /* Built in one pass, then linked once.
     Doing it per product ran discovery again each time, and discovery
     re-classifies every candidate — so the second run cleared the link the
     first had just been given, and only ever one ratio formed. */
  const mk = async (name, priceCents, costCents, seenCents) => {
    const p = await createProduct({ name, category: 'robux', price: priceCents, announce: false,
      metadata: { cost: costCents } });
    /* The market product's id comes back from the observation. Matching on the
       title instead found nothing: market_products stores the CANONICAL title
       ("Roblox 3,000 robux"), not the name a human typed. */
    const { marketProductId } = await seen('manual', name, seenCents, `cost-${name}`);
    return { product: p, marketProductId };
  };
  const a = await mk('3,000 Robux', 2899, 1900, 2400);
  const b = await mk('7,500 Robux', 5999, 3900, 4900);
  await runDiscovery();
  /* Whatever discovery could not match confidently is linked by hand here —
     which is the same thing the admin does when it resolves a needs_review. */
  for (const { product, marketProductId } of [a, b]) {
    await run(`UPDATE market_candidates SET forge_product_id=@f WHERE market_product_id=@m`,
      { f: product.id, m: marketProductId });
  }
  ok('the two comparables really do carry a cost',
    costCentsFromMetadata(JSON.parse((await get('SELECT metadata FROM products WHERE id=@i', { i: a.product.id })).metadata)) === 1900
    && costCentsFromMetadata(JSON.parse((await get('SELECT metadata FROM products WHERE id=@i', { i: b.product.id })).metadata)) === 3900);

  const { catalogueCostRatios } = await import('../src/services/market/opportunity.js');
  const ratios = await catalogueCostRatios();
  /* Keyed by the CANONICAL game ('roblox'), not this shop's own category name
     ('robux'). Grouping by one and looking up by the other is the bug this
     assertion exists to hold shut: it found nothing every time, and every
     margin came back unknown with a plausible reason attached. */
  ok('a cost-to-market ratio is derived from this shop\'s own books',
    (ratios.get('roblox') || []).length >= 2, JSON.stringify([...ratios]));
  ok('…keyed the way the market model names the game, not the way we file it',
    ratios.has('roblox') && !ratios.has('robux'), JSON.stringify([...ratios.keys()]));

  const byMargin = await productsToAdd({ sort: 'margin', limit: 100 });
  const known = byMargin.products.filter((p) => p.margin.marginPct != null);
  ok('candidates in that category now carry a margin', known.length > 0,
    JSON.stringify(byMargin.products.map((p) => [p.name, p.margin.marginPct])));
  ok('…labelled as derived from the catalogue rather than assumed',
    known.every((p) => p.margin.basis === 'derived'));

  const firstUnknown = byMargin.products.findIndex((p) => p.margin.marginPct == null);
  ok('a known margin outranks an unknown one',
    firstUnknown === -1 || firstUnknown === known.length,
    `${known.length} known, first unknown at ${firstUnknown}`);
}

console.log('\n— Filtering by grade —');
{
  const all100 = await productsToAdd({ limit: 100 });
  const g = all100.products[0]?.grade;
  if (g) {
    const only = await productsToAdd({ grade: g, limit: 100 });
    ok(`filtering to ${g} returns only ${g}`, only.products.every((p) => p.grade === g));
  } else ok('filtering to a grade returns only that grade', true);
}

console.log('\n— The endpoint —');
{
  const r = await fetch(`${base}/api/admin/market/opportunities?sort=margin`, { headers: auth });
  const body = await r.json();
  ok('staff can read it', r.status === 200, String(r.status));
  ok('it returns the ranked table', Array.isArray(body.products));
  ok('…with the evidence state beside it', !!body.evidence && Array.isArray(body.evidence.blockers));

  const anon = await fetch(`${base}/api/admin/market/opportunities`);
  ok('a stranger cannot', anon.status === 401 || anon.status === 403, String(anon.status));

  const bad = await fetch(`${base}/api/admin/market/opportunities?sort=nonsense`, { headers: auth });
  ok('a bad sort is refused rather than silently ignored', bad.status === 400, String(bad.status));
}

console.log('\n— Nothing here adds a product —');
{
  const before = (await all(`SELECT id FROM products`)).length;
  await fetch(`${base}/api/admin/market/opportunities?sort=revenue`, { headers: auth });
  await productsToAdd({ limit: 100 });
  const after = (await all(`SELECT id FROM products`)).length;
  ok('reading the report creates no catalogue products', before === after, `${before} → ${after}`);
}

console.log('\n— An empty or thin report says why —');
{
  const ev = await evidenceState();
  ok('it counts what evidence exists',
    typeof ev.observations === 'number' && typeof ev.productsWithCost === 'number');
  ok('no cost prices anywhere is named as a blocker',
    ev.productsWithCost > 0 || ev.blockers.some((b) => /cost price/.test(b)),
    JSON.stringify(ev.blockers));
  ok('…and so is having no live source',
    ev.sourcesLive > 0 || ev.blockers.some((b) => /source is switched on/.test(b)));
  ok('the four marketplaces are named as needing their own credentials',
    ev.sourcesLive > 0 || ev.blockers.some((b) => /Eneba, G2A, Kinguin and Eldorado/.test(b)));
}

srv.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} market-products-to-add: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
