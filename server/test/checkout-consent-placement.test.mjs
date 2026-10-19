/**
 * The consent tick sits directly ABOVE the pay button it unlocks, and the cart
 * shows the product's picture.
 *
 * On a phone the tick lived only in the sticky pay bar, UNDER that bar's
 * button, while the summary's own pay button had no tick at all — and the
 * warning under it said "Tick the box above". The owner, testing the checkout,
 * could not see where to tick. Separately, the cart showed a grey box icon for
 * Robux: a cart line kept no picture, and the fallback ignored the category art
 * the owner set in the admin.
 *
 * Static checks on the storefront source; no server needed.
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const read = (p) => fs.readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');

console.log('— Checkout: the tick above the button —');
{
  const co = read('pages/Checkout.jsx');
  const summaryTick = co.indexOf('id="fm-consent"');
  const summaryButton = co.indexOf('<button disabled={busy || paused} className="btn-primary w-full py-3">');
  ok('the summary has a tick and a pay button', summaryTick > 0 && summaryButton > 0);
  ok('…the tick comes right before that button', summaryTick > 0 && summaryTick < summaryButton
    && !/<button/.test(co.slice(summaryTick, summaryButton)), `tick@${summaryTick} button@${summaryButton}`);
  const tickTag = co.slice(summaryTick, co.indexOf('>', summaryTick));
  ok('…and it is shown on a phone too, not only on desktop', !/\bhidden\b/.test(tickTag), tickTag);

  const bar = co.slice(co.indexOf('Sticky pay bar'));
  const barTick = bar.indexOf('<input type="checkbox"');
  const barButton = bar.indexOf('<button type="submit"');
  ok('the phone pay bar has a tick and a button', barTick > 0 && barButton > 0);
  ok('…with the tick ABOVE the button, where "the box above" points', barTick > 0 && barTick < barButton,
    `tick@${barTick} button@${barButton}`);
}

{
  const co = read('pages/Checkout.jsx');
  const boxes = co.match(/<input type="checkbox" checked=\{consent\}[\s\S]*?\/>/g) || [];
  ok('both consent boxes render light, so an unticked box does not look ticked',
    boxes.length === 2 && boxes.every((b) => /\[color-scheme:light\]/.test(b)), String(boxes.length));
}

console.log('\n— Cart: the product\'s own picture —');
{
  const ctx = read('context/CartContext.jsx');
  ok('a cart line keeps the product picture', /image: product\.image/.test(ctx));
  const cart = read('pages/Cart.jsx');
  ok('the cart falls back to the owner-set category art', /logoFor\(logos, it\.category\)/.test(cart)
    && /useCategoryLogos\(\)/.test(cart));
}

console.log(`\n${fail ? '❌' : '✅'} checkout-consent-placement: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
