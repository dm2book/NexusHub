/**
 * Phase 1 of discovery: read the whole ForgeMarket catalogue and say, per
 * category, what is there and what is wrong with it.
 *
 * Per product: category, name, SKU, platform, region, denomination and unit
 * (from the same parser the market uses, with the product's own metadata as
 * hints), price, picture and its status, description, supplier and status.
 *
 * Per category:
 *   products              how many, and how many are active
 *   missingDenominations  amounts a permitted source has IN STOCK, sellable to a
 *                         Dutch buyer, in the last seven days, that the shop
 *                         does not sell — from observations only, never from a
 *                         list of what "should" exist. No source data → null
 *                         ("not known"), not an empty list ("nothing missing")
 *   duplicates            two products that are the same thing to buy
 *   wrongCategory         a product whose game is the main game of ANOTHER
 *                         category (a Robux card on the Valorant shelf)
 *   missingImage          no picture at all
 *   weakImage             a drawn tile, the shop's icon, a generated or
 *                         unverified picture, or a low-quality one
 *   missingDescription    under 40 characters
 *   missingSupplier       no supplier mapping and no codes in stock
 */
import { all } from '../../db/index.js';
import { parseTitle } from '../market/normalize.js';
import { mediaStatus } from '../productMediaService.js';
import { catalogMatch, sameDenomination, SELLABLE_REGIONS, STALE_HOURS, PRESENCE } from './gate.js';
import { productTitle } from './names.js';

const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m || '{}') : (m || {}); } catch { return {}; } };

/** One catalogue row in the canonical model. */
export function catalogueModel(p) {
  const meta = parse(p.metadata);
  const model = parseTitle(p.name, { platform: meta.platform, region: meta.region, game: meta.game,
    denomination: meta.denomination, denomUnit: meta.denomUnit });
  return { product: { ...p, metadata: meta }, model, key: model.canonicalKey };
}

/** Every product, active or not — a hidden duplicate is still a duplicate. */
export async function catalogueModels() {
  const rows = await all(`SELECT id, name, sku, category, price, description, metadata, active FROM products`);
  return rows.map(catalogueModel);
}

/** Groups of products that are the same thing to buy. */
export function findDuplicates(models) {
  const groups = [];
  const used = new Set();
  for (let i = 0; i < models.length; i++) {
    if (used.has(i) || models[i].model.denomination == null) continue;
    const group = [models[i]];
    for (let j = i + 1; j < models.length; j++) {
      if (used.has(j)) continue;
      const a = models[i].model, b = models[j].model;
      const sameName = models[i].product.name.trim().toLowerCase() === models[j].product.name.trim().toLowerCase();
      const same = sameDenomination(a, b)
        && (a.platform === b.platform || a.platform === 'unknown' || b.platform === 'unknown')
        && (a.region === b.region || a.region === 'unknown' || b.region === 'unknown');
      if (sameName || same) { group.push(models[j]); used.add(j); }
    }
    if (group.length > 1) { used.add(i); groups.push(group.map((g) => ({ id: g.product.id, name: g.product.name, active: !!g.product.active }))); }
  }
  return groups;
}

/** The game most of a category's products are for (null for a mixed shelf). */
export function mainGameOf(models) {
  const n = new Map();
  for (const m of models) if (!String(m.model.game).startsWith('unknown')) n.set(m.model.game, (n.get(m.model.game) || 0) + 1);
  const [top] = [...n.entries()].sort((a, b) => b[1] - a[1]);
  return top && top[1] / models.length >= 0.6 ? top[0] : null;
}

/**
 * The report. `market` (optional) is the in-stock, fresh, sellable market
 * products: [{ game, productType, platform, region, denomination, denomUnit, quantity, edition, title }].
 */
export function auditCatalogue(models, { suppliers = new Map(), codes = {}, market = null } = {}) {
  const byCat = new Map();
  for (const m of models) {
    const c = m.product.category || '(none)';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(m);
  }
  const mains = new Map([...byCat.entries()].map(([c, ms]) => [c, mainGameOf(ms)]));
  const owner = new Map();
  for (const [c, g] of mains) if (g && !owner.has(g)) owner.set(g, c);

  const categories = [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, ms]) => {
    const row = (m, extra = {}) => ({ id: m.product.id, name: m.product.name, ...extra });
    const media = ms.map((m) => [m, mediaStatus(m.product)]);
    const games = new Set(ms.map((m) => m.model.game));
    let missingDenominations = null;
    if (market) {
      const shelf = market.filter((x) => games.has(x.game) && SELLABLE_REGIONS.includes(x.region));
      const seen = new Set();
      missingDenominations = shelf
        .filter((x) => catalogMatch(x, ms).status === PRESENCE.MISSING_PRODUCT)
        .filter((x) => { const k = `${x.game}:${x.platform}:${x.region}:${x.denomination}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .map((x) => ({ title: productTitle(x), denomination: Number(x.denomination), unit: x.denomUnit, platform: x.platform, region: x.region }))
        .sort((a, b) => a.denomination - b.denomination);
    }
    return {
      category,
      products: ms.length,
      active: ms.filter((m) => m.product.active).length,
      mainGame: mains.get(category),
      missingDenominations,
      duplicates: findDuplicates(ms),
      wrongCategory: ms.filter((m) => owner.has(m.model.game) && owner.get(m.model.game) !== category && mains.get(category) !== m.model.game)
        .map((m) => row(m, { belongsIn: owner.get(m.model.game) })),
      missingImage: media.filter(([, s]) => !s.image).map(([m]) => row(m)),
      weakImage: media.filter(([, s]) => s.image && s.status !== 'official').map(([m, s]) => row(m, { status: s.status, reason: s.reasons[0] })),
      missingDescription: ms.filter((m) => String(m.product.description || '').trim().length < 40).map((m) => row(m)),
      missingSupplier: ms.filter((m) => !suppliers.has(m.product.id) && !(codes[m.product.id] > 0)).map((m) => row(m)),
      items: ms.map((m) => ({
        id: m.product.id, name: m.product.name, sku: m.product.sku || m.product.metadata.sku || null,
        platform: m.model.platform, region: m.model.region, denomination: m.model.denomination, unit: m.model.denomUnit,
        price: Number(m.product.price) || 0, image: m.product.metadata.image || null,
        description: !!String(m.product.description || '').trim(), supplier: suppliers.get(m.product.id) || null,
        active: !!m.product.active,
      })),
    };
  });
  const sum = (k) => categories.reduce((a, c) => a + (Array.isArray(c[k]) ? c[k].length : 0), 0);
  return {
    totals: {
      categories: categories.length, products: models.length, active: models.filter((m) => m.product.active).length,
      duplicates: sum('duplicates'), wrongCategory: sum('wrongCategory'), missingImage: sum('missingImage'),
      weakImage: sum('weakImage'), missingDescription: sum('missingDescription'), missingSupplier: sum('missingSupplier'),
      missingDenominations: market ? sum('missingDenominations') : null,
    },
    categories,
  };
}

/** The report from the database. */
export async function catalogueAudit() {
  const models = await catalogueModels();
  const maps = await all(`SELECT sp.product_id, s.name, sp.cost FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id
                           WHERE sp.product_id IS NOT NULL ORDER BY sp.priority ASC`).catch(() => []);
  const suppliers = new Map();
  for (const m of maps) if (!suppliers.has(m.product_id)) suppliers.set(m.product_id, { name: m.name, cost: m.cost == null ? null : Number(m.cost) });
  const codeRows = await all(`SELECT product_id, COUNT(*)::int AS n FROM product_codes WHERE status = 'available' GROUP BY product_id`).catch(() => []);
  const codes = Object.fromEntries(codeRows.map((r) => [r.product_id, Number(r.n)]));
  const cut = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString();
  const market = await all(`SELECT DISTINCT p.* FROM market_products p JOIN market_observations o ON o.market_product_id = p.id
                             WHERE o.observed_at >= @cut AND o.availability = 'in_stock'`, { cut }).catch(() => []);
  const marketModels = market.map((p) => ({ game: p.game, productType: p.product_type, platform: p.platform, region: p.region,
    denomination: p.denomination == null ? null : Number(p.denomination), denomUnit: p.denom_unit, quantity: p.quantity,
    edition: p.edition, title: p.title }));
  return { ...auditCatalogue(models, { suppliers, codes, market: marketModels.length ? marketModels : null }),
    marketDataFrom: marketModels.length ? cut : null };
}
