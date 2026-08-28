/**
 * From observations to a price, and from a price to a decision.
 *
 * Two halves, kept separate on purpose.
 *
 *   summarise()   what the market is doing: low, median, high, official, how
 *                 many sellers, how fresh, how confident. Facts only.
 *   recommend()   what we should charge, and whether a human has to look first.
 *
 * ── WHY NOT "CHEAPEST MINUS A CENT" ───────────────────────────────────────
 * Because it is not a strategy, it is a reflex, and it has three failure modes
 * this engine is built to avoid. It races to the bottom against anyone doing
 * the same thing. It follows a mispriced listing off a cliff. And it says
 * nothing about whether the sale makes money — the number it produces can be
 * below cost and it will produce it anyway.
 *
 * So the price is the higher of two independent numbers: the least we can
 * charge and still make the minimum profit, and where we want to sit in the
 * market. The floor is not a preference, it is arithmetic — cost, payment fees,
 * fulfilment, source cost and VAT — and it always wins.
 *
 * ── WHY THE FLOOR NEEDS ALGEBRA ───────────────────────────────────────────
 * The payment fee is a percentage OF THE PRICE, so "price = cost + fee + profit"
 * has price on both sides. Solved once, here, rather than approximated:
 *
 *     p = (cost + fixed_fee + profit) / (1 - fee_pct - source_pct)
 *
 * Getting this wrong by treating the fee as a percentage of cost understates
 * the floor by a few percent on every product — small enough to look right and
 * large enough to erase the margin on the cheap ones.
 */
import { config } from '../../config/env.js';
import { evaluateFormula } from './formula.js';

const round2 = (n) => Math.round(n * 100) / 100;
const eur = (cents) => cents / 100;

/** The median, taking the lower of the two middles for an even count. */
export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * What the market looks like, from observations we actually hold.
 *
 * Only observations with a euro figure count toward the statistics: an
 * unconverted foreign price is evidence we could not use, and it is reported as
 * such rather than mixed into an average.
 */
export function summarise(observations, { now = Date.now() } = {}) {
  /* `!= null` before Number(), and it is not fussiness: Number(null) is 0, and
     0 is finite. An observation whose currency could not be converted stores
     NULL here, so the obvious `Number.isFinite(Number(x))` counted every failed
     conversion as a competitor selling at €0.00 — which drags the median toward
     zero and produces a confident recommendation to sell at a loss. Caught by
     the currency test, which is exactly why it asserts on the statistics rather
     than on the stored row. */
  const converted = (o) => o.price_eur_cents != null && Number.isFinite(Number(o.price_eur_cents));
  const usable = observations.filter((o) => converted(o) && !o.is_official);
  const official = observations.filter((o) => o.is_official && converted(o));
  const prices = usable.map((o) => Number(o.price_eur_cents));

  const freshest = observations.reduce((max, o) => {
    const t = Date.parse(o.observed_at || '');
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);

  const ageHours = freshest ? (now - freshest) / 3600_000 : null;
  const sources = new Set(usable.map((o) => o.source_key));
  const unconverted = observations.filter((o) => !o.is_official && !converted(o)).length;
  const inStock = usable.filter((o) => o.availability === 'in_stock').length;

  return {
    lowCents: prices.length ? Math.min(...prices) : null,
    medianCents: median(prices),
    highCents: prices.length ? Math.max(...prices) : null,
    officialCents: official.length ? Math.min(...official.map((o) => Number(o.price_eur_cents))) : null,
    competitorCount: prices.length,
    sourceCount: sources.size,
    inStockCount: inStock,
    unconvertedCount: unconverted,
    freshestAt: freshest ? new Date(freshest).toISOString() : null,
    ageHours: ageHours == null ? null : round2(ageHours),
  };
}

/**
 * The lowest price at which this sale still clears the minimum profit.
 *
 * @param costEur what the unit costs us to buy/produce
 */
export function minimumProfitablePrice(costEur, cfg = config.market) {
  const feePct = cfg.paymentFeePercent / 100;
  const srcPct = cfg.sourceCostPercent / 100;
  const denom = 1 - feePct - srcPct;
  if (denom <= 0) throw new Error('payment + source fees consume the whole price — check PAYMENT_FEE_PERCENT / SOURCE_COST_PERCENT');
  const net = Number(costEur) + cfg.fulfillmentCostEur + cfg.paymentFixedFee + cfg.minimumProfitEur;
  const exVat = net / denom;
  // VAT is added only when the shop is actually configured to charge it.
  const vat = cfg.vatPercent > 0 && cfg.pricesIncludeVat ? 1 + cfg.vatPercent / 100 : 1;
  return round2(exVat * vat);
}

/** The margin and profit a given price actually yields, after every deduction. */
export function marginAt(priceEur, costEur, cfg = config.market) {
  const p = Number(priceEur);
  const exVat = cfg.vatPercent > 0 && cfg.pricesIncludeVat ? p / (1 + cfg.vatPercent / 100) : p;
  const fees = exVat * (cfg.paymentFeePercent / 100) + cfg.paymentFixedFee
    + exVat * (cfg.sourceCostPercent / 100);
  const profit = exVat - Number(costEur) - cfg.fulfillmentCostEur - fees;
  return { profitEur: round2(profit), marginPct: exVat > 0 ? round2((profit / exVat) * 100) : null };
}

/**
 * The market price we are positioning against, per MARKET_PRICE_BASIS.
 * Median by default: the lowest listing is frequently an outlier, a mistake, or
 * a seller with no stock, and anchoring on it imports their error.
 */
function basisPrice(stats, cfg) {
  const pick = { low: stats.lowCents, median: stats.medianCents, high: stats.highCents }[cfg.marketBasis];
  return pick == null ? null : eur(pick);
}

/**
 * Recommend a price, or explain why nobody should.
 *
 * Returns the number AND the blockers. A blocked recommendation still computes
 * its price — the reviewer needs to see what was proposed to judge the refusal
 * — but its status is REQUIRES_REVIEW and no automation may publish it.
 */
export function recommend({ stats, costEur, currentPriceEur = null, identityConfidence = 1,
  promotional = false, cfg = config.market, now = Date.now() } = {}) {
  const blockers = [];
  const notes = [];

  // ── The gates, each one a documented reason not to trust this number ─────
  if (stats.competitorCount < cfg.minCompetitors) {
    blockers.push({ code: 'TOO_FEW_COMPETITORS',
      detail: `${stats.competitorCount} usable price(s), minimum is ${cfg.minCompetitors}` });
  }
  if (stats.ageHours == null) {
    blockers.push({ code: 'NO_OBSERVATIONS', detail: 'nothing has been observed for this product' });
  } else if (stats.ageHours > cfg.maxObservationAgeHours) {
    blockers.push({ code: 'STALE_DATA',
      detail: `newest observation is ${stats.ageHours}h old, limit is ${cfg.maxObservationAgeHours}h` });
  }
  if (stats.unconvertedCount > 0) {
    blockers.push({ code: 'CURRENCY_CONVERSION_FAILED',
      detail: `${stats.unconvertedCount} observation(s) had no usable exchange rate` });
  }
  if (identityConfidence < cfg.minConfidence) {
    blockers.push({ code: 'UNCERTAIN_IDENTITY',
      detail: `product identity confidence ${identityConfidence} is below ${cfg.minConfidence}` });
  }
  if (stats.competitorCount > 0 && stats.inStockCount === 0) {
    blockers.push({ code: 'AVAILABILITY_UNCERTAIN',
      detail: 'no observed listing is confirmed in stock' });
  }

  const market = basisPrice(stats, cfg);
  const floor = minimumProfitablePrice(costEur, cfg);

  let recommended = null;
  let formulaError = null;
  if (market != null) {
    const targetMargin = promotional ? cfg.promotionMargin : cfg.targetMargin;
    const vars = {
      minimum_profitable_price: floor,
      competitive_market_price: market,
      target_position: cfg.targetMarketPosition,
      lowest_competitor_price: stats.lowCents == null ? market : eur(stats.lowCents),
      median_competitor_price: stats.medianCents == null ? market : eur(stats.medianCents),
      highest_competitor_price: stats.highCents == null ? market : eur(stats.highCents),
      official_price: stats.officialCents == null ? 0 : eur(stats.officialCents),
      cost: Number(costEur),
      target_margin: targetMargin,
      minimum_profit: cfg.minimumProfitEur,
      payment_fee_percent: cfg.paymentFeePercent,
      payment_fixed_fee: cfg.paymentFixedFee,
      fulfillment_cost: cfg.fulfillmentCostEur,
      vat_percent: cfg.vatPercent,
      competitor_count: stats.competitorCount,
    };
    try {
      recommended = round2(evaluateFormula(cfg.formula, vars));
    } catch (err) {
      formulaError = err.message;
      blockers.push({ code: 'FORMULA_ERROR', detail: err.message });
    }
  } else {
    blockers.push({ code: 'NO_MARKET_PRICE', detail: 'no competitor price could be summarised' });
  }

  if (recommended != null) {
    // The floor is not advice. Whatever the formula said, we do not sell below it.
    if (recommended < floor) {
      notes.push(`formula produced €${recommended}, raised to the profitable floor €${floor}`);
      recommended = floor;
    }

    // Undercutting has a configured limit, so "competitive" cannot become a
    // race to the bottom one refresh at a time.
    if (stats.lowCents != null) {
      const low = eur(stats.lowCents);
      const maxUndercut = low * (1 - cfg.maxCompetitorUndercutPercent / 100);
      if (recommended < maxUndercut) {
        notes.push(`raised from €${recommended} to €${round2(maxUndercut)}: `
          + `MAX_COMPETITOR_UNDERCUT_PERCENT caps the undercut at ${cfg.maxCompetitorUndercutPercent}%`);
        recommended = round2(maxUndercut);
      }
      // Far below the cheapest seller is more often our bug than their mistake.
      if (recommended < low * (1 - cfg.suspiciousBelowLowPercent / 100)) {
        blockers.push({ code: 'SUSPICIOUS_PRICE',
          detail: `€${recommended} is more than ${cfg.suspiciousBelowLowPercent}% under the cheapest observed €${low}` });
      }
    }

    if (currentPriceEur != null && Number(currentPriceEur) > 0) {
      const change = Math.abs(recommended - currentPriceEur) / currentPriceEur * 100;
      if (change > cfg.maxPriceChangePercent) {
        blockers.push({ code: 'PRICE_JUMP',
          detail: `€${currentPriceEur} → €${recommended} is a ${round2(change)}% move, limit is ${cfg.maxPriceChangePercent}%` });
      }
    }
  }

  const m = recommended == null ? { profitEur: null, marginPct: null } : marginAt(recommended, costEur, cfg);
  if (m.marginPct != null && m.marginPct < 0) {
    blockers.push({ code: 'BELOW_MINIMUM_MARGIN', detail: `margin ${m.marginPct}% is negative` });
  } else if (m.profitEur != null && m.profitEur + 1e-9 < cfg.minimumProfitEur) {
    blockers.push({ code: 'BELOW_MINIMUM_PROFIT',
      detail: `profit €${m.profitEur} is under MINIMUM_PROFIT_EUR €${cfg.minimumProfitEur}` });
  }

  /* Confidence is composed of things we can count, not a feeling: how many
     independent sources agree, how fresh they are, and how sure we are that
     this is even the right product. */
  const freshness = stats.ageHours == null ? 0
    : Math.max(0, 1 - stats.ageHours / (cfg.maxObservationAgeHours * 2));
  const breadth = Math.min(1, stats.competitorCount / (cfg.minCompetitors * 2));
  const spread = Math.min(1, stats.sourceCount / 2);
  const confidence = round2(Math.min(1, (freshness * 0.4 + breadth * 0.35 + spread * 0.25)) * identityConfidence);

  return {
    recommendedEur: recommended,
    floorEur: floor,
    marketEur: market,
    marginPct: m.marginPct,
    profitEur: m.profitEur,
    confidence,
    blockers,
    notes,
    formulaError,
    status: blockers.length ? 'requires_review' : 'recommended',
  };
}
