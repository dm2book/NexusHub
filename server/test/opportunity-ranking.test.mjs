/**
 * A ranking that refuses the three axes it has no data for.
 *
 * "Which twenty products have the biggest opportunity" is normally margin ×
 * demand × competition. This shop has none of the three — 0 of 72 products
 * carry a cost, 0 orders have been placed, 0 competitor prices observed — so a
 * ranking on any of them is a ranking on numbers nobody measured. The script
 * says so and ranks on the one thing it can compute.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG } from '../src/db/demoSeed.js';
import { config } from '../src/config/env.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'scripts', 'rank-opportunity.mjs'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('— It names what it cannot rank on —');
{
  for (const [axis, token] of [['margin', 'countWithCost'], ['demand', 'order_items'],
    ['competition', 'market_observations'], ['advertising', 'ad_events']]) {
    ok(`${axis} is counted, not assumed`, src.includes(token), token);
  }
  /* The margin axis used to read `metadata.costCents` here while the admin form
     wrote `metadata.cost`, so it reported 0 of 72 for a shop whose costs were
     all filled in. It goes through the one reader now. */
  ok('and margin is counted by the same reader the pricing engine uses',
    /costService\.js/.test(src));
  ok('and the refusal is printed, not buried', /Cannot be ranked on, and not estimated/.test(src));
  /* The failure mode this guards against is a ranking that looks authoritative
     because it has four columns, three of which are made up. Each of the four
     reports a COUNT of what exists; none of them is derived from anything. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  ok('each unrankable axis reports a count of what exists',
    /withCost = countWithCost\(rows\)/.test(code) && /COALESCE\(SUM\(oi\.quantity\),0\)/.test(code)
    && /COUNT\(\*\) AS n FROM market_observations/.test(code)
    && /COUNT\(\*\) AS n FROM ad_events/.test(code));
  ok('and none of them feeds the score',
    !/score:[\s\S]{0,200}(sold|observations|adEvents|withCost)/.test(code));
}

console.log('\n— It ranks on cash per order, and says why —');
{
  ok('the ranking is price-led', /score: \+\(price \*/.test(src));
  /* Two small modifiers that break ties; they must not be able to reorder
     products of very different value, or the ranking stops being what it says. */
  ok('an account top-up is discounted, not excluded', /automatable \? 1 : 0\.8/.test(src));
  ok('and ladder headroom is capped so it cannot dominate', /Math\.min\(0\.25,/.test(src));
  ok('automatability comes from the delivery copy', /DELIVERY_INFO/.test(src));
}

console.log('\n— The one real margin bound —');
{
  /* A gift card is the only product whose cost has a known ceiling: it cannot
     be bought for much less than the value printed on it. So what is left after
     fees, minus the face, is the most it can ever earn — and that is a real
     number, not an estimate. */
  ok('the ceiling is computed for face-value cards', /marginCeiling = faceEur === null/.test(src));
  ok('and only for them', /faceEur === null \? null/.test(src));

  const F = config.market.paymentFeePercent / 100;
  const X = config.market.paymentFixedFee;
  const net = (e) => e - (e * F + X);
  const cards = CATALOG.filter((p) => p.active !== false && p.category === 'giftcard');
  ok('there are gift cards to bound', cards.length >= 8, `${cards.length}`);

  const ceilings = cards.map((p) => {
    const face = Number((/€\s?(\d+)/.exec(p.name) || [])[1] || 0);
    return { sku: p.sku, ceiling: net(p.price / 100) - face };
  });
  ok('none of them can lose money any more', ceilings.every((c) => c.ceiling > 0),
    ceilings.filter((c) => c.ceiling <= 0).map((c) => c.sku).join(', '));
  /* The number that decides whether this category is worth the shelf: every
     card sold once, at its best possible outcome. */
  const best = ceilings.reduce((n, c) => n + c.ceiling, 0);
  ok('and the whole shelf sold once is worth under €15 at best',
    best > 0 && best < 15, `€${best.toFixed(2)}`);
  console.log(`      ${cards.length} cards · one of each, bought at face: €${best.toFixed(2)} maximum`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
