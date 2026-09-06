#!/usr/bin/env node
/**
 * Which products are worth your attention first — on the one axis that has data.
 *
 *   DATABASE_URL=postgres://…  node scripts/rank-opportunity.mjs
 *   DATABASE_URL=…             node scripts/rank-opportunity.mjs --json
 *
 * ── WHAT THIS CANNOT RANK BY, AND WHY ─────────────────────────────────────
 * A product ranking is normally margin × demand × competition. None of those
 * three exist here, and none of them can be estimated without inventing them:
 *
 *   margin       0 of 72 products carry a purchase cost. The pricing engine
 *                blocks every recommendation with NO_COST for the same reason.
 *   demand       0 orders have ever been placed.
 *   competition  0 market observations; no competitor source is configured.
 *   advertising  0 ad events, 0 spend, nothing attributed.
 *
 * ── WHAT IT RANKS BY INSTEAD ──────────────────────────────────────────────
 * The binding constraint of this shop is not shelf space, it is one person's
 * hours: 66 of 72 products can only be delivered by hand. Delivering a €174.99
 * order and a €8.49 order costs the same ten minutes, so until fulfilment is
 * automated, CASH PER ORDER is the honest proxy for opportunity — and it is
 * computed entirely from prices the owner set.
 *
 * Three real modifiers, all derived, none guessed:
 *
 *   AUTOMATABLE   a code product can one day sell itself; an account top-up
 *                 never can. Worth more per hour of the same attention.
 *   LADDER        how far a buyer can be moved up from here, in euros. A rung
 *                 with €135 above it is an upsell; a lone product is not.
 *   MARGIN CEIL   for a face-value card ONLY, the most it can earn: what is
 *                 left after the shop's own fees, minus the face value it has
 *                 to buy. That is a real bound and the only one available
 *                 without cost data — and for four of them it is negative.
 */
import path from 'node:path';

const ROOT = process.cwd();
const asJson = process.argv.includes('--json');
const { all, get } = await import(path.join(ROOT, 'server/src/db/index.js'));
const { config } = await import(path.join(ROOT, 'server/src/config/env.js'));
const { DELIVERY_INFO } = await import(path.join(ROOT, 'src/lib/deliveryInfo.js'));
const { countWithCost } = await import(path.join(ROOT, 'server/src/services/costService.js'));

const FEE_PCT = config.market.paymentFeePercent / 100;
const FEE_FIX = config.market.paymentFixedFee;
const net = (eur) => eur - (eur * FEE_PCT + FEE_FIX);

/* Same rule as audit-fulfilment: an account top-up is one the shop's own
   delivery copy says needs something off the buyer's account. */
const ACCOUNT_BASED = new Set(Object.entries(DELIVERY_INFO)
  .filter(([k, v]) => k !== 'default'
    && /username|gebruikersnaam|account name|player id|2fa|2-step|2-staps/i
      .test([v.en?.method, ...(v.en?.steps || [])].join(' ')))
  .map(([k]) => k));

const rows = await all(
  `SELECT id, sku, name, category, kind, price, metadata FROM products WHERE active = 1`);

// The three things that would make this a real ranking, counted rather than assumed.
const sold = Number((await get(
  `SELECT COALESCE(SUM(oi.quantity),0) AS n FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
    WHERE o.status IN ('payment_received','processing','awaiting_fulfillment','completed')`)
  .catch(() => ({ n: 0 })))?.n || 0);
const observations = Number((await get('SELECT COUNT(*) AS n FROM market_observations')
  .catch(() => ({ n: 0 })))?.n || 0);
const adEvents = Number((await get('SELECT COUNT(*) AS n FROM ad_events')
  .catch(() => ({ n: 0 })))?.n || 0);
// One reader, so this number means the same thing here as in the pricing engine.
const withCost = countWithCost(rows);

const byCategory = {};
for (const r of rows) (byCategory[r.category] = byCategory[r.category] || []).push(r);

const scored = rows.map((p) => {
  const price = Number(p.price) / 100;
  const face = (/€\s?(\d+)/.exec(p.name) || [])[1];
  const faceEur = face ? Number(face) : null;
  const automatable = !ACCOUNT_BASED.has(p.category);
  const rungs = (byCategory[p.category] || []).map((x) => Number(x.price) / 100).sort((a, b) => a - b);
  const headroom = Math.max(0, rungs[rungs.length - 1] - price);
  /* The only real margin bound available. A card has to be bought, and its
     price cannot exceed its face value by much — so what is left after fees,
     minus the face, is the most it can ever earn. Negative means it cannot
     earn anything unless the card is sourced below face. */
  const marginCeiling = faceEur === null ? null : +(net(price) - faceEur).toFixed(2);

  return {
    sku: p.sku, name: p.name, category: p.category, price,
    net: +net(price).toFixed(2),
    automatable, headroom: +headroom.toFixed(2), rungs: rungs.length,
    marginCeiling,
    /* Cash per order is the ranking. The two modifiers are small on purpose:
       they break ties between products of similar value, they do not invent a
       different order. An account top-up is worth 20% less of the same hour
       because it can never stop needing one; a rung with somewhere to go is
       worth a little more because the order can grow. */
    score: +(price * (automatable ? 1 : 0.8) * (1 + Math.min(0.25, headroom / (price * 8)))).toFixed(2),
  };
}).sort((a, b) => b.score - a.score);

const top = scored.slice(0, 20);

if (asJson) {
  console.log(JSON.stringify({
    unrankable: { margin: `${withCost} of ${rows.length} products carry a cost`,
      demand: `${sold} units ever sold`, competition: `${observations} market observations`,
      advertising: `${adEvents} ad events` },
    rankedBy: 'cash per order, modified by automatability and ladder headroom',
    top,
  }, null, 2));
  process.exit(0);
}

const C = process.stdout.isTTY
  ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', b: '\x1b[1m', d: '\x1b[2m', o: '\x1b[0m' }
  : { r: '', y: '', g: '', b: '', d: '', o: '' };

console.log(`\n${C.b}ForgeMarket — where the money is, on the evidence there is${C.o}`);
console.log(`${C.d}${rows.length} active products · fees ${config.market.paymentFeePercent}% + €${FEE_FIX}${C.o}\n`);

console.log(`${C.y}Cannot be ranked on, and not estimated:${C.o}`);
console.log(`  margin        ${withCost} of ${rows.length} products carry a purchase cost`);
console.log(`  demand        ${sold} units have ever been sold`);
console.log(`  competition   ${observations} market observations`);
console.log(`  advertising   ${adEvents} ad events, nothing attributed`);
console.log(`${C.d}  Ranking on any of those would be ranking on a number nobody measured.${C.o}\n`);

console.log(`${C.b}Ranked by cash per order${C.o} ${C.d}— 66 of 72 products are delivered by hand, and`);
console.log(`  a €174.99 order costs the same ten minutes as a €8.49 one.${C.o}\n`);

console.log(`  #  ${'product'.padEnd(30)} ${'price'.padStart(8)} ${'keeps'.padStart(8)}  auto  ${'upsell'.padStart(8)}  ceiling`);
top.forEach((p, i) => {
  const ceil = p.marginCeiling === null ? `${C.d}    —${C.o}`
    : p.marginCeiling < 0 ? `${C.r}${`€${p.marginCeiling.toFixed(2)}`.padStart(7)}${C.o}`
      : `${C.g}${`€${p.marginCeiling.toFixed(2)}`.padStart(7)}${C.o}`;
  console.log(` ${String(i + 1).padStart(2)}  ${p.name.slice(0, 30).padEnd(30)} `
    + `${`€${p.price.toFixed(2)}`.padStart(8)} ${`€${p.net.toFixed(2)}`.padStart(8)}  `
    + `${p.automatable ? ` ${C.g}yes${C.o}` : ` ${C.d}no ${C.o}`}  `
    + `${(p.headroom ? `+€${p.headroom.toFixed(2)}` : '—').padStart(8)}  ${ceil}`);
});

const cards = top.filter((p) => p.marginCeiling !== null);
if (cards.length) {
  const bad = cards.filter((p) => p.marginCeiling < 0);
  console.log(`\n${C.d}  ceiling = the most a face-value card can earn: what is left after fees,`);
  console.log(`  minus the face value it has to be bought at. ${bad.length ? `${C.r}${bad.length} of the ${cards.length} in this list is negative.${C.o}` : 'All positive.'}${C.o}`);
}
console.log('');
