/**
 * Growth → Product Opportunities.
 *
 * Products ForgeMarket does not sell yet that the marketplaces do, graded HIGH,
 * MEDIUM or LOW. What these check is mostly where a scanner like this lies:
 *
 *   "supplier available" must mean a supplier the shop CONNECTED, in stock —
 *   not "somebody on G2A sells it";
 *   the margin must be after 21% BTW, and against a named cost basis or none;
 *   buying at a marketplace's retail price and reselling at the market median
 *   loses money, and the grade has to say so instead of calling it a chance;
 *   a product the shop already sells is not an opportunity;
 *   a marketplace that cannot be read is reported as such, not as "no offers".
 */
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
const { config } = await import('../src/config/env.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const opp = await import('../src/services/market/opportunity.js');
const { recordObservation } = await import('../src/services/market/observations.js');

const obs = (source_key, cents, availability = 'in_stock', extra = {}) =>
  ({ source_key, price_eur_cents: cents, availability, observed_at: nowIso(), url: `https://${source_key}.test/x`, ...extra });

console.log('\n— "Supplier available" means YOUR supplier, in stock —');
{
  const none = opp.supplierOffer([obs('kinguin', 900)], []);
  ok('with no supplier connected, nothing is available', !none.available && /no supplier connected/.test(none.reason));

  const sup = [{ kind: 'kinguin', name: 'Kinguin' }];
  const got = opp.supplierOffer([obs('g2a', 800), obs('kinguin', 900)], sup);
  /* G2A is cheaper, and irrelevant: the shop cannot buy there. */
  ok('the price is the one at your supplier, not a cheaper stranger', got.available && got.costEur === 9
    && got.supplierName === 'Kinguin', JSON.stringify(got));

  const out = opp.supplierOffer([obs('kinguin', 900, 'out_of_stock')], sup);
  ok('a listing out of stock is not available', !out.available && /not in stock/.test(out.reason), out.reason);

  const elsewhere = opp.supplierOffer([obs('eneba', 700)], sup);
  ok('…and one only on other marketplaces says which suppliers were checked',
    !elsewhere.available && /Kinguin/.test(elsewhere.reason), elsewhere.reason);

  ok('the marketplaces a product is on are listed', JSON.stringify(opp.marketplacesOf(
    [obs('kinguin', 1), obs('g2a', 1), obs('kinguin', 2), obs('official', 1, 'in_stock', { is_official: 1 })]))
    === '["g2a","kinguin"]');
}

console.log('\n— The margin is after BTW, against a named basis —');
{
  const stats = { lowCents: 1000, medianCents: 2050, competitorCount: 4, sourceCount: 4, inStockCount: 4 };
  const supplier = { available: true, costEur: 10, supplierName: 'Kinguin' };
  const basis = opp.costBasisFor(stats, { catalogueRatios: [0.5, 0.6], cfg: { ...config.market, assumedCostRatio: 0.4 }, supplier });
  ok('your supplier\'s price beats every estimate', basis.basis === 'supplier' && basis.costEur === 10, JSON.stringify(basis));
  ok('without one, the catalogue ratio is used and named', opp.costBasisFor(stats, { catalogueRatios: [0.5, 0.6] }).basis === 'derived');
  ok('with nothing at all, the margin is unknown — not guessed',
    opp.costBasisFor(stats, { cfg: { ...config.market, assumedCostRatio: null } }).basis === 'none');

  const sup = [{ kind: 'kinguin', name: 'Kinguin' }];
  const observations = [obs('kinguin', 1000), obs('g2a', 2000), obs('eneba', 2100), obs('eldorado', 2200)];
  const before = opp.assessOpportunity({ observations, suppliers: sup, cfg: { ...config.market, vatPercent: 0 } });
  const after = opp.assessOpportunity({ observations, suppliers: sup, cfg: { ...config.market, vatPercent: 21 } });
  ok('21% BTW lowers the margin it reports', after.margin.marginPct < before.margin.marginPct,
    `${before.margin.marginPct} → ${after.margin.marginPct}`);
}

console.log('\n— A game the shop already sells is recognised; an unknown one stays itself —');
{
  const { parseTitle } = await import('../src/services/market/normalize.js');
  /* Found writing this test: every Apex, Genshin, Free Fire… listing parsed as
     game "unknown", was shown as "unknown 2,150", and shared a key — and so a
     price list — with every other unknown product of the same amount. */
  for (const [title, game] of [['Apex Legends 2150 Coins', 'apex-legends'], ['Clash Royale 500 Gems', 'clash-royale'],
    ['Genshin Impact 6480 Genesis Crystals', 'genshin-impact'], ['Free Fire 1080 Diamonds', 'free-fire'],
    ['PUBG Mobile 660 UC', 'pubg-mobile'], ['Mobile Legends 1155 Diamonds', 'mobile-legends'],
    ['League of Legends 1380 RP', 'league-of-legends'], ['GTA Online Whale Shark Card', 'gta-online']]) {
    ok(`"${title}" is ${game}`, parseTitle(title).game === game, parseTitle(title).game);
  }
  const a = parseTitle('Marvel Rivals 2150 Lattice');
  const b = parseTitle('Some Other Game 2150 Gems');
  ok('two unknown games with the same amount are not one product', a.canonicalKey !== b.canonicalKey);
  ok('…and an unknown game keeps the seller\'s own name', a.title === 'Marvel Rivals 2150 Lattice', a.title);
}

console.log('\n— Against the catalogue, through the admin page —');
const sup = newId('sup');
await run(`INSERT INTO suppliers (id, name, connector_kind, status, config, created_at, updated_at)
           VALUES (@id, 'Kinguin', 'kinguin', 'active', '{}', @at, @at)`, { id: sup, at: nowIso() });

/* Every observation is a real-shaped one: four marketplaces, a URL and a time. */
async function product(title, prices, { status = 'discovered' } = {}) {
  let mp = null;
  for (const [source, cents, availability = 'in_stock'] of prices) {
    const r = await recordObservation(source, { title, priceCents: cents, currency: 'EUR',
      url: `https://${source}.test/${encodeURIComponent(title)}`, availability });
    mp = r.marketProductId;
  }
  await run(`INSERT INTO market_candidates (id, market_product_id, status, created_at, updated_at)
             VALUES (@id, @mp, @st, @at, @at)`, { id: newId('mkc'), mp, st: status, at: nowIso() });
  return mp;
}

/* HIGH: your supplier has it well under what the market charges. */
await product('Valorant 2050 VP EU', [['kinguin', 1000], ['g2a', 2000], ['eneba', 2100], ['eldorado', 2200]]);
/* LOW: your supplier charges about what the market does — a loss after BTW. */
await product('Apex Legends 2150 Coins', [['kinguin', 1900], ['g2a', 1950], ['eneba', 2000], ['eldorado', 2050]]);
/* MEDIUM: widely sold, but no supplier of yours carries it — margin unknown. */
await product('Clash Royale 500 Gems', [['g2a', 500], ['eneba', 520], ['eldorado', 540]]);
/* Already sold here: not an opportunity. */
await product('Roblox 800 Robux Card', [['g2a', 900], ['eneba', 950], ['eldorado', 990]], { status: 'product_created' });

const id = newId('usr');
await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'Owner', @at, @at)`,
  { id, e: `opp-${Date.now()}@test.local`, at: nowIso() });
await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`,
  { u: id, at: nowIso() });
const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id }), {});
const srv = createApp().listen(0);
const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/admin/market/opportunity-scan`,
  { headers: { authorization: `Bearer ${accessToken}` } });
const body = await res.json();
const anon = await fetch(`http://127.0.0.1:${srv.address().port}/api/admin/market/opportunity-scan`);
srv.close();

{
  ok('the page answers', res.status === 200, JSON.stringify(body).slice(0, 200));
  ok('…and only for staff', anon.status === 401);
  ok('all four marketplaces are listed', JSON.stringify(body.marketplaces.map((m) => m.key)) === '["kinguin","g2a","eneba","eldorado"]');
  /* No MARKET_SOURCES in tests: each must say it could not be read, not vanish. */
  ok('a marketplace that cannot be read says so', body.marketplaces.every((m) => m.status !== 'available' && m.reason),
    JSON.stringify(body.marketplaces));

  const all = [...body.groups.high, ...body.groups.medium, ...body.groups.low];
  const row = (t) => all.find((r) => r.name && r.name.toLowerCase().includes(t));
  const vp = row('valorant');
  ok('a product with a cheap supplier and four sellers is HIGH', body.groups.high.some((r) => r === vp || r.name === vp?.name),
    JSON.stringify({ grade: vp?.grade, reasons: vp?.gradeReasons }));
  ok('…showing the average market price', vp?.meanEur === 18.25, String(vp?.meanEur));
  ok('…the number of competitors and marketplaces', vp?.offerCount === 4 && vp?.sourceCount === 4);
  ok('…the margin, from your supplier', vp?.margin.basis === 'supplier' && vp.margin.marginPct > 12,
    JSON.stringify(vp?.margin));
  ok('…the supplier', vp?.supplier.available && vp.supplier.supplierName === 'Kinguin');
  ok('…and an opportunity score', Number.isFinite(vp?.revenue.score) && vp.revenue.score >= 0 && vp.revenue.score <= 100);
  ok('…and its category, by name', vp?.categoryLabel === 'Valorant', String(vp?.categoryLabel));
  /* The screen must not say "nothing can be HIGH" above a HIGH row. */
  ok('with a supplier connected, the page does not claim nothing can be HIGH',
    !(body.evidence?.blockers || []).some((b) => /nothing can be graded HIGH/.test(b)),
    JSON.stringify(body.evidence?.blockers));

  const apex = row('apex');
  ok('buying at your supplier at market price is LOW — a loss after BTW', apex?.grade === 'low'
    && apex.margin.marginPct < 0, JSON.stringify(apex?.margin));

  const clash = row('clash');
  ok('widely sold with no supplier of yours is MEDIUM at best', clash?.grade === 'medium', clash?.grade);
  ok('…with the margin unknown, not invented', clash?.margin.marginPct == null);
  ok('…and the supplier says why not', !clash?.supplier.available && /Kinguin/.test(clash?.supplier.reason || ''));

  ok('a product the shop already sells is not listed', !row('roblox'));
  ok('the counts add up', body.counts.high === body.groups.high.length
    && body.counts.medium === body.groups.medium.length && body.counts.low === body.groups.low.length);
}

console.log(`\n${fail ? '❌' : '✅'} product-opportunities: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
