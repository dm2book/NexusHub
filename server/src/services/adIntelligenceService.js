/**
 * Ad Intelligence — the ad report read three ways: per advert, per platform,
 * and as the five answers an owner opens it for (winner, loser, highest CTR,
 * highest revenue, highest profit).
 *
 * Built on adPerformance(), not beside it, so every number here is the same
 * number the creative table shows. What this adds:
 *
 *   per platform   TikTok, Instagram, Facebook, Discord and YouTube, always all
 *                  five — a platform with nothing measured says so, rather than
 *                  vanishing and leaving the owner to wonder if it was counted.
 *                  Spend is the platform's WHOLE spend, including rows entered
 *                  against a campaign but no creative, which the per-creative
 *                  table cannot place.
 *   highlights     each with the rule that picked it. Winner and loser come
 *                  from the grading — which refuses below 30 landings and three
 *                  comparable adverts — so "no winner yet" is a real answer,
 *                  and an advert does not become the winner by being the only
 *                  one. Highest CTR needs 100 views: one click on one view is
 *                  100% and means nothing.
 *   funnel         views → clicks → landings → checkout starts → purchases,
 *                  each stage the number that actually exists. Views and clicks
 *                  are the platforms' (entered or imported); the rest is
 *                  measured here.
 */
import { all } from '../db/index.js';
import { adPerformance } from './adPerformanceService.js';

const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export const PLATFORMS = [
  { key: 'tiktok', label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'discord', label: 'Discord' },
  { key: 'youtube', label: 'YouTube' },
];
const KNOWN = new Set(PLATFORMS.map((p) => p.key));

export const HIGHLIGHT_RULES = { minImpressionsForCtr: 100 };

/** Whole-platform spend and views, including rows not tied to one creative. */
async function platformTotals(days) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await all(
    `SELECT network, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
            SUM(spend_cents) AS spend, COUNT(*) AS n
       FROM ad_spend WHERE day >= @since GROUP BY network`, { since }).catch(() => []);
  return new Map(rows.map((r) => [r.network, {
    impressions: r.impressions == null ? null : Number(r.impressions),
    clicks: r.clicks == null ? null : Number(r.clicks),
    spendCents: r.spend == null ? null : Number(r.spend),
  }]));
}

/**
 * One platform's figures from its creatives and its spend rows.
 * Profit needs every purchase costed AND a spend figure; otherwise it is null
 * with the reason, exactly like a single advert's.
 */
export function platformRow(platform, creatives, totals = null) {
  const sum = (f) => creatives.reduce((a, c) => a + (Number(c[f]) || 0), 0);
  const visits = sum('visits');
  const purchases = sum('purchases');
  const revenueCents = sum('revenueCents');
  const impressions = totals?.impressions ?? null;
  const platformClicks = totals?.clicks ?? null;
  const spendCents = totals?.spendCents ?? null;
  const contributionKnown = creatives.every((c) => c.contributionCents != null);
  const contributionCents = contributionKnown ? sum('contributionCents') : null;
  return {
    key: platform.key,
    label: platform.label,
    adverts: creatives.length,
    impressions,
    platformClicks,
    visits,
    ctr: impressions ? round2((Number(platformClicks ?? visits) / impressions) * 100) : null,
    checkouts: sum('checkouts'),
    purchases,
    conversionRate: visits ? round1((purchases / visits) * 100) : null,
    revenueCents,
    spendCents,
    roas: spendCents ? round2(revenueCents / spendCents) : null,
    contributionCents,
    profitCents: contributionCents == null || spendCents == null ? null : contributionCents - spendCents,
    status: !visits && spendCents == null && impressions == null ? 'no data'
      : (!visits ? 'no tagged arrivals' : 'measured'),
  };
}

/** The best (or worst) by a measure, with the rule that picked it — or null and why. */
function pick(rows, value, { highest = true, label, why }) {
  const cands = rows.filter((r) => value(r) != null);
  if (!cands.length) return { creative: null, reason: why };
  const best = cands.reduce((a, b) => ((highest ? value(b) > value(a) : value(b) < value(a)) ? b : a));
  return { ...summary(best), value: value(best), measure: label };
}

const summary = (r) => ({
  creative: r.creative, campaign: r.campaign, network: r.network,
  ctr: r.ctr, revenueCents: r.revenueCents, profitCents: r.profitCents,
  roas: r.roas, conversionRate: r.conversionRate, grade: r.grade, gradeReason: r.gradeReason,
});

export function highlights(creatives, rules = HIGHLIGHT_RULES) {
  const score = (r) => (r.gradeBasis === 'roas' ? r.roas : r.conversionRate);
  const winners = creatives.filter((r) => r.grade === 'winner');
  const losers = creatives.filter((r) => r.grade === 'loser');
  /* Why there is no winner (or loser) is a different sentence depending on
     whether anything was compared at all. Quoting the first unrated advert's
     reason — "10 landings, too few" — under "Winner" when three others were
     compared and simply came out close made the card describe the wrong ad. */
  const compared = creatives.filter((r) => r.grade !== 'unrated');
  const ungraded = compared.length
    ? null
    : creatives.find((r) => r.grade === 'unrated')?.gradeReason;
  const close = compared.length
    ? `${compared.length} advert(s) compared on ${compared[0].gradeBasis} and none is more than 25% `
    : null;
  return {
    winner: winners.length
      ? { ...pick(winners, score, { label: winners[0].gradeBasis }) }
      : { creative: null, reason: ungraded || (close ? `${close}above the median` : 'no adverts yet') },
    loser: losers.length
      ? { ...pick(losers, score, { highest: false, label: losers[0].gradeBasis }) }
      : { creative: null, reason: ungraded || (close ? `${close}below the median` : 'no adverts yet') },
    highestCtr: pick(creatives.filter((r) => (r.impressions || 0) >= rules.minImpressionsForCtr), (r) => r.ctr,
      { label: 'ctr', why: `no advert has ${rules.minImpressionsForCtr}+ views recorded — CTR needs the platform's view count` }),
    highestRevenue: pick(creatives.filter((r) => r.revenueCents > 0), (r) => r.revenueCents,
      { label: 'revenue', why: 'no advert has sold anything yet' }),
    highestProfit: pick(creatives, (r) => r.profitCents,
      { label: 'profit', why: 'no advert has both its spend and the cost of what it sold recorded' }),
  };
}

export async function adIntelligence({ days = 30, minVisits = 30 } = {}) {
  const [report, totals] = await Promise.all([adPerformance({ days, minVisits, limit: 200 }), platformTotals(days)]);
  const creatives = report.creatives;

  const platforms = PLATFORMS.map((p) => platformRow(p, creatives.filter((c) => c.network === p.key), totals.get(p.key)));
  /* Anything else that arrived tagged — `meta` from a bare fbclid (Instagram
     or Facebook, the click id cannot say which), Google, untagged sources. Kept
     visible as one row rather than dropped from the totals. */
  const otherCreatives = creatives.filter((c) => !KNOWN.has(c.network));
  const otherSpend = [...totals.entries()].filter(([k]) => !KNOWN.has(k))
    .reduce((acc, [, t]) => ({
      impressions: t.impressions == null ? acc.impressions : (acc.impressions || 0) + t.impressions,
      clicks: t.clicks == null ? acc.clicks : (acc.clicks || 0) + t.clicks,
      spendCents: t.spendCents == null ? acc.spendCents : (acc.spendCents || 0) + t.spendCents,
    }), { impressions: null, clicks: null, spendCents: null });
  const other = otherCreatives.length || otherSpend.spendCents != null
    ? platformRow({ key: 'other', label: 'Other / unspecified' }, otherCreatives, otherSpend) : null;

  const all5 = [...platforms, ...(other ? [other] : [])];
  const s = (f) => all5.reduce((a, p) => (p[f] == null ? a : (a ?? 0) + p[f]), null);

  return {
    days,
    platforms,
    other,
    highlights: highlights(creatives),
    funnel: [
      { key: 'views', label: 'Views', count: s('impressions'), source: 'platform' },
      { key: 'clicks', label: 'Clicks', count: s('platformClicks'), source: 'platform' },
      { key: 'landings', label: 'Landed on the shop', count: s('visits'), source: 'measured' },
      { key: 'checkouts', label: 'Checkout starts', count: s('checkouts'), source: 'measured' },
      { key: 'purchases', label: 'Purchases', count: s('purchases'), source: 'measured' },
    ],
    totals: {
      ...report.totals,
      profitCents: all5.every((p) => p.profitCents != null || (!p.visits && p.spendCents == null)) ? s('profitCents') : null,
    },
    counts: report.counts,
    creatives,
    evidence: report.evidence,
  };
}
