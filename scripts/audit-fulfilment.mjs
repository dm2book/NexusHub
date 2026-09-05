#!/usr/bin/env node
/**
 * How much of this catalogue can be sold while nobody is watching?
 *
 *   DATABASE_URL=postgres://…  node scripts/audit-fulfilment.mjs
 *   DATABASE_URL=…             node scripts/audit-fulfilment.mjs --json
 *
 * ── THE QUESTION THIS ANSWERS ─────────────────────────────────────────────
 * Not "is the shop working" — audit-catalog.mjs already answers that. This one
 * answers the only question that decides how much the shop can sell in a day:
 * how many products can go from paid to delivered with NO human in the loop.
 *
 * Three states, and the difference between the last two is the whole point:
 *
 *   AUTOMATIC   a code is on the shelf, or a supplier will buy one. Paid at
 *               03:00 means delivered at 03:00.
 *   BLOCKED     it COULD be automatic — it is a code product — and there is
 *               nothing to hand out. This is the fixable pile.
 *   BY DESIGN   it cannot ever be automatic with what the shop has. A Roblox
 *               top-up needs the buyer's username and somebody to do the
 *               payout; that is not a stock problem and loading codes will
 *               never fix it.
 *
 * Lumping the last two together is what makes "load some codes" sound like a
 * complete answer. It is not: it is a complete answer for one of the piles.
 *
 * ── WHAT MAKES A PRODUCT "BY DESIGN" MANUAL ───────────────────────────────
 * The shop's own delivery copy, not a guess. src/lib/deliveryInfo.js is what a
 * buyer is shown before they pay: a category whose method asks for an account
 * detail is one a person has to act on. Robux says "we only need your username"
 * and lists 2FA as step one. V-Bucks says "an official gift card code that you
 * redeem yourself" — same shop, opposite answer, and only one of them can be
 * automated by loading stock.
 */
import path from 'node:path';

const ROOT = process.cwd();
const asJson = process.argv.includes('--json');
const { all } = await import(path.join(ROOT, 'server/src/db/index.js'));
const { DELIVERY_INFO } = await import(path.join(ROOT, 'src/lib/deliveryInfo.js'));

/* A category is account-based when the shop's own delivery copy asks for
   something off the buyer's account. Read from the copy rather than listed
   here, so a new category that needs a username is classified the day its
   delivery text is written and not the day somebody remembers this file. */
const ACCOUNT_BASED = new Set(
  Object.entries(DELIVERY_INFO)
    .filter(([k, v]) => k !== 'default'
      && /username|gebruikersnaam|account name|player id|2fa|2-step|2-staps/i
        .test([v.en?.method, ...(v.en?.steps || [])].join(' ')))
    .map(([k]) => k));

const rows = await all(`
  SELECT p.id, p.sku, p.name, p.category, p.kind, p.price, p.metadata,
         (SELECT COUNT(*) FROM product_codes c
           WHERE c.product_id = p.id AND c.status = 'available') AS codes,
         (SELECT COUNT(*) FROM supplier_products sp
            JOIN suppliers s ON s.id = sp.supplier_id
           WHERE sp.product_id = p.id AND s.status = 'active') AS suppliers
    FROM products p
   WHERE p.active = 1
   ORDER BY p.category, p.price`);

const parsed = rows.map((p) => {
  let meta = {}; try { meta = JSON.parse(p.metadata || '{}'); } catch { /* {} */ }
  const codes = Number(p.codes || 0);
  const suppliers = Number(p.suppliers || 0);
  const mode = meta.deliveryMode === 'manual' ? 'manual' : 'auto';
  const accountBased = ACCOUNT_BASED.has(p.category);
  /* A mystery box pays out as store credit, which the shop does itself — it is
     automatic and has no codes to load. */
  const mystery = p.kind === 'mystery';

  let state; let why;
  if (mystery) { state = 'automatic'; why = 'pays out as store credit'; }
  else if (mode === 'manual') { state = 'by-design'; why = 'set to manual delivery by the owner'; }
  else if (accountBased) { state = 'by-design'; why = `${p.category} is an account top-up: it needs the buyer's account detail and somebody to do it`; }
  else if (codes > 0) { state = 'automatic'; why = `${codes} code${codes === 1 ? '' : 's'} on the shelf`; }
  else if (suppliers > 0) { state = 'automatic'; why = 'an active supplier will buy one'; }
  else { state = 'blocked'; why = 'a code product with no codes and no supplier'; }

  return { ...p, price: Number(p.price), codes, suppliers, mode, accountBased, state, why };
});

const by = (s) => parsed.filter((p) => p.state === s);
const automatic = by('automatic');
const blocked = by('blocked');
const byDesign = by('by-design');
const ceiling = automatic.length + blocked.length;   // everything technically automatable

const group = (list) => {
  const m = {};
  for (const p of list) (m[p.category] = m[p.category] || []).push(p);
  return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
};

if (asJson) {
  console.log(JSON.stringify({
    active: parsed.length,
    sellableWithoutAHuman: automatic.length,
    blockedButAutomatable: blocked.length,
    manualByDesign: byDesign.length,
    technicalCeiling: ceiling,
    products: parsed.map(({ metadata, ...p }) => p),
  }, null, 2));
  process.exit(0);
}

const C = process.stdout.isTTY
  ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', b: '\x1b[1m', d: '\x1b[2m', o: '\x1b[0m' }
  : { r: '', y: '', g: '', b: '', d: '', o: '' };

console.log(`\n${C.b}ForgeMarket — what can be delivered without a person${C.o}`);
console.log(`${C.d}${parsed.length} active products${C.o}\n`);

console.log(`  ${C.g}${String(automatic.length).padStart(3)} sellable today with no human in the loop${C.o}`);
console.log(`  ${C.y}${String(blocked.length).padStart(3)} could be, and are not — no codes, no supplier${C.o}`);
console.log(`  ${C.d}${String(byDesign.length).padStart(3)} cannot be, with what this shop has${C.o}`);
console.log(`\n  ${C.b}Technical ceiling: ${ceiling} of ${parsed.length} `
  + `(${Math.round(ceiling / parsed.length * 100)}%)${C.o}`);
console.log(`  ${C.d}100% is not reachable while ${byDesign.length} products are account top-ups.${C.o}`);

if (blocked.length) {
  console.log(`\n${C.y}${C.b}Blocked — the fixable pile${C.o}`);
  for (const [cat, list] of group(blocked)) {
    const worth = list.reduce((n, p) => n + p.price, 0);
    console.log(`  ${String(list.length).padStart(3)}  ${cat.padEnd(16)} ${C.d}one of each is `
      + `€${(worth / 100).toFixed(2)} of shelf${C.o}`);
  }
}

if (byDesign.length) {
  console.log(`\n${C.d}${C.b}Manual by design${C.o}`);
  for (const [cat, list] of group(byDesign)) {
    console.log(`  ${String(list.length).padStart(3)}  ${cat.padEnd(16)} ${C.d}${list[0].why}${C.o}`);
  }
}

if (automatic.length) {
  console.log(`\n${C.g}${C.b}Automatic${C.o}`);
  for (const [cat, list] of group(automatic)) {
    console.log(`  ${String(list.length).padStart(3)}  ${cat.padEnd(16)} ${C.d}${list[0].why}${C.o}`);
  }
}
console.log('');
