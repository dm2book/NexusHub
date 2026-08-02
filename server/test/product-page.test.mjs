/**
 * The product page, pinned.
 *
 * The buy area used to say "Delivery: as fast as possible" — a non-answer in a
 * green pill with a lightning bolt, shown for every product whether or not a
 * code existed. It also carried two different stock readouts fed by two
 * different fields, and put the SHOP's star rating under the product name where
 * every reader takes it as this product's score.
 *
 * These are source-level checks on the shipped code. The behaviour they protect
 * was verified in a browser against products in all three real states: in stock,
 * low stock, and made-to-order with an account target.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const strip = (src) => src
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

const page = read('src', 'pages', 'ProductDetail.jsx');
const code = strip(page);
const delivery = read('src', 'components', 'store', 'ProductDelivery.jsx');
const nl = read('src', 'lib', 'i18n.jsx');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

console.log('— A delivery estimate that says something —');
{
  ok('the non-answer is gone', !/as fast as possible/i.test(code));
  // Both branches must exist and be driven by the server's `instant` flag, which
  // is true only when the product auto-delivers AND a code is actually in stock.
  ok('the estimate branches on real stock', /product\.instant\s*\n?\s*\?/.test(delivery));
  ok('the in-stock branch promises only what follows payment',
    /pd\.etaInstantT/.test(delivery) && /after payment/i.test(delivery));
  ok('the made-to-order branch says it is delivered by hand',
    /pd\.etaHandT/.test(delivery) && /by hand/i.test(delivery));
  // Neither branch may promise a clock the shop does not control: a person
  // confirms every payment by hand.
  ok('no branch promises a fixed delivery time',
    !/within \d+ (seconds|minutes)/i.test(delivery), 'a hard time promise is back');
}

console.log('\n— One stock signal, from one field —');
{
  ok('stock status is computed in one place', /export function stockStatus/.test(delivery));
  ok('it reads the server-computed count', /product\.stockLeft/.test(delivery));
  // The page used to render BOTH a `product.stock <= 10` line and a
  // `product.stockLeft > 0` pill, with different thresholds and both in red.
  ok('the page no longer reads the legacy stock column for a badge',
    !/product\.stock > 0 && product\.stock <= 10/.test(code));
  ok('the duplicate "almost sold out" pill is gone', !/product\.almostGone/.test(code));
  // "Out of stock" would be wrong: nothing here is unavailable, it is bought in
  // per order. That distinction is a buyer leaving vs a buyer waiting.
  ok('a product with no code on the shelf is orderable, not sold out',
    /pd\.stockToOrder/.test(delivery) && !/out of stock/i.test(strip(delivery)));
}

console.log('\n— The rating belongs to whoever earned it —');
{
  // Reviews carry no product_id, so the shop average must be labelled as the
  // shop's rather than presented under the product name as this product's.
  ok('the shop rating is labelled as the shop\'s', /pd\.shopRating/.test(code));
  ok('the review block says it is about the shop', /pd\.shopReviews/.test(code));
  ok('a shop with no reviews says so plainly', /pd\.noReviewsYet/.test(code));
  // The JSON-LD must still not borrow it.
  ok('product structured data still claims no rating', !/aggregateRating/.test(code));
}

console.log('\n— Delivery information and the steps —');
{
  ok('the per-category delivery guide is on the page', /deliveryInfo\(product\.category, lang\)/.test(code));
  ok('it renders numbered steps', /d\.steps\.map/.test(code));
  ok('it renders the category caveats', /d\.notes\.map/.test(code));
  // It used to sit below the mystery pool and the price chart — three screens
  // down — even though "how does this reach me?" precedes the decision.
  const iDelivery = code.indexOf('howDelivered');
  const iMystery = code.indexOf('mysteryPool && mysteryPool.length');
  const iHistory = code.indexOf('price.history');
  ok('delivery is explained before the mystery pool', iDelivery !== -1 && iDelivery < iMystery);
  ok('delivery is explained before the price chart', iDelivery !== -1 && iDelivery < iHistory);
}

console.log('\n— A FAQ about THIS product —');
{
  ok('the questions are built per product', /const productFaq = \(product, t\)/.test(page));
  ok('the speed answer differs by real stock', /pdq\.speedAInstant/.test(page) && /pdq\.speedAHand/.test(page));
  // Asking "do you need my account?" on a gift card raises a worry that does
  // not apply; asking it on a top-up answers the one people actually have.
  ok('the account question appears only when a target is required',
    /if \(product\.deliveryField\)/.test(page));
  ok('the code-or-account choice gets its own answer', /pdq\.accountAChoice/.test(page));
  ok('the FAQ opens without JavaScript', /<details/.test(code) && /<summary/.test(code));
  ok('FAQ rows clear the 44px thumb target', /min-h-\[56px\]/.test(code));
}

console.log('\n— Trust indicators —');
{
  ok('the trust row is rendered', /<TrustRow t=\{t\} \/>/.test(code));
  // Everything on that row has to hold on day one — this shop has no orders yet,
  // and an empty statistic is worse than no statistic.
  for (const key of ['pd.tMoneyBack', 'pd.tNoAccount', 'pd.tVerified', 'pd.tHuman']) {
    ok(`${key} is a promise, not a counter`, delivery.includes(key));
  }
  ok('the old badge row that repeated the delivery promise is gone',
    !/const trustBadges/.test(page));
}

console.log('\n— Dutch —');
{
  const used = [...(page + delivery).matchAll(/t\('((?:pd|pdq)\.[A-Za-z0-9]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((k) => !nl.includes(`'${k}'`));
  ok('every new product-page key has Dutch', missing.length === 0, missing.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
