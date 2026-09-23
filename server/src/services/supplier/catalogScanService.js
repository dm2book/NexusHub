/**
 * "Which of the things I sell can this supplier actually deliver, profitably?"
 *
 * The picker answers that one product at a time. With 71 products that is an
 * hour of clicking to reach a single number — how much of the catalogue can be
 * automated — and that number decides whether a launch date is real. This runs
 * the same search over many products and reports the answer as a table.
 *
 * ── IT PROPOSES. IT NEVER MAPS ────────────────────────────────────────────
 * Matching is by NAME. "Robux" finds a 5 EUR gift card as happily as the
 * 1,000 Robux top-up, and a mapping pointed at the wrong listing sells somebody
 * a product they did not buy — in a region where it may not even redeem. A bulk
 * scan is exactly the feature that invites blind trust, so every row here is a
 * CANDIDATE with the supplier's own title, platform and region attached, and a
 * human clicks to map it. Nothing in this file writes a mapping.
 *
 * ── WHAT "BEST" MEANS ─────────────────────────────────────────────────────
 * Not the top search hit. The cheapest listing that could actually fulfil an
 * order today: in stock, and below what the shop charges — because
 * fulfillmentService refuses to auto-buy at or above the sell price, silently,
 * and a mapping that fails that test looks fine and never delivers.
 *
 * When nothing qualifies the cheapest candidate is still returned, with the
 * verdict saying why it does not: an owner needs to see that the Roblox card
 * costs €14.80 against a €9.99 price, not just that there is "no match".
 */
import { searchTermsFor } from './SupplierConnector.js';

/** Why a product can or cannot be sourced here, in one word. */
export const VERDICT = {
  PROFITABLE: 'profitable',       // in stock, below the sell price → auto-buyable
  BELOW_COST: 'below_cost',       // found, but costs at least what we charge
  OUT_OF_STOCK: 'out_of_stock',   // found and priced fine, nobody has it today
  NOT_FOUND: 'not_found',         // this supplier does not carry it under any term
  NO_PRICE: 'no_price',           // our own product has no price to compare against
};

const cheapest = (rows) => rows.reduce((a, r) => (a === null || r.cost < a.cost ? r : a), null);

/**
 * Pick the candidate worth showing, and say what it means.
 *
 * Deliberately three passes rather than one sort: the question is not "which is
 * first" but "is there one that WORKS, and if not, how close is the nearest".
 */
export function judge(candidates, priceCents) {
  if (!candidates.length) return { best: null, verdict: VERDICT.NOT_FOUND };
  if (!(priceCents > 0)) return { best: cheapest(candidates), verdict: VERDICT.NO_PRICE };

  const inStock = candidates.filter((c) => c.status === 'in_stock');
  const affordable = inStock.filter((c) => c.cost < priceCents);
  if (affordable.length) return { best: cheapest(affordable), verdict: VERDICT.PROFITABLE };

  /* In stock but too expensive, or cheap enough but nobody has it — different
     problems with different fixes (reprice vs wait), so they are different
     verdicts rather than one "no". */
  const underPrice = candidates.filter((c) => c.cost < priceCents);
  if (underPrice.length) return { best: cheapest(underPrice), verdict: VERDICT.OUT_OF_STOCK };
  return { best: cheapest(candidates), verdict: VERDICT.BELOW_COST };
}

/** Margin figures for a candidate against what the shop charges. */
export function marginOf(best, priceCents) {
  if (!best || !(priceCents > 0) || best.cost == null) {
    return { marginCents: null, marginPct: null, wouldRefuseAutoBuy: null };
  }
  const marginCents = priceCents - best.cost;
  return {
    marginCents,
    marginPct: Math.round((marginCents / priceCents) * 1000) / 10,
    /* The exact condition fulfillmentService refuses on, so this table and the
       behaviour at order time cannot disagree. */
    wouldRefuseAutoBuy: best.cost >= priceCents,
  };
}

/**
 * One product against one supplier: the raw candidates, before any judging.
 * Shared by this per-supplier scan and the all-supplier best-source scan, so
 * both search with the same terms in the same order.
 *
 * Search terms are tried shortest-last and it stops at the first that finds
 * anything — a shop writes "1,000 Robux" and a supplier lists "1000 Robux",
 * and without the fallback the whole catalogue reads as "not carried".
 */
export async function searchCandidates(connector, product, { limit = 25 } = {}) {
  const terms = searchTermsFor(product.name);
  const tried = [];
  let candidates = [];
  let searchedFor = terms[0] || product.name;

  for (const term of terms) {
    tried.push(term);
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: each
    // is a request to somebody else's API, and we stop at the first that works.
    candidates = await connector.searchCatalog(term, { limit }).catch(() => []);
    if (candidates.length) { searchedFor = term; break; }
  }
  return { candidates, searchedFor, tried };
}

/** One product against one supplier, judged. */
export async function scanProduct(connector, product, opts = {}) {
  const priceCents = Number(product.price) || 0;
  const { candidates, searchedFor, tried } = await searchCandidates(connector, product, opts);

  const { best, verdict } = judge(candidates, priceCents);
  return {
    productId: product.id,
    name: product.name,
    priceCents,
    searchedFor,
    tried,
    candidates: candidates.length,
    best,
    verdict,
    ...marginOf(best, priceCents),
  };
}

/**
 * A batch of products, one after another.
 *
 * Sequential, not Promise.all. Firing seventy parallel requests at a supplier's
 * API is how an integration gets rate-limited or an account gets flagged, and
 * the whole point of batching this from the client is that nothing here needs
 * to be fast — it needs to finish.
 */
export async function scanProducts(connector, products, opts = {}) {
  const out = [];
  for (const p of products) {
    // eslint-disable-next-line no-await-in-loop -- see above.
    out.push(await scanProduct(connector, p, opts));
  }
  return out;
}

/** How the whole run reads at a glance. */
export function summarise(rows) {
  const by = (v) => rows.filter((r) => r.verdict === v).length;
  const profitable = rows.filter((r) => r.verdict === VERDICT.PROFITABLE);
  return {
    scanned: rows.length,
    profitable: profitable.length,
    belowCost: by(VERDICT.BELOW_COST),
    outOfStock: by(VERDICT.OUT_OF_STOCK),
    notFound: by(VERDICT.NOT_FOUND),
    noPrice: by(VERDICT.NO_PRICE),
    /* Null rather than 0 when nothing is profitable: "no margin to report" and
       "an average margin of zero" are different statements. */
    averageMarginPct: profitable.length
      ? Math.round((profitable.reduce((a, r) => a + r.marginPct, 0) / profitable.length) * 10) / 10
      : null,
  };
}
