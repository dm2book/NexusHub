/**
 * Every supplier, every product: where is each one cheapest to buy, and can
 * the shop map it without a person checking?
 *
 * The per-supplier scan (catalogScanService) answers "what can THIS supplier
 * deliver". An owner with three suppliers had to run it three times and
 * compare the tables by eye, then map seventy products one click at a time.
 * This runs the same search against every active supplier, keeps the most
 * profitable listing per product, and a second-best from a different supplier
 * as the fallback fulfilment already knows how to use (mappings are tried in
 * priority order and skipped when out of stock).
 *
 * ── WHY "MAP ALL" DOES NOT MEAN "MAP EVERYTHING FOUND" ────────────────────
 * Matching is by NAME, and the per-supplier scan refuses to map anything on
 * its own for exactly that reason: "1,000 Robux" finds the 10,000 Robux card,
 * and a card for the wrong region sells somebody a code that will not redeem.
 * A mapped product is bought automatically when an order comes in, so a wrong
 * mapping is a refund and quite possibly a chargeback.
 *
 * So a row is only SAFE — eligible for the bulk button — when the match can
 * be checked mechanically:
 *
 *   amount   every number in our product name appears in the supplier's
 *            title. "EA FC 25 — 2,800 Points" needs both 25 and 2800. A
 *            product with no number at all (a plain "Spotify Premium") cannot
 *            be checked this way and goes to a person, because 1 month and 12
 *            months are the same words.
 *   what     not a game ACCOUNT, and not locked to a platform (Xbox,
 *            PlayStation, Nintendo, Google Play, Apple) that our product
 *            does not name — a buyer on another platform cannot redeem it.
 *   region   when the supplier states one, it has to be sellable to a Dutch
 *            buyer: region-free, global, Europe or the Netherlands. "RoW" is
 *            Rest of World and usually EXCLUDES Europe, so it is not in the
 *            list. A region the supplier does not state is noted on the row but
 *            does not block it: a price list you uploaded yourself rarely has
 *            one, and you know what you are buying from.
 *   profit   after BTW and payment fees, at or above the shop's own minimum
 *            margin — the same floor the pricing engine refuses under.
 *   stock    in stock today.
 *
 * Everything else is still shown, with the reason, and mapped by hand.
 *
 * ── WHY THE MARGIN IS AFTER BTW ───────────────────────────────────────────
 * This is a screen that decides what the shop will buy from whom, before it
 * has sold anything. vatService.planningVat() measures that against the rate
 * the shop will charge. A listing at €9 for a €10 product is 10% "profit"
 * before BTW and a loss after it.
 */
import { all } from '../../db/index.js';
import { config } from '../../config/env.js';
import { createConnector } from './registry.js';
import { searchCandidates } from './catalogScanService.js';
import { getSupplier, mapSupplierProduct } from './supplierService.js';
import { marginAt } from '../market/pricing.js';
import { planningVat } from '../vatService.js';
import { audit } from '../auditService.js';

/** What a row means, in one word. Ordered from "map it" to "nothing here". */
export const BEST = {
  READY: 'ready',               // safe match, in stock, margin at or above the floor
  THIN: 'thin',                 // safe match, in stock, profitable but under the floor
  LOSS: 'loss',                 // safe match, in stock, loses money after BTW and fees
  OUT_OF_STOCK: 'out_of_stock', // safe match, nobody has it today
  CHECK: 'check',               // found, but the match cannot be confirmed mechanically
  NOT_FOUND: 'not_found',       // no supplier carries anything under these terms
  NO_PRICE: 'no_price',         // our own product has no price to compare against
};

/** Priorities the bulk mapping writes. Lower is tried first. */
export const PRIORITY = { BEST: 10, FALLBACK: 20 };

/**
 * The whole numbers in a product or listing name.
 *
 * "1,000" and "1.000" are one thousand, not one and zero: every product here
 * writes its amounts with a thousands separator, and suppliers mostly do not.
 * Decimals ("4.99") are not amounts and are dropped rather than split.
 */
export function amountsIn(text) {
  const s = String(text || '');
  const out = new Set();
  /* Comma and dot only as thousands separators. A SPACE is not one here:
     "Pack 100 500 coins" would read as a hundred thousand and five hundred. */
  for (const m of s.matchAll(/\d{1,3}(?:[.,]\d{3})+(?!\d)|\d+(?:[.,]\d{1,2}(?!\d))?/g)) {
    const raw = m[0];
    if (/^\d+[.,]\d{1,2}$/.test(raw)) continue;                // a price, not an amount
    const n = Number(raw.replace(/[.,]/g, ''));
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return out;
}

const SELLABLE_REGION = /region\s*free|global|worldwide|\bworld\b|europe|\beu\b|netherlands|\bnl\b|benelux/i;

/**
 * Platforms a code can be LOCKED to. A listing that names one is for that
 * platform only; if our product does not name it too, the buyer may be on
 * another one and the code will not redeem. Found on a live scan: "1,000 Apex
 * Coins" matched "Apex Legends — 1000 Apex Coins XBOX One CD Key" on amount and
 * region, and nothing else was looking.
 *
 * Deliberately not here: "Epic Games" (every V-Bucks listing says it and it
 * locks nothing) and "PC" (a catch-all on most key sites).
 */
const PLATFORMS = [
  { name: 'Xbox', re: /xbox/i },
  { name: 'PlayStation', re: /playstation|\bpsn\b|\bps[345]\b/i },
  { name: 'Nintendo', re: /nintendo|\bswitch\b|\beshop\b/i },
  { name: 'Google Play', re: /google\s*play|android/i },
  { name: 'Apple', re: /app\s*store|itunes|\bios\b/i },
];

/* A game ACCOUNT is a different product from a code, and usually one the
   game's own terms forbid selling. Seen on the same scan: "Fortnite — 1000
   V-Bucks Epic Games Account". */
const ACCOUNT = /\baccounts?\b/i;

/**
 * Can this listing be mapped to this product without a person looking?
 * Returns { safe, reasons[], notes[] } — reasons block, notes do not.
 */
export function matchCheck(productName, candidate) {
  const reasons = [];
  const notes = [];

  const ours = amountsIn(productName);
  const theirs = amountsIn(candidate?.name);
  if (!ours.size) {
    reasons.push('our product name has no amount to check the listing against');
  } else {
    const missing = [...ours].filter((n) => !theirs.has(n));
    if (missing.length) {
      reasons.push(`the listing does not mention ${missing.map((n) => n.toLocaleString('en-US')).join(' or ')}`);
    }
  }

  const title = String(candidate?.name || '');
  if (ACCOUNT.test(title) && !ACCOUNT.test(String(productName || ''))) {
    reasons.push('the listing sells a game account, not a code');
  }
  const where = `${title} ${candidate?.platform || ''}`;
  for (const p of PLATFORMS) {
    if (p.re.test(where) && !p.re.test(String(productName || ''))) {
      reasons.push(`the listing is for ${p.name} only`);
    }
  }

  const region = candidate?.region == null ? '' : String(candidate.region).trim();
  if (!region) notes.push('region not stated by the supplier');
  else if (!SELLABLE_REGION.test(region)) reasons.push(`region "${region}" may not redeem for a Dutch buyer`);

  return { safe: reasons.length === 0, reasons, notes };
}

/** Profit and margin of one listing against one price, after BTW and fees. */
export function profitOf(priceCents, costCents, { vatPct, cfg = config.market } = {}) {
  if (!(priceCents > 0) || costCents == null) return { profitCents: null, marginPct: null };
  const m = marginAt(priceCents / 100, costCents / 100, { ...cfg, vatPercent: vatPct });
  return { profitCents: Math.round(m.profitEur * 100), marginPct: m.marginPct };
}

/**
 * Pick the best listing for one product out of every supplier's candidates.
 *
 * `found` is [{ supplier: {id, name, kind}, candidates: [...] }].
 * Pure: no network, no database — what the scan and the tests both call.
 */
export function pickBest(product, found, { vatPct, floorPct = config.market.minimumMarginPercent, cfg } = {}) {
  const priceCents = Number(product.price) || 0;
  const rows = [];
  for (const f of found) {
    for (const c of f.candidates || []) {
      const check = matchCheck(product.name, c);
      rows.push({
        supplierId: f.supplier.id, supplierName: f.supplier.name, supplierKind: f.supplier.kind,
        supplierSku: c.supplierSku, title: c.name, region: c.region ?? null, platform: c.platform ?? null,
        url: c.url ?? null, cost: c.cost, inStock: c.status === 'in_stock',
        ...profitOf(priceCents, c.cost, { vatPct, cfg }),
        safe: check.safe, reasons: check.reasons, notes: check.notes,
      });
    }
  }

  const base = {
    productId: product.id, name: product.name, priceCents,
    candidates: rows.length, suppliersSearched: found.length,
  };
  if (!rows.length) return { ...base, verdict: BEST.NOT_FOUND, best: null, fallback: null };

  const cheapest = (list) => [...list].sort((a, b) => a.cost - b.cost)[0] || null;
  if (!(priceCents > 0)) return { ...base, verdict: BEST.NO_PRICE, best: cheapest(rows), fallback: null };

  const matched = rows.filter((r) => r.safe);
  const buyable = matched.filter((r) => r.inStock && r.profitCents != null)
    .sort((a, b) => (b.profitCents - a.profitCents) || (a.cost - b.cost));

  if (buyable.length) {
    const best = buyable[0];
    /* A fallback from ANOTHER supplier. A second listing at the same supplier
       fails in the same outage, so it is not a fallback at all. */
    const fallback = buyable.find((r) => r.supplierId !== best.supplierId && r.profitCents > 0) || null;
    const verdict = best.profitCents <= 0 ? BEST.LOSS
      : best.marginPct < floorPct ? BEST.THIN : BEST.READY;
    return { ...base, verdict, best, fallback: verdict === BEST.READY ? fallback : null };
  }
  if (matched.length) return { ...base, verdict: BEST.OUT_OF_STOCK, best: cheapest(matched), fallback: null };
  /* Found something, but nothing we can confirm. The cheapest is shown WITH
     its reasons, because "why not" is the whole answer on this row. */
  return { ...base, verdict: BEST.CHECK, best: cheapest(rows.filter((r) => r.inStock)) || cheapest(rows), fallback: null };
}

/** How the whole run reads at a glance. */
export function summarise(results) {
  const n = (v) => results.filter((r) => r.verdict === v).length;
  return {
    scanned: results.length,
    ready: n(BEST.READY), thin: n(BEST.THIN), loss: n(BEST.LOSS),
    outOfStock: n(BEST.OUT_OF_STOCK), check: n(BEST.CHECK),
    notFound: n(BEST.NOT_FOUND), noPrice: n(BEST.NO_PRICE),
    mappable: results.filter((r) => r.verdict === BEST.READY && !r.mapped).length,
  };
}

/* ── Against the real suppliers ──────────────────────────────────────────────── */

/**
 * The suppliers worth asking: active, with a connector that can be built.
 * Each says whether it searches at the supplier or filters a downloaded list.
 */
export async function scanSources() {
  const rows = await all(`SELECT * FROM suppliers WHERE status = 'active' ORDER BY name ASC`).catch(() => []);
  const out = [];
  for (const row of rows) {
    const supplier = await getSupplier(row.id);
    let connector;
    try { connector = createConnector(supplier); } catch { continue; }
    out.push({ supplier, connector });
  }
  return out;
}

/**
 * A connector that searches locally is given its catalogue ONCE per scan.
 *
 * The default searchCatalog downloads the whole list and filters it — per
 * term, per product. Across seventy products that is two hundred downloads of
 * the same file from somebody else's API. Downloaded once, it is the same
 * answer.
 */
function withCachedCatalogue(connector) {
  if (connector.supportsSearch) return connector;
  let catalogue = null;
  return {
    async searchCatalog(term, { limit = 25 } = {}) {
      catalogue ??= await connector.fetchCatalog().catch(() => []);
      const q = String(term || '').trim().toLowerCase();
      return q ? catalogue.filter((i) => String(i.name || '').toLowerCase().includes(q)).slice(0, limit) : [];
    },
  };
}

/** Scan a batch of products against every active supplier. */
export async function scanBest(productIds, { sources = null } = {}) {
  const products = await all(
    `SELECT id, name, price FROM products WHERE id = ANY(@ids)`, { ids: productIds });
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const ordered = productIds.map((id) => byId[id]).filter(Boolean);

  const srcs = (sources || await scanSources())
    .map((s) => ({ ...s, connector: withCachedCatalogue(s.connector) }));

  const mapped = await all(
    `SELECT sp.product_id, sp.cost, sp.priority, s.name AS supplier_name
       FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id
      WHERE sp.product_id = ANY(@ids) ORDER BY sp.priority ASC`, { ids: productIds }).catch(() => []);
  const current = {};
  for (const m of mapped) current[m.product_id] ??= { supplierName: m.supplier_name, cost: m.cost == null ? null : Number(m.cost) };

  const { pct: vatPct } = planningVat();
  const results = [];
  for (const product of ordered) {
    const found = [];
    for (const { supplier, connector } of srcs) {
      // eslint-disable-next-line no-await-in-loop -- one supplier at a time: parallel
      // requests to somebody else's API are how an account gets rate-limited.
      const { candidates } = await searchCandidates(connector, product);
      found.push({ supplier: { id: supplier.id, name: supplier.name, kind: supplier.connector_kind }, candidates });
    }
    const r = pickBest(product, found, { vatPct });
    results.push({ ...r, mapped: !!current[product.id], current: current[product.id] || null });
  }
  return { results, summary: summarise(results), vat: planningVat() };
}

/**
 * Write the mappings an owner confirmed.
 *
 * `picks` come from the scan the owner just read. Each is re-checked against
 * the database — the product exists, the supplier exists and is active — but
 * not re-scanned: a second scan would be minutes, and a price that moved since
 * is corrected by the supplier's own sync, which updates the mapped cost.
 *
 * A product that already has a mapping is skipped unless `replace` is set, so
 * the bulk button can never quietly move a product the owner mapped by hand.
 */
export async function mapBest(picks, { replace = false, actor = null } = {}) {
  const done = [];
  const skipped = [];
  const ids = [...new Set(picks.map((p) => p.productId))];
  const existing = new Set((await all(
    `SELECT DISTINCT product_id FROM supplier_products WHERE product_id = ANY(@ids)`, { ids })
    .catch(() => [])).map((r) => r.product_id));
  const products = new Set((await all(`SELECT id FROM products WHERE id = ANY(@ids)`, { ids })).map((r) => r.id));
  const supplierOk = new Map();
  const activeSupplier = async (id) => {
    if (!supplierOk.has(id)) {
      const s = await getSupplier(id).catch(() => null);
      supplierOk.set(id, !!s && s.status === 'active');
    }
    return supplierOk.get(id);
  };

  for (const p of picks) {
    if (!products.has(p.productId)) { skipped.push({ productId: p.productId, why: 'product not found' }); continue; }
    if (existing.has(p.productId) && !replace) { skipped.push({ productId: p.productId, why: 'already mapped' }); continue; }
    if (!(await activeSupplier(p.supplierId))) { skipped.push({ productId: p.productId, why: 'supplier not active' }); continue; }

    await mapSupplierProduct({ supplierId: p.supplierId, productId: p.productId, supplierSku: p.supplierSku,
      supplierUrl: p.supplierUrl || null, cost: p.cost, priority: PRIORITY.BEST });
    if (p.fallback && p.fallback.supplierId !== p.supplierId && await activeSupplier(p.fallback.supplierId)) {
      await mapSupplierProduct({ supplierId: p.fallback.supplierId, productId: p.productId,
        supplierSku: p.fallback.supplierSku, supplierUrl: p.fallback.supplierUrl || null,
        cost: p.fallback.cost, priority: PRIORITY.FALLBACK });
    }
    done.push(p.productId);
  }

  if (done.length) {
    await audit({ actor, action: 'supplier.map_best', targetType: 'products', targetId: String(done.length),
      metadata: { mapped: done.length, skipped: skipped.length, replace } });
  }
  return { mapped: done.length, skipped };
}
