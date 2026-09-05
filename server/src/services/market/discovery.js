/**
 * What the market sells that we do not.
 *
 * Discovery answers one question per canonical product: does ForgeMarket
 * already have this? The answer is one of five, and four of them are not "add
 * it":
 *
 *   ALREADY_LISTED      we sell it; nothing to do but price it
 *   NEW_CANDIDATE       the market has it, we do not — a proposal, not a product
 *   POSSIBLE_DUPLICATE  we have something that differs in exactly one dimension
 *                       (platform, region, edition…) — a human decides
 *   UNAVAILABLE         observed, but nobody has it in stock
 *   NEEDS_MANUAL_REVIEW we could not read the title well enough to be sure
 *
 * Nothing here creates a customer-facing product. The output is a candidate row
 * with a status, and the only transition into the real catalogue is an approval
 * by a named person, recorded with a timestamp.
 *
 * ── MATCHING AGAINST OUR OWN CATALOGUE ────────────────────────────────────
 * Our products were written by a human for humans ("1,050 FC Points"), so they
 * are put through the same parser as a marketplace title. That is the point of
 * having one parser: if it reads a competitor's title the way it reads ours,
 * the comparison is like for like. Where our own title is too vague to parse,
 * the product is reported as needing review rather than being assumed to match
 * nothing — which would propose a duplicate of something we already sell.
 */
import { all, get, run, nowIso } from '../../db/index.js';
import { newId } from '../../utils/ids.js';
import { parseTitle, nearMiss, canonicalKey } from './normalize.js';
import { latestPerSource } from './observations.js';
import { createProduct, getProduct } from '../productService.js';

export const CANDIDATE_STATUS = {
  DISCOVERED: 'discovered',
  NORMALIZED: 'normalized',
  ALREADY_LISTED: 'already_listed',
  POSSIBLE_DUPLICATE: 'possible_duplicate',
  UNAVAILABLE: 'unavailable',
  NEEDS_REVIEW: 'needs_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PRODUCT_CREATED: 'product_created',
  PUBLISHED: 'published',
};

/** Our own catalogue, parsed into the same canonical model. */
export async function forgeCatalogModels() {
  const rows = await all(`SELECT id, name, sku, price, metadata, active FROM products WHERE active = 1`);
  return rows.map((p) => {
    let meta = {};
    try { meta = JSON.parse(p.metadata || '{}'); } catch { /* keep {} */ }
    const model = parseTitle(p.name, {
      platform: meta.platform, region: meta.region, game: meta.game,
      denomination: meta.denomination, denomUnit: meta.denomUnit,
    });
    return { product: p, model, key: model.canonicalKey };
  });
}

/**
 * Classify one canonical market product against our catalogue.
 * Pure: takes data, returns a verdict. Everything about it is testable without
 * a database, which is why the duplicate rules can be trusted.
 */
export function classify(marketProduct, catalogue, observations) {
  const model = {
    productType: marketProduct.product_type, game: marketProduct.game, edition: marketProduct.edition,
    platform: marketProduct.platform, region: marketProduct.region,
    denomination: marketProduct.denomination == null ? null : Number(marketProduct.denomination),
    denomUnit: marketProduct.denom_unit, quantity: marketProduct.quantity,
  };
  const key = canonicalKey(model);

  // Anything unread in the identity means we cannot honestly say we do or do
  // not have it. Ask a person; do not guess in either direction.
  const unknowns = ['product_type', 'game', 'platform', 'region']
    .filter((f) => !marketProduct[f] || marketProduct[f] === 'unknown');
  if (unknowns.length || marketProduct.denomination == null) {
    return { status: CANDIDATE_STATUS.NEEDS_REVIEW,
      reason: `identity incomplete: ${[...unknowns, marketProduct.denomination == null ? 'denomination' : null]
        .filter(Boolean).join(', ')}`,
      confidence: 0 };
  }

  const exact = catalogue.find((c) => c.key === key);
  if (exact) {
    return { status: CANDIDATE_STATUS.ALREADY_LISTED, reason: `matches ${exact.product.name}`,
      forgeProductId: exact.product.id, confidence: 1 };
  }

  const inStock = observations.filter((o) => o.availability === 'in_stock').length;
  if (observations.length && inStock === 0) {
    return { status: CANDIDATE_STATUS.UNAVAILABLE,
      reason: `${observations.length} listing(s) observed, none in stock`, confidence: 0.5 };
  }

  for (const c of catalogue) {
    const near = nearMiss(model, c.model);
    if (near) {
      return { status: CANDIDATE_STATUS.POSSIBLE_DUPLICATE,
        reason: `differs from "${c.product.name}" only in ${near.field} (${near.b} → ${near.a})`,
        duplicateOf: c.product.id, confidence: 0.7 };
    }
  }

  return { status: CANDIDATE_STATUS.DISCOVERED,
    reason: `not in the catalogue; ${observations.length} observation(s)`, confidence: 0.9 };
}

/** Classify everything we have observed and write the candidate rows. */
export async function runDiscovery() {
  const catalogue = await forgeCatalogModels();
  const products = await all(`SELECT * FROM market_products ORDER BY created_at`);
  const counts = { discovered: 0, already_listed: 0, possible_duplicate: 0, unavailable: 0, needs_review: 0 };

  for (const mp of products) {
    const obs = await latestPerSource(mp.id);
    const verdict = classify(mp, catalogue, obs);
    counts[verdict.status] = (counts[verdict.status] || 0) + 1;

    const existing = await get(`SELECT * FROM market_candidates WHERE market_product_id=@p`, { p: mp.id });
    const at = nowIso();

    /* A decision a human already made outranks anything this job concludes.
       Re-running discovery must never quietly un-approve or un-reject; the
       whole point of the workflow is that the human step is durable. */
    const decided = [CANDIDATE_STATUS.APPROVED, CANDIDATE_STATUS.REJECTED,
      CANDIDATE_STATUS.PRODUCT_CREATED, CANDIDATE_STATUS.PUBLISHED];
    if (existing && decided.includes(existing.status)) continue;

    if (existing) {
      await run(`UPDATE market_candidates SET status=@s, reason=@r, forge_product_id=@f,
                   duplicate_of=@d, match_confidence=@c, updated_at=@at WHERE id=@id`,
        { s: verdict.status, r: verdict.reason, f: verdict.forgeProductId || null,
          d: verdict.duplicateOf || null, c: verdict.confidence, at, id: existing.id });
    } else {
      await run(`INSERT INTO market_candidates (id, market_product_id, status, reason, forge_product_id,
                   duplicate_of, match_confidence, created_at, updated_at)
                 VALUES (@id,@p,@s,@r,@f,@d,@c,@at,@at)`,
        { id: newId('mkc'), p: mp.id, s: verdict.status, r: verdict.reason,
          f: verdict.forgeProductId || null, d: verdict.duplicateOf || null, c: verdict.confidence, at });
    }
  }
  return { classified: products.length, counts };
}

/** The dashboard's five buckets, with the product and its freshest evidence. */
export async function discoveryReport({ limit = 200 } = {}) {
  const rows = await all(
    `SELECT c.*, p.title, p.game, p.platform, p.region, p.denomination, p.denom_unit, p.canonical_key,
            (SELECT COUNT(*) FROM market_observations o WHERE o.market_product_id = p.id) AS observations,
            (SELECT MAX(observed_at) FROM market_observations o WHERE o.market_product_id = p.id) AS last_seen
       FROM market_candidates c JOIN market_products p ON p.id = c.market_product_id
      ORDER BY c.updated_at DESC LIMIT @l`, { l: limit });

  const bucket = (s) => rows.filter((r) => r.status === s);
  return {
    newCandidates: bucket(CANDIDATE_STATUS.DISCOVERED),
    alreadyListed: bucket(CANDIDATE_STATUS.ALREADY_LISTED),
    possibleDuplicates: bucket(CANDIDATE_STATUS.POSSIBLE_DUPLICATE),
    unavailable: bucket(CANDIDATE_STATUS.UNAVAILABLE),
    needsManualReview: bucket(CANDIDATE_STATUS.NEEDS_REVIEW),
    approved: bucket(CANDIDATE_STATUS.APPROVED),
    productCreated: bucket(CANDIDATE_STATUS.PRODUCT_CREATED),
    published: bucket(CANDIDATE_STATUS.PUBLISHED),
    rejected: bucket(CANDIDATE_STATUS.REJECTED),
    total: rows.length,
  };
}

/**
 * Move a candidate along the workflow.
 *
 * DISCOVERED → APPROVED → PRODUCT_CREATED → PUBLISHED, with REJECTED available
 * from anywhere. Every move records who and when: an approval nobody signed is
 * the thing this whole table exists to make impossible.
 */
const ALLOWED = {
  discovered: ['approved', 'rejected', 'needs_review'],
  normalized: ['approved', 'rejected', 'needs_review'],
  needs_review: ['approved', 'rejected'],
  possible_duplicate: ['approved', 'rejected'],
  unavailable: ['approved', 'rejected'],
  already_listed: ['rejected'],
  approved: ['product_created', 'rejected'],
  product_created: ['published', 'rejected'],
  published: [],
  rejected: ['discovered'],
};

/**
 * Turn an approved candidate into a real catalogue product.
 *
 * The one arrow in the workflow that had no implementation. Every other step
 * existed — a candidate could be discovered, normalized, reviewed, approved,
 * marked product_created and published — but "marked product_created" meant a
 * caller had created the product themselves and handed the id back. Nothing
 * actually made one, so the state was a promise the system could not keep.
 *
 * ── IT IS CREATED INACTIVE, AND THAT IS THE POINT ─────────────────────────
 * A product discovered on somebody else's shelf arrives with no cost price, no
 * price this shop chose, no image and no delivery arrangement. Creating it live
 * would be the exact failure the brief warns about — thousands of
 * customer-facing products nobody approved — and it would put a price on the
 * shelf that came from a competitor rather than from this shop's own maths.
 *
 * So: active = 0, price = 0, and the only way to a live price is the
 * recommendation path, which already refuses to publish anything unapproved.
 * The candidate moves to product_created; PUBLISHED stays a separate decision.
 *
 * ── NOTHING IS INVENTED ───────────────────────────────────────────────────
 * Name, category and denomination all come from the canonical model that
 * normalization produced from observations that were actually recorded. The
 * market product id and canonical key travel with it, so the product can always
 * be traced back to the observation it came from.
 *
 * Idempotent: a candidate that already has a forge_product_id returns that
 * product rather than making a second one.
 */
export async function createProductFromCandidate(candidateId, { actor, category = null } = {}) {
  if (!actor) throw new Error('creating a product needs a named actor');
  const c = await get(`SELECT * FROM market_candidates WHERE id=@id`, { id: candidateId });
  if (!c) throw new Error('no such candidate');

  if (c.forge_product_id) {
    const existing = await getProduct(c.forge_product_id);
    if (existing) return { product: existing, created: false, candidate: c };
  }
  if (c.status !== CANDIDATE_STATUS.APPROVED) {
    throw new Error(`only an approved candidate becomes a product (this one is ${c.status})`);
  }

  const mp = await get(`SELECT * FROM market_products WHERE id=@id`, { id: c.market_product_id });
  if (!mp) throw new Error('the candidate has no market product behind it');

  const product = await createProduct({
    name: mp.title,
    category: category || mp.game,
    // No price. A price arrives through the recommendation path or not at all.
    price: 0,
    currency: 'EUR',
    active: false,
    // Never announce a product nobody has priced yet.
    announce: false,
    metadata: {
      source: 'market-discovery',
      marketProductId: mp.id,
      canonicalKey: mp.canonical_key,
      productType: mp.product_type,
      game: mp.game,
      edition: mp.edition || null,
      platform: mp.platform,
      region: mp.region,
      denomination: mp.denomination == null ? null : Number(mp.denomination),
      denomUnit: mp.denom_unit || null,
      discoveredBy: actor,
      discoveredAt: nowIso(),
    },
  });

  await decideCandidate(candidateId, CANDIDATE_STATUS.PRODUCT_CREATED, {
    actor, forgeProductId: product.id,
    reason: 'created inactive and unpriced — publish it after a price is approved',
  });

  return { product, created: true, candidate: await get(`SELECT * FROM market_candidates WHERE id=@id`, { id: candidateId }) };
}

export async function decideCandidate(candidateId, to, { actor, forgeProductId = null, reason = '' } = {}) {
  const c = await get(`SELECT * FROM market_candidates WHERE id=@id`, { id: candidateId });
  if (!c) throw new Error('no such candidate');
  const allowed = ALLOWED[c.status] || [];
  if (!allowed.includes(to)) {
    throw new Error(`cannot move a candidate from ${c.status} to ${to} (allowed: ${allowed.join(', ') || 'nothing'})`);
  }
  if (!actor) throw new Error('a decision needs a named actor');
  await run(`UPDATE market_candidates SET status=@s, reason=@r, decided_by=@by, decided_at=@at,
               forge_product_id=COALESCE(@f, forge_product_id), updated_at=@at WHERE id=@id`,
    { s: to, r: reason || c.reason, by: actor, at: nowIso(), f: forgeProductId, id: candidateId });
  return get(`SELECT * FROM market_candidates WHERE id=@id`, { id: candidateId });
}
