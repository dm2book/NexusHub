/** Regression: coupon/bundle create hooks + full HTTP app boot with new routes. */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_test';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ FAIL: ${name}`); } };

await (await import('../src/app.js')).ensureReady();
const { createCoupon, evaluateCoupon } = await import('../src/services/couponService.js');
const { createBundle, bestBundleDiscount } = await import('../src/services/bundleService.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder } = await import('../src/services/orderService.js');

console.log('— Monetization hooks unchanged —');
const c = await createCoupon({ code: `E2E${Date.now() % 100000}`, kind: 'percent', value: 10, announce: false });
ok('coupon created', c.active && c.value === 10);
const ev = await evaluateCoupon(c.code, { subtotal: 1000 });
ok('coupon evaluates 10%', ev.ok && ev.discount === 100);

const p1 = await createProduct({ name: 'E2E Bundle A', category: 'robux', price: 500, announce: false });
const p2 = await createProduct({ name: 'E2E Bundle B', category: 'robux', price: 700, announce: false });
const b = await createBundle({ name: 'E2E Duo', productIds: [p1.id, p2.id], discountPercent: 15, announce: false });
ok('bundle created', b.active && b.discountPercent === 15);
const best = await bestBundleDiscount([
  { product_id: p1.id, quantity: 1, unit_price: 500 },
  { product_id: p2.id, quantity: 1, unit_price: 700 },
]);
ok('bundle discount computed', best.discount === Math.round(1200 * 0.15));

const o = await createOrder({ consent: true, consentText: 'test consent', email: 'combo@example.com', coupon: c.code, items: [
  { productId: p1.id, quantity: 1 }, { productId: p2.id, quantity: 1 }] });
ok('order applies coupon + bundle', o.total === 1200 - Math.round(1200 * 0.10) - Math.round(1200 * 0.15));

console.log('— HTTP app boot + new endpoints —');
const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const app = createApp();
const srv = app.listen(4567);
const base = 'http://127.0.0.1:4567';
const jr = (r) => r.json();

const health = await fetch(`${base}/api/health`).then(jr);
ok('health ok', health.ok === true);
const products = await fetch(`${base}/api/products`).then(jr);
ok('products listed', Array.isArray(products.products) && products.products.length > 0);
const totpNoAuth = await fetch(`${base}/api/auth/totp`);
ok('GET /auth/totp requires auth', totpNoAuth.status === 401);
const totpLoginBad = await fetch(`${base}/api/auth/totp/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ticket: 'x'.repeat(20), code: '123456' }) });
ok('totp/login rejects bad ticket', totpLoginBad.status === 401);
const csvNoAuth = await fetch(`${base}/api/admin/orders/export.csv`);
ok('csv export requires auth', csvNoAuth.status === 401 || csvNoAuth.status === 403);
const maint = await fetch(`${base}/api/cron/maintenance`).then(jr);
ok('cron maintenance runs (dev, incl. reminders)', typeof maint.remindersSent === 'number');

// Full login → CSV download as owner (ADMIN_EMAILS includes this address? use dev OTP path)
const { requestEmailOtp } = await import('../src/services/authService.js');
const { run, get } = await import('../src/db/index.js');
const { sha256 } = await import('../src/utils/crypto.js');
const email = 'mohamedelhannouti51@gmail.com'; // hardcoded owner bootstrap email
await requestEmailOtp(email, {});
const row = await get(`SELECT id FROM otp_codes WHERE email=@e AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, { e: email });
await run(`UPDATE otp_codes SET code_hash=@h WHERE id=@id`, { h: sha256('654321'), id: row.id });
const login = await fetch(`${base}/api/auth/otp/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, code: '654321' }) }).then(jr);
ok('owner logs in', !!login.accessToken);
ok('publicUser exposes totpEnabled', login.user.totpEnabled === false);
const csv = await fetch(`${base}/api/admin/orders/export.csv?status=pending`, {
  headers: { authorization: `Bearer ${login.accessToken}` } });
ok('owner downloads CSV', csv.status === 200 && (csv.headers.get('content-type') || '').includes('text/csv'));
const body = await csv.text();
ok('CSV body has header row', body.includes('order_number,date,customer_email'));

// TOTP setup over HTTP
const setup = await fetch(`${base}/api/auth/totp/setup`, { method: 'POST',
  headers: { authorization: `Bearer ${login.accessToken}` } }).then(jr);
ok('totp setup over http', /^[A-Z2-7]{32}$/.test(setup.secret || ''));
const { totpCode } = await import('../src/utils/totp.js');
const enable = await fetch(`${base}/api/auth/totp/enable`, { method: 'POST',
  headers: { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ code: totpCode(setup.secret) }) }).then(jr);
ok('totp enabled over http', enable.enabled === true);

// Next login → challenge → totp/login completes
await run(`DELETE FROM otp_codes WHERE email=@e`, { e: email }); // sidestep the request throttle
await requestEmailOtp(email, {});
const row2 = await get(`SELECT id FROM otp_codes WHERE email=@e AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, { e: email });
await run(`UPDATE otp_codes SET code_hash=@h WHERE id=@id`, { h: sha256('654321'), id: row2.id });
const chal = await fetch(`${base}/api/auth/otp/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, code: '654321' }) }).then(jr);
ok('login now returns totp challenge', chal.totpRequired === true && !!chal.ticket);
const done = await fetch(`${base}/api/auth/totp/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ticket: chal.ticket, code: totpCode(setup.secret) }) }).then(jr);
ok('totp/login issues session', !!done.accessToken && done.user.totpEnabled === true);
// cleanup: disable so future runs are unaffected
await fetch(`${base}/api/auth/totp/disable`, { method: 'POST',
  headers: { authorization: `Bearer ${done.accessToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ code: totpCode(setup.secret) }) });

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
