/**
 * Which payment links carry the amount, and which leave it to the buyer.
 *
 * This is the difference between one tap and a typed number, so it decides which
 * provider is worth using. It also used to live in three copies — the checkout,
 * the status page and the email each built the URL themselves — which is exactly
 * how the cart ended up quoting a different bundle price than the card that sold
 * it. One implementation now; the storefront renders what the server sends.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_paymethod';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { payMethodUrl, payMethodsFor } = await import('../src/utils/payMethodUrl.js');

const ORDER = { total: 1438, currency: 'EUR', number: 'FM-2026-ABCD' };
const method = (id, target, kind = 'link') => ({ id, label: id, target, kind });

console.log('— Providers that take the amount —');
{
  const pp = payMethodUrl(method('paypal', 'paypal.me/forgemarket'), ORDER);
  ok('PayPal carries the amount', pp.url === 'https://paypal.me/forgemarket/14.38EUR', pp.url);
  ok('PayPal is marked prefilled', pp.prefilled === true);

  const rev = payMethodUrl(method('revolut', 'revolut.me/mohamed'), ORDER);
  ok('Revolut carries the amount', rev.url === 'https://revolut.me/mohamed/14.38', rev.url);
  ok('Revolut is marked prefilled', rev.prefilled === true);

  // bunq takes a description too, so even the reference is filled in.
  const bunq = payMethodUrl(method('bunq', 'bunq.me/forgemarket'), ORDER);
  ok('bunq carries amount AND reference', bunq.url === 'https://bunq.me/forgemarket/14.38/FM-2026-ABCD', bunq.url);
  ok('bunq is marked prefilled', bunq.prefilled === true);
}

console.log('\n— Tikkie cannot, and must not pretend it can —');
{
  const tk = payMethodUrl(method('tikkie', 'tikkie.me/pay/mo'), ORDER);
  ok('Tikkie link is left alone', tk.url === 'https://tikkie.me/pay/mo', tk.url);
  // Claiming the amount is filled in when it is not sends the buyer to a blank
  // form having been told otherwise — worse than saying nothing.
  ok('Tikkie is NOT marked prefilled', tk.prefilled === false);
}

console.log('\n— Amounts —');
{
  const cases = [
    [999, '9.99'], [1438, '14.38'], [10, '0.10'], [100000, '1000.00'], [1, '0.01'],
  ];
  for (const [cents, expect] of cases) {
    const r = payMethodUrl(method('paypal', 'paypal.me/x'), { ...ORDER, total: cents });
    ok(`${cents} cents → ${expect}`, r.url.endsWith(`/${expect}EUR`), r.url);
  }
  // A free order (fully paid with store credit) must not produce a negative or
  // NaN amount in a link someone can click.
  const zero = payMethodUrl(method('paypal', 'paypal.me/x'), { ...ORDER, total: 0 });
  ok('a zero total is 0.00, not NaN', zero.url.endsWith('/0.00EUR'), zero.url);
  const missing = payMethodUrl(method('paypal', 'paypal.me/x'), {});
  ok('a missing total does not produce NaN', !/NaN/.test(missing.url), missing.url);
}

console.log('\n— Shapes and edges —');
{
  ok('a bare handle gets https',
    payMethodUrl(method('revolut', 'revolut.me/mo'), ORDER).url.startsWith('https://'));
  ok('http is upgraded to https',
    payMethodUrl(method('revolut', 'http://revolut.me/mo'), ORDER).url.startsWith('https://'));
  ok('a trailing slash does not double up',
    payMethodUrl(method('paypal', 'https://paypal.me/x/'), ORDER).url === 'https://paypal.me/x/14.38EUR');

  // A PayPal handle can be an email, which has no link form at all.
  const mail = payMethodUrl(method('paypal', 'me@example.com', 'email'), ORDER);
  ok('an email handle yields no url', mail.url === null);
  ok('an email handle keeps the target to show', mail.target === 'me@example.com');
  ok('an email handle is not prefilled', mail.prefilled === false);

  // The reference goes in a URL path, so it has to survive encoding.
  const odd = payMethodUrl(method('bunq', 'bunq.me/x'), { ...ORDER, number: 'FM 2026/ABCD' });
  ok('a reference with spaces and slashes is encoded', !/ |(?<=\/x\/14\.38\/).*\//.test(odd.url), odd.url);

  ok('an unknown provider is passed through untouched',
    payMethodUrl(method('other', 'pay.example.com/x'), ORDER).url === 'https://pay.example.com/x');
  ok('no methods, no crash', payMethodsFor([], ORDER).length === 0);
  ok('null methods, no crash', payMethodsFor(null, ORDER).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
