/**
 * Per-order payment links.
 *
 * Payment here is manual, and the shared checkout link cannot carry an amount —
 * the buyer types it, so a wrong cent or a forgotten reference becomes the owner
 * matching payments by hand. The owner can now attach a payment request made in
 * their bank app to a single order.
 *
 * The validation matters more than the feature: this URL is rendered as a button
 * on the buyer's public status page and inside the payment reminder email. It is
 * the one field where a mistake turns our own site into the delivery vehicle for
 * someone else's payment page.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_paylink';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };
const rejects = async (fn) => { try { await fn(); return false; } catch { return true; } };

await (await import('../src/app.js')).ensureReady();
const { validatePayLink, isValidPayLink, PayLinkError } = await import('../src/utils/payLink.js');
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { createOrder, getOrder, setOrderPayLink, clearOrderPayLink, markPaymentReceived, renderOrderEmail } =
  await import('../src/services/orderService.js');
const tag = Date.now() % 1000000;

console.log('— What counts as a payment link —');
{
  const good = [
    'https://tikkie.me/pay/abc123',
    'https://www.tikkie.me/pay/abc123',
    'https://revolut.me/mohamed/14.38',
    'https://paypal.me/forgemarket/14.38EUR',
    'https://bunq.me/forgemarket/14.38',
    'https://betaalverzoek.rabobank.nl/betaalverzoek/?id=abc',
    'https://buy.stripe.com/test_abc',
  ];
  for (const u of good) ok(`accepted: ${u.slice(0, 46)}`, isValidPayLink(u));

  // Every one of these has actually shipped in someone's product.
  const bad = [
    ['javascript:alert(1)', 'a script URL'],
    ['data:text/html,<h1>pay me', 'a data URL'],
    ['http://tikkie.me/pay/abc', 'plain http, downgradeable in transit'],
    ['https://tikkie.me.evil.com/pay', 'a lookalike host'],
    ['https://evil.com/tikkie.me/pay', 'the brand in the path, not the host'],
    ['https://user:pass@tikkie.me/pay', 'credentials hiding the real host'],
    ['https://discord.gg/scam', 'not a payment provider at all'],
    ['not a url at all', 'not a URL'],
    ['', 'empty'],
    [`https://tikkie.me/pay/${'x'.repeat(600)}`, 'absurdly long'],
  ];
  for (const [u, why] of bad) ok(`rejected (${why})`, !isValidPayLink(u), u.slice(0, 40));

  // The owner has to be able to fix their own mistake, so the error has to say
  // what is wrong rather than "invalid input".
  try { validatePayLink('https://evil.com/pay'); ok('a rejection explains itself', false); }
  catch (e) {
    ok('a rejection explains itself', e instanceof PayLinkError && /not a payment provider/i.test(e.message), e.message);
    ok('the message names the allowed providers', /tikkie\.me/.test(e.message));
  }
}

console.log('\n— Attaching it to an order —');
{
  const p = await createProduct({ name: `Pay ${tag}`, category: 'robux', price: 1438, announce: false });
  const order = await createOrder({ email: `pay${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }] });

  ok('a fresh order has no link', (await getOrder(order.id)).payLink === null);

  const res = await setOrderPayLink(order.id, 'https://tikkie.me/pay/exact-14-38', { actorId: 'test' });
  ok('the link is attached', res.payLink === 'https://tikkie.me/pay/exact-14-38');
  const withLink = await getOrder(order.id);
  ok('it is readable back', withLink.payLink === 'https://tikkie.me/pay/exact-14-38');
  ok('the moment is recorded', !!withLink.payLinkAt);
  // Attaching a link changes no state, so it must not add a row to the timeline
  // the buyer reads — that would show "Pending" twice for no reason.
  ok('the buyer timeline is not polluted',
    withLink.history.filter((h) => h.to_status === 'pending').length === 1,
    `${withLink.history.length} rows`);

  ok('a bad link never reaches the order', await rejects(() => setOrderPayLink(order.id, 'https://evil.com/x')));
  ok('the previous good link survives a rejected one',
    (await getOrder(order.id)).payLink === 'https://tikkie.me/pay/exact-14-38');

  await clearOrderPayLink(order.id);
  ok('it can be removed', (await getOrder(order.id)).payLink === null);
}

console.log('\n— It only exists while payment is outstanding —');
{
  const p = await createProduct({ name: `Paid ${tag}`, category: 'robux', price: 999, announce: false });
  const order = await createOrder({ email: `paid${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }] });
  await setOrderPayLink(order.id, 'https://tikkie.me/pay/before', { actorId: 'test' });
  await addProductCodes(p.id, [`PAY-${tag}`]);
  await markPaymentReceived(order.id, `tx${tag}`, { actorId: 'test' });

  // A pay button on an order that is already paid invites paying twice.
  ok('a paid order refuses a new link',
    await rejects(() => setOrderPayLink(order.id, 'https://tikkie.me/pay/after')));

  const unknown = await rejects(() => setOrderPayLink('ord_does_not_exist', 'https://tikkie.me/pay/x'));
  ok('an unknown order is refused', unknown);
}

console.log('\n— The buyer sees it —');
{
  const p = await createProduct({ name: `Mail ${tag}`, category: 'robux', price: 1438, announce: false });
  const order = await createOrder({ email: `mail${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }] });
  await setOrderPayLink(order.id, 'https://tikkie.me/pay/in-the-email', { actorId: 'test' });

  const mail = await renderOrderEmail(order.id, 'payment_reminder');
  ok('the reminder email carries the exact-amount link', mail.html.includes('https://tikkie.me/pay/in-the-email'));
  ok('the email says the amount is already filled in', /already filled in/i.test(mail.html));
  // With no generic method configured there is nothing to fall back to, and the
  // mail must not invent one. "as the reference" only appears in the generic
  // block — matching on "Tikkie" would hit the link's own hostname.
  ok('no invented fallback when no method is configured', !/as the reference/i.test(mail.html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
