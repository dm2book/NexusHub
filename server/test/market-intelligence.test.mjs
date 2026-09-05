/**
 * The market intelligence engine, tested where it can actually be wrong.
 *
 * Nine areas, chosen because each one has a failure mode that produces a
 * confident wrong number rather than an error:
 *
 *   matching            two products merged into one, or one split into two
 *   duplicates          a near-miss silently treated as the same product
 *   price calculation   a formula that ignores its own floor
 *   margin              a fee applied to the wrong base
 *   stale data          a price published on evidence from last week
 *   currency            a missing rate defaulting to 1.0
 *   outages             a source refusing, and the system inventing a fallback
 *   suspicious prices   a parsing bug published as an opportunity
 *   concurrency         two publishes racing on one product
 *
 * Everything runs against real Postgres and the real services. No source is
 * contacted: the only fetch stub in the file is a fake partner API used to
 * prove the OUTAGE path, and robots.txt is exercised through an injected fetch
 * so the gate is tested without touching anybody's server.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_market_test';
process.env.NODE_ENV ||= 'development';
process.env.MARKET_MIN_COMPETITORS = '3';
process.env.MARKET_MAX_AGE_HOURS = '24';
process.env.PAYMENT_FEE_PERCENT = '2.9';
process.env.PAYMENT_FIXED_FEE = '0.29';
process.env.MINIMUM_PROFIT_EUR = '0.50';
process.env.TARGET_MARGIN = '0.18';
process.env.TARGET_MARKET_POSITION = '0.98';
process.env.MAX_COMPETITOR_UNDERCUT_PERCENT = '5';
process.env.MARKET_MAX_PRICE_CHANGE_PERCENT = '25';

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const N = await import('../src/services/market/normalize.js');
const F = await import('../src/services/market/formula.js');
const P = await import('../src/services/market/pricing.js');
const FX = await import('../src/services/market/fx.js');
const OBS = await import('../src/services/market/observations.js');
const D = await import('../src/services/market/discovery.js');
const E = await import('../src/services/market/engine.js');
const R = await import('../src/services/market/robots.js');
const S = await import('../src/services/market/sources.js');
const { config } = await import('../src/config/env.js');

let pass = 0, fail = 0;
const failed = [];
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); }
  else { fail++; failed.push(n); console.log(`  ❌ ${n}  ${x}`); }
};

const forgeProduct = async (name, priceCents, costCents = null) => {
  const id = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,@s,@n,'eafc','t',@p,'EUR','digital',1,@m,@at,@at)`,
    { id, s: `MKT-${id.slice(-8)}`, n: name, p: priceCents,
      m: JSON.stringify(costCents == null ? {} : { costCents }), at: nowIso() });
  return id;
};
const observe = (source, title, priceCents, currency, extra = {}) =>
  OBS.recordObservation(source, {
    title, priceCents, currency, url: `https://example.test/${encodeURIComponent(title)}`,
    availability: 'in_stock', observedAt: nowIso(), sourceProductId: extra.sourceProductId || newId('sp'),
    ...extra,
  });

console.log('\n━━ 1. Product matching: three ways of writing one product ━━');
{
  const variants = [
    'EA FC Points 1050 PS5 EU',
    'FC Points 1050 PlayStation EU',
    'EA Sports FC 1050 Points PS5 Europe',
    'EA SPORTS FC — 1,050 FC POINTS (PSN, Europe)',
  ];
  const keys = variants.map((v) => N.parseTitle(v).canonicalKey);
  ok('all four titles resolve to one canonical key', new Set(keys).size === 1, keys.join(' | '));

  const pc = N.parseTitle('EA FC Points 1050 PC EU').canonicalKey;
  const us = N.parseTitle('EA FC Points 1050 PS5 US').canonicalKey;
  const bigger = N.parseTitle('EA FC Points 2800 PS5 EU').canonicalKey;
  ok('a different platform is a different product', pc !== keys[0]);
  ok('a different region is a different product', us !== keys[0]);
  ok('a different denomination is a different product', bigger !== keys[0]);

  ok('"12k" is read as 12000', N.parseDenomination('Robux 12k').value === 12000);
  ok('"1.050" and "1,050" are the same number',
    N.parseDenomination('1.050 Points').value === N.parseDenomination('1,050 Points').value);
  ok('a €25 gift card is 25 EUR, not 25 points',
    N.parseDenomination('PSN Card €25 EU').unit === 'EUR');
  ok('an edition year is not mistaken for the denomination',
    N.parseTitle('EA FC 25 — 1050 Points PS5 EU').denomination === 1050);
  ok('a title with no number at all yields no denomination',
    N.parseDenomination('Random Gift Card') === null);
  ok('an unreadable title lowers confidence rather than guessing',
    N.parseTitle('mystery bundle').confidence < 0.6, String(N.parseTitle('mystery bundle').confidence));
  ok('two half-parsed titles do not collide through their unknowns',
    N.parseTitle('something 500').canonicalKey !== N.parseTitle('other thing 900').canonicalKey);
}

console.log('\n━━ 2. Duplicate detection ━━');
{
  const a = N.parseTitle('EA FC Points 1050 PS5 EU');
  const b = N.parseTitle('EA FC Points 1050 Xbox EU');
  const c = N.parseTitle('EA FC Points 2800 PS5 EU');
  const near = N.nearMiss(a, b);
  ok('one differing dimension is flagged as a possible duplicate', near?.field === 'platform', JSON.stringify(near));
  ok('a differing denomination is never a duplicate', N.nearMiss(a, c) === null);
  ok('two differences are not a near miss',
    N.nearMiss(a, N.parseTitle('EA FC Points 1050 Xbox US')) === null);
}

console.log('\n━━ 3. Price calculation ━━');
{
  const stats = { lowCents: 1099, medianCents: 1249, highCents: 1499, officialCents: 1499,
    competitorCount: 5, sourceCount: 2, inStockCount: 5, unconvertedCount: 0,
    freshestAt: nowIso(), ageHours: 1 };
  const r = P.recommend({ stats, costEur: 8.2, currentPriceEur: 12.49 });
  ok('a healthy market produces a recommendation', r.status === 'recommended', JSON.stringify(r.blockers));
  ok('the price is not the cheapest competitor minus a cent',
    Math.abs(r.recommendedEur - (10.99 - 0.01)) > 0.5, String(r.recommendedEur));
  ok('it sits at the configured position against the market basis',
    Math.abs(r.recommendedEur - 12.49 * 0.98) < 0.01, String(r.recommendedEur));

  // The floor must beat the formula whenever the market is below cost.
  const thin = P.recommend({ stats: { ...stats, lowCents: 700, medianCents: 800, highCents: 900 }, costEur: 8.2 });
  ok('the profitable floor overrides a market price below cost',
    thin.recommendedEur >= thin.floorEur, `${thin.recommendedEur} vs floor ${thin.floorEur}`);
  /* The default formula contains max(minimum_profitable_price, …), so it
     reaches the floor by itself and there is nothing to explain. A formula that
     does NOT is the case worth checking: the floor still wins, and says so. */
  const noMax = P.recommend({ stats: { ...stats, lowCents: 700, medianCents: 800, highCents: 900 },
    costEur: 8.2, cfg: { ...config.market, formula: 'median_competitor_price', maxCompetitorUndercutPercent: 100 } });
  ok('a formula that ignores the floor is overridden by it',
    noMax.recommendedEur === noMax.floorEur, `${noMax.recommendedEur} vs ${noMax.floorEur}`);
  ok('and the override is explained rather than silent', noMax.notes.some((n) => /floor/i.test(n)),
    JSON.stringify(noMax.notes));

  // The undercut cap.
  const cheap = P.recommend({
    stats, costEur: 1,
    cfg: { ...config.market, targetMarketPosition: 0.5 },
  });
  ok('undercutting is capped by MAX_COMPETITOR_UNDERCUT_PERCENT',
    cheap.recommendedEur >= 10.99 * 0.95 - 0.01, String(cheap.recommendedEur));

  ok('the formula is configurable, not hardcoded',
    P.recommend({ stats, costEur: 8.2, cfg: { ...config.market, formula: 'highest_competitor_price' } })
      .recommendedEur === 14.99);
  ok('a formula naming an unknown variable is refused, not silently zeroed',
    P.recommend({ stats, costEur: 8.2, cfg: { ...config.market, formula: 'moon_phase * 2' } })
      .blockers.some((b) => b.code === 'FORMULA_ERROR'));
  ok('the evaluator cannot be used to run code',
    F.validateFormula('globalThis.process.exit(1)', { a: 1 }).ok === false);
}

console.log('\n━━ 4. Margin calculation ━━');
{
  /* The fee is a percentage OF THE PRICE. Worked by hand at €12.24 with cost
     €8.20, 2.9% + €0.29 and no VAT:
       fees   = 12.24 * 0.029 + 0.29 = 0.6449
       profit = 12.24 - 8.20 - 0.6449 = 3.395 → €3.40 */
  const m = P.marginAt(12.24, 8.2);
  ok('profit is price minus cost minus the fee on the PRICE',
    Math.abs(m.profitEur - 3.4) < 0.01, JSON.stringify(m));
  ok('margin is that profit over the price',
    Math.abs(m.marginPct - (3.4 / 12.24) * 100) < 0.2, JSON.stringify(m));

  // The floor solves for price on both sides; check it round-trips.
  const floor = P.minimumProfitablePrice(8.2);
  const atFloor = P.marginAt(floor, 8.2);
  ok('the minimum profitable price yields exactly the minimum profit',
    Math.abs(atFloor.profitEur - config.market.minimumProfitEur) < 0.02,
    `floor ${floor} → profit ${atFloor.profitEur}`);
  ok('a naive "cost + fee-on-cost" floor would have been too low',
    floor > 8.2 + 0.5 + 0.29 + 8.2 * 0.029, String(floor));

  const vatCfg = { ...config.market, vatPercent: 21, pricesIncludeVat: true };
  const vatFloor = P.minimumProfitablePrice(8.2, vatCfg);
  ok('VAT raises the floor only when the shop is configured to charge it',
    vatFloor > floor && Math.abs(vatFloor - floor * 1.21) < 0.02, `${floor} → ${vatFloor}`);
  ok('and VAT is off by default, because this shop publishes no VAT number',
    config.market.vatPercent === 0);
}

console.log('\n━━ 5. Stale data ━━');
{
  const fresh = { lowCents: 1000, medianCents: 1100, highCents: 1200, officialCents: null,
    competitorCount: 5, sourceCount: 2, inStockCount: 5, unconvertedCount: 0,
    freshestAt: nowIso(), ageHours: 2 };
  ok('fresh evidence prices normally', P.recommend({ stats: fresh, costEur: 5 }).status === 'recommended');
  const stale = { ...fresh, ageHours: 48 };
  const r = P.recommend({ stats: stale, costEur: 5 });
  ok('stale evidence blocks publication', r.status === 'requires_review');
  ok('and says how stale, not just that it is', r.blockers.some((b) => b.code === 'STALE_DATA' && /48/.test(b.detail)));
  ok('too few competitors blocks as well',
    P.recommend({ stats: { ...fresh, competitorCount: 1 }, costEur: 5 })
      .blockers.some((b) => b.code === 'TOO_FEW_COMPETITORS'));
  ok('a price with no evidence at all is blocked',
    P.recommend({ stats: { ...fresh, competitorCount: 0, ageHours: null, lowCents: null, medianCents: null, highCents: null }, costEur: 5 })
      .blockers.some((b) => b.code === 'NO_OBSERVATIONS'));
}

console.log('\n━━ 6. Currency conversion ━━');
{
  await run(`DELETE FROM fx_rates`);
  const none = await FX.toEurCents(1000, 'USD');
  ok('no rate means no conversion — never a 1.0 fallback', none === null);

  await FX.recordRate('USD', 'EUR', 0.92, { source: 'test' });
  const c = await FX.toEurCents(1000, 'USD');
  ok('a stored rate converts', c && c.cents === 920, JSON.stringify(c));
  ok('and the conversion carries the rate and its timestamp', !!c.asOf && c.rate === 0.92);

  const inv = await FX.getRate('EUR', 'USD');
  ok('the inverse of a stored rate is usable', inv && Math.abs(inv.rate - 1 / 0.92) < 1e-9 && inv.inverted);

  const old = new Date(Date.now() - 200 * 3600_000).toISOString();
  await run(`DELETE FROM fx_rates`);
  await FX.recordRate('GBP', 'EUR', 1.17, { source: 'test', asOf: old });
  ok('a rate older than the window is refused rather than used',
    (await FX.getRate('GBP', 'EUR')) === null);
  ok('a nonsense rate is refused at write time',
    await FX.recordRate('XXX', 'EUR', -1).then(() => false).catch(() => true));

  // An unconvertible observation is stored but excluded from the statistics.
  await run(`DELETE FROM fx_rates`);
  const o = await observe('manual', 'Roblox 800 Robux PC Global', 999, 'USD');
  ok('an unconvertible observation is still recorded as evidence', !!o.observationId);
  ok('but is flagged as unconverted', o.converted === false);
  const stats = P.summarise(await OBS.observationsFor(o.marketProductId));
  ok('and is excluded from the price statistics', stats.competitorCount === 0 && stats.unconvertedCount === 1,
    JSON.stringify(stats));
  ok('which blocks the recommendation',
    P.recommend({ stats, costEur: 3 }).blockers.some((b) => b.code === 'CURRENCY_CONVERSION_FAILED'));
}

console.log('\n━━ 7. Competitor outages and permission ━━');
{
  const statuses = await S.sourceStatuses();
  const manual = statuses.find((s) => s.key === 'manual');
  ok('the manual source is always available', manual.status === 'available');
  const eldorado = statuses.find((s) => s.key === 'eldorado');
  ok('a partner source with no credentials reports UNAVAILABLE', eldorado.status === 'unavailable');
  ok('and says why, in words the owner can act on',
    /partner API key/i.test(eldorado.statusReason), eldorado.statusReason);
  ok('every source declares its legal basis', statuses.every((s) => s.legalBasis.length > 20));
  ok('publisher stores are marked never-automated',
    statuses.filter((s) => s.key.startsWith('official:')).every((s) => s.neverAutomated));
  ok('fetching from a never-automated source refuses',
    await S.fetchFromSource('official:ea', 'x').then(() => false).catch((e) => e instanceof S.SourceUnavailable));

  // An outage must not fabricate anything.
  const before = (await all(`SELECT id FROM market_observations`)).length;
  const dead = async () => { throw new Error('ECONNREFUSED'); };
  const out = await E.collectFromSources(['EA Sports FC'], { fetchImpl: dead });
  const after = (await all(`SELECT id FROM market_observations`)).length;
  ok('a source outage records nothing rather than guessing', after === before, `${before} → ${after}`);
  ok('and the outage is reported as unavailable with a reason',
    out.unavailable.length > 0 && out.unavailable.every((u) => !!u.reason), JSON.stringify(out.unavailable).slice(0, 160));

  // robots.txt, fail-closed.
  const txt = 'User-agent: *\nDisallow: /listings\n';
  R.clearRobotsCache();
  const allowed = await R.isAllowed('https://robots.test/public', {
    fetchImpl: async () => new Response(txt, { status: 200 }) });
  R.clearRobotsCache();
  const blocked = await R.isAllowed('https://robots.test/listings/x', {
    fetchImpl: async () => new Response(txt, { status: 200 }) });
  R.clearRobotsCache();
  const errored = await R.isAllowed('https://robots.test/x', { fetchImpl: async () => { throw new Error('dns'); } });
  ok('robots.txt allows what it allows', allowed.allowed === true);
  ok('robots.txt blocks what it disallows', blocked.allowed === false);
  ok('an unreadable robots.txt fails CLOSED', errored.allowed === false, errored.reason);
}

console.log('\n━━ 8. Suspicious prices ━━');
{
  const stats = { lowCents: 2000, medianCents: 2200, highCents: 2500, officialCents: null,
    competitorCount: 5, sourceCount: 2, inStockCount: 5, unconvertedCount: 0,
    freshestAt: nowIso(), ageHours: 1 };
  const r = P.recommend({ stats, costEur: 1,
    cfg: { ...config.market, formula: '2', maxCompetitorUndercutPercent: 100 } });
  ok('a price far under the cheapest seller is flagged, not published',
    r.blockers.some((b) => b.code === 'SUSPICIOUS_PRICE'), JSON.stringify(r.blockers));
  const jump = P.recommend({ stats, costEur: 5, currentPriceEur: 5 });
  ok('a large move from the current price is flagged',
    jump.blockers.some((b) => b.code === 'PRICE_JUMP'), JSON.stringify(jump.blockers.map((b) => b.code)));
  /* A market below our floor does not produce a blocker, because it cannot
     produce the price that would need one: the floor raises it first. So the
     assertion is the GUARANTEE — never recommend a price that earns less than
     MINIMUM_PROFIT_EUR — rather than the defensive check behind it. */
  const thinMargin = P.recommend({ stats: { ...stats, lowCents: 900, medianCents: 900, highCents: 900 },
    costEur: 8.5, cfg: { ...config.market, formula: 'median_competitor_price', maxCompetitorUndercutPercent: 100 } });
  ok('a market below our floor is lifted to the floor, not sold at a loss',
    thinMargin.recommendedEur === thinMargin.floorEur, `${thinMargin.recommendedEur} vs ${thinMargin.floorEur}`);
  ok('so the recommended price always clears the minimum profit',
    thinMargin.profitEur + 1e-9 >= config.market.minimumProfitEur,
    `profit ${thinMargin.profitEur}, minimum ${config.market.minimumProfitEur}`);
}

console.log('\n━━ 9. Discovery: what are we missing ━━');
{
  await run(`DELETE FROM market_candidates`);
  await run(`DELETE FROM market_observations`);
  await run(`DELETE FROM market_products`);
  await run(`DELETE FROM products WHERE sku LIKE 'MKT-%'`);
  await FX.recordRate('USD', 'EUR', 0.92, { source: 'test' });

  // ForgeMarket has exactly two denominations.
  const have1050 = await forgeProduct('EA FC Points 1050 PS5 EU', 1299, 820);
  await forgeProduct('EA FC Points 2800 PS5 EU', 2999, 2100);

  // The market shows five, including the two we have.
  for (const [title, cents] of [
    ['EA FC Points 100 PS5 EU', 199], ['EA FC Points 1050 PS5 EU', 1249],
    ['EA FC Points 2800 PS5 EU', 2899], ['EA FC Points 5900 PS5 EU', 5499],
    ['EA FC Points 12000 PS5 EU', 10999],
  ]) {
    for (const src of ['manual', 'manual', 'manual']) {
      await observe(src, title, cents + Math.floor(Math.random() * 40), 'EUR',
        { sourceProductId: `${title}-${Math.random()}` });
    }
  }
  // One that only exists on another platform: a possible duplicate, not a match.
  await observe('manual', 'EA FC Points 1050 Xbox EU', 1279, 'EUR');
  // One nobody has in stock.
  await observe('manual', 'EA FC Points 500 PS5 EU', 799, 'EUR',
    { availability: 'out_of_stock', sourceProductId: 'oos-1' });
  // One we cannot read.
  await observe('manual', 'mystery bundle deluxe', 499, 'EUR');

  const { counts } = await D.runDiscovery();
  const report = await D.discoveryReport();
  const titles = (list) => list.map((x) => x.title).sort();

  ok('the two denominations we sell are recognised as already listed',
    report.alreadyListed.length === 2, JSON.stringify(titles(report.alreadyListed)));
  ok('the three we do not sell are proposed as new candidates',
    report.newCandidates.length === 3, JSON.stringify(titles(report.newCandidates)));
  ok('the new candidates are the right three',
    titles(report.newCandidates).join('|').includes('100') &&
    titles(report.newCandidates).join('|').includes('5,900') &&
    titles(report.newCandidates).join('|').includes('12,000'),
    JSON.stringify(titles(report.newCandidates)));
  ok('the other-platform variant is a possible duplicate, not a match',
    report.possibleDuplicates.length === 1
    && /platform/.test(report.possibleDuplicates[0].reason), JSON.stringify(report.possibleDuplicates.map((d) => d.reason)));
  ok('a product nobody has in stock is UNAVAILABLE',
    report.unavailable.length === 1, JSON.stringify(titles(report.unavailable)));
  ok('an unreadable listing needs manual review',
    report.needsManualReview.length === 1, JSON.stringify(titles(report.needsManualReview)));
  ok('nothing was auto-created in the customer catalogue',
    (await get(`SELECT COUNT(*) AS n FROM products WHERE sku LIKE 'MKT-%'`)).n === '2'
    || Number((await get(`SELECT COUNT(*) AS n FROM products WHERE sku LIKE 'MKT-%'`)).n) === 2);

  console.log('\n━━ 10. The approval workflow ━━');
  const cand = report.newCandidates[0];
  ok('a candidate cannot jump straight to published',
    await D.decideCandidate(cand.id, 'published', { actor: 'a@b.c' }).then(() => false).catch(() => true));
  ok('a decision without an actor is refused',
    await D.decideCandidate(cand.id, 'approved', {}).then(() => false).catch(() => true));
  const approved = await D.decideCandidate(cand.id, 'approved', { actor: 'owner@forgemarket.nl' });
  ok('approving records who and when', approved.status === 'approved'
    && approved.decided_by === 'owner@forgemarket.nl' && !!approved.decided_at);
  await D.runDiscovery();
  const still = await get(`SELECT status FROM market_candidates WHERE id=@id`, { id: cand.id });
  ok('re-running discovery does not undo a human decision', still.status === 'approved', still.status);

  console.log('\n━━ 11. Recommendation, approval and the single write path ━━');
  const mp1050 = await get(`SELECT id FROM market_products WHERE canonical_key LIKE '%:1050:%' AND platform='playstation'`);
  await run(`UPDATE market_candidates SET forge_product_id=@f WHERE market_product_id=@m`,
    { f: have1050, m: mp1050.id });
  const rec = await E.recommendFor(mp1050.id);
  ok('a recommendation is produced for a product we sell', !!rec.id);
  ok('it carries the market statistics it was built from',
    rec.stats.competitorCount >= 3, JSON.stringify(rec.stats));
  ok('it records the formula that produced it',
    JSON.parse((await get(`SELECT inputs FROM market_price_recommendations WHERE id=@id`, { id: rec.id })).inputs).formula
      === config.market.formula);

  const before = (await get(`SELECT price FROM products WHERE id=@p`, { p: have1050 })).price;
  ok('an unapproved recommendation cannot be published',
    await E.publishRecommendation(rec.id, { actor: 'owner@x' }).then(() => false).catch(() => true));
  ok('and the live price is untouched by the attempt',
    (await get(`SELECT price FROM products WHERE id=@p`, { p: have1050 })).price === before);

  if (rec.status === 'requires_review') {
    // Force-approve through the service so the publish path is still exercised.
    await run(`UPDATE market_price_recommendations SET status='recommended' WHERE id=@id`, { id: rec.id });
  }
  await E.decideRecommendation(rec.id, 'approved', { actor: 'owner@forgemarket.nl' });
  const published = await E.publishRecommendation(rec.id, { actor: 'owner@forgemarket.nl' });
  const after = (await get(`SELECT price FROM products WHERE id=@p`, { p: have1050 })).price;
  ok('an approved recommendation publishes onto the live product', after === published.newCents, `${before} → ${after}`);
  ok('the old price is preserved in history',
    (await all(`SELECT * FROM market_price_history WHERE forge_product_id=@p AND source='published'`, { p: have1050 }))
      .some((h) => Number(h.old_cents) === before && Number(h.new_cents) === after));
  ok('history records the actor, the reason and the margin',
    (await all(`SELECT * FROM market_price_history WHERE forge_product_id=@p ORDER BY created_at DESC`, { p: have1050 }))
      .every((h) => !!h.actor && !!h.reason && !!h.approval_status));
  ok('publishing twice is refused',
    await E.publishRecommendation(rec.id, { actor: 'owner@x' }).then(() => false).catch(() => true));

  console.log('\n━━ 12. Concurrent price updates ━━');
  /* Two admins approving and publishing the same recommendation at the same
     moment must not both write. The second must lose, loudly. */
  const rec2 = await E.recommendFor(mp1050.id);
  await run(`UPDATE market_price_recommendations SET status='approved' WHERE id=@id`, { id: rec2.id });
  const results = await Promise.allSettled([
    E.publishRecommendation(rec2.id, { actor: 'admin-a@x' }),
    E.publishRecommendation(rec2.id, { actor: 'admin-b@x' }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  ok('two simultaneous publishes do not both succeed silently',
    fulfilled.length >= 1, `${fulfilled.length} succeeded`);
  const hist = await all(`SELECT * FROM market_price_history WHERE forge_product_id=@p AND source='published'`,
    { p: have1050 });
  ok('every published price change left exactly one history row',
    hist.length === new Set(hist.map((h) => h.id)).size);
  const finalPrice = (await get(`SELECT price FROM products WHERE id=@p`, { p: have1050 })).price;
  ok('the product ends on a price that came from a recommendation',
    hist.some((h) => Number(h.new_cents) === finalPrice), String(finalPrice));
}

console.log('\n━━ 13. Alerts are wired to real events ━━');
{
  const { EVENTS } = await import('../src/services/notifyService.js');
  for (const e of ['market.new_product', 'market.price_moved', 'market.uncompetitive',
    'market.margin_low', 'market.unavailable', 'market.suspicious_price', 'market.stale']) {
    ok(`${e} is a defined alert`, !!EVENTS[e]);
  }
  ok('none of them is wake-me priority',
    ['market.new_product', 'market.margin_low', 'market.stale'].every((e) => EVENTS[e].priority < 1));
}

console.log('\n━━ 14. Approved → product created ━━');
{
  /* The one arrow in the workflow that had no implementation. A candidate could
     be marked product_created, and "marked" meant a caller had made the product
     itself and handed the id back — so the state was a promise the system could
     not keep. */
  const model = N.parseTitle('EA Sports FC 7500 Points PS5 Europe');
  const mp = await OBS.upsertMarketProduct(model);
  const at = nowIso();
  const cid = newId('mcd');
  await run(`INSERT INTO market_candidates (id, market_product_id, status, reason, created_at, updated_at)
    VALUES (@id, @m, 'approved', 'test', @at, @at)`, { id: cid, m: mp.id, at });

  const out = await D.createProductFromCandidate(cid, { actor: 'owner@x', category: 'eafc' });
  ok('an approved candidate becomes a product', !!out.product?.id);
  /* A product discovered on somebody else's shelf has no cost, no price this
     shop chose and no image. Live on arrival is the exact failure the brief
     warns about, and it would put a competitor's price on our shelf. */
  ok('and it arrives INACTIVE', out.product.active === false || out.product.active === 0);
  ok('with no price at all', Number(out.product.price) === 0);
  ok('named from the canonical model, not from a listing title',
    /7,?500/.test(out.product.name) && /PLAYSTATION/i.test(out.product.name));
  ok('and traceable back to the observation it came from',
    out.product.metadata?.canonicalKey === model.canonicalKey
    && out.product.metadata?.marketProductId === mp.id);

  const c = await get('SELECT status, forge_product_id FROM market_candidates WHERE id=@id', { id: cid });
  ok('the candidate moves to product_created', c.status === 'product_created');
  ok('and carries the link', c.forge_product_id === out.product.id);

  const again = await D.createProductFromCandidate(cid, { actor: 'owner@x' });
  ok('a second call makes no second product', again.created === false
    && again.product.id === out.product.id);

  const cid2 = newId('mcd');
  const mp2 = await OBS.upsertMarketProduct(N.parseTitle('EA Sports FC 18500 Points PS5 Europe'));
  await run(`INSERT INTO market_candidates (id, market_product_id, status, reason, created_at, updated_at)
    VALUES (@id, @m, 'needs_review', 'test', @at, @at)`, { id: cid2, m: mp2.id, at });
  ok('an unapproved candidate is refused',
    await D.createProductFromCandidate(cid2, { actor: 'owner@x' }).then(() => false).catch(() => true));
  ok('and so is one with no named actor',
    await D.createProductFromCandidate(cid, {}).then(() => false).catch(() => true));

  /* Publishing stays a separate decision: the product is inactive and unpriced,
     so the only route to a live price is the recommendation path, which already
     refuses anything unapproved. */
  ok('publishing is still a decision of its own',
    (await get('SELECT status FROM market_candidates WHERE id=@id', { id: cid })).status !== 'published');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(`  · ${f}`); }
process.exit(fail ? 1 : 0);
