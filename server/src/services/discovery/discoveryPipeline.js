/**
 * The product discovery pipeline: find what the market sells and ForgeMarket
 * does not, and add only what is safe.
 *
 *   1 scan       the catalogue audit (catalogAuditService)
 *   2 discover   ask every PERMITTED source — partner APIs with credentials the
 *                owner configured (Kinguin, G2A, Eldorado, Eneba) — through the
 *                existing market engine. A source without credentials reports
 *                UNAVAILABLE; there is no code path that reads a public page.
 *                Requests are spaced per host and time out (throttledFetch).
 *   3 normalise  the market's canonical model (market/normalize.js): platform,
 *                region, denomination and type never merge
 *   4 images     only pictures an API sent with a listing, scored for THIS
 *                product (gate.imageConfidence), stored in the shop's own
 *                image store with their source, date, size and type
 *   5 content    productContentService: claim-gated, no delivery times
 *   6 gate       AUTO_APPROVE | REVIEW_REQUIRED | DUPLICATE | UNAVAILABLE |
 *                UNSAFE_MATCH (gate.js)
 *   8 add        AUTO_APPROVE only, automatically; a person can add a
 *                REVIEW_REQUIRED one — but a product without a supplier in
 *                stock, a known cost and a price above the margin floor is
 *                added HIDDEN, never sellable
 *   9 schedule   categories weekly, availability and prices daily, image
 *                health weekly — from the nightly maintenance run, never
 *                from a page load
 */
import { all, get, run, nowIso } from '../../db/index.js';
import { config } from '../../config/env.js';
import { audit } from '../auditService.js';
import { latestPerSource } from '../market/observations.js';
import { GAMES, parseTitle } from '../market/normalize.js';
import { CANDIDATE_STATUS, decideCandidate, runDiscovery } from '../market/discovery.js';
import { categoryFor } from '../productFitService.js';
import { generateAll } from '../productContentService.js';
import { deliveryField } from '../../../../src/lib/deliveryInfo.js';
import { qualityScore } from '../productMediaService.js';
import { floorPrice, roundUpToEnding, profitAt } from '../lossPriceService.js';
import { pickBest } from '../supplier/bestSourceService.js';
import { searchCandidates } from '../supplier/catalogScanService.js';
import { catalogueModels } from './catalogAuditService.js';
import { productTitle } from './names.js';
import { collectMentions, mentionsFor, importResearch } from './searchSource.js';
import { GATE, PRESENCE, STALE_HOURS, catalogMatch, gate, imageConfidence, skuFor, suggestPrice } from './gate.js';

export const LIMITS = {
  minIntervalMs: Number(process.env.DISCOVERY_MIN_INTERVAL_MS || 1500), // per host
  timeoutMs: Number(process.env.DISCOVERY_TIMEOUT_MS || 10_000),
  maxQueries: Number(process.env.DISCOVERY_MAX_QUERIES || 40),           // per category scan
  maxEvaluate: Number(process.env.DISCOVERY_MAX_EVALUATE || 25),         // candidates per run
};
export const autoAddEnabled = () => String(process.env.DISCOVERY_AUTO_ADD ?? 'on') !== 'off';
/* The desk research loads itself in production; elsewhere (tests, local) only
   when asked, so a test database is not filled with it behind a test's back. */
export const researchEnabled = () => (process.env.DISCOVERY_RESEARCH ? process.env.DISCOVERY_RESEARCH === 'on' : config.isProd);
const FINAL = [CANDIDATE_STATUS.APPROVED, CANDIDATE_STATUS.REJECTED, CANDIDATE_STATUS.PRODUCT_CREATED, CANDIDATE_STATUS.PUBLISHED];
const parse = (s, d = null) => { try { return s == null ? d : (typeof s === 'string' ? JSON.parse(s) : s); } catch { return d; } };

/* ── Rate limits and timeouts ──────────────────────────────────────────── */

const lastByHost = new Map();
/**
 * A fetch that waits its turn per host and gives up after `timeoutMs`. A
 * source that times out is an error on the row — "could not be asked" — not
 * an empty answer that would read as "nobody sells this".
 */
export function throttledFetch(fetchImpl = fetch, { minIntervalMs = LIMITS.minIntervalMs, timeoutMs = LIMITS.timeoutMs, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  return async (url, opts = {}) => {
    let host = 'unknown';
    try { host = new URL(url).host; } catch { /* keep */ }
    const last = lastByHost.get(host);
    const wait = last == null ? 0 : last + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastByHost.set(host, now());
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await Promise.race([
        fetchImpl(url, { ...opts, signal: ctrl.signal }),
        new Promise((_, reject) => { ctrl.signal.addEventListener('abort', () => reject(new Error(`timed out after ${timeoutMs} ms`))); }),
      ]);
    } finally { clearTimeout(timer); }
  };
}
export const resetThrottle = () => lastByHost.clear();

/* ── Names ─────────────────────────────────────────────────────────────── */

/** The canonical model of a market_products row. */
export function modelOf(mp) {
  const unknown = ['product_type', 'game', 'platform', 'region'].filter((f) => !mp[f] || mp[f] === 'unknown' || String(mp[f]).startsWith('unknown'));
  if (mp.denomination == null) unknown.push('denomination');
  return {
    productType: mp.product_type, game: mp.game, edition: mp.edition || '', platform: mp.platform, region: mp.region,
    denomination: mp.denomination == null ? null : Number(mp.denomination), denomUnit: mp.denom_unit || '',
    quantity: Number(mp.quantity) || 1, title: mp.title, canonicalKey: mp.canonical_key,
    unknown, confidence: Math.round(((6 - Math.min(6, unknown.length)) / 6) * 1000) / 1000,
  };
}

/* ── Images ────────────────────────────────────────────────────────────── */

/** Crop boxes for the three uses, from the stored picture's size (no resampling). */
export function cropsFor(width, height) {
  const box = (ratio) => {
    if (!width || !height) return null;
    const w = Math.min(width, Math.round(height * ratio)), h = Math.min(height, Math.round(width / ratio));
    return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
  };
  return { square: box(1), card: box(4 / 3), hero: box(16 / 9) };
}

/**
 * The best picture for a candidate, from the leads the APIs sent. Downloads at
 * most `max` of them, scores each, stores the winner in the shop's own image
 * store. Returns the record, or null with the reasons.
 */
export async function findImage(model, leads, { otherDenominations = [], fetchImpl = fetch, store = true, max = 2 } = {}) {
  const { downloadImage } = await import('../supplier/supplierImageService.js');
  const { dimensions, storeImage } = await import('../imageStoreService.js');
  const pre = leads.filter((l) => /^https:\/\//i.test(l.url || ''))
    .map((l) => ({ ...l, pre: imageConfidence({ sourceType: l.sourceType, quality: 100, url: l.url, model, otherDenominations }) }))
    .filter((l) => !l.pre.mismatch).sort((a, b) => b.pre.score - a.pre.score);
  const rejected = leads.map((l) => ({ url: l.url, ...imageConfidence({ sourceType: l.sourceType, quality: 100, url: l.url, model, otherDenominations }) }))
    .filter((l) => l.mismatch);
  let best = null;
  for (const l of pre.slice(0, max)) {
    // eslint-disable-next-line no-await-in-loop
    const got = await downloadImage(l.url, { fetchImpl }).catch((e) => ({ error: e.message }));
    if (!got?.bytes) continue;
    const { width, height } = dimensions(got.mime, got.bytes);
    const quality = qualityScore({ width, height, bytes: got.bytes.length, mime: got.mime });
    const conf = imageConfidence({ sourceType: l.sourceType, quality, url: l.url, model, otherDenominations });
    if (!best || conf.score > best.confidence) best = { lead: l, got, width, height, quality, confidence: conf.score, reasons: conf.reasons };
  }
  if (!best) return { image: null, rejected, reason: leads.length ? 'no usable picture among the API leads' : 'the sources sent no picture' };
  let stored = null;
  if (store && best.confidence >= 0.5) stored = await storeImage(best.got.mime, best.got.bytes, { source: `discovery:${best.lead.sourceType}` });
  return {
    rejected,
    image: {
      url: stored?.url || null, sourceUrl: best.lead.url, sourceType: best.lead.sourceType, source: best.lead.source,
      lastChecked: nowIso(), width: best.width, height: best.height, mime: best.got.mime, quality: best.quality,
      confidence: best.confidence, reasons: best.reasons, crops: cropsFor(best.width, best.height),
    },
  };
}

/* ── Suppliers ─────────────────────────────────────────────────────────── */

const MARKET_KINDS = ['kinguin', 'g2a', 'eldorado', 'eneba'];
/** Ask each active supplier for this product; the best safe listing and its picture. */
export async function supplierLookup(title, { sources = null, priceCents = 0 } = {}) {
  const { scanSources } = await import('../supplier/bestSourceService.js');
  const srcs = sources || await scanSources();
  const found = [];
  const errors = [];
  for (const { supplier, connector } of srcs) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one supplier at a time
      const { candidates } = await searchCandidates(connector, { name: title });
      found.push({ supplier: { id: supplier.id, name: supplier.name, kind: supplier.connector_kind || supplier.kind }, candidates });
    } catch (e) { errors.push(`${supplier.name}: ${e.message}`); }
  }
  const pick = pickBest({ id: null, name: title, price: priceCents }, found);
  const listing = pick.best ? found.flatMap((f) => f.candidates).find((c) => c.supplierSku === pick.best.supplierSku) : null;
  return { pick, found, errors, image: listing?.image || null, suppliersAsked: srcs.length };
}

/* ── Evaluate one candidate ────────────────────────────────────────────── */

/**
 * Everything the gate needs for one candidate, then its verdict, written to
 * the candidate row. `deps` lets the tests replace the network.
 */
export async function evaluateCandidate(candidateId, deps = {}) {
  const c = await get(`SELECT * FROM market_candidates WHERE id=@id`, { id: candidateId });
  if (!c) throw new Error('no such candidate');
  const mp = await get(`SELECT * FROM market_products WHERE id=@id`, { id: c.market_product_id });
  const model = modelOf(mp);
  const edits = parse(c.edits, {});
  const catalogue = deps.catalogue || await catalogueModels();
  const presence = catalogMatch(model, catalogue);

  const obs = await latestPerSource(mp.id, { sinceHours: STALE_HOURS });
  const sources = [...new Set(obs.map((o) => o.source_key))];
  const inStock = [...new Set(obs.filter((o) => o.availability === 'in_stock').map((o) => o.source_key))];
  const euros = obs.filter((o) => o.availability === 'in_stock' && o.price_eur_cents != null).map((o) => Number(o.price_eur_cents)).sort((a, b) => a - b);
  const median = euros.length ? euros[Math.floor(euros.length / 2)] : null;

  const mentioned = await mentionsFor(mp.id, { sinceHours: STALE_HOURS });
  if (mentioned.domains.length) sources.push('search');
  const title = edits.title || productTitle(model);
  let supplier = null, supplierImage = null, sourceErrors = [];
  if (presence.status === PRESENCE.MISSING_PRODUCT && !presence.near) {
    const first = await supplierLookup(title, { sources: deps.supplierSources });
    sourceErrors = first.errors;
    const cost = first.pick.best?.safe && first.pick.best.inStock ? first.pick.best.cost : null;
    const suggested = edits.priceCents || suggestPrice({ costCents: cost, marketMedianCents: median,
      floorPrice: (x) => floorPrice(x), roundUp: roundUpToEnding, position: config.market.targetMarketPosition });
    /* With a price, the full verdict (ready / thin / loss / out of stock). Without
       one — no cost — still say whether anyone has it in stock: probing at one
       cent tells stock and match apart, and anything it calls a loss is really
       "cost unknown". */
    if (suggested) supplier = pickBest({ id: null, name: title, price: suggested }, first.found);
    else {
      const probe = pickBest({ id: null, name: title, price: 1 }, first.found);
      supplier = ['out_of_stock', 'check', 'not_found'].includes(probe.verdict) ? probe : first.pick;
    }
    supplier.suggested = suggested;
    supplierImage = first.image;
    const kind = supplier.best?.supplierKind;
    if (supplier.best?.safe) sources.push(MARKET_KINDS.includes(kind) ? kind : `supplier:${supplier.best.supplierId}`);
  }
  const extraReasons = [];
  if (supplier?.suggested && median && supplier.suggested > median * 1.15) {
    extraReasons.push(`suggested price €${(supplier.suggested / 100).toFixed(2)} is over 15% above the market median €${(median / 100).toFixed(2)}`);
  }

  /* Pictures: the supplier's listing first, then what the marketplaces sent. */
  const others = [...new Set([
    ...catalogue.filter((x) => x.model.game === model.game).map((x) => x.model.denomination),
    ...(await all(`SELECT denomination FROM market_products WHERE game=@g`, { g: model.game })).map((r) => Number(r.denomination)),
  ].filter((n) => n != null && n !== model.denomination))];
  const leads = [
    ...(supplierImage ? [{ url: supplierImage, sourceType: 'supplier', source: supplier?.best?.supplierName }] : []),
    ...obs.filter((o) => o.image_url).map((o) => ({ url: o.image_url, sourceType: 'marketplace', source: o.source_key })),
  ];
  const img = presence.status === PRESENCE.MISSING_PRODUCT && !presence.near
    ? await findImage(model, leads, { otherDenominations: others, fetchImpl: deps.imageFetch || fetch })
    : { image: null, rejected: [] };

  const shelf = await categoryFor({ name: title, game: model.game, category: edits.category || null });
  const content = generateAll({ name: title, category: shelf.category });
  if (!content.ok) extraReasons.push(`content refused by the claim check: ${content.refused.slice(0, 2).join(' | ')}`);

  const verdict = gate({
    model, presence, sources, inStockSources: inStock, freshObservations: obs.length, sourceErrors,
    supplier, categoryStatus: edits.category ? 'existing' : shelf.status, mentionDomains: mentioned.domains.length,
    image: img.image ? { score: img.image.confidence, reasons: img.image.reasons } : (img.rejected[0] || null), extraReasons,
  });
  const best = supplier?.best || null;
  const margin = supplier?.suggested && best?.cost != null ? profitAt(supplier.suggested, best.cost).marginPct : null;
  const found = [...new Set([...obs.map((o) => o.source_key), ...(deps.supplierSources || []).map((s) => s.supplier.name), ...(best ? [best.supplierName] : []),
    ...(mentioned.domains.length ? [`zoekresultaten: ${mentioned.domains.slice(0, 4).join(', ')}${mentioned.domains.length > 4 ? ` +${mentioned.domains.length - 4}` : ''}`] : [])])];

  await run(`UPDATE market_candidates SET gate_status=@g, gate_reasons=@r, match_confidence=@m, image_confidence=@i, image=@img,
               supplier=@sup, sources_found=@src, suggested_price_cents=@p, supplier_cost_cents=@cost, expected_margin_pct=@mg,
               content=@content, evaluated_at=@at, updated_at=@at WHERE id=@id`, {
    g: verdict.status, r: JSON.stringify(verdict.reasons), m: verdict.matchConfidence, i: verdict.imageConfidence,
    img: img.image ? JSON.stringify(img.image) : null,
    sup: best ? JSON.stringify({ id: best.supplierId, name: best.supplierName, sku: best.supplierSku, title: best.title, cost: best.cost,
      inStock: best.inStock, safe: best.safe, region: best.region, platform: best.platform, url: best.url, verdict: supplier.verdict }) : null,
    src: JSON.stringify(found), p: supplier?.suggested || null, cost: best?.cost ?? null, mg: margin,
    content: content.ok ? JSON.stringify({ title, category: shelf.category, sku: skuFor(model), ...content.content,
      deliveryRequirement: deliveryField(shelf.category, 'nl') || null }) : null,
    at: nowIso(), id: candidateId,
  });
  return { id: candidateId, title, ...verdict };
}

/** Evaluate every open candidate (not yet decided), oldest evaluation first. */
export async function evaluateCandidates({ limit = LIMITS.maxEvaluate, ids = null, deadline = Infinity, ...deps } = {}) {
  const rows = ids
    ? await all(`SELECT id FROM market_candidates WHERE id = ANY(@ids)`, { ids })
    : await all(`SELECT id FROM market_candidates WHERE status <> ALL(@final)
                  ORDER BY evaluated_at ASC NULLS FIRST LIMIT @l`, { final: FINAL, l: limit });
  const catalogue = deps.catalogue || await catalogueModels();
  const out = [];
  for (const r of rows) {
    if (Date.now() > deadline) break;
    // eslint-disable-next-line no-await-in-loop
    out.push(await evaluateCandidate(r.id, { ...deps, catalogue }).catch((e) => ({ id: r.id, status: 'error', reasons: [e.message] })));
  }
  return out;
}

/* ── Add ───────────────────────────────────────────────────────────────── */

/**
 * Put a candidate in the catalogue. `auto` is the pipeline (AUTO_APPROVE only);
 * a person may add a REVIEW_REQUIRED one. Either way it is SELLABLE only with a
 * supplier in stock, a known cost and a price at or above the margin floor —
 * otherwise it is added hidden, with the reason on it.
 */
export async function addCandidate(candidateId, { actor, auto = false, manualCostCents = null, logoFetch = fetch } = {}) {
  if (!actor) throw new Error('adding a product needs a named actor');
  const c = await get(`SELECT * FROM market_candidates WHERE id=@id`, { id: candidateId });
  if (!c) throw Object.assign(new Error('no such candidate'), { status: 404 });
  if (c.forge_product_id) return { productId: c.forge_product_id, created: false };
  if (FINAL.includes(c.status) && c.status !== CANDIDATE_STATUS.APPROVED) throw Object.assign(new Error(`this candidate is ${c.status}`), { status: 409 });
  if (auto && c.gate_status !== GATE.AUTO_APPROVE) throw Object.assign(new Error('only AUTO_APPROVE is added automatically'), { status: 409 });
  if (!auto && ![GATE.AUTO_APPROVE, GATE.REVIEW_REQUIRED].includes(c.gate_status)) {
    throw Object.assign(new Error(`a ${c.gate_status || 'not yet evaluated'} candidate cannot be added`), { status: 409 });
  }
  const mp = await get(`SELECT * FROM market_products WHERE id=@id`, { id: c.market_product_id });
  const model = modelOf(mp);
  /* The catalogue may have changed since the evaluation: check again. */
  const presence = catalogMatch(model, await catalogueModels());
  if (presence.status === PRESENCE.ALREADY_EXISTS) throw Object.assign(new Error(`already sold as "${presence.product.name}"`), { status: 409 });

  const content = parse(c.content, null);
  if (!content) throw Object.assign(new Error('no generated content — re-scan the product'), { status: 409 });
  const edits = parse(c.edits, {});
  const sup = parse(c.supplier, null);
  const image = parse(c.image, null);
  /* The owner delivers it themselves (as the shop's hand-delivered products
     are): their own cost price replaces the supplier's, and the same margin
     floor applies. Never on the automatic path — a person says so. */
  const manual = !auto && Number(manualCostCents) > 0 ? Math.round(Number(manualCostCents)) : null;
  const cost = manual ?? sup?.cost ?? null;
  const floor = cost != null ? floorPrice(cost) : null;
  const price = Number(edits.priceCents || c.suggested_price_cents) || (manual ? floor : 0);
  const fulfilable = manual != null || !!(sup?.safe && sup.inStock);
  const sellable = !!(fulfilable && cost != null && price > 0 && price >= floor);
  const hiddenReason = sellable ? null : !fulfilable ? (!sup ? 'no supplier' : 'supplier out of stock')
    : cost == null ? 'supplier cost unknown' : !(price > 0) ? 'no price' : 'price under the margin floor';

  const { createProduct } = await import('../productService.js');
  const product = await createProduct({
    name: edits.title || content.title, category: edits.category || content.category, sku: content.sku,
    description: content.nl.long, price, currency: 'EUR', active: sellable, announce: false,
    metadata: {
      source: 'discovery', marketProductId: mp.id, canonicalKey: mp.canonical_key, sku: content.sku,
      ...(manual != null ? { deliveryMode: 'manual', costCents: manual } : {}),
      productType: model.productType, game: model.game, edition: model.edition || null, platform: model.platform,
      region: model.region, denomination: model.denomination, denomUnit: model.denomUnit,
      ...(image?.url && image.confidence >= 0.5 ? {
        image: image.url, imageSource: image.sourceType === 'supplier' ? 'supplier' : 'discovery', imageSourceUrl: image.sourceUrl,
        imageUpdatedAt: image.lastChecked, imageQuality: image.quality, imageWidth: image.width, imageHeight: image.height,
        imageMime: image.mime, imageConfidence: image.confidence, imageCrops: image.crops, imageOfficial: image.sourceType === 'supplier',
      } : {}),
      content: { nl: content.nl, en: content.en, generated: true, generatedAt: nowIso() },
      ...(content.deliveryRequirement ? { deliveryRequirement: content.deliveryRequirement } : {}),
      discovery: { by: actor, auto, at: nowIso(), gate: c.gate_status, matchConfidence: Number(c.match_confidence),
        imageConfidence: Number(c.image_confidence), ...(hiddenReason ? { hiddenReason } : {}) },
    },
  });
  /* No official picture: the brand's logo under a free licence (Wikimedia
     Commons) — not the shop's own drawn artwork. None found → no picture,
     which Product media lists as missing. A supplier's real picture replaces
     the logo when one arrives. */
  if (!(image?.url && image.confidence >= 0.5)) {
    const { logoFor, logoMetadata, logosEnabled } = await import('./commonsLogoService.js');
    const logo = logosEnabled() ? await logoFor(model.game, { fetchImpl: logoFetch }).catch(() => null) : null;
    if (logo) {
      const { updateProduct } = await import('../productService.js');
      await updateProduct(product.id, { metadata: { ...product.metadata, ...logoMetadata(logo) } }).catch(() => {});
    }
  }
  if (manual == null && sup?.id && sup.sku) {
    const { mapSupplierProduct } = await import('../supplier/supplierService.js');
    await mapSupplierProduct({ supplierId: sup.id, productId: product.id, supplierSku: sup.sku, supplierUrl: sup.url, cost, priority: 10 }).catch(() => {});
  }
  if (c.status !== CANDIDATE_STATUS.APPROVED) {
    if (![CANDIDATE_STATUS.DISCOVERED, CANDIDATE_STATUS.NORMALIZED, CANDIDATE_STATUS.NEEDS_REVIEW,
      CANDIDATE_STATUS.POSSIBLE_DUPLICATE, CANDIDATE_STATUS.UNAVAILABLE].includes(c.status)) {
      await run(`UPDATE market_candidates SET status='needs_review', updated_at=@at WHERE id=@id`, { at: nowIso(), id: c.id });
    }
    await decideCandidate(c.id, CANDIDATE_STATUS.APPROVED, { actor, reason: auto ? 'AUTO_APPROVE' : 'approved in Product Discovery' });
  }
  await decideCandidate(c.id, CANDIDATE_STATUS.PRODUCT_CREATED, { actor, forgeProductId: product.id,
    reason: sellable ? 'added and sellable' : `added hidden: ${hiddenReason}` });
  await audit({ actor: auto ? null : actor, action: auto ? 'discovery.auto_added' : 'discovery.added', targetType: 'product', targetId: product.id,
    metadata: { candidateId: c.id, sellable, hiddenReason } }).catch(() => {});
  return { productId: product.id, created: true, sellable, hiddenReason };
}

/** Every AUTO_APPROVE candidate not yet added. */
export async function addAllSafe({ actor = 'system:discovery' } = {}) {
  const rows = await all(`SELECT id FROM market_candidates WHERE gate_status=@g AND forge_product_id IS NULL AND status <> ALL(@final)`,
    { g: GATE.AUTO_APPROVE, final: [CANDIDATE_STATUS.REJECTED, CANDIDATE_STATUS.PRODUCT_CREATED, CANDIDATE_STATUS.PUBLISHED] });
  const out = [];
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await addCandidate(r.id, { actor, auto: true }).catch((e) => ({ id: r.id, error: e.message })));
  }
  return { added: out.filter((o) => o.created).length, results: out };
}

export async function rejectCandidate(candidateId, { actor, reason = 'rejected in Product Discovery' } = {}) {
  return decideCandidate(candidateId, CANDIDATE_STATUS.REJECTED, { actor, reason });
}

/** An owner's corrections: name, category, price. Identity fields are not editable — they ARE the product. */
export async function editCandidate(candidateId, { title, category, priceCents } = {}, { actor } = {}) {
  const c = await get(`SELECT * FROM market_candidates WHERE id=@id`, { id: candidateId });
  if (!c) throw Object.assign(new Error('no such candidate'), { status: 404 });
  const edits = { ...parse(c.edits, {}), ...(title ? { title: String(title).slice(0, 120) } : {}),
    ...(category ? { category: String(category).slice(0, 60) } : {}), ...(priceCents > 0 ? { priceCents: Math.round(priceCents) } : {}) };
  await run(`UPDATE market_candidates SET edits=@e, updated_at=@at WHERE id=@id`, { e: JSON.stringify(edits), at: nowIso(), id: candidateId });
  await audit({ actor, action: 'discovery.edited', targetType: 'market_candidate', targetId: candidateId, metadata: edits }).catch(() => {});
  return edits;
}

/* ── Scans ─────────────────────────────────────────────────────────────── */

/** Search terms for categories: what each shelf's products are for, as the market names it. */
export async function queriesFor(categories = null, { cap = LIMITS.maxQueries } = {}) {
  const models = await catalogueModels();
  const games = new Set(models.filter((m) => !categories || categories.includes(m.product.category)).map((m) => m.model.game));
  const labels = GAMES.filter((g) => games.has(g.key)).map((g) => g.label);
  if (!categories) labels.push(...GAMES.map((g) => g.label));
  return [...new Set(labels)].slice(0, cap);
}

/** Ask the permitted sources, classify, evaluate, and (if on) add what is safe. */
export async function scanCategories({ categories = null, fetchImpl = fetch, autoAdd = autoAddEnabled(), ...deps } = {}) {
  const { collectFromSources } = await import('../market/engine.js');
  const queries = await queriesFor(categories);
  const f = throttledFetch(fetchImpl);
  const collected = await collectFromSources(queries, { fetchImpl: f });
  const searched = await collectMentions(queries, { fetchImpl: f, credentials: deps.searchCredentials });
  const classified = await runDiscovery();
  const evaluated = await evaluateCandidates(deps);
  const added = autoAdd ? await addAllSafe() : { added: 0, results: [] };
  return { queries: queries.length, collected, searched, classified, evaluated: evaluated.length, added: added.added,
    byGate: Object.fromEntries(Object.values(GATE).map((g) => [g, evaluated.filter((e) => e.status === g).length])) };
}

/** Re-ask the sources about one product's game, and re-evaluate it. */
export async function rescanCandidate(candidateId, { fetchImpl = fetch, ...deps } = {}) {
  const c = await get(`SELECT c.id, p.game FROM market_candidates c JOIN market_products p ON p.id = c.market_product_id WHERE c.id=@id`, { id: candidateId });
  if (!c) throw Object.assign(new Error('no such candidate'), { status: 404 });
  const { collectFromSources } = await import('../market/engine.js');
  const label = GAMES.find((g) => g.key === c.game)?.label;
  const f = throttledFetch(fetchImpl);
  const collected = label ? await collectFromSources([label], { fetchImpl: f }) : null;
  if (label) await collectMentions([label], { fetchImpl: f, credentials: deps.searchCredentials });
  await runDiscovery();
  return { collected, result: await evaluateCandidate(candidateId, deps) };
}

/* ── Admin view ────────────────────────────────────────────────────────── */

export async function discoveryList({ gate: g = null, limit = 300 } = {}) {
  const rows = await all(
    `SELECT c.*, p.title AS market_title, p.game, p.platform, p.region, p.denomination, p.denom_unit, p.canonical_key, p.product_type
       FROM market_candidates c JOIN market_products p ON p.id = c.market_product_id
      ${g ? 'WHERE c.gate_status = @g' : ''}
      ORDER BY CASE c.gate_status WHEN 'AUTO_APPROVE' THEN 0 WHEN 'REVIEW_REQUIRED' THEN 1 WHEN 'UNSAFE_MATCH' THEN 2
               WHEN 'UNAVAILABLE' THEN 3 WHEN 'DUPLICATE' THEN 4 ELSE 5 END, c.updated_at DESC LIMIT @l`, { g, l: limit });
  const items = rows.map((r) => ({
    id: r.id, status: r.status, gate: r.gate_status, reasons: parse(r.gate_reasons, []),
    title: parse(r.edits, {}).title || parse(r.content, {})?.title || r.market_title,
    category: parse(r.edits, {}).category || parse(r.content, {})?.category || null,
    game: r.game, platform: r.platform, region: r.region, productType: r.product_type,
    denomination: r.denomination == null ? null : Number(r.denomination), unit: r.denom_unit,
    sources: parse(r.sources_found, []), image: parse(r.image, null), supplier: parse(r.supplier, null),
    matchConfidence: r.match_confidence == null ? null : Number(r.match_confidence),
    imageConfidence: r.image_confidence == null ? null : Number(r.image_confidence),
    suggestedPrice: r.suggested_price_cents == null ? null : Number(r.suggested_price_cents),
    supplierCost: r.supplier_cost_cents == null ? null : Number(r.supplier_cost_cents),
    margin: r.expected_margin_pct == null ? null : Number(r.expected_margin_pct),
    edits: parse(r.edits, {}), productId: r.forge_product_id, evaluatedAt: r.evaluated_at,
  }));
  const counts = Object.fromEntries(Object.values(GATE).map((x) => [x, items.filter((i) => i.gate === x && !i.productId).length]));
  return { counts, added: items.filter((i) => i.productId).length, autoAdd: autoAddEnabled(), items };
}

/* ── Scheduling ────────────────────────────────────────────────────────── */

/* "Nightly" means once a day: maintenance also runs hourly (on the first
   request of an hour), and the category batch asks partner and search APIs
   that are rate-limited and, for Brave, paid per query. */
const JOBS = { categories: 24, refresh: 24, images: 168 };
export const BATCH = Number(process.env.DISCOVERY_NIGHTLY_QUERIES || 6);
async function due(job, hours, now) {
  const row = await get(`SELECT value FROM kv WHERE key=@k`, { k: `discovery.job.${job}` }).catch(() => null);
  const last = Date.parse(row?.value || '');
  return !Number.isFinite(last) || now - last >= hours * 3600_000;
}
async function kvSet(key, v) {
  const at = nowIso();
  await run(`INSERT INTO kv (key, value, updated_at) VALUES (@k, @v, @at) ON CONFLICT (key) DO UPDATE SET value=@v, updated_at=@at`,
    { k: key, v: String(v), at }).catch(() => {});
}
const mark = (job, now) => kvSet(`discovery.job.${job}`, new Date(now).toISOString());

/**
 * The weekly category scan, spread over the week: each night asks the sources
 * about the next BATCH search terms, so every shelf comes round once a week and
 * no single night spends minutes on somebody else's API.
 */
export async function nightlyCategoryBatch({ size = BATCH, fetchImpl = fetch } = {}) {
  const queries = (await queriesFor()).sort();
  if (!queries.length) return { queries: [] };
  const row = await get(`SELECT value FROM kv WHERE key='discovery.cursor'`).catch(() => null);
  const from = (Number(row?.value) || 0) % queries.length;
  const batch = [...queries, ...queries].slice(from, from + Math.min(size, queries.length));
  const { collectFromSources } = await import('../market/engine.js');
  const f = throttledFetch(fetchImpl);
  const collected = await collectFromSources(batch, { fetchImpl: f });
  const searched = await collectMentions(batch, { fetchImpl: f }).catch(() => ({ mentions: 0 }));
  await kvSet('discovery.cursor', (from + batch.length) % queries.length);
  await runDiscovery({ onlyNew: true, deadline: Date.now() + 5_000 });
  return { queries: batch, recorded: collected.recorded, mentions: searched.mentions || 0, unavailable: collected.unavailable.length, errors: collected.errors.length };
}

/**
 * From the nightly maintenance run, inside its time budget (`deadline`):
 *   categories  once a day, the next few search terms (a full pass a week)
 *   refresh     daily  — re-evaluate open candidates (stock, cost, price), add what became safe
 *   images      weekly — refresh stale or weak official product pictures
 */
export async function scheduledDiscovery({ now = Date.now(), deadline = Date.now() + 20_000, fetchImpl = fetch, ...deps } = {}) {
  const out = {};
  /* The desk research, once per version, and then every candidate nobody has
     evaluated yet — cheap (no network without suppliers), so it is done on
     the next maintenance run rather than waiting a week. */
  /* Each piece gets a share of the time that is left, and stops on time. */
  const slice = (ms) => Math.min(deadline, Date.now() + ms);
  const research = researchEnabled() && Date.now() < deadline
    ? await importResearch({ deadline: slice(8_000) }).catch((e) => ({ error: e.message })) : {};
  if (research.mentions || research.error) out.research = research;
  if (Date.now() < deadline) {
    const cls = await runDiscovery({ onlyNew: true, deadline: slice(6_000) }).catch(() => null);
    if (cls?.classified) out.classified = cls.classified;
  }
  const fresh = await all(`SELECT id FROM market_candidates WHERE evaluated_at IS NULL AND status <> ALL(@final) LIMIT 300`, { final: FINAL }).catch(() => []);
  if (fresh.length && Date.now() < deadline) {
    out.firstEvaluation = (await evaluateCandidates({ ...deps, ids: fresh.map((r) => r.id), deadline }).catch(() => [])).length;
  }
  if (Date.now() < deadline && await due('categories', JOBS.categories, now)) {
    out.categories = await nightlyCategoryBatch({ fetchImpl }).catch((e) => ({ error: e.message }));
    await mark('categories', now);
  }
  if (Date.now() < deadline && await due('refresh', JOBS.refresh, now)) {
    const ev = await evaluateCandidates({ ...deps, limit: 8, deadline }).catch(() => []);
    out.refresh = { evaluated: ev.length, added: autoAddEnabled() ? (await addAllSafe().catch(() => ({ added: 0 }))).added : 0 };
    await mark('refresh', now);
  }
  /* Brand logos instead of shop artwork, a batch per run until every product
     that shows artwork has its free-licence logo (production only — it asks
     Wikimedia Commons). */
  const { applyLogos, logosEnabled } = await import('./commonsLogoService.js');
  if (logosEnabled() && Date.now() < deadline) {
    out.logos = await applyLogos({ fetchImpl, limit: 20, deadline }).catch((e) => ({ error: e.message }));
  }
  if (Date.now() < deadline && await due('images', JOBS.images, now)) {
    const { enrichmentQueue, enrichMedia } = await import('../productMediaService.js');
    const ids = await enrichmentQueue({ limit: 4 }).catch(() => []);
    out.images = ids.length ? await enrichMedia(ids).catch((e) => ({ error: e.message })) : { applied: 0 };
    await mark('images', now);
  }
  return out;
}

/* ── Official reference denominations ──────────────────────────────────── */

/** Which publisher's store is the official reference for a game. */
export const VENDOR_OF = {
  'ea-fc': 'ea', roblox: 'roblox', fortnite: 'epic', minecraft: 'mojang', 'pokemon-go': 'niantic', valorant: 'riot',
  'league-of-legends': 'riot', 'call-of-duty': 'activision', 'brawl-stars': 'supercell', 'clash-of-clans': 'supercell',
  'clash-royale': 'supercell', 'apex-legends': 'ea', 'genshin-impact': 'hoyoverse', 'free-fire': 'garena',
  'pubg-mobile': 'tencent', 'mobile-legends': 'moonton', 'gta-online': 'rockstar', discord: 'discord', steam: 'valve',
  'playstation-store': 'sony', 'xbox-store': 'microsoft', 'xbox-game-pass': 'microsoft', 'nintendo-store': 'nintendo',
  spotify: 'spotify', netflix: 'netflix', 'google-play': 'google', apple: 'apple', amazon: 'amazon',
};

/**
 * Denominations the OWNER read on the publisher's own store, entered with the
 * page they came from. Publisher stores have no API and forbid automated
 * collection, so a person reads them — this records what that person saw, as
 * an official observation with its source URL, and runs it through the same
 * normalisation, duplicate check and gate as everything else. Nothing here is
 * ever AUTO_APPROVE on its own: one source is 95% at most.
 */
export async function addReferenceDenominations({ game, platforms = ['unknown'], region = 'eu', amounts = [], currency = 'EUR', sourceUrl, actor } = {}, deps = {}) {
  const def = GAMES.find((g) => g.key === game);
  if (!def) throw Object.assign(new Error(`unknown game "${game}"`), { status: 400 });
  if (!/^https:\/\/\S+$/i.test(String(sourceUrl || ''))) throw Object.assign(new Error('give the official page the amounts came from (https)'), { status: 400 });
  if (!amounts.length) throw Object.assign(new Error('no amounts given'), { status: 400 });
  const vendor = VENDOR_OF[game];
  const { recordObservation } = await import('../market/observations.js');
  const productType = def.unit === 'EUR' ? 'giftcard' : def.unit === 'months' ? 'subscription' : 'points';
  const keys = [];
  for (const platform of platforms) {
    for (const a of amounts) {
      const denomination = Number(a.denomination);
      if (!(denomination > 0) || !(Number(a.priceCents) > 0)) continue;
      const hints = { game, platform: platform === 'unknown' ? undefined : platform, region, denomination, denomUnit: def.unit, productType };
      // eslint-disable-next-line no-await-in-loop
      const r = await recordObservation(vendor ? `official:${vendor}` : 'manual', {
        title: `${def.label} ${denomination} ${def.unit} ${platform !== 'unknown' ? platform : ''} ${region}`.replace(/\s+/g, ' ').trim(),
        priceCents: Math.round(Number(a.priceCents)), currency, availability: 'in_stock', url: sourceUrl,
        sourceProductId: `${game}:${platform}:${region}:${denomination}`, hints,
      });
      keys.push(r.marketProductId);
    }
  }
  await runDiscovery();
  const ids = (await all(`SELECT id FROM market_candidates WHERE market_product_id = ANY(@ids) AND status <> ALL(@final)`,
    { ids: [...new Set(keys)], final: FINAL })).map((r) => r.id);
  const evaluated = ids.length ? await evaluateCandidates({ ids, ...deps }) : [];
  await audit({ actor, action: 'discovery.reference_added', targetType: 'market', targetId: game,
    metadata: { platforms, region, amounts: amounts.map((a) => a.denomination), sourceUrl } }).catch(() => {});
  return { recorded: keys.length, evaluated: evaluated.map((e) => ({ id: e.id, title: e.title, status: e.status, reasons: e.reasons })) };
}

/* ── The complete scan ─────────────────────────────────────────────────── */

/**
 * A complete scan: every search term for every category at every permitted
 * source, then every open candidate evaluated, then the safe ones added. It
 * takes as long as it takes — but a server function on Vercel lives 30
 * seconds, so it runs in STEPS: each call works until its budget is spent,
 * saves where it was, and the next call carries on. The admin page calls the
 * next step until it says done; the CLI (scripts/discovery-full-scan.mjs)
 * gives each step an unlimited budget. The per-host spacing and timeouts
 * apply throughout — a long scan is slow, never fast.
 */
const FULL_KEY = 'discovery.full';
async function fullState() {
  const row = await get(`SELECT value FROM kv WHERE key=@k`, { k: FULL_KEY }).catch(() => null);
  return parse(row?.value, null);
}
const saveFull = (st) => kvSet(FULL_KEY, JSON.stringify(st));

export async function fullScanStatus() { return fullState(); }

/** Start a complete scan (or say one is already running). */
export async function startFullScan({ actor = 'system', categories = null, restart = false } = {}) {
  if (researchEnabled()) await importResearch().catch(() => {});
  const cur = await fullState();
  if (cur && cur.phase !== 'done' && !restart) return cur;
  const queries = await queriesFor(categories, { cap: Infinity });
  const st = { id: `full-${Date.now().toString(36)}`, startedAt: nowIso(), by: actor, categories, phase: 'collect',
    queries, qi: 0, recorded: 0, unavailable: [], errors: 0, candidates: null, ei: 0, byGate: {}, added: 0, steps: 0 };
  await saveFull(st);
  return st;
}

/** One step of the complete scan, within `budgetMs`. */
export async function fullScanStep({ budgetMs = 20_000, fetchImpl = fetch, autoAdd = autoAddEnabled(), ...deps } = {}) {
  const st = await fullState();
  if (!st || st.phase === 'done') return st || { phase: 'idle' };
  const until = Date.now() + budgetMs;
  const left = () => Date.now() < until;
  st.steps += 1;

  if (st.phase === 'collect') {
    const { collectFromSources } = await import('../market/engine.js');
    const f = throttledFetch(fetchImpl);
    while (st.qi < st.queries.length && left()) {
      // eslint-disable-next-line no-await-in-loop
      const r = await collectFromSources([st.queries[st.qi]], { fetchImpl: f });
      // eslint-disable-next-line no-await-in-loop
      const m = await collectMentions([st.queries[st.qi]], { fetchImpl: f, credentials: deps.searchCredentials });
      st.recorded += r.recorded; st.errors += r.errors.length + m.errors.length;
      st.mentions = (st.mentions || 0) + m.mentions;
      if (m.skipped && !st.unavailable.some((x) => x.source === 'brave')) st.unavailable.push({ source: 'brave', reason: m.skipped });
      /* Reference prices (official:*) and the manual source are typed in by
         hand on purpose; they are not "unavailable". */
      for (const u of r.unavailable) {
        if (/^official:|^manual$/.test(u.source) || st.unavailable.some((x) => x.source === u.source)) continue;
        st.unavailable.push({ source: u.source, reason: u.reason });
      }
      st.qi += 1;
    }
    if (st.qi >= st.queries.length) st.phase = 'classify';
  }
  if (st.phase === 'classify' && left()) {
    /* Every market product once, in order, across as many steps as it takes. */
    if (!st.classifyIds) { st.classifyIds = (await all(`SELECT id FROM market_products ORDER BY created_at`)).map((r) => r.id); st.ci = 0; }
    while (st.ci < st.classifyIds.length && left()) {
      // eslint-disable-next-line no-await-in-loop
      const r = await runDiscovery({ ids: st.classifyIds.slice(st.ci, st.ci + 25), deadline: until, atLeast: 1 });
      st.ci += Math.max(1, r.classified);
    }
  }
  if (st.phase === 'classify' && st.ci >= (st.classifyIds?.length ?? Infinity) && left()) {
    st.candidates = (await all(`SELECT id FROM market_candidates WHERE status <> ALL(@final) ORDER BY created_at`, { final: FINAL })).map((r) => r.id);
    st.ei = 0;
    st.phase = 'evaluate';
  }
  if (st.phase === 'evaluate') {
    const catalogue = await catalogueModels();
    while (st.ei < st.candidates.length && left()) {
      // eslint-disable-next-line no-await-in-loop
      const r = await evaluateCandidate(st.candidates[st.ei], { ...deps, catalogue }).catch((e) => ({ status: 'error', reasons: [e.message] }));
      st.byGate[r.status] = (st.byGate[r.status] || 0) + 1;
      st.ei += 1;
    }
    if (st.ei >= st.candidates.length) st.phase = 'add';
  }
  if (st.phase === 'add' && left()) {
    st.added = autoAdd ? (await addAllSafe()).added : 0;
    st.phase = 'done';
    st.finishedAt = nowIso();
  }
  await saveFull(st);
  return { ...st, queries: undefined, candidates: undefined, classifyIds: undefined, totalQueries: st.queries.length, totalCandidates: st.candidates?.length ?? null };
}

export { parseTitle, productTitle };
