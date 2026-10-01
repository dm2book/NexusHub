/**
 * Ad Intelligence: per advert and per platform — views, clicks, CTR, checkout
 * starts, purchases, revenue, profit — and the winner, the loser, the highest
 * CTR, revenue and profit.
 *
 * What it must not do:
 *   call revenue minus spend "profit" — BTW and the goods come out first;
 *   invent a profit where a product has no cost entered;
 *   crown a winner on too little traffic, or the only advert there is;
 *   give the highest-CTR badge to one click on one view;
 *   drop a platform that has no data, or a tagged click it cannot place;
 *   keep counting a sale that was refunded.
 */
import './_selling-shop.mjs';   // must come first — see that file
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { netCents, planningVat } = await import('../src/services/vatService.js');
const { createProduct } = await import('../src/services/productService.js');
const { recordVisit, recordEvent } = await import('../src/services/attributionService.js');
const { recordSpend } = await import('../src/services/adPerformanceService.js');
const intel = await import('../src/services/adIntelligenceService.js');

const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);
const vat = planningVat();

console.log('\n— Before any advert has run —');
{
  const r = await intel.adIntelligence({ days: 30 });
  ok('all five platforms are listed, each saying it has no data',
    JSON.stringify(r.platforms.map((p) => p.key)) === '["tiktok","instagram","facebook","discord","youtube"]'
    && r.platforms.every((p) => p.status === 'no data'), JSON.stringify(r.platforms.map((p) => p.status)));
  ok('no winner, no loser — and each says why',
    r.highlights.winner.creative === null && r.highlights.loser.creative === null && !!r.highlights.winner.reason);
  ok('no highest CTR, revenue or profit is made up',
    ['highestCtr', 'highestRevenue', 'highestProfit'].every((k) => r.highlights[k].creative === null && r.highlights[k].reason));
  ok('views and clicks are "not recorded", not zero',
    r.funnel[0].count === null && r.funnel[1].count === null && r.funnel[2].count === 0);
  ok('no profit total', r.totals.profitCents === null);
}

/* Two products: one with a cost, one without. */
const P = async (name, price, cost) => {
  const p = await createProduct({ name, sku: `AI-${name.replace(/\W+/g, '')}-${stamp}`, category: 'robux',
    price, currency: 'EUR', active: true, announce: false });
  if (cost != null) await run(`UPDATE products SET metadata=@m WHERE id=@id`, { id: p.id, m: JSON.stringify({ cost }) });
  return p;
};
const costed = await P('Costed 20', 2000, 1000);
const loose = await P('Uncosted 50', 5000, null);

let seq = 0;
/** n arrivals on one tagged link; the first `checkouts` start a checkout, the first `buys` pay. */
async function advert(query, { visits, checkouts = 0, buys = 0, product = costed }) {
  const orders = [];
  for (let i = 0; i < visits; i++) {
    const v = await recordVisit({ sessionId: `s-${stamp}-${++seq}`, query, path: '/' });
    if (i < checkouts) await recordEvent({ visitId: v.id, kind: 'checkout' });
    if (i < buys) {
      const id = newId('ord');
      await run(`INSERT INTO orders (id, number, email, status, currency, subtotal, total, billing, ad_visit_id, created_at, updated_at)
                 VALUES (@id, @num, @e, 'completed', 'EUR', @t, @t, '{}', @v, @at, @at)`,
        { id, num: `AI-${stamp}-${seq}`, e: `b${seq}@x.dev`, t: product.price, v: v.id, at: nowIso() });
      await run(`INSERT INTO order_items (id, order_id, product_id, name, quantity, unit_price) VALUES (@id, @o, @p, @n, 1, @u)`,
        { id: newId('oi'), o: id, p: product.id, n: product.name, u: product.price });
      orders.push(id);
    }
  }
  return orders;
}

const tiktok = await advert({ utm_source: 'tiktok', utm_campaign: 'launch', utm_content: 'hookA' }, { visits: 40, checkouts: 10, buys: 6 });
await advert({ utm_source: 'instagram', utm_campaign: 'launch', utm_content: 'reelB' }, { visits: 40, checkouts: 4, buys: 2 });
await advert({ utm_source: 'youtube', utm_campaign: 'launch', utm_content: 'shortC' }, { visits: 40, checkouts: 5, buys: 3 });
await advert({ utm_source: 'discord', utm_campaign: 'server', utm_content: 'postD' }, { visits: 10, checkouts: 2, buys: 1, product: loose });
await advert({ fbclid: 'x', utm_campaign: 'launch', utm_content: 'metaE' }, { visits: 2 });   // Instagram or Facebook? unknown

/* What the platforms reported, as the owner would enter it. */
await recordSpend({ day: today, network: 'tiktok', campaign: 'launch', creative: 'hookA', impressions: 10_000, clicks: 400, spendCents: 3000 });
await recordSpend({ day: today, network: 'instagram', campaign: 'launch', creative: 'reelB', impressions: 5000, clicks: 100, spendCents: 3000 });
await recordSpend({ day: today, network: 'youtube', campaign: 'launch', creative: 'shortC', impressions: 20_000, clicks: 1000, spendCents: 2000 });
await recordSpend({ day: today, network: 'facebook', campaign: 'launch', impressions: 50, spendCents: 500 });   // no creative, no landings

const r = await intel.adIntelligence({ days: 30 });
const ad = (c) => r.creatives.find((x) => x.creative === c);
const plat = (k) => r.platforms.find((p) => p.key === k);
const per20 = netCents(2000, vat.rate) - 1000;     // what one €20 sale leaves after BTW and the goods

console.log('\n— Per advert: the seven numbers —');
{
  const a = ad('hookA');
  ok('views — the platform\'s impressions', a.impressions === 10_000);
  ok('clicks — the platform\'s, beside the landings the shop measured', a.platformClicks === 400 && a.visits === 40);
  ok('CTR', a.ctr === 4, String(a.ctr));
  ok('checkout starts', a.checkouts === 10);
  ok('purchases', a.purchases === 6);
  ok('revenue', a.revenueCents === 12_000);
  ok('profit: after 21% BTW, the goods and the spend', a.profitCents === 6 * per20 - 3000 && vat.pct === 21,
    `${a.profitCents} vs ${6 * per20 - 3000}`);
  ok('…which is not revenue minus spend', a.profitCents !== 12_000 - 3000);
  const b = ad('reelB');
  ok('an advert that earns less than it costs shows a loss', b.profitCents === 2 * per20 - 3000 && b.profitCents < 0, String(b.profitCents));
  const d = ad('postD');
  ok('a product with no cost entered: profit unknown, and says why', d.profitCents === null && /no cost entered/.test(d.profitBasis), d.profitBasis);
}

console.log('\n— The five answers —');
{
  const h = r.highlights;
  ok('winner: the best return among adverts with enough traffic', h.winner.creative === 'hookA' && /median/.test(h.winner.gradeReason),
    JSON.stringify(h.winner));
  ok('loser: the worst', h.loser.creative === 'reelB', JSON.stringify(h.loser));
  ok('highest CTR', h.highestCtr.creative === 'shortC' && h.highestCtr.value === 5, JSON.stringify(h.highestCtr));
  ok('highest revenue', h.highestRevenue.creative === 'hookA' && h.highestRevenue.value === 12_000);
  ok('highest profit', h.highestProfit.creative === 'hookA' && h.highestProfit.value === 6 * per20 - 3000);
  ok('the Discord post, with 10 landings, is not graded', ad('postD').grade === 'unrated');

  const tiny = intel.highlights([{ creative: 'x', impressions: 1, ctr: 100, revenueCents: 0, profitCents: null, grade: 'unrated', gradeReason: 'too few' }]);
  ok('one click on one view does not win highest CTR', tiny.highestCtr.creative === null && /100\+ views/.test(tiny.highestCtr.reason));
  ok('…and a lone advert is not the winner', tiny.winner.creative === null && tiny.winner.reason === 'too few');
}

console.log('\n— Per platform —');
{
  ok('TikTok', plat('tiktok').purchases === 6 && plat('tiktok').ctr === 4 && plat('tiktok').status === 'measured');
  ok('Instagram and Facebook are separate platforms', plat('instagram').purchases === 2 && plat('facebook').purchases === 0);
  ok('Facebook\'s spend counts even with no advert to put it on', plat('facebook').spendCents === 500
    && plat('facebook').status === 'no tagged arrivals' && plat('facebook').profitCents === -500, JSON.stringify(plat('facebook')));
  ok('Discord: measured, profit unknown without a cost', plat('discord').visits === 10 && plat('discord').profitCents === null);
  ok('YouTube', plat('youtube').revenueCents === 6000 && plat('youtube').ctr === 5);
  ok('a bare Facebook click id is kept, as "other" — not guessed into Instagram or Facebook',
    r.other?.visits === 2 && plat('instagram').visits === 40 && plat('facebook').visits === 0);
}

console.log('\n— The funnel —');
{
  const f = Object.fromEntries(r.funnel.map((s) => [s.key, s.count]));
  ok('views, from the platforms', f.views === 35_050, String(f.views));
  ok('clicks, from the platforms', f.clicks === 1500);
  ok('landings, checkout starts and purchases, measured here',
    f.landings === 132 && f.checkouts === 21 && f.purchases === 12, JSON.stringify(f));
}

console.log('\n— A refund leaves the report —');
{
  await run(`UPDATE orders SET status='refunded' WHERE id=@id`, { id: tiktok[0] });
  const after = await intel.adIntelligence({ days: 30 });
  const a = after.creatives.find((x) => x.creative === 'hookA');
  ok('one purchase fewer, its revenue and its profit gone',
    a.purchases === 5 && a.revenueCents === 10_000 && a.profitCents === 5 * per20 - 3000);
  /* hookA's 3.33× is now within 25% of the 3× median: no winner — and the card
     says THAT, not the unrelated "10 landings" of the Discord post. */
  ok('with no clear winner, the reason is about the adverts that were compared',
    after.highlights.winner.creative === null && /3 advert\(s\) compared on roas/.test(after.highlights.winner.reason),
    after.highlights.winner.reason);
}

console.log('\n— Admin —');
{
  const owner = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`,
    { id: owner, e: `o-${stamp}@x.dev`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
  const srv = createApp().listen(0);
  const url = `http://127.0.0.1:${srv.address().port}/api/admin/analytics/ads/intelligence`;
  const res = await fetch(`${url}?days=30`, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  ok('the page answers', res.status === 200 && body.platforms.length === 5 && !!body.highlights.winner);
  ok('…and only for staff', (await fetch(url)).status === 401);
  ok('a bad period falls back instead of failing',
    (await fetch(`${url}?days=nonsense`, { headers: { authorization: `Bearer ${accessToken}` } })).status === 200);
  srv.close();

  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  ok('Growth → Ad Intelligence is in the admin menu', /growth\/ads.*Ad Intelligence/.test(read('src/layouts/AdminLayout.jsx')));
  const page = read('src/pages/admin/AdIntelligence.jsx');
  ok('the page charts per platform and the funnel', /<Bars rows=\{rows/.test(page) && /data\.funnel\.map/.test(page));
  ok('…and over time, per advert', /<AdPerformance/.test(page));
  ok('every platform is offered when recording spend',
    ['tiktok', 'instagram', 'facebook', 'youtube', 'discord'].every((n) => read('src/components/admin/AdPerformance.jsx').includes(`'${n}'`)));
}

console.log(`\n${fail ? '❌' : '✅'} ad-intelligence: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
