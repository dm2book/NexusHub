/**
 * Is this advert working — and the half of that question this shop cannot see.
 *
 * ── WHAT WAS ALREADY MEASURABLE ───────────────────────────────────────────
 * attributionService records an arrival: somebody clicked, the page loaded, and
 * from there the funnel is ours — product views, checkout starts, purchases,
 * revenue. Every one of those is a fact this database holds.
 *
 * ── WHAT IS NOT, AND CANNOT BE ────────────────────────────────────────────
 * Impressions happen on TikTok's servers. The money leaves on TikTok's invoice.
 * Neither is derivable from anything here, at all, ever. Which means:
 *
 *   CTR  = clicks / impressions   needs a number only the platform has
 *   ROAS = revenue / spend        needs a number only the invoice has
 *
 * and those two are most of what "is this advert working" means. A dashboard
 * that showed a CTR without impressions would be showing a ratio of a measured
 * number to an invented one.
 *
 * So they are entered, or imported from the platform's own export, per creative
 * per day — the grain every ad platform exports at. Until they are, CTR and
 * ROAS are null with a reason, and a creative cannot be graded a WINNER on
 * numbers that do not exist.
 *
 * ── TWO KINDS OF CLICK, NEVER RECONCILED ──────────────────────────────────
 * The platform reports how many clicks it sent. This shop measures how many
 * arrivals it saw. They disagree for real reasons — consent refusals, blocked
 * scripts, people who leave before the page runs — and the SIZE of the gap is
 * worth reading. Averaging them into one "clicks" column would hide the one
 * signal that tells you your tracking is broken.
 *
 * ── AND A GRADE IS NOT A RANKING ──────────────────────────────────────────
 * A creative with four landings and one sale has a 25% conversion rate and
 * means nothing. Grading is refused below a minimum sample rather than handing
 * the best badge to the advert with the least evidence — which is what a plain
 * sort by conversion rate does, every time.
 */
import { all, get, run, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { creativePerformance } from './attributionService.js';

const n = (v) => (v == null ? null : Number(v));
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const key = (network, campaign, creative) =>
  `${network || ''}::${campaign || ''}::${creative || ''}`;

/** The five the shop actually advertises on, plus what the click ids can say. */
export const NETWORKS = ['tiktok', 'instagram', 'facebook', 'youtube', 'discord'];

/**
 * One day of one creative's platform numbers.
 *
 * Upserted on (day, network, campaign, creative): re-importing yesterday's
 * export must not double the spend, which is the mistake that halves every ROAS
 * on the page and looks like the adverts got worse.
 */
export async function recordSpend({
  day, network, campaign = null, creative = null,
  impressions = null, clicks = null, spendCents = null,
  currency = 'EUR', source = 'manual', note = null,
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) {
    throw new Error('a spend row needs a day as YYYY-MM-DD');
  }
  if (!network) throw new Error('a spend row needs the network it was bought on');
  const nonNeg = (v, name) => {
    if (v == null) return null;
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) throw new Error(`${name} must be a number and not negative`);
    return Math.round(x);
  };
  const imp = nonNeg(impressions, 'impressions');
  const clk = nonNeg(clicks, 'clicks');
  const spend = nonNeg(spendCents, 'spend');
  if (imp == null && clk == null && spend == null) {
    throw new Error('a spend row with no impressions, clicks or spend records nothing');
  }
  /* More clicks than impressions is not a small discrepancy, it is a mis-mapped
     column in somebody's CSV — and it would produce a CTR above 100%, which the
     page would then have to explain away. */
  if (imp != null && clk != null && clk > imp) {
    throw new Error(`${clk} clicks against ${imp} impressions — check the columns`);
  }

  const at = nowIso();
  await run(
    `INSERT INTO ad_spend (id, day, network, campaign, creative, impressions, clicks,
                           spend_cents, currency, source, note, created_at, updated_at)
     VALUES (@id, @day, @net, @camp, @cre, @imp, @clk, @spend, @cur, @src, @note, @at, @at)
     ON CONFLICT (day, network, COALESCE(campaign, ''), COALESCE(creative, ''))
     DO UPDATE SET impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
                   spend_cents = EXCLUDED.spend_cents, currency = EXCLUDED.currency,
                   source = EXCLUDED.source, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
    { id: newId('ads'), day, net: network, camp: campaign, cre: creative,
      imp, clk, spend, cur: currency, src: source, note, at });
  return get(
    `SELECT * FROM ad_spend WHERE day=@day AND network=@net
       AND COALESCE(campaign,'')=COALESCE(@camp,'') AND COALESCE(creative,'')=COALESCE(@cre,'')`,
    { day, net: network, camp: campaign, cre: creative });
}

/** Platform numbers per creative over a window. */
export async function spendByCreative({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await all(
    `SELECT network, campaign, creative,
            SUM(impressions) AS impressions,
            SUM(clicks)      AS clicks,
            SUM(spend_cents) AS spend_cents,
            COUNT(*)         AS days
       FROM ad_spend
      WHERE day >= @since
      GROUP BY network, campaign, creative`, { since }).catch(() => []);
  const map = new Map();
  for (const r of rows) {
    map.set(key(r.network, r.campaign, r.creative), {
      impressions: n(r.impressions), clicks: n(r.clicks),
      spendCents: n(r.spend_cents), days: Number(r.days),
    });
  }
  return map;
}

/**
 * Every number for one creative, with each one's evidence state attached.
 *
 * `visits` is what this shop measured. `clicks` is what the platform says it
 * sent. Both are present; neither is called "clicks" on its own.
 */
export function creativeRow(perf, platform = null) {
  const visits = Number(perf.visits || 0);
  const purchases = Number(perf.purchases || 0);
  const revenue = Number(perf.revenue || 0);

  const impressions = platform?.impressions ?? null;
  const clicks = platform?.clicks ?? null;
  const spendCents = platform?.spendCents ?? null;

  const ctr = impressions ? round2((Number(clicks ?? visits) / impressions) * 100) : null;
  const roas = spendCents ? round2(revenue / spendCents) : null;

  /* How much of what the platform charged for actually reached the shop. A gap
     is normal; a gap of 80% is a tracking problem, not an audience problem, and
     nothing else on this page would show it. */
  const trackedPct = clicks ? round1((visits / clicks) * 100) : null;

  return {
    creative: perf.creative,
    campaign: perf.campaign,
    network: perf.network || null,

    impressions,
    platformClicks: clicks,
    visits,
    ctr,
    ctrBasis: impressions == null
      ? 'no impressions recorded — only the ad platform has this number'
      : (clicks == null ? 'measured landings over platform impressions' : 'platform clicks over impressions'),
    trackedPct,

    productViews: Number(perf.productViews || 0),
    checkouts: Number(perf.checkouts || 0),
    purchases,
    /* Over measured landings, because that is the population this shop could
       have converted — a click the shop never saw had no chance to buy. */
    conversionRate: visits ? round1((purchases / visits) * 100) : null,
    checkoutRate: visits ? round1((Number(perf.checkouts || 0) / visits) * 100) : null,

    revenueCents: revenue,
    spendCents,
    roas,
    roasBasis: spendCents == null ? 'no spend recorded — enter it or import the platform export' : null,
    profitCents: spendCents == null ? null : revenue - spendCents,
  };
}

/**
 * WINNER / AVERAGE / LOSER, and the refusal to grade on nothing.
 *
 * Graded against the OTHER creatives in the same window, because "good" for a
 * top-up shop is not a number anybody can write down in advance. But relative
 * grading has a failure mode — with three creatives, one is always a LOSER —
 * so the comparison needs a population, and below a minimum sample a creative
 * is UNRATED rather than badged on four visits.
 *
 * ROAS decides when spend is known, because it is the only one of these that is
 * about money rather than about behaviour. Where it is not, conversion rate
 * stands in and the row says so.
 */
export function gradeCreatives(rows, {
  minVisits = 30, minPopulation = 3, breakEvenRoas = 1,
} = {}) {
  const ratable = rows.filter((r) => r.visits >= minVisits);

  /* ONE basis for the whole comparison.
     The first version picked per creative — ROAS where spend was known,
     conversion rate where it was not — and then took a median across both. A
     ROAS of 1.54 and a conversion rate of 10 are not two values of one thing,
     so the median was meaningless and the best-converting advert in the set came
     out a LOSER because 1.54 sits below a median dragged up by percentages.
     Caught by the end-to-end test, which had one creative with spend and two
     without — the ordinary case for a shop that has just started entering it.

     So: ROAS only when EVERY creative with enough traffic has spend recorded.
     Otherwise the comparison runs on the measure all of them have, and the
     report says which. Creatives that are individually below break-even are
     still flagged and still graded LOSER on the absolute rule below — that one
     does not need a population. */
  const everyRatableHasSpend = ratable.length > 0 && ratable.every((r) => r.roas != null);
  const basis = everyRatableHasSpend ? 'roas' : 'conversion rate';
  const scoreOf = (r) => (basis === 'roas' ? r.roas : r.conversionRate);
  const basisOf = () => basis;

  const scored = ratable.map(scoreOf).filter((x) => x != null).sort((a, b) => a - b);
  const median = scored.length
    ? (scored.length % 2 ? scored[(scored.length - 1) / 2]
      : (scored[scored.length / 2 - 1] + scored[scored.length / 2]) / 2)
    : null;

  return rows.map((r) => {
    const flags = [];
    /* Absolute, and it does not wait for a population: an advert that has spent
       real money and returned less than it cost is losing money whether or not
       it is the worst one in the list. */
    if (r.roas != null && r.spendCents > 0 && r.roas < breakEvenRoas) {
      flags.push({
        code: 'BELOW_BREAK_EVEN', severity: r.roas < 0.5 ? 'critical' : 'warn',
        detail: `€${(r.spendCents / 100).toFixed(2)} spent returned `
          + `€${(r.revenueCents / 100).toFixed(2)} — ${r.roas}× back.`,
      });
    }
    if (r.trackedPct != null && r.trackedPct < 50) {
      flags.push({
        code: 'TRACKING_GAP', severity: 'warn',
        detail: `the platform reported ${r.platformClicks} clicks and the shop saw `
          + `${r.visits} — ${r.trackedPct}% arrived. The funnel below this is measured `
          + 'on the ones that did.',
      });
    }
    if (r.impressions != null && r.ctr != null && r.impressions >= 1000 && r.ctr < 0.5) {
      flags.push({
        code: 'LOW_CTR', severity: 'info',
        detail: `${r.ctr}% of ${r.impressions.toLocaleString('en-US')} impressions clicked.`,
      });
    }

    if (r.visits < minVisits) {
      return { ...r, grade: 'unrated', gradeBasis: null, flags,
        gradeReason: `${r.visits} landing(s) — under ${minVisits}, which is too few to judge. `
          + 'A grade here would be a badge on noise.' };
    }
    if (ratable.length < minPopulation || median == null) {
      return { ...r, grade: 'unrated', gradeBasis: null, flags,
        gradeReason: `only ${ratable.length} creative(s) have enough traffic to compare — `
          + `${minPopulation} are needed before "better than average" means anything.` };
    }

    const score = scoreOf(r);
    if (score == null) {
      return { ...r, grade: 'unrated', gradeBasis: null, flags,
        gradeReason: 'no ROAS and no conversion rate to judge on' };
    }

    const rowBasis = basisOf(r);
    const mixed = basis === 'conversion rate' && r.roas != null;
    /* A creative below break-even is a LOSER even if it beats the median — the
       rest of the list being worse does not make it profitable. */
    const losing = r.roas != null && r.spendCents > 0 && r.roas < breakEvenRoas;
    let grade = 'average';
    if (losing) grade = 'loser';
    else if (score > median * 1.25) grade = 'winner';
    else if (score < median * 0.75) grade = 'loser';

    const fmt = rowBasis === 'roas' ? `${score}×` : `${score}%`;
    const mfmt = rowBasis === 'roas' ? `${round2(median)}×` : `${round1(median)}%`;
    return {
      ...r, grade, gradeBasis: rowBasis, flags,
      gradeReason: losing
        ? `${fmt} on ${rowBasis} — below break-even, whatever the rest of the list is doing.`
        : `${fmt} on ${rowBasis} against a median of ${mfmt} across `
          + `${ratable.length} creative(s) with enough traffic.`
          + (mixed
            ? ` (This one has a ROAS of ${r.roas}×, but not every advert with `
              + 'enough traffic does — so the comparison runs on the measure they all have.)'
            : ''),
    };
  });
}

/** The whole report. */
export async function adPerformance({ days = 30, limit = 100, minVisits = 30 } = {}) {
  const perf = await creativePerformance({ days, limit });
  const platform = await spendByCreative({ days });

  const rows = perf.map((p) => {
    /* Matched on the creative the advert was tagged with. A spend row entered
       against a campaign but no creative is not silently spread across that
       campaign's creatives — that would invent a per-creative ROAS out of one
       total, and it is the number a person would act on. */
    const exact = platform.get(key(p.network, p.campaign, p.creative))
      || platform.get(key(p.network, null, p.creative))
      || null;
    return creativeRow(p, exact);
  });

  const graded = gradeCreatives(rows, { minVisits });
  const spendTotal = [...platform.values()].reduce((a, s) => a + (s.spendCents || 0), 0);
  const matched = rows.filter((r) => r.spendCents != null)
    .reduce((a, r) => a + r.spendCents, 0);

  return {
    days,
    creatives: graded,
    totals: {
      visits: graded.reduce((a, r) => a + r.visits, 0),
      purchases: graded.reduce((a, r) => a + r.purchases, 0),
      revenueCents: graded.reduce((a, r) => a + r.revenueCents, 0),
      spendCents: spendTotal,
      /* Blended, and labelled: one ROAS over everything is not the average of
         the per-creative ones and reading it as such is how a losing advert
         hides behind a winning one. */
      blendedRoas: spendTotal ? round2(
        graded.reduce((a, r) => a + r.revenueCents, 0) / spendTotal) : null,
      unattributedSpendCents: spendTotal - matched,
    },
    counts: {
      winner: graded.filter((r) => r.grade === 'winner').length,
      average: graded.filter((r) => r.grade === 'average').length,
      loser: graded.filter((r) => r.grade === 'loser').length,
      unrated: graded.filter((r) => r.grade === 'unrated').length,
    },
    flagged: graded.filter((r) => r.flags.length > 0)
      .map((r) => ({ creative: r.creative, network: r.network, grade: r.grade, flags: r.flags })),
    evidence: await evidence({ days }),
  };
}

/** One measure per day per creative, for the chart. */
export async function adTimeseries({ days = 30, metric = 'roas', limit = 6 } = {}) {
  const sinceDay = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  const spend = await all(
    `SELECT day, creative, network, SUM(spend_cents) AS spend, SUM(impressions) AS impressions,
            SUM(clicks) AS clicks
       FROM ad_spend WHERE day >= @d GROUP BY day, creative, network`, { d: sinceDay })
    .catch(() => []);
  const sales = await all(
    `SELECT SUBSTRING(o.created_at, 1, 10) AS day,
            COALESCE(v.creative_id, v.content, '—') AS creative,
            COUNT(*) AS purchases, COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o JOIN ad_visits v ON v.id = o.ad_visit_id
      WHERE o.ad_visit_id IS NOT NULL AND o.created_at > @since
      GROUP BY 1, 2`, { since: sinceIso }).catch(() => []);
  const landings = await all(
    `SELECT SUBSTRING(created_at, 1, 10) AS day,
            COALESCE(creative_id, content, '—') AS creative,
            COUNT(*) AS visits
       FROM ad_visits WHERE created_at > @since GROUP BY 1, 2`, { since: sinceIso })
    .catch(() => []);

  const cells = new Map();
  const touch = (day, creative) => {
    const k = `${creative}::${day}`;
    if (!cells.has(k)) {
      cells.set(k, { day, creative, spend: 0, revenue: 0, visits: 0, purchases: 0, impressions: 0, clicks: 0 });
    }
    return cells.get(k);
  };
  for (const r of spend) {
    const c = touch(r.day, r.creative || '—');
    c.spend += Number(r.spend || 0);
    c.impressions += Number(r.impressions || 0);
    c.clicks += Number(r.clicks || 0);
  }
  for (const r of sales) {
    const c = touch(r.day, r.creative);
    c.revenue += Number(r.revenue || 0);
    c.purchases += Number(r.purchases || 0);
  }
  for (const r of landings) {
    const c = touch(r.day, r.creative);
    c.visits += Number(r.visits || 0);
  }

  const pick = {
    roas: (c) => (c.spend > 0 ? round2(c.revenue / c.spend) : null),
    conversion: (c) => (c.visits > 0 ? round1((c.purchases / c.visits) * 100) : null),
    ctr: (c) => (c.impressions > 0 ? round2((c.clicks / c.impressions) * 100) : null),
    revenue: (c) => (c.revenue > 0 ? c.revenue : null),
  }[metric] || (() => null);

  const byCreative = new Map();
  for (const c of [...cells.values()].sort((a, b) => a.day.localeCompare(b.day))) {
    const v = pick(c);
    if (v == null) continue;
    if (!byCreative.has(c.creative)) byCreative.set(c.creative, { name: c.creative, points: [] });
    byCreative.get(c.creative).points.push({ at: `${c.day}T00:00:00.000Z`, value: v });
  }

  /* The biggest few, by how much of the measure they carry. Eight lines on one
     chart is a plate of spaghetti; the rest are still in the table. */
  const series = [...byCreative.values()]
    .sort((a, b) => b.points.length - a.points.length)
    .slice(0, limit);

  return {
    metric, days, series,
    enoughToPlot: series.some((s) => s.points.length >= 2),
  };
}

/** Why the page looks the way it does. */
export async function evidence({ days = 30 } = {}) {
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const sinceDay = sinceIso.slice(0, 10);
  const visits = await get(
    `SELECT COUNT(*) AS n FROM ad_visits WHERE created_at > @s`, { s: sinceIso })
    .catch(() => ({ n: 0 }));
  const spendRows = await get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(spend_cents), 0) AS total,
            COUNT(*) FILTER (WHERE impressions IS NOT NULL) AS with_impressions
       FROM ad_spend WHERE day >= @d`, { d: sinceDay }).catch(() => ({ n: 0, total: 0, with_impressions: 0 }));

  const blockers = [];
  if (Number(visits.n) === 0) {
    blockers.push('No tagged arrivals in this window. An advert is measured by the '
      + 'utm_source / utm_campaign / utm_content it links with — without those a click '
      + 'is a visitor, not an advert.');
  }
  if (Number(spendRows.n) === 0) {
    blockers.push('No spend recorded, so there is no ROAS and nothing can be graded on money. '
      + 'Enter it per creative per day, or import the platform export.');
  } else if (Number(spendRows.with_impressions) === 0) {
    blockers.push('Spend is recorded but impressions are not, so there is no CTR.');
  }
  return {
    taggedVisits: Number(visits.n),
    spendRows: Number(spendRows.n),
    spendCents: Number(spendRows.total),
    rowsWithImpressions: Number(spendRows.with_impressions),
    blockers,
  };
}
