/**
 * Three ways in that skipped a factor.
 *
 * 1. THE 2FA TICKET WAS A LOGIN. It is signed with the access-token secret,
 *    and verifyAccess never looked at its `purpose`: sent as a Bearer token it
 *    opened /api/auth/me without the authenticator code.
 * 2. DISCORD/GOOGLE TOOK OVER ACCOUNTS BY EMAIL. An unverified provider email
 *    was linked to the account with that address — the owner's included — and
 *    the OAuth path signed in without the TOTP check.
 * 3. THE OTP LIMIT CAME AFTER THE CODE. Once "too many attempts" had been
 *    answered, a correct guess still signed in.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';
process.env.DISCORD_CLIENT_ID = 'test-discord-client';
process.env.DISCORD_CLIENT_SECRET = 'test-discord-secret';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const auth = await import('../src/services/authService.js');
const { handleOAuthCallback } = await import('../src/services/oauthService.js');
const { sha256 } = await import('../src/utils/crypto.js');

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const stamp = Date.now();
const user = async (email, { role = 'customer', totp = false } = {}) => {
  const id = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, email_verified, totp_secret, totp_enabled_at, created_at, updated_at)
             VALUES (@id, @e, 'U', 1, @s, @t, @at, @at)`,
    { id, e: email, s: totp ? 'JBSWY3DPEHPK3PXP' : null, t: totp ? nowIso() : null, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, @r, @at) ON CONFLICT DO NOTHING`, { u: id, r: role, at: nowIso() });
  return get('SELECT * FROM users WHERE id=@id', { id });
};

console.log('\n— The 2FA ticket is not a login —');
{
  const owner = await user(`owner-${stamp}@example.test`, { role: 'owner', totp: true });
  const ticket = auth.issueTotpTicket(owner);
  const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${ticket}` } });
  ok('the ticket alone does not open /api/auth/me', me.status === 401, String(me.status));
  const admin = await fetch(`${base}/api/admin/orders`, { headers: { authorization: `Bearer ${ticket}` } });
  ok('…nor the admin', admin.status === 401 || admin.status === 403, String(admin.status));
  ok('…while the ticket still works for its one purpose', (await auth.resolveTotpTicket(ticket).catch(() => null))?.id === owner.id);
  const s = await auth.finalizeLogin(owner, {});
  const real = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${s.accessToken}` } });
  ok('a real session token does', real.status === 200, String(real.status));
}

console.log('\n— Discord/Google sign-in —');
const realFetch = globalThis.fetch;
const asDiscord = (profile) => {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('discord.com/api/oauth2/token')) return new Response(JSON.stringify({ access_token: 'x', token_type: 'Bearer' }), { status: 200 });
    if (u.includes('discord.com/api/users/@me')) return new Response(JSON.stringify(profile), { status: 200 });
    return realFetch(url, init);
  };
};
{
  const ownerEmail = `boss-${stamp}@example.test`;
  await user(ownerEmail, { role: 'owner' });
  asDiscord({ id: `d1-${stamp}`, username: 'x', email: ownerEmail, verified: false });
  const r1 = await handleOAuthCallback('discord', 'code', {}).then(() => 'signed in', (e) => e.message);
  ok('an unverified provider email is refused', /not verified/.test(r1), r1);

  asDiscord({ id: `d2-${stamp}`, username: 'x', email: ownerEmail, verified: true });
  const r2 = await handleOAuthCallback('discord', 'code', {}).then(() => 'signed in', (e) => e.message);
  ok('a verified one is not linked to a staff account by email', /link this account/.test(r2), r2);

  const twoFa = `cust-${stamp}@example.test`;
  await user(twoFa, { totp: true });
  asDiscord({ id: `d3-${stamp}`, username: 'x', email: twoFa, verified: true });
  const r3 = await handleOAuthCallback('discord', 'code', {});
  ok('a 2FA customer is asked for the authenticator code, not signed in', r3.totpRequired === true && !r3.accessToken && !!r3.ticket);

  const plain = `plain-${stamp}@example.test`;
  asDiscord({ id: `d4-${stamp}`, username: 'x', email: plain, verified: true });
  const r4 = await handleOAuthCallback('discord', 'code', {});
  ok('a plain verified customer signs in as before', !!r4.accessToken);
  globalThis.fetch = realFetch;
}

console.log('\n— The OTP limit comes first —');
{
  const email = `otp-${stamp}@example.test`;
  const code = '123456';
  await run(`INSERT INTO otp_codes (id, email, code_hash, purpose, expires_at, created_at, attempts)
             VALUES (@id, @e, @h, 'login', @x, @at, 0)`,
    { id: newId('otp'), e: email, h: sha256(code), x: new Date(Date.now() + 600_000).toISOString(), at: nowIso() });
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push(await auth.verifyEmailOtp(email, '000000', {}).then(() => 200, (e) => e.status));
  ok('wrong guesses are refused, then locked', statuses.slice(0, 5).every((s) => s === 400) && statuses[5] === 429, statuses.join(','));
  const after = await auth.verifyEmailOtp(email, code, {}).then(() => 'signed in', (e) => e.status);
  ok('…and once locked, the right code no longer signs in', after !== 'signed in', String(after));
  const left = await get(`SELECT COUNT(*)::int AS n FROM otp_codes WHERE email=@e AND consumed_at IS NULL`, { e: email });
  ok('…because every live code was burned', left.n === 0);
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} auth-guards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
