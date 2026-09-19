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

/* The storefront reads it from the public config (no auth) — as a URL.
   It used to be the base64 itself, and /api/config is fetched on every page
   load: measured on the live shop at 1.33 MB, of which 1 328 498 bytes were
   sixteen inline logos with `max-age=0` on them. */
const cfg = await (await fetch(`${base}/api/config`)).json();
const stored = cfg.categoryLogos?.robux;
ok('public config exposes the logo', !!stored);
ok('…as a URL, not as base64', /^\/api\/images\/[a-f0-9]{32}\.[a-z0-9]+$/.test(stored || ''), stored?.slice(0, 40));

// And the URL has to actually serve the bytes that were uploaded.
const served = await fetch(`${base}${stored}`);
const bytes = Buffer.from(await served.arrayBuffer());
ok('the URL serves the picture', served.status === 200 && bytes.equals(Buffer.from(logo.split(',')[1], 'base64')));
ok('…with an immutable cache header', /immutable/.test(served.headers.get('cache-control') || ''),
  served.headers.get('cache-control'));

// An unsafe value is rejected — same guard as product images.
const bad = await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ slug: 'robux', image: 'javascript:alert(1)' }) });
ok('unsafe image value is rejected', bad.status === 400, `status=${bad.status}`);

// The rejected write left the good logo in place.
const cfg2 = await (await fetch(`${base}/api/config`)).json();
ok('previous logo survives a rejected write', cfg2.categoryLogos?.robux === stored);

// Clearing removes just that entry.
await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ slug: 'v-bucks', image: logo }) });
const clear = await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ slug: 'v-bucks', image: null }) });
const cfg3 = await (await fetch(`${base}/api/config`)).json();
ok('clearing a logo works', clear.status === 200 && !cfg3.categoryLogos['v-bucks']);
ok('clearing one leaves the others', cfg3.categoryLogos?.robux === stored);

/* The same picture twice is one row and one URL — the whole reason the URL may
   claim to be immutable. */
await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ slug: 'spotify', image: logo }) });
const cfg4 = await (await fetch(`${base}/api/config`)).json();
ok('the same picture under another category reuses one URL', cfg4.categoryLogos?.spotify === stored);

/* Logos saved before any of this existed. The sweep is what moves them, and
   running it twice must not write a second copy or a second row. */
const { setSetting } = await import('../src/services/settingsService.js');
const { migrateCategoryLogos } = await import('../src/services/settingsService.js');
await setSetting('category_logos', { robux: stored, legacy: logo });
const first = await migrateCategoryLogos();
ok('the sweep moves a logo left as base64', first.moved === 1, JSON.stringify(first));
ok('…and reports the bytes it took out of the config', first.freedBytes === logo.length);
const cfg5 = await (await fetch(`${base}/api/config`)).json();
ok('…leaving a URL behind', cfg5.categoryLogos?.legacy === stored);
const second = await migrateCategoryLogos();
ok('running it again moves nothing', second.moved === 0, JSON.stringify(second));

/* What this is all for: the size of the answer the storefront gets. */
const raw = await (await fetch(`${base}/api/config`)).text();
ok('the public config stays small with logos set', raw.length < 20_000, `${raw.length} bytes`);

// Staff auth is required to change logos.
const anon = await fetch(`${base}/api/admin/categories/logo`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ slug: 'robux', image: logo }) });
ok('anonymous cannot set a logo', anon.status === 401 || anon.status === 403, `status=${anon.status}`);

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
