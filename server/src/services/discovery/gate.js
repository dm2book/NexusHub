/**
 * The discovery pipeline's decisions, pure: no network, no database. Every rule
 * that decides whether a found product is added, reviewed or dropped lives
 * here, so the tests read the same code the pipeline runs.
 *
 * ── 1. DOES FORGEMARKET ALREADY SELL IT? (catalogMatch) ───────────────────
 * Against our own catalogue, parsed by the same parser as the market titles.
 * The denomination, its unit, the product type, the game, the quantity and
 * the edition must be equal. Platform and region must be equal OR unstated on
 * one side: our "1,000 Robux" names no region, and the market's "1000 Robux
 * Global" is the thing we already sell — not a gap to fill with a second
 * listing. Two STATED values that differ are two products: PlayStation and
 * Xbox points, EU and US cards, never merge.
 *
 * ── 2. HOW SURE IS THE MATCH? (matchConfidence, 0–1) ──────────────────────
 *   the parser's own confidence (the share of the six identity dimensions it
 *   could read) × corroboration: 1 independent source 0.95, 2 or more 1.0.
 * So AUTO_APPROVE (≥ 0.98) needs every dimension read AND two independent
 * sources — a marketplace and a supplier — agreeing on the exact product.
 *
 * ── 3. IS THE PICTURE THIS PRODUCT? (imageConfidence, 0–1) ────────────────
 *   where it came from   supplier API for the matched listing 0.60, official
 *                        (owner-marked press kit) 0.65, a distributor 0.50,
 *                        a marketplace listing 0.45, shop artwork 0
 *   quality              qualityScore/100 × 0.30 (resolution, shape, format)
 *   exact denomination   +0.05 when the file's address names this amount
 * And a hard zero when the address names ANOTHER denomination of the same
 * game, or a different platform: that picture is of a different product.
 * Only API-delivered pictures are candidates at all — nothing is scraped,
 * nothing generated. A picture can therefore reach 0.95 only from a supplier
 * or official source, at full quality, naming this exact amount.
 *
 * ── 4. THE STATUS ─────────────────────────────────────────────────────────
 *   DUPLICATE       we sell it already, or it differs from one of ours in one
 *                   stated dimension only (a person decides)
 *   UNSAFE_MATCH    not sellable to a Dutch buyer (a region outside EU/NL/
 *                   global), or every supplier listing conflicts on amount,
 *                   platform or region
 *   UNAVAILABLE     nobody has it in stock, the evidence is stale, or the
 *                   sources could not be asked
 *   AUTO_APPROVE    match ≥ 0.98, image ≥ 0.95, no duplicate, no conflict,
 *                   a supplier in stock with a known cost and a price at or
 *                   above the margin floor, in a category the shop has
 *   REVIEW_REQUIRED everything else — with every reason it is not automatic
 */
import { canonicalKey } from '../market/normalize.js';

export const GATE = {
  AUTO_APPROVE: 'AUTO_APPROVE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  DUPLICATE: 'DUPLICATE',
  UNAVAILABLE: 'UNAVAILABLE',
  UNSAFE_MATCH: 'UNSAFE_MATCH',
};
export const PRESENCE = { ALREADY_EXISTS: 'ALREADY_EXISTS', MISSING_PRODUCT: 'MISSING_PRODUCT' };
export const AUTO_MATCH = 0.98;
export const AUTO_IMAGE = 0.95;
/* What a Dutch buyer can redeem. 'any' is a platform, not a region. */
export const SELLABLE_REGIONS = ['eu', 'nl', 'global'];
export const STALE_HOURS = 7 * 24;

const loose = (a, b) => !a || !b || a === 'unknown' || b === 'unknown' || a === b;

/** Is one of our products this market product? See header §1. */
export function sameDenomination(a, b) {
  return a.productType === b.productType && a.game === b.game
    && a.denomination != null && Number(a.denomination) === Number(b.denomination)
    && (a.denomUnit || '') === (b.denomUnit || '') && Number(a.quantity || 1) === Number(b.quantity || 1)
    && (!a.edition || !b.edition || a.edition === b.edition);
}

/**
 * ALREADY_EXISTS (with the product) or MISSING_PRODUCT; and, when one of ours
 * differs only in a STATED platform or region, `near` names it — a possible
 * duplicate a person should look at rather than a new listing.
 */
export function catalogMatch(model, catalogue) {
  let near = null;
  for (const c of catalogue) {
    if (!sameDenomination(model, c.model)) continue;
    const platformOk = loose(model.platform, c.model.platform);
    const regionOk = loose(model.region, c.model.region);
    if (platformOk && regionOk) return { status: PRESENCE.ALREADY_EXISTS, product: c.product };
    if (!near && (platformOk || regionOk)) {
      near = { product: c.product, field: platformOk ? 'region' : 'platform',
        ours: platformOk ? c.model.region : c.model.platform, theirs: platformOk ? model.region : model.platform };
    }
  }
  return { status: PRESENCE.MISSING_PRODUCT, near };
}

/** §2. `sources` = distinct sources whose listing parsed to this exact product. */
export function matchConfidence(model, sources) {
  const n = new Set(sources || []).size;
  const corroboration = n >= 2 ? 1 : n === 1 ? 0.95 : 0;
  return Math.round(Number(model.confidence || 0) * corroboration * 1000) / 1000;
}

const SOURCE_WEIGHT = { supplier: 0.6, official: 0.65, distributor: 0.5, marketplace: 0.45, artwork: 0 };
const PLATFORM_WORDS = [
  ['xbox', /xbox/i], ['playstation', /playstation|\bpsn\b|\bps[45]\b/i], ['nintendo', /nintendo|switch|eshop/i],
  ['pc', /\bsteam\b/i], ['ios', /itunes|app-?store/i], ['android', /google-?play/i],
];

/** The amounts a picture's address names (not sizes like 1200x630 or w=800). */
export function numbersInUrl(url) {
  let path = '';
  try { path = decodeURIComponent(new URL(url).pathname); } catch { return new Set(); }
  const cleaned = path.replace(/\d+\s*[x×]\s*\d+/gi, ' ').replace(/[_-](?:w|h|s|q)\d+/gi, ' ').replace(/\.\w+$/, '');
  return new Set([...cleaned.matchAll(/(?<![a-z0-9])(\d{2,6})(?![0-9])/gi)].map((m) => Number(m[1])));
}

/** §3. A score for one picture as THIS product's picture. */
export function imageConfidence({ sourceType, quality = 0, url = '', model = {}, otherDenominations = [] }) {
  const reasons = [];
  const nums = numbersInUrl(url);
  const clash = [...nums].find((n) => n !== Number(model.denomination) && otherDenominations.map(Number).includes(n));
  if (clash) return { score: 0, mismatch: `the picture's address names ${clash}, another denomination`, reasons };
  for (const [key, re] of PLATFORM_WORDS) {
    if (re.test(url) && model.platform && !['unknown', 'any', key].includes(model.platform)) {
      return { score: 0, mismatch: `the picture's address names ${key}, not ${model.platform}`, reasons };
    }
  }
  let score = (SOURCE_WEIGHT[sourceType] ?? 0) + (Math.max(0, Math.min(100, quality)) / 100) * 0.3;
  if (model.denomination != null && nums.has(Number(model.denomination))) score += 0.05;
  else reasons.push('the picture is not tied to this exact amount');
  if (quality < 60) reasons.push(`low quality (${quality}/100)`);
  if (!(sourceType in SOURCE_WEIGHT) || sourceType === 'artwork') reasons.push('not the publisher’s artwork');
  return { score: Math.round(Math.min(1, score) * 1000) / 1000, mismatch: null, reasons };
}

/**
 * A suggested price: never under the margin floor for the supplier's cost, and
 * at the shop's market position when the market's median is known. No cost →
 * no price: a number without a cost behind it is a guess.
 */
export function suggestPrice({ costCents, marketMedianCents = null, floorPrice, roundUp, position = 0.98 }) {
  if (!(costCents > 0)) return null;
  const floor = floorPrice(costCents);
  const competitive = marketMedianCents > 0 ? Math.round(marketMedianCents * position) : 0;
  return roundUp(Math.max(floor, competitive));
}

/**
 * §4. The verdict for one candidate.
 *
 * input: { model, presence, sources, inStockSources, freshObservations,
 *          sourceErrors, supplier: pickBest result | null, categoryStatus,
 *          image: imageConfidence result | null, requiresSupplier = true,
 *          extraReasons: [] — anything else that must stop an automatic add,
 *          mentionDomains: websites naming it in search results (searchSource) }
 */
export function gate(input) {
  const { model, presence = {}, sources = [], inStockSources = [], freshObservations = 0,
    sourceErrors = [], supplier = null, categoryStatus = 'unknown', image = null, requiresSupplier = true, extraReasons = [],
    mentionDomains = 0 } = input;
  const reasons = [...extraReasons];
  const match = matchConfidence(model, sources);
  const img = image?.mismatch ? 0 : Number(image?.score || 0);
  const out = (status, extra = []) => ({ status, reasons: [...extra, ...reasons], matchConfidence: match, imageConfidence: img });

  if (presence.status === PRESENCE.ALREADY_EXISTS) return out(GATE.DUPLICATE, [`already sold as "${presence.product?.name}"`]);
  if (presence.near) {
    return out(GATE.DUPLICATE, [`same as "${presence.near.product?.name}" except the ${presence.near.field} (${presence.near.ours} → ${presence.near.theirs}) — a person decides`]);
  }
  if (model.region && model.region !== 'unknown' && !SELLABLE_REGIONS.includes(model.region)) {
    return out(GATE.UNSAFE_MATCH, [`region ${model.region.toUpperCase()} does not redeem for a Dutch buyer`]);
  }
  const listings = supplier?.candidates || 0;
  if (supplier && listings > 0 && supplier.verdict === 'check' && !supplier.best?.safe) {
    return out(GATE.UNSAFE_MATCH, [`every supplier listing conflicts: ${(supplier.best?.reasons || []).join('; ') || 'amount, platform or region'}`]);
  }
  const supplierInStock = supplier && ['ready', 'thin', 'loss'].includes(supplier.verdict);
  /* Found only in search results: proof it exists, not that anyone has it.
     Two websites or more → a person reviews it; one → not enough. */
  if (!inStockSources.length && !supplierInStock && mentionDomains > 0) {
    if (mentionDomains < 2 && !freshObservations) return out(GATE.UNAVAILABLE, ['seen on only one website — not enough evidence that it exists']);
    reasons.push(`found only in search results or research (${mentionDomains} websites) — price and stock unknown`);
  } else if (!inStockSources.length && !supplierInStock) {
    const why = sourceErrors.length && !freshObservations ? `the sources could not be asked (${sourceErrors.join('; ')})`
      : !freshObservations ? `no observation in the last ${STALE_HOURS / 24} days — the data is stale`
        : 'nobody has it in stock';
    return out(GATE.UNAVAILABLE, [why]);
  }

  const unknown = (model.unknown || []).filter(Boolean);
  if (unknown.length || model.denomination == null) reasons.push(`identity incomplete: ${unknown.join(', ') || 'denomination'}`);
  if (match < AUTO_MATCH) reasons.push(`match confidence ${Math.round(match * 100)}% (needs ${AUTO_MATCH * 100}%)`);
  if (image?.mismatch) reasons.push(`picture rejected: ${image.mismatch}`);
  else if (img < AUTO_IMAGE) reasons.push(`image confidence ${Math.round(img * 100)}% (needs ${AUTO_IMAGE * 100}%)${image?.reasons?.length ? ` — ${image.reasons.join(', ')}` : ''}`);
  if (categoryStatus !== 'existing') reasons.push('not a category the shop already has');
  if (requiresSupplier) {
    if (!supplier || !listings) reasons.push('no supplier carries it — cannot be fulfilled automatically');
    else if (supplier.verdict === 'out_of_stock') reasons.push('the supplier listing is out of stock');
    else if (supplier.best?.cost == null) reasons.push('supplier cost unknown');
    else if (supplier.verdict === 'loss') reasons.push('unsafe pricing: loses money after BTW and fees');
    else if (supplier.verdict === 'thin') reasons.push('unsafe pricing: under the minimum margin');
    else if (supplier.verdict !== 'ready') reasons.push(`supplier: ${supplier.verdict}`);
  }
  if (sourceErrors.length) reasons.push(`some sources failed: ${sourceErrors.join('; ')}`);
  return reasons.length ? out(GATE.REVIEW_REQUIRED) : out(GATE.AUTO_APPROVE);
}

/**
 * A sale price from the shop's OWN prices for the same game — the only basis
 * there is when no supplier and no market price is known.
 *
 *   gift cards (EUR)  the median of price ÷ face value over the shop's cards
 *                     of that brand, times this card's face value
 *   everything else   the shop's pack of that game nearest in size (by ratio),
 *                     its price per unit times this pack's size
 * Rounded up to the shop's own endings. No pack of that game in the shop → no
 * estimate (null), never a guess from another game. Products whose own price
 * was estimated are never used as a basis.
 */
export function estimateFromCatalogue(model, catalogue, { roundUp = (x) => x } = {}) {
  const target = Number(model.denomination);
  if (!(target > 0)) return null;
  const peers = catalogue.filter((c) => c.product.active && Number(c.product.price) > 0
    && c.model.game === model.game && (c.model.denomUnit || '') === (model.denomUnit || '')
    && Number(c.model.denomination) > 0 && !c.product.metadata?.pricing?.estimated);
  if (!peers.length) return null;
  const names = peers.map((p) => p.product.name);
  if (model.denomUnit === 'EUR') {
    const ratios = peers.map((p) => Number(p.product.price) / (Number(p.model.denomination) * 100)).sort((a, b) => a - b);
    const ratio = ratios[Math.floor(ratios.length / 2)];
    return { priceCents: roundUp(Math.round(target * 100 * ratio)), basis: `prijs/waarde van ${names.join(', ')}`, peers: peers.length };
  }
  const nearest = [...peers].sort((a, b) => Math.abs(Math.log(Number(a.model.denomination) / target))
    - Math.abs(Math.log(Number(b.model.denomination) / target)))[0];
  const perUnit = Number(nearest.product.price) / Number(nearest.model.denomination);
  return { priceCents: roundUp(Math.round(perUnit * target)), basis: `prijs per eenheid van ${nearest.product.name}`, peers: peers.length };
}

/** A stable SKU from the canonical model: ROBLOX-1000-ANY-GLOBAL. */
export function skuFor(model) {
  return [model.game, model.edition, model.denomination, model.denomUnit === 'EUR' ? 'EUR' : '', model.platform, model.region]
    .filter((x) => x != null && x !== '' && x !== 'unknown').join('-').toUpperCase().replace(/[^A-Z0-9-]+/g, '').slice(0, 60);
}

export { canonicalKey };
