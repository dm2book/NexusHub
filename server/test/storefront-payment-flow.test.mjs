/**
 * The storefront's payment flow around Pay., from the full-site scan.
 *
 * Server, over real HTTP with only connect.pay.nl stubbed:
 *   - "Pay again" works with the order id + number alone (a guest in another
 *     browser has no saved email; it answered "This order is not yours");
 *   - a refusal carries a code the storefront can translate;
 *   - the track page offers a new Pay. payment after a cancelled one, with the
 *     methods, and never the leftover manual Tikkie/Revolut links under Pay.;
 *   - a cart line the shop no longer sells is named (code + product) in the
 *     quote's refusal, so the page can offer to remove it;
 *   - the signed-in cart keeps each line's category (the Roblox username field
 *     depends on it).
 * Storefront source, statically: the orphan-order retry, Back from Pay., the
 * translated errors, the phone pay bar when paused, the manual screen's email,
 * the sign-in return, and the category fallback.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_sf_flow';
process.env.NODE_ENV ||= 'development';
process.env.LAUNCH_MODE ||= 'open';
process.env.LIMIT_CHECKOUT_PER_MINUTE = '10000';
process.env.PAYNL_SERVICE_ID = 'SL-1234-5678';
process.env.PAYNL_SERVICE_SECRET = 'a'.repeat(40);
process.env.APP_URL = 'http://localhost:3000';
process.env.PAY_TIKKIE = 'https://tikkie.me/pay/leftover';   // a manual link left configured after the switch
process.env.SMTP_URL = 'smtp://127.0.0.1:9';                 // a mail target so ordering is not paused; nothing listens
delete process.env.MOLLIE_API_KEY;
delete process.env.STRIPE_SECRET_KEY;

import fs from 'node:fs';

const realFetch = globalThis.fetch;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const payOrders = new Map();
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://connect.pay.nl/')) return realFetch(url, init);
  if ((init.method || 'GET') === 'POST' && /\/v1\/orders$/.test(u)) {
    const b = JSON.parse(init.body);
    const id = `${Math.random().toString(16).slice(2, 10)}-aaaa-bbbb-cccc-${Date.now().toString(16)}`;
    const o = { id, orderId: `51${Math.floor(Math.random() * 1e9)}X`, serviceId: b.serviceId, reference: b.reference,
      amount: b.amount, status: { code: 20, action: 'PENDING' }, integration: { test: !!b.integration?.test },
      payments: [{ paymentMethod: { id: b.paymentMethod?.id ?? null } }],
      links: { redirect: `https://checkout.pay.nl/test/${id}`, status: `https://connect.pay.nl/v1/orders/${id}/status` } };
    payOrders.set(id, o);
    return json(o, 201);
  }
  const m = u.match(/\/v1\/orders\/([A-Za-z0-9-]+)\/status$/);
  if (m) { const o = payOrders.get(m[1]); return o ? json(o) : json({ message: 'nf' }, 404); }
  return json({ message: 'unexpected' }, 404);
};

const { ensureReady, createApp } = await import('../src/app.js');
await ensureReady();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };
const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
async function product(name, { active = 1, category = 'robux' } = {}) {
  const id = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,@s,@n,@c,'t',999,'EUR','digital',@a,'{}',@at,@at)`,
    { id, s: `SF-${id.slice(-8)}`, n: name, c: category, a: active, at: nowIso() });
  return id;
}
const place = async (pid) => {
  const r = await post('/api/orders', { email: `sf-${newId('x').slice(-6)}@example.com`, consent: true, consentText: 'ok',
    items: [{ productId: pid, quantity: 1 }], billing: { deliveryMethod: 'account', deliveryDetails: 'ewan_8617' } });
  if (!r.body?.order) throw new Error(`order not placed: ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body.order;
};

console.log('— "Pay again" with the order id + number —');
{
  const o = await place(await product('Flow A'));
  const none = await post(`/api/orders/${o.id}/paynl`, {});
  ok('without any proof it is still refused (403)…', none.status === 403, JSON.stringify(none));
  ok('…with a code the storefront can translate', none.body?.error?.code === 'order_not_yours', JSON.stringify(none.body));
  const wrong = await post(`/api/orders/${o.id}/paynl`, { number: 'FM-0000-NOPE' });
  ok('a wrong order number is no proof', wrong.status === 403, JSON.stringify(wrong));
  const right = await post(`/api/orders/${o.id}/paynl`, { number: o.number.toLowerCase(), method: 'bancontact' });
  ok('the right order number starts the payment, no email needed', right.status === 201 && /checkout\.pay\.nl/.test(right.body?.checkoutUrl || ''),
    JSON.stringify(right));
  const sent = [...payOrders.values()].at(-1);
  ok('…with the method the buyer picked again', sent?.payments?.[0]?.paymentMethod?.id === 436, JSON.stringify(sent?.payments));
}

console.log('\n— The track page after a cancelled Pay. payment —');
{
  const o = await place(await product('Flow B'));
  await post(`/api/orders/${o.id}/paynl`, { number: o.number });
  await run(`UPDATE orders SET psp_status='canceled' WHERE id=@id`, { id: o.id });
  const t = await (await fetch(`${base}/api/track/${encodeURIComponent(o.number)}`)).json();
  ok('it says a new payment can be made…', t.paymentRetryable === true, JSON.stringify(t).slice(0, 300));
  ok('…with the methods to choose from', Array.isArray(t.paynlMethods) && t.paynlMethods.some((m) => m.id === 'ideal'), JSON.stringify(t.paynlMethods));
  ok('and no leftover manual links while Pay. is the provider', Array.isArray(t.payMethods) && t.payMethods.length === 0,
    JSON.stringify(t.payMethods));
  await run(`UPDATE orders SET psp_status='open' WHERE id=@id`, { id: o.id });
  const t2 = await (await fetch(`${base}/api/track/${encodeURIComponent(o.number)}`)).json();
  ok('an open payment is resumed, not offered anew', !t2.paymentRetryable && !!t2.payUrl, JSON.stringify(t2).slice(0, 200));
}

console.log('\n— A cart line the shop no longer sells —');
{
  const live = await product('Flow live');
  const off = await product('Flow switched off', { active: 0 });
  const r = await post('/api/checkout/quote', { items: [{ productId: live, quantity: 1 }, { productId: off, quantity: 1 },
    { productId: 'prd_deleted_long_ago', quantity: 1 }] });
  ok('the quote still refuses the cart, as the order will', r.status === 409, JSON.stringify(r).slice(0, 200));
  ok('…but says WHICH line, with a code the page acts on',
    r.body?.error?.code === 'product_unavailable' && r.body.error.details?.productId === off
    && r.body.error.details?.name === 'Flow switched off', JSON.stringify(r.body));
  const del = await post('/api/checkout/quote', { items: [{ productId: 'prd_deleted_long_ago', quantity: 1 }] });
  ok('a deleted product is named by its id the same way', del.status === 400
    && del.body?.error?.code === 'product_unavailable' && del.body.error.details?.productId === 'prd_deleted_long_ago',
    JSON.stringify(del.body));
  const fine = await post('/api/checkout/quote', { items: [{ productId: live, quantity: 1 }] });
  ok('once it is removed, the rest is priced', fine.status === 200 && fine.body?.subtotal === 999, JSON.stringify(fine.body).slice(0, 120));
  const order = await post('/api/orders', { email: 'sf-off@example.com', consent: true, consentText: 'ok',
    items: [{ productId: off, quantity: 1 }] });
  ok('the order itself still refuses it', order.status >= 400, JSON.stringify(order).slice(0, 160));
}

console.log('\n— The signed-in cart keeps each line\'s category —');
{
  const { saveCart, getCart } = await import('../src/services/cartService.js');
  const uid = newId('usr');
  await run(`INSERT INTO users (id, email, created_at, updated_at) VALUES (@id,@e,@at,@at)`,
    { id: uid, e: `sf-cart-${uid.slice(-6)}@example.com`, at: nowIso() }).catch(() => {});
  await saveCart(uid, [{ id: 'prd_x', name: '1,000 Robux', price: 999, qty: 1, category: 'robux', image: '/api/images/a.webp' }]);
  const back = await getCart(uid);
  const line = back[0];
  ok('the category survives the round trip', line?.category === 'robux', JSON.stringify(back));
  ok('…and so does the picture', line?.image === '/api/images/a.webp', JSON.stringify(back));
}

console.log('\n— Order limits carry a code —');
{
  const src = fs.readFileSync(new URL('../src/services/orderLimitService.js', import.meta.url), 'utf8');
  ok('each order-limit refusal has its own code',
    ['order_limit_value', 'order_limit_count', 'order_limit_daily', 'order_limit_ip'].every((c) => src.includes(`'${c}'`)));
}

console.log('\n— The storefront source —');
{
  const read = (p) => fs.readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
  const co = read('pages/Checkout.jsx');
  ok('a payment that failed to start keeps its order for the retry (no second order)',
    /if \(created\) \{\s*setPendingOrder\(created\)/.test(co) && /created = order;/.test(co));
  ok('…and the wallet is read again', /if \(created\)[\s\S]{0,200}\/api\/account\/wallet/.test(co));
  ok('Back from the payment page lands on the order\'s track page',
    /replaceState\(null, '', `\/track\?number=/.test(co) && (co.match(/leaveForPayment\(order, r\.checkoutUrl\)/g) || []).length === 2);
  ok('errors are shown in the buyer\'s language', /toast\.error\(friendlyError\(err, t\)\)/.test(co));
  ok('the phone pay bar says "paused" when it is', /Sticky pay bar[\s\S]*: paused \? <>\{t\('checkout\.pausedBtn'/.test(co));
  ok('the manual screen falls back to the order\'s email', /email=\{email \|\| placed\.email \|\| undefined\}/.test(co)
    && /\{email \|\| placed\.email\}/.test(co));
  ok('"sign in" comes back to the checkout', /to="\/login" state=\{\{ from: '\/checkout' \}\}/.test(co));
  ok('a line without a category gets it from the catalogue', /deliveryField\(i\.category \|\| productCats\[i\.id\], lang\)/.test(co));
  const cart = read('pages/Cart.jsx');
  ok('an unavailable line is named with a Remove, on the cart and the checkout',
    /<UnavailableLines problems=\{gone\}/.test(co) && /<UnavailableLines problems=\{gone\}/.test(cart)
    && /e\?\.code === 'product_unavailable'/.test(co) && /e\?\.code === 'product_unavailable'/.test(cart));

  const again = read('components/store/PayAgain.jsx');
  ok('"Pay again" sends the order number and the chosen method',
    /number, \.\.\.\(email \? \{ email \} : \{\}\), \.\.\.\(method \? \{ method \} : \{\}\)/.test(again));
  ok('the return page uses it', /<PayAgain orderId=\{orderId\} number=\{number\}/.test(read('pages/CheckoutSuccess.jsx')));
  ok('the track page offers it after a cancelled payment',
    /result\.paymentRetryable && result\.id[\s\S]{0,600}<PayAgain orderId=\{result\.id\} number=\{result\.number\}/.test(read('pages/Track.jsx')));

  const fe = read('lib/friendlyError.js');
  const dicts = [read('lib/i18n.jsx'), read('lib/i18n/de.js'), read('lib/i18n/fr.js')];
  const keys = [...fe.matchAll(/\['(err\.[a-zA-Z]+)'/g)].map((m) => m[1]);
  const missing = keys.filter((k) => dicts.some((d) => !d.includes(`'${k}':`)));
  ok(`every translated error exists in nl, de and fr (${keys.length} keys)`, keys.length >= 9 && missing.length === 0, missing.join(', '));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} storefront-payment-flow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
