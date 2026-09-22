/**
 * Cost prices, pasted in one go.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Not one of the 72 products carries a purchase cost, and without one every
 * margin in this shop is blind: the profit page shows revenue minus zero, the
 * pricing engine refuses to recommend with NO_COST, and the supplier comparison
 * has nothing to compare. The numbers themselves are the owner's — nobody can
 * invent them — but the LABOUR is not: entering them meant opening 72 products
 * one at a time, and an hour of clicking is a good reason to leave it for later
 * forever.
 *
 * A supplier price list is already a table. So is a spreadsheet. This takes it
 * as text.
 *
 * ── WHAT IT REFUSES TO GUESS ──────────────────────────────────────────────
 * A line that does not match a SKU is REPORTED, never silently skipped — a
 * typo'd SKU that vanishes is how somebody comes back convinced they entered a
 * cost they did not. A cost above the sell price is applied but flagged, because
 * selling at a loss is a real decision somebody might make deliberately and is
 * usually a decimal in the wrong place.
 *
 * Dry by default. The report is free; writing 72 products is a decision.
 */
import { all } from '../db/index.js';
import { audit } from './auditService.js';
import { costCentsFromMetadata } from './costService.js';

/**
 * A money string as cents.
 *
 * Accepts what people actually paste: "€1,23", "1.23", "1,23", " 12 ", "1.234,56"
 * and "1,234.56". The last two are the ambiguous ones, and they are decided by
 * which separator comes LAST — that is the decimal one in both conventions.
 * Anything else returns null rather than a number that looks plausible.
 */
export function parseMoney(raw) {
  let s = String(raw ?? '').trim()
    .replace(/[€$£\s]/g, '')
    .replace(/^"+|"+$/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    /* Whichever is last is the decimal separator; the other groups thousands. */
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    /* A lone comma is a decimal separator here, unless it is grouping three
       digits at the end ("1,234") — in which case reading it as 1.234 would
       turn twelve hundred into one. */
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * One pasted line as { sku, cents } — or a reason it is not one.
 *
 * The SKU is the first field and the cost is the last, so a product name in
 * between does no harm. Tab and semicolon are unambiguous; the comma is not,
 * because "APEX-2150,12,50" is both "three fields" and "a SKU and a Dutch
 * decimal". Splitting it naively takes the cost as 50 cents — silently, on a
 * line that looks fine. So when a comma split ends in a bare two-digit group,
 * the last two fields are rejoined into one number.
 */
export function parseLine(line) {
  const raw = String(line ?? '').trim();
  if (!raw || raw.startsWith('#')) return null;

  const sep = raw.includes('\t') ? '\t' : (raw.includes(';') ? ';' : ',');
  let parts = raw.split(sep).map((x) => x.trim());
  if (sep === ',' && parts.length > 2 && /^\d{1,2}$/.test(parts[parts.length - 1])) {
    const tail = parts.pop();
    parts[parts.length - 1] = `${parts[parts.length - 1]}.${tail}`;
  }
  if (parts.length < 2) return { error: 'no separator — expected "SKU<tab>cost"', raw };
  /* "X,1,234" is either a SKU and €1,234 or three fields ending in 234, and
     nothing in the line says which. Picking one silently is how a cost lands an
     order of magnitude out, so it is refused and named. */
  if (sep === ',' && parts.length > 2 && /^[\d.,]+$/.test(parts[parts.length - 2])) {
    return { error: 'ambiguous — use a tab or a semicolon between SKU and cost', raw };
  }

  const sku = String(parts[0]).replace(/^"+|"+$/g, '');
  const amount = parts[parts.length - 1];
  const cents = parseMoney(amount);
  if (!sku) return { error: 'no SKU', raw };
  if (cents === null) return { error: `"${amount}" is not an amount`, raw };
  return { sku, cents, raw };
}

/**
 * Read a pasted table against the catalogue.
 *
 * Nothing is written unless `apply` is true, and the report is the same shape
 * either way — so the screen an owner approves is the screen they already read.
 */
export async function importCosts(text, { apply = false, actor = null } = {}) {
  const products = await all(`SELECT id, sku, name, price, metadata FROM products`);
  const bySku = new Map();
  for (const p of products) {
    if (p.sku) bySku.set(String(p.sku).trim().toLowerCase(), p);
  }

  const rows = [];
  const bad = [];
  const seen = new Set();

  for (const line of String(text || '').split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (parsed.error) { bad.push(parsed); continue; }

    const product = bySku.get(parsed.sku.toLowerCase());
    if (!product) {
      bad.push({ error: 'no product with that SKU', raw: parsed.raw, sku: parsed.sku });
      continue;
    }
    /* The same SKU twice in one paste is a mistake worth naming rather than
       resolving by letting the last line win in silence. */
    if (seen.has(product.id)) {
      bad.push({ error: 'this SKU appears more than once', raw: parsed.raw, sku: parsed.sku });
      continue;
    }
    seen.add(product.id);

    let meta = {};
    try { meta = typeof product.metadata === 'string' ? JSON.parse(product.metadata || '{}') : (product.metadata || {}); }
    catch { meta = {}; }
    const before = costCentsFromMetadata(meta);
    const price = Number(product.price || 0);

    rows.push({
      id: product.id, sku: product.sku, name: product.name,
      price, before, after: parsed.cents,
      changed: before !== parsed.cents,
      /* Applied, not refused — an owner may be pricing a loss leader on
         purpose — but never quietly. */
      warning: parsed.cents >= price && price > 0
        ? `cost is not below the €${(price / 100).toFixed(2)} sell price`
        : null,
    });
  }

  if (apply && rows.length) {
    const { getProduct, updateProduct } = await import('./productService.js');
    for (const r of rows.filter((x) => x.changed)) {
      const p = await getProduct(r.id);
      if (!p) continue;
      /* Both names, because three different readers disagree about which one
         this field is called — costService documents exactly that. Writing one
         of them leaves the pricing engine still blind. */
      await updateProduct(r.id, {
        metadata: { ...p.metadata, cost: r.after, costCents: r.after },
      });
    }
    await audit({ actor, action: 'product.costs_imported', targetType: 'products',
      targetId: String(rows.length),
      metadata: { updated: rows.filter((x) => x.changed).length, unmatched: bad.length } });
  }

  /* Re-read after a write rather than adding up what was probably done: the
     point of this figure is how many products the shop can now compute a margin
     for, and an estimate of that is worth nothing. */
  const after = apply && rows.some((r) => r.changed)
    ? await all(`SELECT metadata FROM products`) : products;
  const withCost = after.filter((p) => {
    let m = {};
    try { m = typeof p.metadata === 'string' ? JSON.parse(p.metadata || '{}') : (p.metadata || {}); }
    catch { m = {}; }
    return costCentsFromMetadata(m) != null;
  }).length;

  return {
    applied: apply,
    matched: rows.length,
    changed: rows.filter((r) => r.changed).length,
    unchanged: rows.filter((r) => !r.changed).length,
    warnings: rows.filter((r) => r.warning).length,
    unmatched: bad.length,
    /* Where the catalogue stands, so the owner sees the gap close rather than
       counting rows themselves. */
    catalogue: { total: products.length, withCost },
    rows: rows.slice(0, 200),
    problems: bad.slice(0, 50),
  };
}
