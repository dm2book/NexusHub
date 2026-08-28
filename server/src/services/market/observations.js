/**
 * Recording what we saw, where, and when.
 *
 * The one rule: an observation without a source and a timestamp is not stored.
 * Not defaulted, not backfilled with "now" — rejected. Everything downstream —
 * the freshness gate, the confidence score, the audit trail behind a price — is
 * only as honest as this table, and a row with an invented provenance is worse
 * than a missing row because it looks like evidence.
 */
import { all, get, run, nowIso } from '../../db/index.js';
import { newId } from '../../utils/ids.js';
import { parseTitle } from './normalize.js';
import { toEurCents } from './fx.js';
import { bySourceKey } from './sources.js';

/** Find or create the canonical product for a parsed model. */
export async function upsertMarketProduct(model) {
  const existing = await get(`SELECT * FROM market_products WHERE canonical_key=@k`, { k: model.canonicalKey });
  if (existing) return existing;
  const id = newId('mkp');
  const at = nowIso();
  await run(
    `INSERT INTO market_products (id, canonical_key, product_type, game, edition, platform, region,
                                  denomination, denom_unit, quantity, title, created_at, updated_at)
     VALUES (@id,@k,@t,@g,@e,@p,@r,@d,@u,@q,@title,@at,@at)
     ON CONFLICT (canonical_key) DO NOTHING`,
    { id, k: model.canonicalKey, t: model.productType, g: model.game, e: model.edition,
      p: model.platform, r: model.region, d: model.denomination, u: model.denomUnit,
      q: model.quantity, title: model.title, at });
  return get(`SELECT * FROM market_products WHERE canonical_key=@k`, { k: model.canonicalKey });
}

/**
 * Store one offer as an observation.
 *
 * @param offer  { title, priceCents, currency, availability, url, sourceProductId, observedAt, hints }
 * @returns      { observationId, marketProductId, model, converted }
 */
export async function recordObservation(sourceKey, offer) {
  const src = bySourceKey(sourceKey);
  if (!src) throw new Error(`unknown source "${sourceKey}"`);
  if (!offer?.url) throw new Error('an observation needs the URL it came from');
  const observedAt = offer.observedAt || nowIso();
  if (Number.isNaN(Date.parse(observedAt))) throw new Error('an observation needs a real timestamp');
  const priceCents = Math.round(Number(offer.priceCents));
  if (!Number.isFinite(priceCents) || priceCents <= 0) throw new Error('an observation needs a positive price');
  const currency = String(offer.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`"${offer.currency}" is not a currency code`);

  const model = parseTitle(offer.title, offer.hints || {});
  const product = await upsertMarketProduct(model);

  /* Conversion may fail, and when it does the row is still stored — with a NULL
     euro figure. That is deliberate: the observation is real and the reviewer
     should see it, but it cannot enter a price calculation. The summariser
     counts these separately and blocks on them. */
  const converted = await toEurCents(priceCents, currency).catch(() => null);

  const id = newId('mko');
  await run(
    `INSERT INTO market_observations (id, market_product_id, source_key, source_product_id, raw_title,
       price_cents, currency, price_eur_cents, fx_rate, fx_as_of, availability, is_official, url,
       observed_at, created_at)
     VALUES (@id,@p,@s,@sp,@t,@c,@cur,@eur,@rate,@fxat,@av,@off,@url,@obs,@at)`,
    { id, p: product.id, s: sourceKey, sp: offer.sourceProductId || null, t: String(offer.title || '').slice(0, 400),
      c: priceCents, cur: currency, eur: converted?.cents ?? null, rate: converted?.rate ?? null,
      fxat: converted?.asOf ?? null, av: offer.availability || 'unknown',
      off: src.isOfficial ? 1 : 0, url: String(offer.url).slice(0, 1000),
      obs: observedAt, at: nowIso() });

  return { observationId: id, marketProductId: product.id, model, converted: !!converted };
}

/** Observations for a product inside the freshness window the caller cares about. */
export async function observationsFor(marketProductId, { sinceHours = 168 } = {}) {
  const cut = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  return all(
    `SELECT * FROM market_observations
      WHERE market_product_id=@p AND observed_at >= @cut
      ORDER BY observed_at DESC`, { p: marketProductId, cut });
}

/**
 * The newest observation per (source, product), which is what a price summary
 * should read: five daily snapshots from one seller are one seller's opinion,
 * not five competitors, and counting them as five inflates confidence.
 */
export async function latestPerSource(marketProductId, { sinceHours = 168 } = {}) {
  const cut = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  return all(
    `SELECT DISTINCT ON (source_key, COALESCE(source_product_id, '')) *
       FROM market_observations
      WHERE market_product_id=@p AND observed_at >= @cut
      ORDER BY source_key, COALESCE(source_product_id, ''), observed_at DESC`,
    { p: marketProductId, cut });
}

/** Housekeeping: observations stop being useful long before they stop existing. */
export async function pruneObservations({ keepDays = 90 } = {}) {
  const cut = new Date(Date.now() - keepDays * 86400_000).toISOString();
  const r = await run(`DELETE FROM market_observations WHERE observed_at < @cut`, { cut });
  return r?.changes ?? 0;
}
