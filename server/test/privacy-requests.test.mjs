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

/* Everything else the schema holds about a person, one row each. */
const shotId = 'ab'.repeat(16);
await run(`INSERT INTO social_events (id, type, order_id, first_name, city, product_label, status, created_at)
           VALUES (@id, 'purchase', @o, 'Sam', 'Utrecht', '1,000 Robux', 'visible', @at) ON CONFLICT (order_id) DO NOTHING`,
  { id: newId('soc'), o: order.id, at: nowIso() });
await run(`INSERT INTO product_images (id, product_id, mime, bytes, byte_size, sha256, source, created_at)
           VALUES (@id, NULL, 'image/png', '\\x89504e47', 4, 'x', 'proof', @at)`, { id: shotId, at: nowIso() });
await run(`INSERT INTO payment_proofs (id, order_id, method, transaction_id, screenshot_url, note, amount, status, ip, created_at)
           VALUES (@id, @o, 'tikkie', 'TX-778', @shot, 'betaald door S. Jansen, NL91ABNA0417164300', 499, 'pending', '198.51.100.4', @at)`,
  { id: newId('prf'), o: order.id, shot: `/api/images/${shotId}`, at: nowIso() });
await run(`INSERT INTO gift_cards (id, code, initial_balance, balance, recipient_email, created_at)
           VALUES (@id, @c, 2500, 2500, @e, @at)`, { id: newId('gc'), c: `GIFT-${stamp}-WXYZ`, e: buyer.email, at: nowIso() });
await run(`INSERT INTO sms_verifications (id, phone, code_hash, ip, expires_at, created_at)
           VALUES (@id, '+31612345678', 'h', '198.51.100.4', @at, @at)`, { id: newId('sv'), at: nowIso() });
await run(`INSERT INTO daily_claims (id, user_id, day, streak_day, points, ip, created_at)
           VALUES (@id, @u, '2026-10-01', 1, 5, '198.51.100.4', @at)`, { id: newId('dc'), u: buyer.id, at: nowIso() });
const ticketId = newId('tkt');
await run(`INSERT INTO support_tickets (id, number, user_id, subject, created_at, updated_at)
           VALUES (@id, @n, @u, 'Waar blijft mijn code?', @at, @at)`, { id: ticketId, n: `T-${stamp}`, u: buyer.id, at: nowIso() });
await run(`INSERT INTO ticket_messages (id, ticket_id, author_id, author_kind, body, created_at)
           VALUES (@id, @t, @u, 'customer', 'Ik ben Sam Jansen uit Utrecht', @at)`, { id: newId('tm'), t: ticketId, u: buyer.id, at: nowIso() });
await run(`INSERT INTO referrals (code, user_id, created_at) VALUES (@c, @u, @at)`, { c: `SAMJA${stamp}`, u: buyer.id, at: nowIso() });
await run(`INSERT INTO audit_logs (id, actor_id, actor_email, action, created_at) VALUES (@id, @u, @e, 'order.cancel', @at)`,
  { id: newId('aud'), u: buyer.id, e: buyer.email, at: nowIso() });

console.log('\n— Export —');
{
  const r = await fetch(`${base}/export?email=${encodeURIComponent(buyer.email)}`, { headers: admin.H });
  const d = await r.json();
  ok('an admin who manages users can export', r.status === 200);
  ok('…the account, the order with its items, the wallet and the newsletter row',
    d.account?.email === buyer.email && d.orders?.[0]?.items?.length === 1 && d.walletLedger?.length >= 1 && d.newsletter?.length === 1);
  const text = JSON.stringify(d);
  ok('…and no secrets in it', !text.includes('JBSWY3DPEHPK3PXP') && !/refresh|code_hash|token_hash/.test(text));
  // Not the request's free text ('x'): the sentence the checkout shows (utils/consentWording.js).
  ok('…the waiver they agreed to, with each order', !!d.orders?.[0]?.consent_at && /^Ik wil mijn bestelling meteen geleverd/.test(d.orders[0].consent_text || ''));
  ok('…the payment proof they sent, without the image itself',
    d.paymentProofs?.length === 1 && d.paymentProofs[0].transaction_id === 'TX-778' && d.paymentProofs[0].screenshot_on_file === true
      && !text.includes('89504e47'));
  ok('…where they are signed in, their referral code and their check-ins',
    d.signedIn?.length >= 1 && d.referralCodes?.[0]?.code === `SAMJA${stamp}` && d.dailyCheckIns?.length === 1);
  ok('…a gift card sent to them, but not its code',
    d.giftCardsReceived?.length === 1 && d.giftCardsReceived[0].code_ends_with === 'WXYZ' && !text.includes(`GIFT-${stamp}`));
}

console.log('\n— Screenshots nobody will review —');
{
  /* An order that stopped waiting on its proof without the proof being
     confirmed or rejected — cancelled here; marked paid by hand is the same. */
  const { forgetStaleScreenshots } = await import('../src/services/paymentProofService.js');
  const other = await createOrder({ email: buyer.email, userId: buyer.id, items: [{ productId: product.id, quantity: 1 }],
    consent: true, consentText: 'x' });
  await run(`UPDATE orders SET status = 'cancelled' WHERE id = @id`, { id: other.id });
  const staleShot = 'cd'.repeat(16);
  await run(`INSERT INTO product_images (id, product_id, mime, bytes, byte_size, sha256, source, created_at)
             VALUES (@id, NULL, 'image/png', '\\x89504e47', 4, 'y', 'proof', @at)`, { id: staleShot, at: nowIso() });
  await run(`INSERT INTO payment_proofs (id, order_id, method, screenshot_url, amount, status, created_at)
             VALUES (@id, @o, 'tikkie', @shot, 999, 'pending', @at)`,
    { id: newId('prf'), o: other.id, shot: `/api/images/${staleShot}`, at: nowIso() });
  const n = await forgetStaleScreenshots();
  ok('a screenshot on a cancelled order is dropped by maintenance', n >= 1
    && !(await get('SELECT screenshot_url FROM payment_proofs WHERE order_id=@o', { o: other.id }))?.screenshot_url
    && !(await get('SELECT 1 FROM product_images WHERE id=@id', { id: staleShot })));
  ok('…while one still waiting for review on an open order stays',
    !!(await get('SELECT screenshot_url FROM payment_proofs WHERE order_id=@o', { o: order.id }))?.screenshot_url);
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
  ok('their first name and city are off the live feed',
    !(await get('SELECT 1 FROM social_events WHERE order_id=@o', { o: order.id })));
  const proof = await get('SELECT transaction_id, amount, screenshot_url, note, ip FROM payment_proofs WHERE order_id=@o', { o: order.id });
  ok('the payment proof stays as bookkeeping, without the screenshot, the note or the IP',
    proof?.transaction_id === 'TX-778' && proof.amount === 499 && !proof.screenshot_url && !proof.note && !proof.ip, JSON.stringify(proof));
  ok('…and the screenshot itself is deleted', !(await get('SELECT 1 FROM product_images WHERE id=@id', { id: shotId })));
  const card = await get('SELECT balance, recipient_email FROM gift_cards WHERE code=@c', { c: `GIFT-${stamp}-WXYZ` });
  ok('a gift card sent to them still works but no longer names them', card?.balance === 2500 && card.recipient_email === null, JSON.stringify(card));
  ok('the phone number SMS sign-in kept is gone',
    !(await get(`SELECT 1 FROM sms_verifications WHERE phone='+31612345678'`)));
  ok('check-ins keep their points but not their address',
    (await get('SELECT ip FROM daily_claims WHERE user_id=@u', { u: buyer.id }))?.ip === null);
  ok('support conversations are deleted',
    !(await get('SELECT 1 FROM support_tickets WHERE id=@t', { t: ticketId })) && !(await get('SELECT 1 FROM ticket_messages WHERE ticket_id=@t', { t: ticketId })));
  ok('the referral code made from their address is gone',
    !(await get('SELECT 1 FROM referrals WHERE code=@c', { c: `SAMJA${stamp}` })));
  ok('the security log keeps the row but not their address',
    !!(await get(`SELECT 1 FROM audit_logs WHERE actor_id=@u AND action='order.cancel'`, { u: buyer.id }))
      && !(await get('SELECT 1 FROM audit_logs WHERE lower(actor_email)=@e', { e: buyer.email })));
  const again = await (await fetch(`${base}/export?email=${encodeURIComponent(buyer.email)}`, { headers: admin.H })).json();
  ok('an export afterwards finds nothing under the old address', !again.account && !again.orders.length);
  const audited = await get(`SELECT metadata FROM audit_logs WHERE action='privacy.erase' ORDER BY created_at DESC LIMIT 1`);
  ok('the erase is audited without the erased address', !!audited && !String(audited.metadata).includes(buyer.email));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} privacy-requests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
