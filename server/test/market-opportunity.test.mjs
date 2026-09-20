/**
 * Products to add, and the discipline about what may be claimed.
 *
 * The engine's whole job is to say which of the things other marketplaces sell
 * are worth selling here. Three of the five numbers a person wants from it —
 * margin, revenue, grade — cannot be computed from observations alone, and the
 * failure mode of a tool like this is to produce them anyway.
 *
 * So most of these assertions are about refusal:
 *
 *   · a margin needs a COST, and this shop has none on any product. It comes
 *     back null with a reason, and never as a number derived from treating a
 *     competitor's retail price as wholesale.
 *   · a revenue figure needs demand, and demand means this shop's own orders.
 *     With no orders the score falls back to how widely the market carries the
 *     product, and says so.
 *   · HIGH is capped behind a known margin. Grading something a high
 *     opportunity without knowing whether it can be sold at a profit is the
 *     exact confident-wrongness this subsystem exists to avoid.
 *
 * The arithmetic is tested through the pure functions, so every number in the
 * admin table can be checked without a database.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

import {
  assessOpportunity, competitionPressure, costBasisFor, likelyPrice,
  revenueOpportunity, gradeOpportunity, GRADE,
} from '../src/services/market/opportunity.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const CFG = {
  minCompetitors: 3, minimumMarginPercent: 6, vatPercent: 0, pricesIncludeVat: true,
  paymentFeePercent: 2.9, paymentFixedFee: 0.35, fulfillmentCostEur: 0, sourceCostPercent: 0,
  marketBasis: 'median', targetMarketPosition: 0.98, assumedCostRatio: null,
};

/** An observation shaped the way the table stores one. */
const obs = (eurCents, { source = 's1', id = null, stock = 'in_stock', official = 0, at = null } = {}) => ({
  price_eur_cents: eurCents, source_key: source, source_product_id: id,
  availability: stock, is_official: official,
  observed_at: at || new Date().toISOString(),
});

const CANDIDATE = {
  id: 'mkc_1', market_product_id: 'mkp_1', title: '1,000 Robux',
  game: 'robux', platform: 'any', region: 'eu', product_type: 'currency',
};

console.log('\n— The prices come straight off the observations —');
{
  const a = assessOpportunity({
    candidate: CANDIDATE, cfg: CFG,
    observations: [obs(899, { source: 'g2a' }), obs(1099, { source: 'kinguin' }), obs(999, { source: 'eneba' })],
  });
  ok('lowest is the lowest', a.lowEur === 8.99, String(a.lowEur));
  ok('highest is the highest', a.highEur === 10.99, String(a.highEur));
  ok('average is the mean of the three', a.meanEur === 9.99, String(a.meanEur));
  ok('offers are counted', a.offerCount === 3, String(a.offerCount));
  ok('and so are the marketplaces they came from', a.sourceCount === 3, String(a.sourceCount));
  ok('the name, category and platform ride along',
    a.name === '1,000 Robux' && a.category === 'robux' && a.platform === 'any');
}

console.log('\n— An official price is a reference, not a competitor —');
{
  const a = assessOpportunity({
    candidate: CANDIDATE, cfg: CFG,
    observations: [obs(899, { source: 'g2a' }), obs(1099, { source: 'kinguin' }),
      obs(1299, { source: 'official', official: 1 })],
  });
  ok('the publisher price is kept apart', a.officialEur === 12.99 && a.highEur === 10.99,
    `${a.officialEur} / ${a.highEur}`);
  ok('…and does not inflate the offer count', a.offerCount === 2, String(a.offerCount));
}

console.log('\n— One seller polled five times is one seller —');
{
  /* latestPerSource does the de-duplication in SQL; this asserts the summariser
     does not re-inflate what it was handed. */
  const a = assessOpportunity({
    candidate: CANDIDATE, cfg: CFG,
    observations: [obs(899, { source: 'g2a', id: 'x' }), obs(910, { source: 'g2a', id: 'y' })],
  });
  ok('two listings on one marketplace are two offers from one source',
    a.offerCount === 2 && a.sourceCount === 1, `${a.offerCount}/${a.sourceCount}`);
}

console.log('\n— A price nobody could convert is not a €0 competitor —');
{
  const a = assessOpportunity({
    candidate: CANDIDATE, cfg: CFG,
    observations: [obs(899), obs(null, { source: 'kinguin' })],
  });
  ok('the unconverted row is left out of the statistics', a.offerCount === 1, String(a.offerCount));
  ok('…and does not drag the average to zero', a.meanEur === 8.99, String(a.meanEur));
}

console.log('\n— Competition pressure is measured, not asserted —');
{
  const crowded = competitionPressure({ competitorCount: 14, sourceCount: 4, lowCents: 980, highCents: 1020 }, CFG);
  const quiet = competitionPressure({ competitorCount: 2, sourceCount: 1, lowCents: 600, highCents: 1400 }, CFG);
  ok('a crowded, tightly-priced market reads high', crowded.level === 'high', JSON.stringify(crowded));
  ok('a thin one with room reads low', quiet.level === 'low', JSON.stringify(quiet));
  ok('the spread is reported as a number', crowded.spreadPct != null && quiet.spreadPct > crowded.spreadPct);
  ok('and it says what it counted', crowded.reasons.some((r) => /offer/.test(r)));

  const nothing = competitionPressure({ competitorCount: 0, sourceCount: 0 }, CFG);
  ok('with nothing observed there is no score rather than a zero',
    nothing.score === null && nothing.level === null, JSON.stringify(nothing));
}

console.log('\n— A margin needs a cost, and this shop has none —');
{
  const stats = { lowCents: 899, medianCents: 999, highCents: 1099, competitorCount: 3 };
  const none = costBasisFor(stats, { catalogueRatios: [], cfg: CFG });
  ok('no cost anywhere means no cost basis', none.costEur === null && none.basis === 'none');
  ok('…and it says why', /no product in this category has a cost price/.test(none.reason), none.reason);

  const one = costBasisFor(stats, { catalogueRatios: [0.8], cfg: CFG });
  ok('one comparable is an anecdote, not a basis', one.basis === 'none' && /anecdote/.test(one.reason));

  const derived = costBasisFor(stats, { catalogueRatios: [0.8, 0.7, 0.75], cfg: CFG });
  ok('two or more give a derived basis', derived.basis === 'derived' && derived.ratio === 0.75,
    JSON.stringify(derived));
  ok('…computed against the market low', derived.costEur === 6.74, String(derived.costEur));
  ok('…and it names its sample', derived.sampleSize === 3);

  const assumed = costBasisFor(stats, { catalogueRatios: [], cfg: { ...CFG, assumedCostRatio: 0.7 } });
  ok('a stated assumption is used when there is nothing better',
    assumed.basis === 'assumed' && assumed.costEur === 6.29, JSON.stringify(assumed));
  ok('…and is labelled as an assumption', /not a measurement/.test(assumed.reason));

  /* The thing this must never do. */
  ok('the market low is never silently used as the cost',
    costBasisFor(stats, { catalogueRatios: [], cfg: CFG }).costEur !== 8.99);
}

console.log('\n— The price this shop would charge is its own decision —');
{
  const p = likelyPrice({ lowCents: 899, medianCents: 999, highCents: 1099 }, CFG);
  ok('it positions against the median at the configured position', p.priceEur === 9.79, String(p.priceEur));
  ok('…and says which basis it used', /median/.test(p.reason));
  ok('with no observations there is no price', likelyPrice({}, CFG).priceEur === null);
}

console.log('\n— Revenue rests on this shop\'s own orders, or says it does not —');
{
  const stats = { inStockCount: 2, competitorCount: 3 };
  const comp = { sources: 4 };
  const blind = revenueOpportunity({ stats, priceEur: 9.79, categoryUnitsPerMonth: null, competition: comp });
  ok('no sales history means no euro figure', blind.eurPerMonth === null && blind.unitsPerMonth === null);
  ok('…and the basis says so', blind.basis === 'market_breadth_only');
  ok('…in words a person can act on', blind.reasons.some((r) => /no orders in this category/.test(r)));

  const known = revenueOpportunity({ stats, priceEur: 10, categoryUnitsPerMonth: 20, competition: comp });
  ok('with real orders it produces a figure', known.eurPerMonth > 0 && known.basis === 'category_sales');
  ok('…conservatively, at a stated share of the category',
    known.unitsPerMonth === 3 && known.eurPerMonth === 30, JSON.stringify(known));
  ok('…and shows the share it used', known.reasons.some((r) => /15% share/.test(r)));

  const noPrice = revenueOpportunity({ stats, priceEur: null, categoryUnitsPerMonth: 20, competition: comp });
  ok('no price basis means no euro figure either', noPrice.eurPerMonth === null);
}

console.log('\n— HIGH is capped behind a known margin —');
{
  const stats = { competitorCount: 4, sourceCount: 2, inStockCount: 2, lowCents: 899, highCents: 1400 };
  const comp = competitionPressure(stats, CFG);
  const rev = { score: 80, basis: 'category_sales', unitsPerMonth: 3, eurPerMonth: 30, reasons: [] };

  const unknown = gradeOpportunity({
    margin: { marginPct: null, reason: 'no cost basis' }, competition: comp, revenue: rev, stats, cfg: CFG });
  ok('a great-looking product with an unknown margin is not HIGH',
    unknown.grade !== GRADE.HIGH, unknown.grade);
  ok('…and the cap is stated', unknown.reasons.some((r) => /capped below HIGH/.test(r)));

  const good = gradeOpportunity({
    margin: { marginPct: 18 }, competition: comp, revenue: rev, stats, cfg: CFG });
  ok('with a healthy known margin it can be HIGH', good.grade === GRADE.HIGH, good.grade);

  /* The rule that a ranking must be able to rank: with no sales history the
     demand score is capped by market breadth, so requiring it for MEDIUM made
     every product LOW whatever its margin — inputs that cannot change the
     output. */
  const quietDemand = { score: 40, basis: 'market_breadth_only', reasons: [] };
  const clears = gradeOpportunity({
    margin: { marginPct: 18 }, competition: comp, revenue: quietDemand, stats, cfg: CFG });
  ok('a margin that clears the floor is at least MEDIUM, even with no demand evidence',
    clears.grade === GRADE.MEDIUM, clears.grade);

  /* Neither quiet nor wanted: the case where the only thing in its favour is
     the margin, which is exactly when the reader needs to be told why it
     stopped at MEDIUM. */
  const crowded = competitionPressure(
    { competitorCount: 14, sourceCount: 4, lowCents: 980, highCents: 1020 }, CFG);
  const onlyMargin = gradeOpportunity({
    margin: { marginPct: 18 }, competition: crowded, revenue: quietDemand, stats, cfg: CFG });
  ok('…and when that is all it has going for it, it says so',
    onlyMargin.grade === GRADE.MEDIUM
    && onlyMargin.reasons.some((r) => /without demand evidence/.test(r)),
    `${onlyMargin.grade} · ${onlyMargin.reasons.join(' | ')}`);

  const thin = gradeOpportunity({
    margin: { marginPct: 2 }, competition: comp, revenue: rev, stats, cfg: CFG });
  ok('a margin under the floor is LOW whatever else is true', thin.grade === GRADE.LOW);
  ok('…and says it would not clear the floor',
    thin.reasons.some((r) => /minimum margin/.test(r)));

  const nothing = gradeOpportunity({
    margin: { marginPct: null }, competition: competitionPressure({ competitorCount: 0 }, CFG),
    revenue: rev, stats: { competitorCount: 0 }, cfg: CFG });
  ok('nothing observed is UNRATED, not LOW', nothing.grade === GRADE.UNRATED, nothing.grade);
}

console.log('\n— Every verdict carries its reasons —');
{
  const a = assessOpportunity({
    candidate: CANDIDATE, cfg: CFG,
    observations: [obs(899, { source: 'g2a' }), obs(1099, { source: 'kinguin' }), obs(999, { source: 'eneba' })],
  });
  ok('the grade explains itself', Array.isArray(a.gradeReasons) && a.gradeReasons.length >= 2);
  ok('the margin explains why it is missing', a.margin.marginPct === null && !!a.margin.reason);
  ok('competition explains what it counted', a.competition.reasons.length > 0);
  ok('revenue explains its basis', !!a.revenue.basis);
  ok('and the observation age travels with the row', a.ageHours != null && a.observedAt != null);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} market-opportunity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
