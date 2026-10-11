/**
 * Struck-through prices, "lowest price" claims and the order button — what the
 * webshop rules allow, pinned.
 *
 *   A reduction is shown against the LOWEST price of the 30 days before the
 *   current price began (Prijzenbesluit art. 6a, the EU Omnibus rule) — never
 *   against a "was" price somebody typed in. The product cards drew the typed
 *   value with a "-20%" badge; the product page referred to a value that was
 *   never defined and rendered nothing at all.
 *
 *   "Lowest price of the last 30 days" counts the price that was already in
 *   effect when the 30 days opened.
 *
 *   A bundle's separate prices are today's prices, said in words — not struck
 *   through as if the bundle once cost that.
 *
 *   Every label on the order button says that pressing it means paying
 *   (art. 6:230v lid 3 BW, § 312j BGB).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV ||= 'development';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

const { priorPrice, isLowestOf30Days } = await import('../../src/lib/priceHistory.js');

console.log('\n— The prior price —');
{
  ok('a price that never changed announces no reduction',
    priorPrice([{ price: 1000, at: ago(90) }], 1000) === null);
  ok('€10 for months, €8 since yesterday: shown against €10',
    priorPrice([{ price: 1000, at: ago(90) }, { price: 800, at: ago(1) }], 800) === 1000);
  ok('raised to €12 for three days, then "reduced" to €10: €8 was asked in the 30 days before, so no reduction',
    priorPrice([{ price: 800, at: ago(90) }, { price: 1200, at: ago(4) }, { price: 1000, at: ago(1) }], 1000) === null);
  ok('the lowest of the 30 days is used, not the most recent',
    priorPrice([{ price: 1100, at: ago(90) }, { price: 1300, at: ago(10) }, { price: 900, at: ago(1) }], 900) === 1100);
  ok('a history that does not end on the price on the button cannot speak for it',
    priorPrice([{ price: 1000, at: ago(90) }, { price: 800, at: ago(1) }], 700) === null);
}

console.log('\n— "Lowest price of the last 30 days" —');
{
  ok('€6 for weeks, €10 for a few days, now €8: not the lowest — €6 was in effect when the 30 days opened',
    !isLowestOf30Days([{ price: 600, at: ago(60) }, { price: 1000, at: ago(5) }, { price: 800, at: ago(1) }], 800));
  ok('€10 for months, €8 since yesterday: the lowest', isLowestOf30Days([{ price: 1000, at: ago(90) }, { price: 800, at: ago(1) }], 800));
  ok('an unchanged price is not a low point, it is just a price', !isLowestOf30Days([{ price: 800, at: ago(90) }], 800));
}

console.log('\n— What the API hands the storefront —');
{
  const { ensureReady } = await import('../src/app.js');
  await ensureReady();
  const { run } = await import('../src/db/index.js');
  const { createProduct, updateProduct, getProduct, listProducts } = await import('../src/services/productService.js');

  const p = await createProduct({ name: 'Omnibus test card', category: 'steam', price: 1000, announce: false,
    metadata: { compareAt: 1500 } });
  ok('a typed "was" price on a price that never changed shows no reduction', (await getProduct(p.id)).compareAtPrice === null,
    String((await getProduct(p.id)).compareAtPrice));

  // €10 for six weeks, then down to €8.
  await run(`UPDATE price_history SET created_at = @at WHERE product_id = @p`, { at: ago(42), p: p.id });
  await updateProduct(p.id, { price: 800 });
  const after = await getProduct(p.id);
  ok('after a real reduction it is shown against the real earlier price (€10), not the typed €15',
    after.compareAtPrice === 1000, String(after.compareAtPrice));
  const listed = (await listProducts({ activeOnly: true })).find((x) => x.id === p.id);
  ok('…the same in the product list the cards are drawn from', listed?.compareAtPrice === 1000, String(listed?.compareAtPrice));
  ok('…while the owner still sees what they typed', after.metadata.compareAt === 1500);

  const quiet = await createProduct({ name: 'Omnibus no sale', category: 'steam', price: 1000, announce: false });
  await run(`UPDATE price_history SET created_at = @at WHERE product_id = @p`, { at: ago(42), p: quiet.id });
  await updateProduct(quiet.id, { price: 800 });
  ok('a price that went down without a sale being switched on announces nothing',
    (await getProduct(quiet.id)).compareAtPrice === null);
}

console.log('\n— The storefront draws only the lawful figure —');
{
  const card = read('src/components/store/LightProductCard.jsx');
  const page = read('src/pages/ProductDetail.jsx');
  ok('no storefront file reads the typed metadata.compareAt',
    !/metadata\??\.compareAt\b/.test(card) && !/metadata\??\.compareAt\b/.test(page));
  ok('the product page defines its struck-through price from the API figure',
    /const wasPrice = product\.compareAtPrice > product\.price \? product\.compareAtPrice : null/.test(page));
  ok('the product page asks the shared rule whether today is the lowest', /isLowestOf30Days\(priceHist, product\.price\)/.test(page));

  for (const f of ['src/components/store/BundlesShowcase.jsx', 'src/components/store/BundleOffer.jsx', 'src/pages/Bundles.jsx']) {
    const src = read(f);
    const loose = src.split('\n').filter((l) => /b\.subtotal/.test(l));
    ok(`${f.split('/').pop()}: the separate prices are not struck through`,
      loose.length > 0 && loose.every((l) => !/line-through|<s[\s>]/.test(l)), loose.join(' | '));
  }
  ok('…and say what they are', /bundles\.separately/.test(read('src/components/store/BundlesShowcase.jsx'))
    && /bundles\.separately/.test(read('src/components/store/BundleOffer.jsx')));
}

console.log('\n— The order button —');
{
  const checkout = read('src/pages/Checkout.jsx');
  ok('no branch of the button says just "Place order"', !/checkout\.placeOrder/.test(checkout));
  const dicts = {
    nl: [read('src/lib/i18n.jsx'), /'checkout\.placePay': '([^']+)'/],
    de: [read('src/lib/i18n/de.js'), /'checkout\.placePay': '([^']+)'/],
    fr: [read('src/lib/i18n/fr.js'), /'checkout\.placePay': '([^']+)'/],
  };
  const words = { nl: /betal/i, de: /zahlungspflichtig|bezahl|kaufen/i, fr: /pai|payer/i };
  for (const [lang, [src, re]] of Object.entries(dicts)) {
    const label = re.exec(src)?.[1] || '';
    ok(`${lang}: "${label}" says that ordering means paying`, words[lang].test(label));
  }
  ok('en: the fallback says so too', /t\('checkout\.placePay', 'Place order & pay'\)/.test(checkout));
}

console.log(`\n${fail ? '❌' : '✅'} omnibus-prices: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
