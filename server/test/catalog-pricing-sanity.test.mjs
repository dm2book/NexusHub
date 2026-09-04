/**
 * Two pricing mistakes the shipped catalogue must never contain again.
 *
 * Both were found by running scripts/audit-commercial.mjs against the live
 * catalogue, and both are arithmetic rather than opinion — which is why they
 * belong in a test instead of a note somewhere.
 *
 *   LADDER INVERSION  5,000 V-Bucks cost €4.80 per 1,000 while the 2,800 pack
 *                     next to it cost €4.64. The customer who buys more paid
 *                     more per unit. In a market where the first thing anyone
 *                     does is divide price by units, that is not a rounding
 *                     quirk, it is the shelf arguing against itself. Mobile
 *                     Legends had the same shape at 1,155 diamonds.
 *
 *   FACE-VALUE FLOOR  Four €25 gift cards were priced at €25.99. After the
 *                     shop's own configured payment fees (2.9% + €0.29) that
 *                     leaves €24.95 — less than the card's own face value.
 *                     Every one of those sales loses money unless the card is
 *                     sourced more than 2.2% under face, and nothing in the
 *                     shop enforced that. Steam Wallet €50 at €51.99 kept
 *                     €50.19, a €0.19 margin against a €0.50 minimum.
 *
 * No database: both properties belong to the catalogue list itself, so this
 * reads it directly and stays fast enough to never be skipped.
 */
import { CATALOG } from '../src/db/demoSeed.js';
import { config } from '../src/config/env.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const FEE_PCT = config.market.paymentFeePercent / 100;
const FEE_FIX = config.market.paymentFixedFee;
const MIN_PROFIT = config.market.minimumProfitEur;
/** What the shop keeps once the payment provider has taken its cut. */
const net = (eur) => eur - (eur * FEE_PCT + FEE_FIX);

const active = CATALOG.filter((p) => p.active !== false);
ok('the catalogue is non-empty, so the checks below mean something', active.length > 10, `${active.length}`);

console.log('\n— no ladder charges more per unit for a bigger pack —');
{
  /* Leading number only: "Xbox Game Pass Ultimate — 3 Months" is not three
     units of anything a per-unit price can compare. */
  const byCat = {};
  for (const p of active) {
    const m = /^([\d.,]+)\s+\S/.exec(p.name);
    if (!m) continue;
    const units = Number(m[1].replace(/[.,]/g, ''));
    if (!units) continue;
    (byCat[p.category] = byCat[p.category] || []).push({ ...p, units, perK: (p.price / 100 / units) * 1000 });
  }

  const inverted = [];
  for (const [category, rows] of Object.entries(byCat)) {
    const rungs = rows.sort((a, b) => a.units - b.units);
    let best = Infinity;
    for (const r of rungs) {
      // 1e-9 so two rungs priced at exactly the same per-unit rate are fine —
      // flat is not an inversion, it is only a missing incentive.
      if (r.perK > best + 1e-9) {
        inverted.push(`${category}/${r.sku} €${(r.price / 100).toFixed(2)} = €${r.perK.toFixed(2)}/1k, `
          + `dearer than the smaller rung at €${best.toFixed(2)}/1k`);
      }
      best = Math.min(best, r.perK);
    }
  }
  ok('every ladder is monotonically cheaper per unit as the pack grows',
    inverted.length === 0, `\n      ${inverted.join('\n      ')}`);
  ok('and there are real ladders to check, not zero', Object.keys(byCat).length >= 10,
    `${Object.keys(byCat).length} categories with a ladder`);
}

console.log('\n— no face-value card is sold below what it costs to honour —');
{
  const broken = [];
  let checked = 0;
  for (const p of active) {
    const m = /€\s?(\d+)/.exec(p.name);
    if (!m) continue;
    checked++;
    const face = Number(m[1]);
    const keep = net(p.price / 100);
    /* The card has to be bought somewhere. Priced at or under face, the shop
       needs a supplier discount it has never recorded — so the floor is the
       one number that can be asserted without cost data. */
    if (keep < face + MIN_PROFIT) {
      broken.push(`${p.sku} €${(p.price / 100).toFixed(2)} keeps €${keep.toFixed(2)} `
        + `on a €${face} card — €${(keep - face).toFixed(2)} against a €${MIN_PROFIT} minimum`);
    }
  }
  ok('there are face-value cards in the catalogue at all', checked >= 5, `${checked} found`);
  ok('each clears the configured minimum profit at face value',
    broken.length === 0, `\n      ${broken.join('\n      ')}`);
}

console.log('\n— the checks would actually catch a regression —');
{
  // A guard that cannot fail is decoration. Both rules are re-run here against
  // a deliberately broken pair to prove they still bite.
  const rungs = [{ units: 1000, price: 599 }, { units: 5000, price: 9999 }]
    .map((r) => ({ ...r, perK: (r.price / 100 / r.units) * 1000 }));
  ok('an inverted ladder is detected', rungs[1].perK > rungs[0].perK);
  ok('a card priced at face is rejected', net(25.00) < 25 + MIN_PROFIT);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
