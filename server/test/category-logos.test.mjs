/** Per-category logos: the owner sets an image per category in the admin and
 *  the storefront reads them from the public /api/config payload. */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
import { sha256 } from '../src/utils/crypto.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { requestEmailOtp } = await import('../src/services/authService.js');
const { run, get } = await import('../src/db/index.js');

const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const tag = Date.now() % 100000;

// Owner login (dev OTP path).
const email = 'mohamedelhannouti51@gmail.com';
await requestEmailOtp(email, {});
const row = await get(`SELECT id FROM otp_codes WHERE email=@e AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, { e: email });
await run(`UPDATE otp_codes SET code_hash=@h WHERE id=@id`, { h: sha256('654321'), id: row.id });
const login = await (await fetch(`${base}/api/auth/otp/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, code: '654321' }) })).json();
ok('owner logs in', !!login.accessToken);
const auth = { 'content-type': 'application/json', authorization: `Bearer ${login.accessToken}` };

await createProduct({ name: `Robux pack ${tag}`, category: 'robux', price: 999, announce: false });

// The admin sees the categories it actually sells.
const list = await (await fetch(`${base}/api/admin/categories`, { headers: auth })).json();
ok('categories are listed', Array.isArray(list.categories) && list.categories.includes('robux'));

const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const put = await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ slug: 'robux', image: logo }) });
ok('setting a category logo returns 200', put.status === 200, `status=${put.status}`);

// The storefront reads it from the public config (no auth).
const cfg = await (await fetch(`${base}/api/config`)).json();
ok('public config exposes the logo', cfg.categoryLogos?.robux === logo);

// An unsafe value is rejected — same guard as product images.
const bad = await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ slug: 'robux', image: 'javascript:alert(1)' }) });
ok('unsafe image value is rejected', bad.status === 400, `status=${bad.status}`);

// The rejected write left the good logo in place.
const cfg2 = await (await fetch(`${base}/api/config`)).json();
ok('previous logo survives a rejected write', cfg2.categoryLogos?.robux === logo);

// Clearing removes just that entry.
await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ slug: 'v-bucks', image: logo }) });
const clear = await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ slug: 'v-bucks', image: null }) });
const cfg3 = await (await fetch(`${base}/api/config`)).json();
ok('clearing a logo works', clear.status === 200 && !cfg3.categoryLogos['v-bucks']);
ok('clearing one leaves the others', cfg3.categoryLogos?.robux === logo);

// Staff auth is required to change logos.
const anon = await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ slug: 'robux', image: logo }) });
ok('anonymous cannot set a logo', anon.status === 401 || anon.status === 403, `status=${anon.status}`);

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
