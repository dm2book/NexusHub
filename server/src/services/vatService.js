/**
 * VAT, and the one question the profit dashboard never asked.
 *
 * The shop's prices are what a buyer pays. Once the seller is registered for
 * BTW, roughly a fifth of every one of those euros is not the seller's money:
 * it is collected on behalf of the Belastingdienst and paid over. The profit
 * page counted all of it as revenue, so the moment a btw-identificatienummer
 * exists, every margin on that page is overstated by the VAT share — on a €10
 * sale at 21% that is €1.74 of imaginary profit, and margins are what prices
 * get set from.
 *
 * ── WHERE THE RATE COMES FROM ─────────────────────────────────────────────
 * From the same single fact the terms already derive their VAT sentence from:
 * whether a btw-identificatienummer is published. That is deliberate. An unset
 * field is not evidence of a tax position, so this does not guess one — it
 * simply takes nothing out until the seller says they are registered, which is
 * the only state in which taking something out would be correct.
 *
 * Before registration the numbers are unchanged, because before registration
 * they were right.
 *
 * ── WHAT THIS DOES NOT KNOW ───────────────────────────────────────────────
 * It does not know the rate that applies to a given sale. Digital services to
 * a consumer in another EU country are taxed at THAT country's rate under the
 * OSS rules, and this system does not record where a buyer was. One rate is a
 * good estimate for a shop selling mostly at home and a bad one for a shop
 * that is not; the figure is labelled as an estimate for that reason.
 *
 * It also takes the entered COST as given. A supplier invoice for digital keys
 * from another EU country normally carries no reclaimable Dutch VAT — it is
 * reverse-charged — so the cost is already net and nothing should come off it.
 * If a supplier did charge VAT that the seller can reclaim, the cost here is
 * too high and the margin is understated. That is the safer direction to be
 * wrong in, and it is written down rather than silently corrected.
 */
import { config } from '../config/env.js';
import { LEGAL } from '../../../src/lib/legalIdentity.js';

/** The Dutch standard rate, used when the shop is registered and set no other. */
export const NL_STANDARD_RATE = 0.21;

/**
 * The fraction to take out of a gross price, or 0 when none should be.
 *
 * `legal` and `rate` are arguments so this can be tested without a build and
 * without a registered shop.
 */
export function vatRate({ legal = LEGAL, rate = config.vatRate } = {}) {
  if (!String(legal?.vat || '').trim()) return 0;
  const r = Number(rate);
  return Number.isFinite(r) && r >= 0 && r < 1 ? r : NL_STANDARD_RATE;
}

/** What is left of a gross amount after VAT comes out. Whole cents. */
export function netCents(grossCents, rate = 0) {
  const gross = Number(grossCents) || 0;
  if (!(rate > 0)) return Math.round(gross);
  return Math.round(gross / (1 + rate));
}

/** What of a gross amount belongs to the Belastingdienst. */
export function vatCents(grossCents, rate = 0) {
  const gross = Math.round(Number(grossCents) || 0);
  return gross - netCents(gross, rate);
}

/**
 * Everything a report needs to say about VAT in one object.
 *
 * `registered` is the honest name for it: this is a statement about what the
 * shop has published, not a tax opinion.
 */
export function vatContext(opts = {}) {
  const rate = vatRate(opts);
  return {
    rate,
    registered: rate > 0,
    pct: Math.round(rate * 1000) / 10,
    /* Named so a reader of the API cannot mistake one rate applied to every
       sale for a calculation of what is actually owed. */
    estimate: true,
  };
}
