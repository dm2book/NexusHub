/**
 * Which of the things the market sells are worth ForgeMarket selling.
 *
 * Discovery already answers "does this shop have it?" and produces candidates.
 * This answers the next question — "should it?" — and it is a harder question,
 * because the honest answer for most of them today is "we cannot tell yet".
 *
 * ── THE PROBLEM THIS MODULE IS MOSTLY ABOUT ───────────────────────────────
 * A margin needs a cost. Measured on this shop: of 72 active products, ZERO
 * have a cost price, and there are no supplier mappings. So for a product the
 * shop does not even sell there is no cost anywhere in the system, and there is
 * no arithmetic that turns competitor retail prices into one.
 *
 * The tempting move is to treat the market's lowest listing as the cost. It is
 * wrong in the expensive direction: a retail price is not a wholesale price, so
 * every margin would come out flattering, and the products that looked best
 * would be the ones whose sellers are cheapest — which is precisely backwards.
 *
 * So a margin is reported only when a cost basis exists, and each one says
 * which basis it used:
 *
 *   derived   the median cost-to-market ratio of products this shop ALREADY
 *             sells in the same category, where both numbers are known. Real
 *             evidence, from this shop's own books.
 *   assumed   MARKET_ASSUMED_COST_RATIO, set deliberately by the owner. An
 *             assumption, labelled as one, with the ratio shown beside it.
 *   none      neither exists. marginPct is null and the grade is capped.
 *
 * ── AND THE SAME RULE FOR DEMAND ──────────────────────────────────────────
 * "Estimated revenue" is where a tool like this usually starts inventing. There
 * is no demand data for a product nobody here has ever sold, so the only real
 * signal available is this shop's OWN sales in the same category, and the only
 * market-side signal is how many sellers carry it — which is supply, and a
 * proxy for demand rather than a measurement of it.
 *
 * Both are reported as what they are. A euro figure appears only when there is
 * both a price basis and a category with real orders behind it; otherwise the
 * score stands alone and says why.
 *
 * ── WHAT A GRADE MEANS ────────────────────────────────────────────────────
 * HIGH is capped behind a known margin. Calling something a high opportunity
 * while not knowing whether it can be sold profitably is the kind of confident
 * wrongness this whole subsystem is built to avoid — it is the same failure as
 * a health check that cries wolf, only it costs money instead of attention.
 */
import { all, get } from '../../db/index.js';
import { config } from '../../config/env.js';
import { summarise, marginAt } from './pricing.js';
import { latestPerSource } from './observations.js';
import { costCentsFromMetadata } from '../costService.js';
import { parseTitle } from './normalize.js';

const round2 = (n) => Math.round(n * 100) / 100;
const eur = (cents) => (cents == null ? null : cents / 100);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const EMPTY_COUNTS = { high: 0, medium: 0, low: 0, unrated: 0 };

export const GRADE = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNRATED: 'unrated' };

/**
 * How hard this product is to compete on, from what was actually observed.
 *
 * Three signals, none of them guessed:
 *   offers   how many distinct sellers were seen holding it
 *   sources  how many different marketplaces carry it at all
 *   spread   how tightly those prices cluster — a commoditised product has a
 *            narrow spread and nowhere to stand; a wide one has room
 *
 * Higher score = more pressure. It is deliberately not inverted into a
 * "opportunity score" here: pressure is the thing observed, and the inversion
 * belongs to whoever is reading it.
 */
export function competitionPressure(stats, cfg = config.market) {
  const offers = stats.competitorCount || 0;
  const sources = stats.sourceCount || 0;
  const reasons = [];

  if (offers === 0) {
    return { score: null, level: null, spreadPct: null, offers, sources,
      reasons: ['nothing was observed in stock, so there is nothing to measure'] };
  }

  /* Saturating rather than linear: the difference between one seller and four
     is the whole story, and the difference between forty and fifty is noise. */
  const offerLoad = clamp(offers / 12, 0, 1);
  const sourceLoad = clamp(sources / 4, 0, 1);

  let spreadPct = null;
  if (stats.lowCents != null && stats.highCents != null && stats.lowCents > 0) {
    spreadPct = round2(((stats.highCents - stats.lowCents) / stats.lowCents) * 100);
  }
  /* A 0% spread is everybody at the same number — the most pressure there is.
     Anything past 60% is a market that has not settled, which is room. */
  const spreadLoad = spreadPct == null ? 0.5 : clamp(1 - spreadPct / 60, 0, 1);

  const score = Math.round((offerLoad * 0.45 + sourceLoad * 0.25 + spreadLoad * 0.30) * 100);
  reasons.push(`${offers} offer(s) across ${sources} source(s)`);
  if (spreadPct != null) reasons.push(`prices spread ${spreadPct}% from low to high`);
  if (offers < cfg.minCompetitors) {
    reasons.push(`fewer than the ${cfg.minCompetitors} observations this shop requires before it trusts a price`);
  }

  const level = score < 34 ? 'low' : score < 67 ? 'medium' : 'high';
  return { score, level, spreadPct, offers, sources, reasons };
}

/**
 * What it would cost this shop to stock one, and how sure we are.
 *
 * `catalogueRatios` are cost/market-low ratios taken from products this shop
 * already sells where BOTH numbers are known. Nothing is derived from a single
 * product — one mapping is an anecdote — so a basis needs at least two.
 */
export function costBasisFor(stats, { catalogueRatios = [], cfg = config.market } = {}) {
  const lowEur = eur(stats.lowCents);
  if (lowEur == null) {
    return { costEur: null, basis: 'none', reason: 'no observed price to work from' };
  }
  const usable = catalogueRatios.filter((r) => Number.isFinite(r) && r > 0 && r <= 1.5);
  if (usable.length >= 2) {
    const sorted = [...usable].sort((a, b) => a - b);
    const mid = sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    return {
      costEur: round2(lowEur * mid),
      basis: 'derived',
      ratio: round2(mid),
      sampleSize: usable.length,
      reason: `median cost is ${Math.round(mid * 100)}% of the market low across `
        + `${usable.length} product(s) this shop already sells in this category`,
    };
  }
  const assumed = Number(cfg.assumedCostRatio);
  if (Number.isFinite(assumed) && assumed > 0) {
    return {
      costEur: round2(lowEur * assumed),
      basis: 'assumed',
      ratio: round2(assumed),
      reason: `MARKET_ASSUMED_COST_RATIO is ${assumed} — an assumption, not a measurement`,
    };
  }
  return {
    costEur: null,
    basis: 'none',
    reason: usable.length === 1
      ? 'only one comparable product has a cost price, which is an anecdote rather than a basis'
      : 'no product in this category has a cost price, and MARKET_ASSUMED_COST_RATIO is not set',
  };
}

/**
 * What this shop would probably charge.
 *
 * Its own target position against the market it is looking at — the same
 * number the pricing engine uses when it recommends a price for something
 * already on the shelf, so a candidate is judged the way a product is.
 */
export function likelyPrice(stats, cfg = config.market) {
  const basis = { low: stats.lowCents, median: stats.medianCents, high: stats.highCents }[cfg.marketBasis]
    ?? stats.medianCents;
  if (basis == null) return { priceEur: null, reason: 'no observed prices' };
  const pos = Number.isFinite(cfg.targetMarketPosition) ? cfg.targetMarketPosition : 1;
  return {
    priceEur: round2((basis / 100) * pos),
    reason: `${cfg.marketBasis} of the market × target position ${pos}`,
  };
}

/**
 * How much this could be worth per month.
 *
 * `categoryUnitsPerMonth` is this shop's own order history for the category —
 * the only real demand evidence available. Market breadth is a supply signal
 * and is used to temper it, never to replace it: a product carried by four
 * marketplaces is more likely to be wanted than one carried by a single seller,
 * but nobody here has sold one.
 */
export function revenueOpportunity({ stats, priceEur, categoryUnitsPerMonth = null, competition }) {
  const reasons = [];
  const breadth = competition?.sources ? clamp(competition.sources / 4, 0, 1) : 0;
  const stocked = stats.inStockCount > 0 ? 1 : 0;
  if (stats.inStockCount === 0) reasons.push('nothing observed in stock');

  if (categoryUnitsPerMonth == null) {
    return {
      score: Math.round((breadth * 0.7 + stocked * 0.3) * 100),
      unitsPerMonth: null,
      eurPerMonth: null,
      basis: 'market_breadth_only',
      reasons: [...reasons,
        'this shop has no orders in this category, so there is no demand evidence — '
        + 'the score reflects only how widely the market carries it'],
    };
  }

  /* A new product does not inherit a category's whole demand. A conservative
     share, stated rather than tuned into looking good, and the number it is
     applied to is this shop's own measured sales. */
  const SHARE = 0.15;
  const units = round2(categoryUnitsPerMonth * SHARE * (0.5 + breadth / 2));
  const eurPerMonth = priceEur == null ? null : round2(units * priceEur);
  reasons.push(`${categoryUnitsPerMonth} unit(s)/month sold in this category, `
    + `at a ${Math.round(SHARE * 100)}% share for a new line`);
  if (priceEur == null) reasons.push('no price basis, so no euro figure');

  const score = Math.round(clamp(
    (clamp(units / 10, 0, 1) * 0.6) + (breadth * 0.25) + (stocked * 0.15), 0, 1) * 100);
  return { score, unitsPerMonth: units, eurPerMonth, basis: 'category_sales', reasons };
}

/**
 * The verdict, and every reason behind it.
 *
 * HIGH requires a known margin. Everything else can be graded on what was
 * observed, but "this is a high opportunity" is a claim about profit, and a
 * claim about profit without a cost is a guess wearing a badge.
 */
export function gradeOpportunity({ margin, competition, revenue, stats, cfg = config.market }) {
  const reasons = [];

  if (!stats.competitorCount) {
    return { grade: GRADE.UNRATED, reasons: ['no usable observations — nothing to judge'] };
  }
  if (stats.competitorCount < cfg.minCompetitors) {
    reasons.push(`only ${stats.competitorCount} observation(s); this shop requires ${cfg.minCompetitors}`);
  }

  const marginKnown = margin?.marginPct != null;
  const marginOk = marginKnown && margin.marginPct >= cfg.minimumMarginPercent;
  const marginGood = marginKnown && margin.marginPct >= cfg.minimumMarginPercent * 2;

  if (!marginKnown) reasons.push(margin?.reason || 'no cost basis, so the margin is unknown');
  else reasons.push(`margin ${margin.marginPct}% at the price this shop would set `
    + `(floor ${cfg.minimumMarginPercent}%)`);

  if (competition.level) reasons.push(`competition pressure ${competition.level} (${competition.score}/100)`);
  reasons.push(`opportunity score ${revenue.score}/100 — ${revenue.basis.replace(/_/g, ' ')}`);

  if (marginKnown && !marginOk) {
    return { grade: GRADE.LOW, reasons: [...reasons, 'it would not clear the minimum margin'] };
  }

  const lowPressure = competition.level === 'low';
  const highDemand = revenue.score >= 55;
  const enoughEvidence = stats.competitorCount >= cfg.minCompetitors;

  if (marginGood && !(competition.level === 'high') && highDemand && enoughEvidence) {
    return { grade: GRADE.HIGH, reasons };
  }
  if (!marginKnown) {
    /* Capped deliberately. Without a cost this cannot be called high, however
       good the rest of it looks. */
    return {
      grade: (lowPressure || highDemand) ? GRADE.MEDIUM : GRADE.LOW,
      reasons: [...reasons, 'capped below HIGH: the margin is unknown'],
    };
  }
  /* A known margin that clears the floor is at least MEDIUM.
     It used to also need low pressure or high demand, and with no sales history
     the demand score is capped by market breadth alone — so on a shop with no
     orders NOTHING could reach the threshold and every product graded LOW,
     margin and competition included. A ranking where the inputs cannot change
     the output is not a ranking; it is the same wolf-crying as a health check
     that is red every day, and it would have been read exactly as carefully. */
  if (marginOk) {
    return {
      grade: GRADE.MEDIUM,
      reasons: [...reasons, highDemand || lowPressure
        ? 'clears the margin floor'
        : 'clears the margin floor, but without demand evidence it is not HIGH'],
    };
  }
  return { grade: GRADE.LOW, reasons };
}

/**
 * One candidate, fully assessed. Pure: everything it needs is handed to it, so
 * every number in the table can be tested without a database.
 */
export function assessOpportunity({
  candidate, observations = [], catalogueRatios = [], categoryUnitsPerMonth = null,
  now = Date.now(), cfg = config.market,
} = {}) {
  const stats = summarise(observations, { now });
  const competition = competitionPressure(stats, cfg);
  const cost = costBasisFor(stats, { catalogueRatios, cfg });
  const price = likelyPrice(stats, cfg);

  let margin = { marginPct: null, profitEur: null, basis: cost.basis, reason: cost.reason };
  if (cost.costEur != null && price.priceEur != null) {
    const m = marginAt(price.priceEur, cost.costEur, cfg);
    margin = {
      marginPct: m.marginPct, profitEur: m.profitEur, basis: cost.basis,
      costEur: cost.costEur, ratio: cost.ratio ?? null, sampleSize: cost.sampleSize ?? null,
      reason: cost.reason,
    };
  }

  const revenue = revenueOpportunity({ stats, priceEur: price.priceEur, categoryUnitsPerMonth, competition });
  const { grade, reasons } = gradeOpportunity({ margin, competition, revenue, stats, cfg });

  return {
    candidateId: candidate?.id ?? null,
    marketProductId: candidate?.market_product_id ?? null,
    name: candidate?.title ?? null,
    category: candidate?.game ?? null,
    platform: candidate?.platform ?? null,
    region: candidate?.region ?? null,
    productType: candidate?.product_type ?? null,

    lowEur: eur(stats.lowCents),
    meanEur: eur(stats.meanCents),
    highEur: eur(stats.highCents),
    officialEur: eur(stats.officialCents),
    likelyPriceEur: price.priceEur,

    offerCount: stats.competitorCount,
    sourceCount: stats.sourceCount,
    inStockCount: stats.inStockCount,
    observedAt: stats.freshestAt,
    ageHours: stats.ageHours,

    competition,
    margin,
    revenue,
    grade,
    gradeReasons: reasons,
  };
}

/* ── Reading the evidence out of the database ──────────────────────────────
   Everything above is pure. Everything below is the queries that feed it, kept
   apart so the arithmetic can be tested without a database and the queries can
   be read without the arithmetic in the way. */

/**
 * Cost-to-market ratios from products this shop already sells, per category.
 *
 * A ratio needs both halves: a cost price this shop entered, and a market low
 * this shop observed for the same canonical product. Measured today: zero of
 * 72 active products have a cost price, so this returns empty and every margin
 * comes back unknown — which is the correct output, not a failure.
 */
export async function catalogueCostRatios() {
  /* Keyed by the CANONICAL game, not by this shop's own category name.
     They are two different taxonomies — a product filed under `robux` here is
     `roblox` in the market model — so grouping ratios by one and looking them
     up by the other silently found nothing, every time, and every margin came
     back unknown with a plausible-sounding reason. Both sides go through the
     same parser, which is the rule discovery.js already follows for exactly
     this reason.

     Category comes out of the same row rather than a lookup per product — the
     first version issued one query per active product to fetch a column it had
     already joined past. */
  const rows = await all(
    `SELECT p.id, p.name, p.category, p.metadata,
            (SELECT MIN(o.price_eur_cents)
               FROM market_candidates c
               JOIN market_observations o ON o.market_product_id = c.market_product_id
              WHERE c.forge_product_id = p.id AND o.price_eur_cents IS NOT NULL
                AND o.is_official = 0) AS market_low
       FROM products p
      WHERE p.active = 1`);
  const byCategory = new Map();
  for (const r of rows) {
    if (!r.market_low || Number(r.market_low) <= 0) continue;
    let meta = {};
    try { meta = JSON.parse(r.metadata || '{}'); } catch { /* keep {} */ }
    const cost = costCentsFromMetadata(meta);
    if (cost == null || cost <= 0) continue;
    let meta2 = meta;
    const key = parseTitle(r.name, {
      platform: meta2.platform, region: meta2.region, game: meta2.game,
      denomination: meta2.denomination, denomUnit: meta2.denomUnit,
    }).game || r.category || '';
    const list = byCategory.get(key) || [];
    list.push(cost / Number(r.market_low));
    byCategory.set(key, list);
  }
  return byCategory;
}

/**
 * This shop's own monthly demand per category — real orders, not a model.
 *
 * Only delivered orders count. A cancelled order is not demand and a pending
 * one is not yet anything, and counting either would inflate every estimate
 * that rests on this number.
 */
export async function categoryDemandPerMonth({ sinceDays = 90 } = {}) {
  const cut = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const rows = await all(
    `SELECT p.category AS category, SUM(oi.quantity) AS units
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'completed' AND o.created_at >= @cut
      GROUP BY p.category`, { cut }).catch(() => []);
  const months = Math.max(1, sinceDays / 30);
  const out = new Map();
  for (const r of rows) {
    if (!r.category) continue;
    out.set(r.category, round2(Number(r.units || 0) / months));
  }
  return out;
}

/**
 * Products to add, ranked.
 *
 * Only candidates this shop does NOT already sell: `already_listed` is a
 * finished question and `rejected` is a decision somebody made. Everything
 * returned is a proposal with its evidence attached, and nothing here writes
 * anything — a candidate becomes a product through the approval path, with a
 * name against it, exactly as before.
 */
export async function productsToAdd({
  limit = 100, sort = 'opportunity', grade = null, sinceHours = 168,
} = {}) {
  const rows = await all(
    `SELECT c.id, c.status, c.market_product_id, c.updated_at,
            p.title, p.game, p.platform, p.region, p.product_type, p.canonical_key
       FROM market_candidates c
       JOIN market_products p ON p.id = c.market_product_id
      WHERE c.status IN ('discovered','normalized','needs_review','possible_duplicate','approved')
      ORDER BY c.updated_at DESC
      LIMIT @l`, { l: Math.min(500, Math.max(1, limit)) });

  if (!rows.length) return { products: [], total: 0, counts: EMPTY_COUNTS, evidence: await evidenceState() };

  const ratios = await catalogueCostRatios();
  const demand = await categoryDemandPerMonth();

  const assessed = [];
  for (const row of rows) {
    const observations = await latestPerSource(row.market_product_id, { sinceHours });
    assessed.push(assessOpportunity({
      candidate: row,
      observations,
      catalogueRatios: ratios.get(row.game) || [],
      categoryUnitsPerMonth: demand.has(row.game) ? demand.get(row.game) : null,
    }));
  }

  const filtered = grade ? assessed.filter((a) => a.grade === grade) : assessed;
  const RANK = { high: 3, medium: 2, low: 1, unrated: 0 };
  const by = {
    /* The three the brief asks for, plus the default. `null` always sorts last
       — an unknown margin is not a zero margin, and letting it fall to the
       bottom of a "highest margin" list is the only honest place for it. */
    margin: (a, b) => (b.margin.marginPct ?? -Infinity) - (a.margin.marginPct ?? -Infinity),
    competition: (a, b) => (a.competition.score ?? Infinity) - (b.competition.score ?? Infinity),
    revenue: (a, b) => (b.revenue.score ?? -1) - (a.revenue.score ?? -1),
    opportunity: (a, b) => (RANK[b.grade] - RANK[a.grade])
      || ((b.revenue.score ?? -1) - (a.revenue.score ?? -1)),
  };
  filtered.sort(by[sort] || by.opportunity);

  return {
    products: filtered,
    total: filtered.length,
    counts: {
      high: assessed.filter((a) => a.grade === 'high').length,
      medium: assessed.filter((a) => a.grade === 'medium').length,
      low: assessed.filter((a) => a.grade === 'low').length,
      unrated: assessed.filter((a) => a.grade === 'unrated').length,
    },
    evidence: await evidenceState(),
  };
}

/**
 * Why the table looks the way it does.
 *
 * A report of zero opportunities has at least four different causes and they
 * need different actions: no sources switched on, no observations recorded, no
 * cost prices entered, no sales history. Without this the admin shows an empty
 * table and the reader has to guess which.
 */
export async function evidenceState() {
  const sources = await all(`SELECT key, status, enabled FROM market_sources`).catch(() => []);
  const obs = await get(`SELECT COUNT(*) AS n FROM market_observations`).catch(() => ({ n: 0 }));
  const products = await all(`SELECT metadata FROM products WHERE active = 1`).catch(() => []);
  let withCost = 0;
  for (const p of products) {
    let meta = {};
    try { meta = JSON.parse(p.metadata || '{}'); } catch { /* keep {} */ }
    if (costCentsFromMetadata(meta) != null) withCost += 1;
  }
  const orders = await get(
    `SELECT COUNT(*) AS n FROM orders WHERE status = 'completed'`).catch(() => ({ n: 0 }));

  const blockers = [];
  const live = sources.filter((s) => s.enabled && s.status === 'available');
  if (!live.length) {
    blockers.push('No market source is switched on and available, so nothing new can be discovered. '
      + 'Eneba, G2A, Kinguin and Eldorado each need their own API credentials — none of them '
      + 'may be scraped.');
  }
  if (Number(obs?.n || 0) === 0) {
    blockers.push('No prices have been observed yet, so there is nothing to compare.');
  }
  if (withCost === 0) {
    blockers.push(`None of the ${products.length} active products has a cost price, so no margin `
      + 'can be estimated and nothing can be graded HIGH. Enter cost prices, or set '
      + 'MARKET_ASSUMED_COST_RATIO to work from a stated assumption.');
  }
  if (Number(orders?.n || 0) === 0) {
    blockers.push('No completed orders, so there is no demand evidence — opportunity scores '
      + 'fall back to how widely the market carries a product.');
  }
  return {
    sourcesLive: live.length,
    sourcesTotal: sources.length,
    observations: Number(obs?.n || 0),
    productsWithCost: withCost,
    activeProducts: products.length,
    completedOrders: Number(orders?.n || 0),
    blockers,
  };
}
