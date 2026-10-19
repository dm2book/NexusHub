/**
 * The market jobs stop at the maintenance run's deadline by themselves, and a
 * pass that stopped early is resumed instead of being started over.
 *
 * Seen live right after per-step time limits shipped: every traffic-triggered
 * run ended with "marketError: market: stopped after 15.5 s (step time limit)".
 * Pricing walked every market product with no deadline, was cut off from the
 * outside, so it never reached its "done" mark — the next run started from the
 * top and was cut off again. The market data stopped refreshing.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_market_budget';
process.env.NODE_ENV ||= 'development';

import fs from 'node:fs';

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const OBS = await import('../src/services/market/observations.js');
const E = await import('../src/services/market/engine.js');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}  ${x}`); }
};

// A handful of market products, each with one observation.
const titles = ['Roblox 800 Robux PC Global', 'Roblox 1700 Robux PC Global', 'Roblox 4500 Robux PC Global',
  'Roblox 10000 Robux PC Global', 'Roblox 22500 Robux PC Global', 'Roblox 400 Robux PC Global'];
for (const [i, title] of titles.entries()) {
  await OBS.recordObservation('manual', { title, priceCents: 500 + i * 100, currency: 'EUR',
    url: `https://example.test/${encodeURIComponent(title)}`, availability: 'in_stock', observedAt: nowIso(),
    sourceProductId: `sp-${i}` });
}
const products = await all(`SELECT DISTINCT market_product_id AS id FROM market_observations`);
const lastPricedAt = async () => (await get(`SELECT value FROM kv WHERE key='market.job.pricing'`))?.value || null;
const pricedIds = async () => (await all(`SELECT DISTINCT market_product_id AS id FROM market_price_recommendations`)).map((r) => r.id);

console.log('— A pass with no time left —');
{
  await run(`DELETE FROM kv WHERE key='market.job.pricing'`);
  const r = await E.refreshRecommendations({ force: true, deadline: Date.now() + 500 });
  ok('it stops by itself and says it is partial', r.partial === true && r.priced === 0, JSON.stringify(r));
  ok('…and is NOT marked done, so the next run picks it up', (await lastPricedAt()) === null, String(await lastPricedAt()));
}

console.log('\n— A partial pass makes progress, the next one continues —');
{
  // Price exactly two products, then stop (deadline reached after two).
  let calls = 0;
  const realNow = Date.now;
  const start = realNow();
  Date.now = () => (calls >= 2 ? start + 10_000 : start);
  const before = new Set(await pricedIds());
  const orig = E.refreshRecommendations;
  // Count products priced via the recommendations table growing.
  const r1 = await (async () => {
    const watcher = setInterval(async () => { calls = (await pricedIds()).length; }, 5);
    try { return await orig({ force: true, deadline: start + 5_000 }); } finally { clearInterval(watcher); Date.now = realNow; }
  })();
  const afterFirst = new Set(await pricedIds());
  ok('the first, cut-short pass priced some but not all products',
    r1.partial === true && afterFirst.size > before.size && afterFirst.size < products.length,
    `${JSON.stringify(r1)} priced=${afterFirst.size}/${products.length}`);

  const r2 = await E.refreshRecommendations({ force: true, deadline: Date.now() + 60_000 });
  const afterSecond = new Set(await pricedIds());
  ok('the next pass prices the ones the first never reached, and finishes',
    !r2.partial && afterSecond.size === products.length, `${JSON.stringify(r2)} priced=${afterSecond.size}/${products.length}`);
  ok('…and only a complete pass is marked done', (await lastPricedAt()) !== null);
}

console.log('\n— Without a deadline nothing changes —');
{
  const r = await E.refreshRecommendations({ force: true });
  ok('a pass without a deadline prices everything', !r.partial && r.priced === products.length, JSON.stringify(r));
}

console.log('\n— The maintenance run hands its deadline to the market jobs —');
{
  const src = fs.readFileSync(new URL('../src/services/maintenanceService.js', import.meta.url), 'utf8');
  ok('discovery gets the deadline', /runProductDiscovery\(\{ deadline: marketDeadline \}\)/.test(src));
  ok('pricing gets the deadline', /refreshRecommendations\(\{ deadline: marketDeadline \}\)/.test(src));
  /* Seen live: with a 0.5 s margin the step was still cut off at 15.2 s,
     because one item takes several ~0.7 s round trips. */
  const margin = Number((src.match(/MARKET_MARGIN_MS = ([\d_]+)/) || [])[1]?.replace(/_/g, ''));
  ok('…with a margin of several seconds before the step limit', margin >= 3_000, String(margin));
  /* Seen live: with the market jobs finishing, failover (after them) was the
     step that ran out of budget. It is cheap and protects orders: it goes first. */
  ok('supplier failover runs before the market jobs',
    src.indexOf("step('failover'") > 0 && src.indexOf("step('failover'") < src.indexOf("step('market'"));
}

console.log(`\n${fail ? '❌' : '✅'} market-step-budget: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
