#!/usr/bin/env node
/**
 * The commercial state of the catalogue, from the catalogue itself.
 *
 *   DATABASE_URL=postgres://…  node scripts/audit-commercial.mjs
 *   DATABASE_URL=…             node scripts/audit-commercial.mjs --json
 *
 * ── WHAT THIS WILL AND WILL NOT TELL YOU ──────────────────────────────────
 * It reports what the data supports and refuses the rest. Three questions a
 * commercial audit is usually asked cannot be answered from this shop today,
 * and the report says so rather than estimating:
 *
 *   which products sell      no order has ever been placed
 *   which products earn      no product carries a purchase cost
 *   what the market charges  no competitor source is configured, so the
 *                            market tables are empty
 *
 * A projection built on any of those would be a number with nothing behind it,
 * and this shop's whole position is that it does not do that.
 *
 * What it CAN compute, entirely from prices the owner set:
 *
 *   LADDER INVERSION   a bigger pack that costs more per unit than a smaller
 *                      one. Unambiguously wrong: the customer who buys more
 *                      pays more per unit, and this is a market where people
 *                      compare per-unit prices before they buy.
 *   FACE-VALUE FLOOR   a gift card whose price, after payment fees, leaves the
 *                      shop less than the card's own face value. That sale
 *                      cannot make money unless the card is bought below face,
 *                      and the report says exactly how far below.
 *   LADDER SHAPE       how steeply each ladder discounts, so a category with no
 *                      volume incentive is visible next to one that has plenty.
 *   DEPTH              how many rungs each category has, so the thin ones show.
 */
import path from 'node:path';

const ROOT = process.cwd();
const asJson = process.argv.includes('--json');
const { all, get } = await import(path.join(ROOT, 'server/src/db/index.js'));
const { config } = await import(path.join(ROOT, 'server/src/config/env.js'));

const FEE_PCT = config.market.paymentFeePercent / 100;
const FEE_FIX = config.market.paymentFixedFee;
const MIN_PROFIT = config.market.minimumProfitEur;

const products = await all(
  `SELECT id, sku, name, category, price, metadata FROM products WHERE active = 1 ORDER BY category, price`);

const parsed = products.map((p) => {
  let meta = {}; try { meta = JSON.parse(p.metadata || '{}'); } catch { /* {} */ }
  /* The quantity a pack contains, from the name — "2,800 V-Bucks" → 2800.
     Only leading numbers: "Xbox Game Pass Ultimate — 3 Months" is not 3 units
     of anything comparable, and treating it as one produces nonsense. */
  const m = /^([\d.,]+)\s+\S/.exec(p.name);
  const units = m ? Number(m[1].replace(/[.,]/g, '')) : null;
  const face = (/€\s?(\d+)/.exec(p.name) || [])[1];
  return { ...p, meta, units, faceEur: face ? Number(face) : null, priceEur: p.price / 100,
    costEur: Number.isFinite(Number(meta.costCents)) ? Number(meta.costCents) / 100 : null };
});

/** What the shop keeps after the payment provider takes its cut. */
const net = (priceEur) => priceEur - (priceEur * FEE_PCT + FEE_FIX);

// ── What cannot be answered, and why ───────────────────────────────────────
const sold = Number((await get(
  `SELECT COALESCE(SUM(oi.quantity), 0) AS n FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
    WHERE o.status IN ('payment_received','processing','awaiting_fulfillment','completed')`)
  .catch(() => ({ n: 0 })))?.n || 0);
const withCost = parsed.filter((p) => p.costEur !== null).length;
const observations = Number((await get(`SELECT COUNT(*) AS n FROM market_observations`)
  .catch(() => ({ n: 0 })))?.n || 0);
const stocked = Number((await get(
  `SELECT COUNT(DISTINCT product_id) AS n FROM product_codes WHERE status='available'`)
  .catch(() => ({ n: 0 })))?.n || 0);

const unanswerable = [];
if (!sold) unanswerable.push({ question: 'Which products are popular?',
  why: 'No order has ever been placed. Popularity has no data behind it, and ranking by anything else would be ranking by guess.' });
if (!withCost) unanswerable.push({ question: 'Which products have thin margin?',
  why: `None of the ${parsed.length} products carries a purchase cost, so no margin is computable. The pricing engine blocks these with NO_COST rather than assuming one.` });
if (!observations) unanswerable.push({ question: 'What does the market sell that we do not?',
  why: 'No competitor source is configured, so market_observations is empty. A gap list without observations is a list of assumptions.' });

// ── Ladder inversions ──────────────────────────────────────────────────────
const byCat = {};
for (const p of parsed) (byCat[p.category] = byCat[p.category] || []).push(p);

const inversions = [];
const ladders = [];
for (const [cat, rows] of Object.entries(byCat)) {
  const rungs = rows.filter((r) => r.units).sort((a, b) => a.units - b.units);
  if (rungs.length < 2) continue;
  const perK = rungs.map((r) => ({ ...r, perK: (r.priceEur / r.units) * 1000 }));
  let best = Infinity;
  for (const r of perK) {
    if (r.perK > best + 1e-9) {
      /* Priced back onto the curve: never dearer per unit than the cheapest
         rung below it. A suggestion, not a decision — the owner prices. */
      const suggested = Math.round((best * r.units) / 1000 * 100) / 100;
      inversions.push({ category: cat, sku: r.sku, name: r.name,
        units: r.units, priceEur: r.priceEur, perK: +r.perK.toFixed(2),
        cheaperRungPerK: +best.toFixed(2),
        suggestedMaxEur: suggested,
        overchargeEur: +(r.priceEur - suggested).toFixed(2) });
    }
    best = Math.min(best, r.perK);
  }
  const first = perK[0].perK, last = perK[perK.length - 1].perK;
  ladders.push({ category: cat, rungs: perK.length,
    perKTop: +first.toFixed(2), perKBottom: +last.toFixed(2),
    volumeDiscountPct: +((1 - last / first) * 100).toFixed(1) });
}

// ── Face-value floor ───────────────────────────────────────────────────────
const faceFloor = [];
for (const p of parsed) {
  if (p.faceEur === null) continue;
  const keep = net(p.priceEur);
  const maxCost = keep - MIN_PROFIT;
  faceFloor.push({ sku: p.sku, name: p.name, priceEur: p.priceEur, faceEur: p.faceEur,
    netEur: +keep.toFixed(2),
    profitAtFaceEur: +(keep - p.faceEur).toFixed(2),
    discountNeededPct: +(((p.faceEur - maxCost) / p.faceEur) * 100).toFixed(1),
    losesAtFace: keep < p.faceEur });
}

// ── Depth ──────────────────────────────────────────────────────────────────
const depth = Object.entries(byCat)
  .map(([category, rows]) => ({ category, products: rows.length }))
  .sort((a, b) => a.products - b.products);

const report = {
  products: parsed.length,
  unitsEverSold: sold,
  productsWithCost: withCost,
  productsStocked: stocked,
  marketObservations: observations,
  unanswerable,
  inversions,
  faceFloor: faceFloor.filter((f) => f.losesAtFace || f.discountNeededPct > 0),
  ladders: ladders.sort((a, b) => a.volumeDiscountPct - b.volumeDiscountPct),
  depth,
  fees: { percent: config.market.paymentFeePercent, fixed: FEE_FIX, minimumProfit: MIN_PROFIT },
};

if (asJson) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }

const C = process.stdout.isTTY
  ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', b: '\x1b[1m', d: '\x1b[2m', o: '\x1b[0m' }
  : { r: '', y: '', g: '', b: '', d: '', o: '' };

console.log(`\n${C.b}ForgeMarket — commercial audit${C.o}`);
console.log(`${C.d}${parsed.length} active products · fees ${config.market.paymentFeePercent}% + €${FEE_FIX} · minimum profit €${MIN_PROFIT}${C.o}`);

if (unanswerable.length) {
  console.log(`\n${C.b}What this cannot tell you, and why${C.o}`);
  for (const u of unanswerable) {
    console.log(`  ${C.y}✗${C.o} ${u.question}`);
    console.log(`      ${C.d}${u.why}${C.o}`);
  }
}

console.log(`\n${C.b}Ladder inversions — a bigger pack that costs more per unit${C.o}`);
if (!inversions.length) console.log(`  ${C.g}None. Every ladder gets cheaper per unit as it goes up.${C.o}`);
for (const i of inversions) {
  console.log(`  ${C.r}${i.name}${C.o}`);
  console.log(`      €${i.priceEur.toFixed(2)} = €${i.perK}/1,000 — dearer than the smaller pack at €${i.cheaperRungPerK}/1,000`);
  console.log(`      ${C.d}on the curve it would be at most €${i.suggestedMaxEur} (−€${i.overchargeEur})${C.o}`);
}

console.log(`\n${C.b}Gift cards — what is left after fees, against the card's own face value${C.o}`);
for (const f of report.faceFloor) {
  const tag = f.losesAtFace ? `${C.r}loses money at face value${C.o}` : `${C.y}thin${C.o}`;
  console.log(`  ${f.name}`);
  console.log(`      €${f.priceEur.toFixed(2)} → keeps €${f.netEur} on a €${f.faceEur} card — ${tag}`);
  console.log(`      ${C.d}needs the card bought ${f.discountNeededPct}% under face to clear €${MIN_PROFIT}${C.o}`);
}

console.log(`\n${C.b}Volume incentive per ladder ${C.d}(how much cheaper the top rung is per unit)${C.o}`);
for (const l of report.ladders) {
  const bar = '█'.repeat(Math.max(0, Math.round(l.volumeDiscountPct / 2)));
  console.log(`  ${String(l.category).padEnd(14)} ${String(l.volumeDiscountPct).padStart(5)}%  ${C.d}${bar}${C.o}`);
}

console.log(`\n${C.b}Depth${C.o}`);
console.log('  ' + depth.map((d) => `${d.category}:${d.products}`).join('  '));
console.log('');
process.exit(0);
