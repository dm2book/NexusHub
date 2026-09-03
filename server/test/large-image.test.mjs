/** A real (base64) image an admin uploads is larger than the old 1mb JSON body
 *  limit, so saving it 413'd and "the image didn't change". The body limit is
 *  now 3mb; the image guard still caps the data URI. This locks that in. */
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

const p = await createProduct({ name: `FC Points ${tag}`, category: 'fc', price: 3699, announce: false });

// A ~1.4mb data URI — bigger than the old 1mb parser limit, under the 2.5mb cap.
const bigImage = 'data:image/jpeg;base64,' + 'A'.repeat(1_400_000);
const r1 = await fetch(`${base}/api/admin/products/${p.id}`, {
  method: 'PATCH', headers: auth, body: JSON.stringify({ metadata: { ...p.metadata, image: bigImage } }) });
ok('1.4mb uploaded image saves (not 413)', r1.status === 200, `status=${r1.status}`);
/* Persisted, but not in the product row: a 1.4 MB upload is exactly the case
   that made GET /api/products 8.7 MB on the live shop. It is stored once in
   product_images and the row keeps a URL. */
const saved = (await getProduct(p.id)).image;
ok('the 1.4mb upload is stored', /^\/api\/images\/[a-f0-9]{32}\./.test(saved), saved.slice(0, 48));
ok('…and the product row no longer carries it',
  saved.length < 100, `${saved.length} bytes in the row`);
ok('…while the bytes are served from the URL', (await fetch(base + saved)).status === 200);

// Over the cap → clean 400 (validation), never a crash / silent drop.
const huge = 'data:image/jpeg;base64,' + 'A'.repeat(2_700_000);
const r2 = await fetch(`${base}/api/admin/products/${p.id}`, {
  method: 'PATCH', headers: auth, body: JSON.stringify({ metadata: { ...p.metadata, image: huge } }) });
ok('oversized image is rejected with 400', r2.status === 400, `status=${r2.status}`);

// Bulk path accepts a real uploaded image too.
const r3 = await fetch(`${base}/api/admin/products/bulk`, {
  method: 'POST', headers: auth, body: JSON.stringify({ ids: [p.id], action: 'image', value: bigImage }) });
ok('bulk accepts a large uploaded image', r3.status === 200, `status=${r3.status}`);

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
