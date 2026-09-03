/** Bulk "set one image across the whole selection" — the admin flow for giving
 *  every Robux / V-Bucks variant the same logo in one click. */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
import { sha256 } from '../src/utils/crypto.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { createProduct, getProduct } = await import('../src/services/productService.js');
const { requestEmailOtp } = await import('../src/services/authService.js');
const { run, get } = await import('../src/db/index.js');

const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const tag = Date.now() % 100000;

// Owner login (dev OTP path, like the regression suite).
const email = 'mohamedelhannouti51@gmail.com';
await requestEmailOtp(email, {});
const row = await get(`SELECT id FROM otp_codes WHERE email=@e AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, { e: email });
await run(`UPDATE otp_codes SET code_hash=@h WHERE id=@id`, { h: sha256('654321'), id: row.id });
const login = await (await fetch(`${base}/api/auth/otp/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, code: '654321' }) })).json();
ok('owner logs in', !!login.accessToken);
const auth = { 'content-type': 'application/json', authorization: `Bearer ${login.accessToken}` };

// Three "Robux" variants to bulk-image.
const a = await createProduct({ name: `Robux 1k ${tag}`, category: 'robux', price: 999, announce: false });
const b = await createProduct({ name: `Robux 5k ${tag}`, category: 'robux', price: 4999, announce: false });
const c = await createProduct({ name: `V-Bucks ${tag}`, category: 'vbucks', price: 599, announce: false });

const url = 'https://cdn.example.com/roblox-logo.png';
const res = await fetch(`${base}/api/admin/products/bulk`, {
  method: 'POST', headers: auth, body: JSON.stringify({ ids: [a.id, b.id], action: 'image', value: url }) });
const body = await res.json();
ok('bulk image applied to 2 products', res.status === 200 && body.updated === 2, JSON.stringify(body));
ok('product A got the image', (await getProduct(a.id)).image === url);
ok('product B got the image', (await getProduct(b.id)).image === url);
ok('unselected product C is untouched', !(await getProduct(c.id)).image);

// Clearing with an empty value removes the image again.
await fetch(`${base}/api/admin/products/bulk`, {
  method: 'POST', headers: auth, body: JSON.stringify({ ids: [a.id], action: 'image', value: '' }) });
ok('empty value clears the image', !(await getProduct(a.id)).image);

// A junk (non-http) URL is rejected.
const bad = await fetch(`${base}/api/admin/products/bulk`, {
  method: 'POST', headers: auth, body: JSON.stringify({ ids: [b.id], action: 'image', value: 'javascript:alert(1)' }) });
ok('non-http image URL is rejected', bad.status === 400, `status=${bad.status}`);

// An uploaded image (raster data URI) is accepted and stored.
const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const up = await fetch(`${base}/api/admin/products/bulk`, {
  method: 'POST', headers: auth, body: JSON.stringify({ ids: [c.id], action: 'image', value: dataUri }) });
ok('uploaded data-URI image is accepted', up.status === 200, `status=${up.status}`);
/* The row no longer stores the picture. An upload is moved into
   product_images and the product keeps a URL, so setting one image across a
   whole selection costs one row rather than one copy per product — see
   services/imageStoreService.js. This assertion used to require the opposite. */
const stored = (await getProduct(c.id)).image;
ok('product C stored a URL rather than the base64', /^\/api\/images\/[a-f0-9]{32}\./.test(stored), stored.slice(0, 48));
ok('…and the picture is served from it', (await fetch(base + stored)).status === 200);

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
