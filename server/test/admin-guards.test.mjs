/**
 * What an admin who is not the owner may no longer do.
 *
 *   change payment keys, payment links and the seller identity, or take and
 *   download a backup (which held every user's 2FA secret) — owner only;
 *   take the owner role away from the owner, or remove the last owner;
 *   grant store credit to themselves, or more than the staff cap;
 *   and a listed owner address only bootstraps the first owner.
 * Plus: a product name cannot break out of the page's JSON-LD script, and a
 * payment screenshot is deleted once the proof has been reviewed.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { createProduct } = await import('../src/services/productService.js');

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const stamp = Date.now();
const person = async (role) => {
  const id = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'P', @at, @at)`,
    { id, e: `${role}-${id}@example.test`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, @r, @at) ON CONFLICT DO NOTHING`, { u: id, r: role, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id }), {});
  return { id, H: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' } };
};
const call = (method, path, who, body) => fetch(`${base}${path}`, { method, headers: who.H, body: body ? JSON.stringify(body) : undefined });

const owner = await person('owner');
const admin = await person('admin');
const customer = await person('customer');

console.log('\n— Owner-only —');
{
  ok('an admin cannot read the keys', (await call('GET', '/api/admin/settings/keys', admin)).status === 403);
  ok('…nor change one', (await call('PUT', '/api/admin/settings/keys/payments.tikkieUrl', admin, { value: 'https://tikkie.me/pay/x' })).status === 403);
  ok('…nor the seller identity', (await call('PUT', '/api/admin/legal-identity', admin, { legalName: 'X' })).status === 403);
  ok('…nor take a backup', (await call('POST', '/api/admin/backups', admin, {})).status === 403);
  ok('the owner can read the keys', (await call('GET', '/api/admin/settings/keys', owner)).status === 200);
  await run(`UPDATE users SET totp_secret='JBSWY3DPEHPK3PXP' WHERE id=@id`, { id: owner.id });
  const bk = await call('POST', '/api/admin/backups', owner, {});
  const made = await bk.json().catch(() => ({}));
  const id = made.backup?.id || made.id;
  if (id) {
    const dl = await call('GET', `/api/admin/backups/${id}/download`, owner);
    const text = await dl.text();
    ok('a backup no longer carries 2FA secrets', dl.status === 200 && !text.includes('JBSWY3DPEHPK3PXP') && /redacted/.test(text));
  } else ok('a backup no longer carries 2FA secrets', false, JSON.stringify(made).slice(0, 200));
}

console.log('\n— The owner role —');
{
  ok('an admin cannot strip the owner', (await call('PUT', `/api/admin/security/users/${owner.id}/roles`, admin, { roles: ['customer'] })).status === 400);
  const still = await get(`SELECT 1 FROM user_roles WHERE user_id=@u AND role_id='owner'`, { u: owner.id });
  ok('…and the owner is still owner', !!still);
  ok('an unknown role is a 400, not a 500', (await call('PUT', `/api/admin/security/users/${customer.id}/roles`, owner, { roles: ['wizard'] })).status === 400);
  const owners = await all(`SELECT DISTINCT user_id FROM user_roles WHERE role_id='owner'`);
  if (owners.length === 1) {
    ok('the last owner cannot be removed', (await call('PUT', `/api/admin/security/users/${owner.id}/roles`, owner, { roles: ['customer'] })).status === 400);
  } else {
    await run(`DELETE FROM user_roles WHERE role_id='owner' AND user_id<>@u`, { u: owner.id });
    ok('the last owner cannot be removed', (await call('PUT', `/api/admin/security/users/${owner.id}/roles`, owner, { roles: ['customer'] })).status === 400);
  }
  const { upsertUserByEmail } = await import('../src/services/userService.js');
  const { config } = await import('../src/config/env.js');
  const listed = `listed-${stamp}@example.test`;
  config.auth.adminEmails.push(listed);
  const { user } = await upsertUserByEmail(listed);
  await upsertUserByEmail(listed);
  const granted = await get(`SELECT 1 FROM user_roles WHERE user_id=@u AND role_id='owner'`, { u: user.id });
  ok('a listed address is not made owner while an owner exists', !granted);
}

console.log('\n— Store credit —');
{
  ok('an admin cannot credit themselves', (await call('POST', `/api/admin/security/users/${admin.id}/credit`, admin, { amount: 500 })).status === 400);
  ok('…nor grant €999,999.99', (await call('POST', `/api/admin/security/users/${customer.id}/credit`, admin, { amount: 99_999_999 })).status === 400);
  ok('…nor more than the staff cap', (await call('POST', `/api/admin/security/users/${customer.id}/credit`, admin, { amount: 20_000 })).status === 400);
  ok('a small goodwill grant still works', (await call('POST', `/api/admin/security/users/${customer.id}/credit`, admin, { amount: 500, description: 'sorry' })).status === 200);
}

console.log('\n— The product page —');
{
  const p = await createProduct({ name: 'Evil </script><script>alert(1)</script> Pack', category: 'giftcard', price: 999, announce: false });
  const html = await (await fetch(`${base}/product/${p.id}`)).text();
  const ld = html.split('application/ld+json').slice(1).join('');
  ok('a product name cannot close the JSON-LD script', !/<\/script><script>alert/.test(ld));
}

console.log('\n— Payment screenshots —');
{
  const { confirmProof } = await import('../src/services/paymentProofService.js');
  const imgId = 'a'.repeat(32);
  await run(`INSERT INTO product_images (id, product_id, mime, bytes, byte_size, sha256, source, created_at)
             VALUES (@id, NULL, 'image/png', '\\x00'::bytea, 1, @sha, 'upload', @at) ON CONFLICT DO NOTHING`, { id: imgId, sha: `sha-${stamp}`, at: nowIso() });
  const prod = await createProduct({ name: 'Proof Card', category: 'giftcard', price: 1000, announce: false });
  const oid = newId('ord');
  await run(`INSERT INTO orders (id, number, email, status, currency, subtotal, total, billing, created_at, updated_at)
             VALUES (@id, @n, 'proof@example.test', 'pending', 'EUR', 1000, 1000, '{}', @at, @at)`, { id: oid, n: `FM-T-${stamp}`, at: nowIso() });
  const pid = newId('ppf');
  await run(`INSERT INTO payment_proofs (id, order_id, method, transaction_id, screenshot_url, amount, status, created_at)
             VALUES (@id, @o, 'tikkie', 'tx1', @u, 1000, 'pending', @at)`, { id: pid, o: oid, u: `/api/images/${imgId}.png`, at: nowIso() });
  await confirmProof(pid, { user: { id: owner.id, email: 'o' } }).catch(() => {});
  const proof = await get('SELECT screenshot_url FROM payment_proofs WHERE id=@id', { id: pid });
  const img = await get('SELECT 1 FROM product_images WHERE id=@id', { id: imgId });
  ok('after review the screenshot is gone, from the proof and from storage', proof && proof.screenshot_url === null && !img);
  void prod;
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} admin-guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
