/**
 * The checkout reads the payment settings as they are NOW, not the page's copy.
 *
 * The owner switched the shop to Pay. and the checkout went on offering Stripe
 * under "Ordering is paused": its config came from the page-life cache, filled
 * from a CDN copy taken before the switch. Static checks on the storefront
 * source; no server needed.
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const read = (p) => fs.readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');

const lib = read('lib/useConfig.js');
const co = read('pages/Checkout.jsx');
ok('there is a fresh config read', /export function getFreshConfig\(/.test(lib));
ok('…keyed per minute, so the CDN copy is at most a minute old',
  /\/api\/config\?v=\$\{minute\}/.test(lib) && /Date\.now\(\) \/ 60_000/.test(lib));
ok('…that falls back to the cached config when the network fails', /\.catch\(\(\) => getConfig\(\)\)/.test(lib));
ok('the checkout uses it for the provider and the paused state',
  /getFreshConfig\(\)\.then\(\(c\) => \{[\s\S]{0,200}setProvider\(c\.paymentProvider\)/.test(co));
ok('…and no longer the page-life copy', !/\bgetConfig\(\)/.test(co));

console.log(`\n${fail ? '❌' : '✅'} checkout-fresh-config: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
