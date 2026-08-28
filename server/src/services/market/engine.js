/**
 * The jobs, the recommendations, and the one place a price is allowed to change.
 *
 * Five scheduled pieces of work, each idempotent and each rate-limited by its
 * own interval in configuration:
 *
 *   1. refreshSources()      what may we query today, and why not
 *   2. runProductDiscovery() ask permitted sources what they sell
 *   3. (normalization happens on the way in — see observations.js)
 *   4. refreshRecommendations() price every product we hold evidence for
 *   5. detectStaleData()     find the prices that have quietly stopped being true
 *
 * Customer-facing prices are never touched by any of them. publishRecommendation()
 * is the only writer of products.price, it takes an actor, and it refuses a
 * recommendation that is not approved. That separation is the difference between
 * a pricing assistant and an automated way to sell at a loss.
 */
import { config } from '../../config/env.js';
import { all, get, run, nowIso } from '../../db/index.js';
import { newId } from '../../utils/ids.js';
import { alertOwner } from '../notifyService.js';
import { sourceStatuses, persistSourceStatuses, fetchFromSource, SourceUnavailable, SOURCES } from './sources.js';
import { recordObservation, latestPerSource } from './observations.js';
import { runDiscovery, CANDIDATE_STATUS } from './discovery.js';
import { summarise, recommend, marginAt } from './pricing.js';

const KV_PREFIX = 'market.job.';

/** Has this job run inside its own interval? Keeps refreshes sane and cheap. */
async function dueFor(job, hours) {
  const row = await get(`SELECT value FROM kv WHERE key=@k`, { k: KV_PREFIX + job }).catch(() => null);
  if (!row?.value) return true;
  const last = Date.parse(row.value);
  return !Number.isFinite(last) || (Date.now() - last) >= hours * 3600_000;
}
async function markRun(job) {
  const at = nowIso();
  await run(`INSERT INTO kv (key, value, updated_at) VALUES (@k,@v,@at)
             ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@at`,
    { k: KV_PREFIX + job, v: at, at }).catch(() => {});
}

// ── 1. Sources ─────────────────────────────────────────────────────────────
export async function refreshSources({ checkRobots = true } = {}) {
  const statuses = await sourceStatuses({ checkRobots });
  await persistSourceStatuses(statuses);
  return statuses;
}

// ── 2. Discovery ───────────────────────────────────────────────────────────
/**
 * Ask every permitted source about a set of search terms.
 *
 * A source that may not be queried is reported, not worked around — the return
 * value carries an `unavailable` list so the dashboard can show WHY a market
 * looks empty, which is the difference between "nobody sells this" and "we are
 * not allowed to ask".
 */
export async function collectFromSources(queries, { fetchImpl = fetch } = {}) {
  const result = { recorded: 0, unavailable: [], errors: [], bySource: {} };
  const statuses = await sourceStatuses();

  for (const s of statuses) {
    if (s.status !== 'available' || s.neverAutomated) {
      result.unavailable.push({ source: s.key, status: s.status, reason: s.statusReason });
      continue;
    }
    const src = SOURCES.find((x) => x.key === s.key);
    if (!src || src.kind === 'manual') continue;      // manual sources are pushed to us

    for (const q of queries) {
      try {
        const offers = await fetchFromSource(s.key, q, { fetchImpl });
        for (const offer of offers) {
          try {
            await recordObservation(s.key, { ...offer, observedAt: nowIso() });
            result.recorded += 1;
            result.bySource[s.key] = (result.bySource[s.key] || 0) + 1;
          } catch (err) { result.errors.push({ source: s.key, query: q, error: err.message }); }
        }
      } catch (err) {
        if (err instanceof SourceUnavailable) result.unavailable.push({ source: s.key, status: 'unavailable', reason: err.reason });
        else result.errors.push({ source: s.key, query: q, error: err.message });
        await run(`UPDATE market_sources SET last_error=@e, updated_at=@at WHERE key=@k`,
          { e: err.message.slice(0, 500), at: nowIso(), k: s.key }).catch(() => {});
      }
    }
    await run(`UPDATE market_sources SET last_run_at=@at, updated_at=@at WHERE key=@k`,
      { at: nowIso(), k: s.key }).catch(() => {});
  }
  return result;
}

/** Search terms built from what we already sell, plus the games we know about. */
export async function discoveryQueries() {
  const rows = await all(`SELECT DISTINCT category FROM products WHERE active=1 AND category IS NOT NULL`);
  const fromCatalogue = rows.map((r) => String(r.category)).filter(Boolean);
  const { GAMES } = await import('./normalize.js');
  return [...new Set([...fromCatalogue, ...GAMES.map((g) => g.label)])];
}

export async function runProductDiscovery({ force = false, fetchImpl = fetch } = {}) {
  if (!force && !(await dueFor('discovery', config.market.discoveryIntervalHours))) {
    return { skipped: 'not due', nextIn: config.market.discoveryIntervalHours };
  }
  const collected = await collectFromSources(await discoveryQueries(), { fetchImpl });
  const classified = await runDiscovery();
  await markRun('discovery');

  /* A genuinely new product is worth telling the owner about — once, and only
     when it is new. dedupeKey is the canonical key, so a product rediscovered
     every night does not page anybody twice. */
  const fresh = await all(
    `SELECT c.id, p.title, p.canonical_key FROM market_candidates c
       JOIN market_products p ON p.id = c.market_product_id
      WHERE c.status = @s AND c.created_at > @cut`,
    { s: CANDIDATE_STATUS.DISCOVERED, cut: new Date(Date.now() - 26 * 3600_000).toISOString() });
  for (const f of fresh.slice(0, 10)) {
    await alertOwner('market.new_product', {
      title: `New product on the market: ${f.title}`,
      lines: ['Not in the ForgeMarket catalogue', 'Review it in Admin → Market'],
      dedupeKey: `market.new:${f.canonical_key}`,
    }).catch(() => {});
  }
  return { collected, classified, newCandidates: fresh.length };
}

// ── 4. Recommendations ─────────────────────────────────────────────────────
/**
 * What does this product cost us? Real numbers only.
 *
 * Supplier cost when the owner mapped one, otherwise the stored buy cost. When
 * neither exists there is no cost, and a recommendation without a cost cannot
 * assert a margin — so it is blocked rather than assumed to be free.
 */
export async function costFor(forgeProductId) {
  if (!forgeProductId) return null;
  const mapped = await get(
    `SELECT cost_cents FROM supplier_products WHERE product_id=@p AND cost_cents IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`, { p: forgeProductId }).catch(() => null);
  if (mapped?.cost_cents != null) return Number(mapped.cost_cents) / 100;
  const p = await get(`SELECT metadata FROM products WHERE id=@p`, { p: forgeProductId }).catch(() => null);
  try {
    const meta = JSON.parse(p?.metadata || '{}');
    if (Number.isFinite(Number(meta.costCents))) return Number(meta.costCents) / 100;
    if (Number.isFinite(Number(meta.buyPrice))) return Number(meta.buyPrice);
  } catch { /* no metadata cost */ }
  return null;
}

export async function recommendFor(marketProductId, { promotional = false } = {}) {
  const mp = await get(`SELECT * FROM market_products WHERE id=@id`, { id: marketProductId });
  if (!mp) throw new Error('no such market product');
  const cand = await get(`SELECT * FROM market_candidates WHERE market_product_id=@id`, { id: marketProductId });
  const forgeProductId = cand?.forge_product_id || null;

  const obs = await latestPerSource(marketProductId, { sinceHours: config.market.maxObservationAgeHours * 4 });
  const stats = summarise(obs);

  const costEur = await costFor(forgeProductId);
  const current = forgeProductId
    ? Number((await get(`SELECT price FROM products WHERE id=@p`, { p: forgeProductId }))?.price || 0) / 100
    : null;

  if (costEur == null) {
    const rec = {
      recommendedEur: null, floorEur: null, marketEur: stats.medianCents == null ? null : stats.medianCents / 100,
      marginPct: null, profitEur: null, confidence: 0,
      blockers: [{ code: 'NO_COST', detail: 'no purchase cost is recorded for this product, so no margin can be asserted' }],
      notes: [], status: 'requires_review',
    };
    return persistRecommendation(mp, forgeProductId, stats, rec);
  }

  const rec = recommend({
    stats, costEur, currentPriceEur: current || null,
    identityConfidence: Number(cand?.match_confidence ?? 1), promotional,
  });
  return persistRecommendation(mp, forgeProductId, stats, rec, { costEur, current });
}

async function persistRecommendation(mp, forgeProductId, stats, rec, extra = {}) {
  const id = newId('mkr');
  await run(
    `INSERT INTO market_price_recommendations (id, market_product_id, forge_product_id, low_cents,
       median_cents, high_cents, official_cents, competitor_count, freshest_at, confidence,
       recommended_cents, margin_pct, profit_cents, status, blockers, inputs, created_at)
     VALUES (@id,@mp,@fp,@low,@med,@high,@off,@n,@fresh,@conf,@rec,@margin,@profit,@status,@blockers,@inputs,@at)`,
    { id, mp: mp.id, fp: forgeProductId, low: stats.lowCents, med: stats.medianCents, high: stats.highCents,
      off: stats.officialCents, n: stats.competitorCount, fresh: stats.freshestAt, conf: rec.confidence,
      rec: rec.recommendedEur == null ? null : Math.round(rec.recommendedEur * 100),
      margin: rec.marginPct, profit: rec.profitEur == null ? null : Math.round(rec.profitEur * 100),
      status: rec.status, blockers: JSON.stringify(rec.blockers),
      inputs: JSON.stringify({ ...extra, stats, notes: rec.notes, floorEur: rec.floorEur,
        formula: config.market.formula }),
      at: nowIso() });
  return { id, product: mp, stats, ...rec };
}

export async function refreshRecommendations({ force = false } = {}) {
  if (!force && !(await dueFor('pricing', config.market.priceRefreshIntervalHours))) {
    return { skipped: 'not due', nextIn: config.market.priceRefreshIntervalHours };
  }
  const products = await all(
    `SELECT DISTINCT p.id FROM market_products p
       JOIN market_observations o ON o.market_product_id = p.id`);
  const out = { priced: 0, requiresReview: 0, errors: [] };
  for (const p of products) {
    try {
      const r = await recommendFor(p.id);
      out.priced += 1;
      if (r.status === 'requires_review') out.requiresReview += 1;
      await maybeAlert(r);
    } catch (err) { out.errors.push({ product: p.id, error: err.message }); }
  }
  await markRun('pricing');
  return out;
}

/** The four things worth interrupting the owner for. */
async function maybeAlert(rec) {
  const key = rec.product.canonical_key;
  if (rec.marginPct != null && rec.marginPct < config.market.targetMargin * 100 * 0.5) {
    await alertOwner('market.margin_low', {
      title: `Margin ${rec.marginPct}% on ${rec.product.title}`,
      lines: [`Recommended €${rec.recommendedEur}`, `Target margin ${(config.market.targetMargin * 100).toFixed(0)}%`],
      dedupeKey: `market.margin:${key}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(() => {});
  }
  if (rec.blockers?.some((b) => b.code === 'SUSPICIOUS_PRICE')) {
    await alertOwner('market.suspicious_price', {
      title: `Suspicious price for ${rec.product.title}`,
      lines: rec.blockers.map((b) => b.detail).slice(0, 3),
      dedupeKey: `market.susp:${key}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(() => {});
  }
  if (rec.stats?.competitorCount > 0 && rec.stats.inStockCount === 0) {
    await alertOwner('market.unavailable', {
      title: `${rec.product.title} is out of stock across the market`,
      lines: [`${rec.stats.competitorCount} listing(s), none in stock`],
      dedupeKey: `market.unavail:${key}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(() => {});
  }
}

// ── 5. Stale data ──────────────────────────────────────────────────────────
/**
 * Which of our live prices rest on evidence that has gone off?
 *
 * A stale price is not wrong, it is unsupported — and the difference matters,
 * because the response is to go and look rather than to change the number.
 */
export async function detectStaleData() {
  const cut = new Date(Date.now() - config.market.maxObservationAgeHours * 3600_000).toISOString();
  const rows = await all(
    `SELECT p.id, p.title, p.canonical_key, c.forge_product_id,
            MAX(o.observed_at) AS last_seen, COUNT(o.id) AS observations
       FROM market_products p
       LEFT JOIN market_candidates c ON c.market_product_id = p.id
       LEFT JOIN market_observations o ON o.market_product_id = p.id
      GROUP BY p.id, p.title, p.canonical_key, c.forge_product_id`);
  const stale = rows.filter((r) => !r.last_seen || r.last_seen < cut);
  for (const s of stale.filter((x) => x.forge_product_id).slice(0, 10)) {
    await alertOwner('market.stale', {
      title: `Price evidence has gone stale: ${s.title}`,
      lines: [s.last_seen ? `Last observed ${s.last_seen}` : 'Never observed',
        `Older than ${config.market.maxObservationAgeHours}h`],
      dedupeKey: `market.stale:${s.canonical_key}:${new Date().toISOString().slice(0, 10)}`,
    }).catch(() => {});
  }
  return { checked: rows.length, stale: stale.length, items: stale.slice(0, 50) };
}

// ── Approval and the single write path to a live price ─────────────────────
export async function decideRecommendation(recommendationId, to, { actor, reason = '' } = {}) {
  if (!actor) throw new Error('a pricing decision needs a named actor');
  const allowed = ['approved', 'rejected'];
  if (!allowed.includes(to)) throw new Error(`status must be one of ${allowed.join(', ')}`);
  const r = await get(`SELECT * FROM market_price_recommendations WHERE id=@id`, { id: recommendationId });
  if (!r) throw new Error('no such recommendation');
  if (r.status === 'published') throw new Error('that recommendation has already been published');
  await run(`UPDATE market_price_recommendations SET status=@s, decided_by=@by, decided_at=@at WHERE id=@id`,
    { s: to, by: actor, at: nowIso(), id: recommendationId });
  await run(`INSERT INTO market_price_history (id, market_product_id, forge_product_id, old_cents, new_cents,
               source, reason, margin_pct, approval_status, actor, created_at)
             VALUES (@id,@mp,@fp,@old,@new,'recommendation',@reason,@margin,@st,@actor,@at)`,
    { id: newId('mkh'), mp: r.market_product_id, fp: r.forge_product_id, old: null,
      new: r.recommended_cents, reason: reason || `${to} by ${actor}`, margin: r.margin_pct,
      st: to, actor, at: nowIso() });
  return get(`SELECT * FROM market_price_recommendations WHERE id=@id`, { id: recommendationId });
}

/**
 * Publish an approved recommendation onto the live product.
 *
 * The ONLY place in this system that writes products.price. It refuses a
 * recommendation that is not approved, refuses one with no product, and writes
 * a history row with the old value before it changes anything — so every live
 * price can be traced to a decision, a person and the evidence behind it.
 */
export async function publishRecommendation(recommendationId, { actor } = {}) {
  if (!actor) throw new Error('publishing a price needs a named actor');
  const r = await get(`SELECT * FROM market_price_recommendations WHERE id=@id`, { id: recommendationId });
  if (!r) throw new Error('no such recommendation');
  if (r.status !== 'approved') throw new Error(`only an approved recommendation can be published (this one is ${r.status})`);
  if (!r.forge_product_id) throw new Error('this recommendation is not attached to a ForgeMarket product');
  if (r.recommended_cents == null) throw new Error('this recommendation has no price');

  const product = await get(`SELECT id, price, name FROM products WHERE id=@p`, { p: r.forge_product_id });
  if (!product) throw new Error('the product no longer exists');

  await run(`UPDATE products SET price=@price, updated_at=@at WHERE id=@id`,
    { price: r.recommended_cents, at: nowIso(), id: product.id });
  await run(`UPDATE market_price_recommendations SET status='published', decided_by=@by, decided_at=@at WHERE id=@id`,
    { by: actor, at: nowIso(), id: recommendationId });
  await run(`INSERT INTO market_price_history (id, market_product_id, forge_product_id, old_cents, new_cents,
               source, reason, margin_pct, approval_status, actor, created_at)
             VALUES (@id,@mp,@fp,@old,@new,'published',@reason,@margin,'published',@actor,@at)`,
    { id: newId('mkh'), mp: r.market_product_id, fp: r.forge_product_id, old: product.price,
      new: r.recommended_cents, reason: `published by ${actor}`, margin: r.margin_pct,
      actor, at: nowIso() });

  return { productId: product.id, oldCents: product.price, newCents: r.recommended_cents };
}

export async function priceHistory({ forgeProductId = null, limit = 100 } = {}) {
  return forgeProductId
    ? all(`SELECT * FROM market_price_history WHERE forge_product_id=@p ORDER BY created_at DESC LIMIT @l`,
      { p: forgeProductId, l: limit })
    : all(`SELECT * FROM market_price_history ORDER BY created_at DESC LIMIT @l`, { l: limit });
}

/** Everything the pricing dashboard shows, in one query set. */
export async function pricingReport({ limit = 100 } = {}) {
  const rows = await all(
    `SELECT DISTINCT ON (r.market_product_id) r.*, p.title, p.canonical_key,
            pr.name AS forge_name, pr.price AS forge_price_cents
       FROM market_price_recommendations r
       JOIN market_products p ON p.id = r.market_product_id
       LEFT JOIN products pr ON pr.id = r.forge_product_id
      ORDER BY r.market_product_id, r.created_at DESC`);
  return rows.slice(0, limit).map((r) => ({
    ...r,
    blockers: JSON.parse(r.blockers || '[]'),
    inputs: JSON.parse(r.inputs || '{}'),
    stale: !r.freshest_at
      || (Date.now() - Date.parse(r.freshest_at)) > config.market.maxObservationAgeHours * 3600_000,
  }));
}

export { marginAt, summarise };
