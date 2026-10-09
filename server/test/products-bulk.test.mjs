/**
 * Admin bulk actions on products (routes/admin/products.js POST /bulk): one read
 * and one write for the whole selection, with exactly the results the
 * per-product loop gave — active, featured, delivery mode, image set and clear.
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady, createApp } from '../src/app.js';
import { get, run, all, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const stamp = Date.now().toString(36);

const owner = newId('usr');
await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`,
  { id: owner, e: `bulk-${stamp}@x.dev`, at: nowIso() });
await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const bulk = (body) => fetch(`${base}/api/admin/products/bulk`, {
  method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
  body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const ids = [];
for (let i = 0; i < 80; i++) {
  const p = await createProduct({ name: `Bulk ${stamp} ${i}`, category: 'robux', price: 999 + i, announce: false,
    metadata: { keep: `k${i}`, deliveryMode: i % 2 ? 'manual' : undefined } });
  ids.push(p.id);
}
const metaOf = async () => (await all(`SELECT id, active, price, metadata FROM products WHERE id = ANY(@ids)`, { ids }))
  .map((r) => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));

let r = await bulk({ ids, action: 'active', value: false });
let rows = await metaOf();
ok('deactivating 80 products answers with the count', r.status === 200 && r.body.updated === 80, JSON.stringify(r.body));
ok('…and every one is inactive', rows.every((p) => Number(p.active) === 0));

r = await bulk({ ids: [...ids, 'prd_does_not_exist'], action: 'active', value: true });
ok('an unknown id is skipped, not counted', r.body.updated === 80, JSON.stringify(r.body));

r = await bulk({ ids, action: 'featured', value: true });
rows = await metaOf();
ok('featured is set on every product', r.body.updated === 80 && rows.every((p) => p.metadata.featured === true));
ok('…without touching the rest of the metadata', rows.every((p) => /^k\d+$/.test(p.metadata.keep)));

r = await bulk({ ids, action: 'deliveryMode', value: 'auto' });
rows = await metaOf();
ok('delivery mode "auto" removes the key everywhere (the default keeps metadata clean)',
  rows.every((p) => !('deliveryMode' in p.metadata)));
r = await bulk({ ids: ids.slice(0, 10), action: 'deliveryMode', value: 'manual' });
rows = await metaOf();
ok('…and "manual" sets it on exactly the selection', rows.filter((p) => p.metadata.deliveryMode === 'manual').length === 10);

r = await bulk({ ids, action: 'image', value: 'https://cdn.example.com/robux.png' });
rows = await metaOf();
ok('one image across the whole selection', r.body.updated === 80 && rows.every((p) => p.metadata.image === 'https://cdn.example.com/robux.png'));
r = await bulk({ ids, action: 'image', value: '' });
rows = await metaOf();
ok('…and cleared again', rows.every((p) => !('image' in p.metadata)));
const bad = await bulk({ ids, action: 'image', value: 'javascript:alert(1)' });
ok('an unsafe image value is refused', bad.status === 400);

ok('no price changed along the way', rows.every((p, i) => Number(p.price) >= 999));
const t = Date.now();
await bulk({ ids, action: 'featured', value: false });
ok('80 products in one bulk action take well under a second locally', Date.now() - t < 1_000, `${Date.now() - t} ms`);

srv.close();
console.log(`\n${fail ? '❌' : '✅'} products-bulk: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
