/**
 * AVG requests: what the shop holds about an address, and erasing it.
 *
 *   the export has the account, the orders with their items and the wallet,
 *   and no secrets (no TOTP secret, no session tokens);
 *   erasing deletes what exists only because of the person, and anonymises
 *   what the shop must keep — an order stays, with its amounts, but without
 *   the name, the address, the email or the delivery target;
 *   only the owner may erase, the address must be typed again, and staff
 *   accounts are refused.
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
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder } = await import('../src/services/orderService.js');
const { credit } = await import('../src/services/walletService.js');
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api/admin/security/privacy`;
const stamp = Date.now();

const person = async (role, email = null) => {
  const id = newId('usr');
  const e = email || `${role}-${stamp}-${id.slice(-4)}@example.test`.toLowerCase();
  await run(`INSERT INTO users (id, email, display_name, phone, totp_secret, created_at, updated_at)
             VALUES (@id, @e, 'Sam Jansen', '+31612345678', 'JBSWY3DPEHPK3PXP', @at, @at)`, { id, e, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, @r, @at)`, { u: id, r: role, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id }), {});
  return { id, email: e, H: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' } };
};
const owner = await person('owner');
const admin = await person('admin');
const buyer = await person('customer');
const product = await createProduct({ name: '1,000 Robux', category: 'robux', price: 999, announce: false });
await credit(buyer.id, 500, 'adjustment', 'test');
const order = await createOrder({ email: buyer.email, userId: buyer.id, billing: { full_name: 'Sam Jansen', city: 'Utrecht', deliveryMethod: 'account', deliveryDetails: 'SamJ_123' },
  useCredit: 500, items: [{ productId: product.id, quantity: 1 }], consent: true, consentText: 'x' });
await run(`INSERT INTO newsletter_signups (id, email, source, created_at) VALUES (@id, @e, 'test', @at)`, { id: newId('nls'), e: buyer.email, at: nowIso() });

console.log('\n— Export —');
{
  const r = await fetch(`${base}/export?email=${encodeURIComponent(buyer.email)}`, { headers: admin.H });
  const d = await r.json();
  ok('an admin who manages users can export', r.status === 200);
  ok('…the account, the order with its items, the wallet and the newsletter row',
    d.account?.email === buyer.email && d.orders?.[0]?.items?.length === 1 && d.walletLedger?.length >= 1 && d.newsletter?.length === 1);
  const text = JSON.stringify(d);
  ok('…and no secrets in it', !text.includes('JBSWY3DPEHPK3PXP') && !/refresh|code_hash/.test(text));
}

console.log('\n— Erase —');
{
  ok('an admin cannot erase', (await fetch(`${base}/erase`, { method: 'POST', headers: admin.H, body: JSON.stringify({ email: buyer.email, confirm: buyer.email }) })).status === 403);
  ok('…nor the owner without typing the address again',
    (await fetch(`${base}/erase`, { method: 'POST', headers: owner.H, body: JSON.stringify({ email: buyer.email, confirm: 'oops' }) })).status === 400);
  ok('…and a staff account is refused', (await fetch(`${base}/erase`, { method: 'POST', headers: owner.H, body: JSON.stringify({ email: admin.email, confirm: admin.email }) })).status === 400);
  const r = await fetch(`${base}/erase`, { method: 'POST', headers: owner.H, body: JSON.stringify({ email: buyer.email, confirm: buyer.email.toUpperCase() }) });
  ok('the owner erases', r.status === 200);
  const u = await get('SELECT email, display_name, phone, totp_secret FROM users WHERE id=@id', { id: buyer.id });
  ok('the account is anonymised: no email, name, phone or 2FA secret', /@erased\.invalid$/.test(u.email) && u.display_name === 'Verwijderd' && !u.phone && !u.totp_secret, JSON.stringify(u));
  const o = await get('SELECT email, billing, total FROM orders WHERE id=@id', { id: order.id });
  const b = JSON.parse(o.billing);
  ok('the order stays for the books, with its amount, but without name, city or delivery target',
    o.total === order.total && /@erased\.invalid$/.test(o.email) && !b.full_name && !b.city && !b.deliveryDetails && b.creditApplied === 500, JSON.stringify(b));
  ok('sessions and the newsletter row are gone',
    !(await get('SELECT 1 FROM sessions WHERE user_id=@u', { u: buyer.id })) && !(await get('SELECT 1 FROM newsletter_signups WHERE email=@e', { e: buyer.email })));
  const again = await (await fetch(`${base}/export?email=${encodeURIComponent(buyer.email)}`, { headers: admin.H })).json();
  ok('an export afterwards finds nothing under the old address', !again.account && !again.orders.length);
  const audited = await get(`SELECT metadata FROM audit_logs WHERE action='privacy.erase' ORDER BY created_at DESC LIMIT 1`);
  ok('the erase is audited without the erased address', !!audited && !String(audited.metadata).includes(buyer.email));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} privacy-requests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
