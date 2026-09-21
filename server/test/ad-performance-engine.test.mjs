/**
 * Is this advert working — and the half of that question this shop cannot see.
 *
 * attributionService measures arrivals: somebody clicked and the page loaded,
 * and from there the funnel is ours. Impressions happen on TikTok's servers and
 * the money leaves on TikTok's invoice, so CTR and ROAS need two numbers that
 * are not derivable from anything in this database, at all.
 *
 * Most of this file is therefore about what the report refuses to do:
 *
 *   · no impressions → no CTR. Not 0%, and not "clicks over landings" quietly
 *     substituted so the column has something in it.
 *   · no spend → no ROAS, and nothing can be graded on money.
 *   · a creative with four landings is UNRATED, not a WINNER. A plain sort by
 *     conversion rate hands the best badge to the advert with the least
 *     evidence, every single time.
 *   · below break-even is a LOSER even when it beats the median — the rest of
 *     the list being worse does not make it profitable.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

import { creativeRow, gradeCreatives, NETWORKS } from '../src/services/adPerformanceService.js';
import { parseParams } from '../src/services/attributionService.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const perf = (over = {}) => ({
  creative: 'ad-A', campaign: 'launch', network: 'tiktok',
  visits: 100, productViews: 60, checkouts: 20, purchases: 10, revenue: 10000, ...over,
});

console.log('\n— The five networks are told apart —');
{
  ok('TikTok', parseParams({ utm_source: 'tiktok' }).network === 'tiktok');
  ok('YouTube', parseParams({ utm_source: 'youtube' }).network === 'youtube');
  ok('Discord', parseParams({ utm_source: 'discord' }).network === 'discord');
  /* These two shared one bucket called `meta`. They share an invoice and
     nothing else: a Reel and a Facebook feed post reach different people and
     convert differently, and merging them means the report cannot answer which
     of the two to put the next euro into. */
  ok('Instagram is its own network', parseParams({ utm_source: 'instagram' }).network === 'instagram');
  ok('Facebook is its own network', parseParams({ utm_source: 'facebook' }).network === 'facebook');
  ok('…and a Reel is Instagram', parseParams({ utm_source: 'reels' }).network === 'instagram');
  ok('rows that genuinely say "meta" still parse',
    parseParams({ utm_source: 'meta' }).network === 'meta');
  /* An fbclid cannot say WHICH Meta surface — the same parameter is appended on
     both. Guessing would put real spend against the wrong network. */
  ok('an fbclid stays unsplit, because it cannot say which',
    parseParams({ fbclid: 'abc' }).network === 'meta');
  ok('all five the shop advertises on are named', NETWORKS.length === 5
    && ['tiktok', 'instagram', 'facebook', 'youtube', 'discord'].every((x) => NETWORKS.includes(x)));
}

console.log('\n— What the shop can measure on its own —');
{
  const r = creativeRow(perf());
  ok('landings', r.visits === 100);
  ok('checkout starts', r.checkouts === 20);
  ok('purchases', r.purchases === 10);
  ok('revenue', r.revenueCents === 10000);
  ok('conversion rate over landings', r.conversionRate === 10, String(r.conversionRate));
  ok('checkout rate too', r.checkoutRate === 20);
}

console.log('\n— And what it cannot —');
{
  const r = creativeRow(perf());
  ok('no impressions means no CTR', r.ctr === null);
  ok('…and it says only the platform has that number',
    /only the ad platform/.test(r.ctrBasis), r.ctrBasis);
  ok('no spend means no ROAS', r.roas === null);
  ok('…and it says where to get it', /import the platform export/.test(r.roasBasis));
  ok('…and no profit figure either', r.profitCents === null);

  const zero = creativeRow(perf({ visits: 0, purchases: 0, revenue: 0 }));
  ok('an advert with no landings has no conversion rate, not 0%',
    zero.conversionRate === null);
}

console.log('\n— With the platform numbers in —');
{
  const r = creativeRow(perf(), { impressions: 50000, clicks: 120, spendCents: 5000 });
  ok('CTR is platform clicks over impressions', r.ctr === 0.24, String(r.ctr));
  ok('…and says so', /platform clicks over impressions/.test(r.ctrBasis));
  ok('ROAS is revenue over spend', r.roas === 2, String(r.roas));
  ok('profit is the difference', r.profitCents === 5000);

  /* Two kinds of click, never reconciled. The gap is the signal. */
  ok('the platform’s clicks and the shop’s landings are both kept',
    r.platformClicks === 120 && r.visits === 100);
  ok('…and the share that arrived is reported', r.trackedPct === 83.3, String(r.trackedPct));

  const noClicks = creativeRow(perf(), { impressions: 50000, clicks: null, spendCents: 5000 });
  ok('with impressions but no click count it falls back to landings',
    noClicks.ctr === 0.2 && /measured landings over platform impressions/.test(noClicks.ctrBasis));
}

console.log('\n— A grade is not a ranking —');
{
  const thin = gradeCreatives([creativeRow(perf({ visits: 4, purchases: 1, revenue: 1000 }))],
    { minVisits: 30 });
  ok('four landings is UNRATED, not a WINNER', thin[0].grade === 'unrated', thin[0].grade);
  ok('…and it says a badge here would be noise', /too few to judge/.test(thin[0].gradeReason));

  /* Relative grading needs a population: with two creatives one is always the
     loser, which is arithmetic rather than a finding. */
  const pair = gradeCreatives([
    creativeRow(perf({ creative: 'a', purchases: 20, revenue: 20000 })),
    creativeRow(perf({ creative: 'b', purchases: 2, revenue: 2000 })),
  ], { minVisits: 30, minPopulation: 3 });
  ok('two creatives are not a population', pair.every((r) => r.grade === 'unrated'));
  ok('…and it says how many are needed', /3 are needed/.test(pair[0].gradeReason));
}

console.log('\n— WINNER, AVERAGE, LOSER —');
{
  const rows = [
    creativeRow(perf({ creative: 'star', purchases: 30, revenue: 30000 })),
    creativeRow(perf({ creative: 'mid', purchases: 10, revenue: 10000 })),
    creativeRow(perf({ creative: 'mid2', purchases: 11, revenue: 11000 })),
    creativeRow(perf({ creative: 'dud', purchases: 2, revenue: 2000 })),
  ];
  const g = gradeCreatives(rows, { minVisits: 30 });
  const by = Object.fromEntries(g.map((r) => [r.creative, r.grade]));
  ok('the best is a WINNER', by.star === 'winner', JSON.stringify(by));
  ok('the middle is AVERAGE', by.mid === 'average' && by.mid2 === 'average');
  ok('the worst is a LOSER', by.dud === 'loser');
  ok('the reason names the median it was judged against',
    /median of/.test(g.find((r) => r.creative === 'star').gradeReason));
  ok('…and which measure stood in for money',
    g.every((r) => r.gradeBasis === 'conversion rate'));
}

console.log('\n— Money decides once it exists —');
{
  const rows = [
    creativeRow(perf({ creative: 'cheapwin', purchases: 6, revenue: 6000 }),
      { spendCents: 1000, impressions: 40000, clicks: 100 }),
    creativeRow(perf({ creative: 'busy', purchases: 20, revenue: 20000 }),
      { spendCents: 19000, impressions: 40000, clicks: 100 }),
    creativeRow(perf({ creative: 'mid', purchases: 10, revenue: 10000 }),
      { spendCents: 5000, impressions: 40000, clicks: 100 }),
  ];
  const g = gradeCreatives(rows, { minVisits: 30 });
  const by = Object.fromEntries(g.map((r) => [r.creative, r.grade]));
  /* `busy` sells the most and is the worst buy — 20000 back on 19000 spent.
     Grading on conversion rate would have crowned it. */
  ok('the best RETURN wins, not the most sales', by.cheapwin === 'winner', JSON.stringify(by));
  ok('and the one selling most for the most money is not', by.busy !== 'winner');
  ok('the basis switches to ROAS', g.every((r) => r.gradeBasis === 'roas'));
}

console.log('\n— Losing money is absolute —');
{
  const rows = [
    creativeRow(perf({ creative: 'a', purchases: 2, revenue: 900 }), { spendCents: 1000 }),
    creativeRow(perf({ creative: 'b', purchases: 1, revenue: 200 }), { spendCents: 1000 }),
    creativeRow(perf({ creative: 'c', purchases: 1, revenue: 100 }), { spendCents: 1000 }),
  ];
  const g = gradeCreatives(rows, { minVisits: 30 });
  /* `a` is the best of the three and still returns less than it cost. Relative
     grading alone would call it a WINNER. */
  ok('the best of a losing set is still a LOSER',
    g.find((r) => r.creative === 'a').grade === 'loser',
    JSON.stringify(g.map((r) => [r.creative, r.grade])));
  ok('…and the reason says so',
    /below break-even, whatever the rest/.test(g.find((r) => r.creative === 'a').gradeReason));
  ok('every one of them is flagged',
    g.every((r) => r.flags.some((f) => f.code === 'BELOW_BREAK_EVEN')));
  ok('and returning a tenth of the spend is critical',
    g.find((r) => r.creative === 'c').flags
      .find((f) => f.code === 'BELOW_BREAK_EVEN').severity === 'critical');

  const fine = gradeCreatives([creativeRow(perf(), { spendCents: 2000 })], { minVisits: 30 });
  ok('a profitable advert is not flagged',
    !fine[0].flags.some((f) => f.code === 'BELOW_BREAK_EVEN'));
}

console.log('\n— The flags that are about the measurement, not the advert —');
{
  const leaky = gradeCreatives(
    [creativeRow(perf({ visits: 20 }), { clicks: 200, impressions: 90000, spendCents: 1000 })],
    { minVisits: 10 });
  const f = leaky[0].flags.find((x) => x.code === 'TRACKING_GAP');
  ok('a big gap between reported clicks and arrivals is raised', !!f, JSON.stringify(leaky[0].flags));
  ok('…and it says the funnel below is measured on the ones that arrived',
    /measured on the ones that did/.test(f.detail));

  const dull = gradeCreatives(
    [creativeRow(perf(), { impressions: 100000, clicks: 200, spendCents: 1000 })],
    { minVisits: 10 });
  ok('a very low CTR on real volume is noted',
    dull[0].flags.some((x) => x.code === 'LOW_CTR'), JSON.stringify(dull[0].flags));

  const small = gradeCreatives(
    [creativeRow(perf(), { impressions: 200, clicks: 1, spendCents: 1000 })], { minVisits: 10 });
  ok('…but not on two hundred impressions',
    !small[0].flags.some((x) => x.code === 'LOW_CTR'));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-performance-engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
