/**
 * Findings of the sign-in and admin-permission audit, each with its failure.
 *
 *   - Account phone verification compared guesses before counting them, so a
 *     parallel burst could bind someone else's number (and their future SMS
 *     logins) to your account.
 *   - Switching 2FA on needed only a session: a stolen one could lock the real
 *     owner out for good.
 *   - Logging out left "remember this device" valid: the next person on that
 *     browser was signed in without a code.
 *   - Staff could mark their own unpaid order paid and refund it as store
 *     credit (unlimited credit), or let it deliver (free codes).
 *   - The orders CSV turned buyer text starting with "=" into a spreadsheet
 *     formula.
 */
import './_selling-shop.mjs';
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_auth_audit_fixes';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
await (await import('../src/services/bootUpkeep.js')).claimInterval('maintenance_auto', 3_600_000);
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const { sha256 } = await import('../src/utils/crypto.js');
const { createProduct } = await import('../src/services/productService.js');
const { createOrder, exportOrdersCsv } = await import('../src/services/orderService.js');

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}/api`;
const stamp = Date.now();

const person = async (role, { sessionAgeMs = 0 } = {}) => {
  const id = newId('usr');
  const e = `${role || 'buyer'}-${stamp}-${id.slice(-4)}@example.test`.toLowerCase();
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'Auth', @at, @at)`,
    { id, e, at: nowIso() });
  if (role) await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, @r, @at)`, { u: id, r: role, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id }), {});
  if (sessionAgeMs) {
    await run(`UPDATE sessions SET created_at=@at WHERE user_id=@u`, { u: id, at: new Date(Date.now() - sessionAgeMs).toISOString() });
  }
  return { id, email: e, H: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' } };
};
const call = async (method, path, body, H) => {
  const r = await fetch(`${base}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: j, headers: r.headers };
};

console.log('— Phone verification: thirty guesses at once still get five —');
{
  const attacker = await person(null);
  const phone = '+31687654321';
  await run(`INSERT INTO sms_verifications (id, phone, code_hash, attempts, expires_at, created_at) VALUES (@id, @p, @h, 0, @exp, @at)`,
    { id: newId('sms'), p: phone, h: sha256('515151'), exp: new Date(Date.now() + 600_000).toISOString(), at: nowIso() });
  const guesses = Array.from({ length: 30 }, (_, i) => (i === 19 ? '515151' : String(100000 + i)));
  const res = await Promise.all(guesses.map((code) => call('POST', '/account/phone/verify', { phone, code }, attacker.H)));
  const bound = await get(`SELECT phone_verified FROM users WHERE id=@id`, { id: attacker.id });
  ok('the correct code as guess 20 of a parallel burst does not bind the number',
    !bound?.phone_verified, JSON.stringify(res.map((r) => r.status)));
}

console.log('\n— Switching 2FA on needs a recent sign-in —');
{
  const stale = await person(null, { sessionAgeMs: 2 * 3_600_000 });
  const r = await call('POST', '/auth/totp/setup', {}, stale.H);
  ok('a two-hour-old session cannot start 2FA setup', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
  const fresh = await person(null);
  const r2 = await call('POST', '/auth/totp/setup', {}, fresh.H);
  ok('…a fresh sign-in can', r2.status === 200, `${r2.status} ${JSON.stringify(r2.body).slice(0, 120)}`);
}

console.log('\n— Logging out forgets this browser —');
{
  const u = await person(null);
  const { createTrustedDevice: trustDevice } = await import('../src/services/deviceService.js');
  const { token } = await trustDevice(u.id, { userAgent: 'test' });
  const H = { ...u.H, cookie: `fm_device=${token}` };
  const out = await call('POST', '/auth/logout', {}, H);
  const id = token.split('.')[0];
  const row = await get(`SELECT revoked_at FROM trusted_devices WHERE id=@id`, { id });
  ok('logout revokes the trusted device of this browser', out.status === 200 && !!row?.revoked_at, JSON.stringify(row));
  ok('…and clears its cookie', /fm_device=;/.test(out.headers.get('set-cookie') || ''), out.headers.get('set-cookie'));
}

console.log('\n— Staff cannot process their own orders —');
{
  const admin = await person('admin');
  const p = await createProduct({ name: 'Auth Self', sku: `AUTH-S-${stamp}`, category: 'robux', price: 5000,
    currency: 'EUR', active: true, announce: false });
  const own = await createOrder({ consent: true, consentText: 'test', email: admin.email, userId: admin.id,
    items: [{ productId: p.id, quantity: 1 }] }, { actorId: admin.id });
  const paid = await call('POST', `/admin/orders/${own.id}/payment-received`, { paymentRef: 'x' }, admin.H);
  ok('an admin cannot mark their own unpaid order paid', paid.status === 403, `${paid.status}`);
  const tr = await call('POST', `/admin/orders/${own.id}/transition`, { to: 'payment_received' }, admin.H);
  ok('…nor move it there by transition', tr.status === 403, `${tr.status}`);
  const st = await get(`SELECT status FROM orders WHERE id=@id`, { id: own.id });
  ok('…and the order is still unpaid', st.status === 'pending', st.status);
  const ref = await call('POST', `/admin/orders/${own.id}/refund`, { method: 'credit' }, admin.H);
  ok('…nor refund it to their own wallet', ref.status === 403, `${ref.status}`);

  const buyer = await person(null);
  const other = await createOrder({ consent: true, consentText: 'test', email: buyer.email, userId: buyer.id,
    items: [{ productId: p.id, quantity: 1 }] }, { actorId: buyer.id });
  const okPaid = await call('POST', `/admin/orders/${other.id}/payment-received`, { paymentRef: 'manual-1' }, admin.H);
  ok('…while a customer\'s order still can be marked paid', okPaid.status === 200, `${okPaid.status} ${JSON.stringify(okPaid.body).slice(0, 120)}`);

  const owner = await person('owner');
  const ownerOrder = await createOrder({ consent: true, consentText: 'test', email: owner.email, userId: owner.id,
    items: [{ productId: p.id, quantity: 1 }] }, { actorId: owner.id });
  const op = await call('POST', `/admin/orders/${ownerOrder.id}/payment-received`, { paymentRef: 'owner' }, owner.H);
  ok('the owner may (it is their money)', op.status === 200, `${op.status}`);
}

console.log('\n— The orders CSV does not carry formulas —');
{
  const p = await createProduct({ name: 'Auth CSV', sku: `AUTH-C-${stamp}`, category: 'robux', price: 1000,
    currency: 'EUR', active: true, announce: false });
  const o = await createOrder({ consent: true, consentText: 'test', email: `csv-${stamp}@example.test`,
    items: [{ productId: p.id, quantity: 1 }] });
  await run(`UPDATE orders SET payment_ref=@r WHERE id=@id`, { r: '=HYPERLINK("https://evil.example","Verify")', id: o.id });
  const csv = await exportOrdersCsv({});
  const line = String(csv).split('\n').find((l) => l.includes(o.number)) || '';
  ok('a buyer value starting with = is exported as text', line.includes(`"'=HYPERLINK`) && !/,=HYPERLINK/.test(line), line.slice(0, 200));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} auth-audit-fixes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
