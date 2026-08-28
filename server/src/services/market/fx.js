/**
 * Currency conversion, or an honest refusal.
 *
 * Competitor prices arrive in whatever currency the marketplace quotes, and a
 * pricing engine that compares 25 USD with 25 EUR produces a number that looks
 * like analysis and is not. So every conversion here either returns a rate WITH
 * the moment and the source it came from, or returns null.
 *
 * There is no fallback rate. 1.0 is not a safe default — it is a 10-15% pricing
 * error wearing a plausible face, and it would be applied silently to every
 * product from a source that changed its quoting currency.
 *
 * Rates are stored rather than fetched on demand: an owner can paste in the
 * rates their accountant uses (MARKET_FX_RATES, or the admin API), and a rate
 * older than the staleness window stops being usable rather than quietly
 * ageing. Any provider can be wired in later through recordRate(); nothing else
 * in the system needs to change.
 */
import { all, get, run, nowIso } from '../../db/index.js';
import { newId } from '../../utils/ids.js';

/** Rates older than this are not used for a customer-facing price. */
export const MAX_RATE_AGE_HOURS = 48;

/** Store a rate, with where it came from. Both directions are derivable. */
export async function recordRate(base, quote, rate, { source = 'manual', asOf = null } = {}) {
  const b = String(base).toUpperCase(), q = String(quote).toUpperCase();
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) throw new Error(`refusing to store a nonsense rate: ${rate}`);
  await run(`INSERT INTO fx_rates (id, base, quote, rate, as_of, source, created_at)
             VALUES (@id, @b, @q, @r, @a, @s, @at)`,
    { id: newId('fx'), b, q, r, a: asOf || nowIso(), s: source, at: nowIso() });
  return { base: b, quote: q, rate: r };
}

/**
 * The newest usable rate for base→quote, or null.
 *
 * Same currency is 1.0 and needs no source. The inverse of a stored rate counts:
 * one USD→EUR row answers EUR→USD too, and inventing a second row for it would
 * just be two things to keep in sync.
 */
export async function getRate(base, quote, { maxAgeHours = MAX_RATE_AGE_HOURS, now = Date.now() } = {}) {
  const b = String(base || '').toUpperCase(), q = String(quote || '').toUpperCase();
  if (!b || !q) return null;
  if (b === q) return { rate: 1, asOf: new Date(now).toISOString(), source: 'identity', inverted: false };

  const cutoff = new Date(now - maxAgeHours * 3600_000).toISOString();
  const direct = await get(
    `SELECT rate, as_of, source FROM fx_rates
      WHERE base=@b AND quote=@q AND as_of >= @cut ORDER BY as_of DESC LIMIT 1`, { b, q, cut: cutoff });
  if (direct) return { rate: Number(direct.rate), asOf: direct.as_of, source: direct.source, inverted: false };

  const inverse = await get(
    `SELECT rate, as_of, source FROM fx_rates
      WHERE base=@q AND quote=@b AND as_of >= @cut ORDER BY as_of DESC LIMIT 1`, { b, q, cut: cutoff });
  if (inverse && Number(inverse.rate) > 0) {
    return { rate: 1 / Number(inverse.rate), asOf: inverse.as_of, source: inverse.source, inverted: true };
  }
  return null;
}

/**
 * Convert an amount in minor units, or refuse.
 *
 * @returns {Promise<{cents:number, rate:number, asOf:string, source:string}|null>}
 */
export async function toEurCents(amountCents, currency, opts = {}) {
  const r = await getRate(currency, 'EUR', opts);
  if (!r) return null;
  return { cents: Math.round(Number(amountCents) * r.rate), rate: r.rate, asOf: r.asOf, source: r.source };
}

/** Everything on file, newest first — the admin's view of what it is trusting. */
export async function listRates(limit = 50) {
  return all(`SELECT base, quote, rate, as_of, source FROM fx_rates ORDER BY as_of DESC LIMIT @l`, { l: limit });
}

/** Seed from MARKET_FX_RATES="USD:EUR:0.92,GBP:EUR:1.17". Idempotent enough. */
export async function seedRatesFromEnv(raw) {
  const spec = String(raw || '').trim();
  if (!spec) return 0;
  let n = 0;
  for (const part of spec.split(',')) {
    const [b, q, r] = part.split(':').map((x) => String(x || '').trim());
    if (!b || !q || !r) continue;
    try { await recordRate(b, q, r, { source: 'env:MARKET_FX_RATES' }); n += 1; } catch { /* skip junk */ }
  }
  return n;
}
