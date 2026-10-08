import './_selling-shop.mjs';   // must come first — see that file
/**
 * Two account-security holes, each pinned so it stays closed.
 *
 * 1. CONNECTING DISCORD WAS NOT BOUND TO A BROWSER. The link state resolved to
 *    the account that started it — but anybody could finish it. Start a link
 *    on your own account, send the Discord consent URL to someone else, and
 *    when they approved, THEIR Discord was attached to YOUR account. The state
 *    now has to come back to the browser that started the link, in a cookie
 *    scoped to the callback. (And starting a link works at all now: the account
 *    page navigates there, and a navigation carries no bearer token.)
 * 2. AN AUTHENTICATOR CODE WORKED MORE THAN ONCE, AND A 2FA LOGIN TICKET TOOK
 *    UNLIMITED GUESSES. A code is spent the moment it is accepted, wherever a
 *    code is checked; a ticket survives five wrong codes and signs in once.
 */
/* Linking needs a configured Discord client, and config/env.js reads the
   environment once at import — so the app is loaded below, after these. */
process.env.DISCORD_CLIENT_ID = 'test-discord-client';
process.env.DISCORD_CLIENT_SECRET = 'test-discord-secret';
delete process.env.DISCORD_BOT_TOKEN;   // role sync stays offline: "not configured"

const { ensureReady, createApp } = await import('../src/app.js');
const { get, run, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { config } = await import('../src/config/env.js');
const auth = await import('../src/services/authService.js');
const { totpCode, matchTotpStep, verifyTotp, generateTotpSecret } = await import('../src/utils/totp.js');
const jwt = (await import('jsonwebtoken')).default;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const stamp = Date.now();

/* Discord, stubbed: the token exchange and the profile read. Everything else —
   including this test's own calls to the API — goes to the real fetch. */
const realFetch = globalThis.fetch;
let discordCalls = 0;
let discordProfile = { id: `uid_${stamp}`, username: 'someone' };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://discord.com/')) {
    discordCalls++;
    if (u.includes('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer' }), { status: 200 });
    if (u.endsWith('/users/@me')) return new Response(JSON.stringify(discordProfile), { status: 200 });
    return new Response('{}', { status: 404 });
  }
  return realFetch(url, init);
};

const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

const makeUser = async ({ totp = false } = {}) => {
  const id = newId('usr');
  const secret = totp ? generateTotpSecret() : null;
  await run(`INSERT INTO users (id, email, display_name, email_verified, totp_secret, totp_enabled_at, created_at, updated_at)
             VALUES (@id, @e, 'U', 1, @s, @t, @at, @at)`,
    { id, e: `${id.toLowerCase()}@example.test`, s: secret, t: totp ? nowIso() : null, at: nowIso() });
  return { user: await get('SELECT * FROM users WHERE id=@id', { id }), secret };
};
const signIn = (user) => auth.finalizeLogin(user, {});

// A navigation: no bearer token unless asked for, cookies as given, 302s not followed.
const nav = (path, { cookie, bearer } = {}) => fetch(`${base}${path}`, {
  redirect: 'manual',
  headers: { ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
});
const setCookie = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) || '';
const cookieValue = (header) => header.split(';')[0].split('=').slice(1).join('=');

/* Every POST from its own address: /totp/login sits behind a per-IP limiter of
   five a minute, and what is under test here is the ticket's OWN limit — which
   is exactly the one that must hold when the address changes. */
let ipSeq = 0;
const nextIp = () => { ipSeq++; return `203.0.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`; };
const post = async (path, body, { bearer } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, message: json?.error?.message || '' };
};

/* Codes are generated for "now" and "the next step", and checked a moment
   later by the server. Started too close to a step boundary, "now" could age
   out of the window in between; so each block that relies on the step starts
   well inside one. */
async function freshStep() {
  const into = Date.now() % 30_000;
  if (into > 20_000) await new Promise((r) => setTimeout(r, 30_000 - into + 300));
}
const code = (secret, steps = 0) => totpCode(secret, { at: Date.now() + steps * 30_000 });
const wrongCode = (secret) => {
  const good = new Set([-1, 0, 1].map((s) => code(secret, s)));
  for (let n = 0; ; n++) { const c = String((123456 + n * 7919) % 1_000_000).padStart(6, '0'); if (!good.has(c)) return c; }
};
const ticketRow = (ticket) => get('SELECT * FROM totp_tickets WHERE id=@id', { id: jwt.decode(ticket).jti });

// ── 1. Connecting Discord ────────────────────────────────────────────────────
console.log('— Starting a link is a navigation —');
const LINK = '/api/auth/oauth/discord/link';
const { user: attacker } = await makeUser();
const attackerSession = await signIn(attacker);
const attackerCookie = `fm_session=${attackerSession.refreshToken}`;
const stateOf = (res) => new URL(res.headers.get('location') || 'http://x/').searchParams.get('state') || '';
let attackerState = '';
{
  const res = await nav(`${LINK}/start`, { cookie: attackerCookie });
  const loc = res.headers.get('location') || '';
  ok('the account page\'s navigation (session cookie, no bearer) reaches Discord',
    res.status === 302 && loc.startsWith('https://discord.com/api/oauth2/authorize'), `${res.status} ${loc}`);
  const state = stateOf(res);
  const sc = setCookie(res, 'oauth_state_discord_link');
  ok('…and binds the state to this browser in a cookie', !!state && cookieValue(sc) === state && state.length >= 32, sc);
  ok('…httpOnly, Lax, scoped to the callback path, ten minutes',
    /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Path=\/api\/auth\/oauth\/discord\/link\/callback(;|$)/.test(sc)
      && /Max-Age=600/.test(sc), sc);
  ok('…not Secure in development (http://localhost has to work)', !!sc && !/;\s*Secure/i.test(sc), sc);
  const intent = await get('SELECT user_id FROM oauth_link_intents WHERE state=@s', { s: state });
  ok('the intent is recorded for the account that started it', intent?.user_id === attacker.id);
}
{
  /* The attack below starts the way it always could: with a bearer token. That
     path worked before this fix too, so the attack is real either way. */
  const bearer = await nav(`${LINK}/start`, { bearer: attackerSession.accessToken });
  attackerState = stateOf(bearer);
  ok('a bearer token (API clients) still starts a link',
    bearer.status === 302 && /discord\.com/.test(bearer.headers.get('location') || '') && !!attackerState);
  ok('…and gets the same browser binding', cookieValue(setCookie(bearer, 'oauth_state_discord_link')) === attackerState);

  const anon = await nav(`${LINK}/start`);
  const loc = anon.headers.get('location') || '';
  const body = await anon.text();
  ok('signed out: back to the account page with a reason, not a JSON 401',
    anon.status === 302 && /\/account\/profile\?discord=failed&reason=/.test(loc) && !/"error"\s*:/.test(body), `${anon.status} ${loc}`);

  const { user: gone } = await makeUser();
  const goneSession = await signIn(gone);
  await auth.revokeSession(goneSession.refreshToken.split('.')[0]);
  const revoked = await nav(`${LINK}/start`, { cookie: `fm_session=${goneSession.refreshToken}` });
  ok('a revoked session cookie counts as signed out', /discord=failed/.test(revoked.headers.get('location') || ''));

  const { user: other } = await makeUser();
  const otherSession = await signIn(other);
  const [sid] = otherSession.refreshToken.split('.');
  const forged = await nav(`${LINK}/start`, { cookie: `fm_session=${sid}.${'0'.repeat(64)}` });
  ok('a session cookie with the wrong secret counts as signed out', /discord=failed/.test(forged.headers.get('location') || ''));
  const still = await get('SELECT revoked_at FROM sessions WHERE id=@id', { id: sid });
  ok('…without revoking the real session (a read-only check is no theft detector)', still && !still.revoked_at);

  const wasProd = config.isProd;
  config.isProd = true;
  const prod = await nav(`${LINK}/start`, { bearer: attackerSession.accessToken });
  config.isProd = wasProd;
  ok('in production the state cookie is Secure', /;\s*Secure/i.test(setCookie(prod, 'oauth_state_discord_link')));
}

console.log('— The state has to come back to the browser that started it —');
{
  const victimUid = `uid_victim_${stamp}`;
  discordProfile = { id: victimUid, username: 'victim' };
  const before = discordCalls;
  // The victim approved the attacker's consent URL; Discord sends THEIR browser back.
  const res = await nav(`${LINK}/callback?code=victim-code&state=${attackerState}`);
  const loc = res.headers.get('location') || '';
  ok('a state from another browser is refused', res.status === 302 && /discord=failed/.test(loc), loc);
  ok('…before any token exchange with Discord', discordCalls === before, `${discordCalls - before} calls`);
  const linked = await get("SELECT user_id FROM oauth_accounts WHERE provider='discord' AND provider_uid=@u", { u: victimUid });
  ok('…so the victim\'s Discord is attached to nobody', !linked);
  ok('…and the intent is not spent by it', !!(await get('SELECT 1 AS x FROM oauth_link_intents WHERE state=@s', { s: attackerState })));

  // The victim had a link of their own going: their cookie, a different state.
  const { user: victim } = await makeUser();
  const vStart = await nav(`${LINK}/start`, { cookie: `fm_session=${(await signIn(victim)).refreshToken}` });
  const victimCookie = `oauth_state_discord_link=${cookieValue(setCookie(vStart, 'oauth_state_discord_link'))}`;
  const crossed = await nav(`${LINK}/callback?code=victim-code&state=${attackerState}`, { cookie: victimCookie });
  ok('a browser\'s own pending link does not vouch for someone else\'s state',
    /discord=failed/.test(crossed.headers.get('location') || '') && discordCalls === before);

  const tweaked = attackerState.slice(0, -1) + (attackerState.endsWith('0') ? '1' : '0');
  const near = await nav(`${LINK}/callback?code=c&state=${tweaked}`, { cookie: `oauth_state_discord_link=${attackerState}` });
  ok('one character off is refused', /discord=failed/.test(near.headers.get('location') || '') && discordCalls === before);

  const twice = await nav(`${LINK}/callback?code=c&state=${attackerState}&state=${attackerState}`,
    { cookie: `oauth_state_discord_link=${attackerState}` });
  ok('a repeated state parameter is refused', /discord=failed/.test(twice.headers.get('location') || '') && discordCalls === before);

  const none = await nav(`${LINK}/callback?code=c`, { cookie: `oauth_state_discord_link=${attackerState}` });
  ok('no state at all is refused', /discord=failed/.test(none.headers.get('location') || '') && discordCalls === before);
}
{
  // The browser that started the link finishes it — with its own Discord.
  const ownUid = `uid_attacker_${stamp}`;
  discordProfile = { id: ownUid, username: 'own' };
  const res = await nav(`${LINK}/callback?code=own-code&state=${attackerState}`, { cookie: `oauth_state_discord_link=${attackerState}` });
  const loc = res.headers.get('location') || '';
  ok('the browser that started the link can finish it', res.status === 302 && /discord=linked/.test(loc), loc);
  const row = await get("SELECT user_id FROM oauth_accounts WHERE provider='discord' AND provider_uid=@u", { u: ownUid });
  ok('…attaching the Discord account to the account that started it', row?.user_id === attacker.id);
  const cleared = setCookie(res, 'oauth_state_discord_link');
  ok('…and clears the state cookie on the same path',
    /Expires=Thu, 01 Jan 1970/i.test(cleared) && /Path=\/api\/auth\/oauth\/discord\/link\/callback/.test(cleared), cleared);
  const again = await nav(`${LINK}/callback?code=own-code&state=${attackerState}`, { cookie: `oauth_state_discord_link=${attackerState}` });
  ok('replaying the finished callback is refused (the intent is single-use)', /discord=failed/.test(again.headers.get('location') || ''));
}

// ── 2. Authenticator codes ───────────────────────────────────────────────────
console.log('— A code belongs to a time-step —');
{
  const secret = generateTotpSecret();
  await freshStep();
  const step = matchTotpStep(secret, code(secret));
  const now = Math.floor(Date.now() / 30_000);
  ok('the current code matches the current step', step === now, `${step} vs ${now}`);
  ok('…and nothing at or before `after`', matchTotpStep(secret, code(secret), { after: step }) === null);
  ok('the next step is still inside the drift window', matchTotpStep(secret, code(secret, 1)) === step + 1);
  ok('two steps ahead is not', matchTotpStep(secret, code(secret, 2)) === null);
  ok('verifyTotp keeps its yes/no answer', verifyTotp(secret, code(secret)) === true && verifyTotp(secret, wrongCode(secret)) === false);
  ok('garbage is simply no', matchTotpStep(secret, 'abc') === null && matchTotpStep(secret, '1234567') === null);
}

console.log('— Enabling and disabling: a code works once —');
{
  const { user } = await makeUser();
  const { accessToken } = await signIn(user);
  const setup = await post('/api/auth/totp/setup', {}, { bearer: accessToken });
  const secret = setup.json?.secret;
  await freshStep();
  const now = code(secret);
  const en = await post('/api/auth/totp/enable', { code: now }, { bearer: accessToken });
  ok('2FA turns on with the first code', en.status === 200 && en.json?.enabled === true, JSON.stringify(en.json));
  const row = await get('SELECT totp_last_step FROM users WHERE id=@id', { id: user.id });
  ok('…and that code is recorded as used', row?.totp_last_step === Math.floor(Date.now() / 30_000), JSON.stringify(row));

  const replay = await post('/api/auth/totp/disable', { code: now }, { bearer: accessToken });
  ok('the same code cannot switch it straight off again', replay.status === 400 && /already used/.test(replay.message), `${replay.status} ${replay.message}`);
  ok('…so 2FA is still on', !!(await get('SELECT totp_enabled_at FROM users WHERE id=@id', { id: user.id }))?.totp_enabled_at);

  const off = await post('/api/auth/totp/disable', { code: code(secret, 1) }, { bearer: accessToken });
  ok('the next code does', off.status === 200 && off.json?.enabled === false, JSON.stringify(off.json));
  const after = await get('SELECT totp_secret, totp_enabled_at, totp_last_step FROM users WHERE id=@id', { id: user.id });
  ok('…clearing the secret and its last step', !after.totp_secret && !after.totp_enabled_at && after.totp_last_step == null, JSON.stringify(after));
}
{
  // A double-submitted "Enable" used to promote NULL over the secret it had just activated.
  const { user } = await makeUser();
  const { accessToken } = await signIn(user);
  const setup = await post('/api/auth/totp/setup', {}, { bearer: accessToken });
  await freshStep();
  const c = code(setup.json.secret);
  const burst = await Promise.all([1, 2, 3, 4].map(() => post('/api/auth/totp/enable', { code: c }, { bearer: accessToken })));
  const row = await get('SELECT totp_secret, totp_enabled_at, totp_pending_secret FROM users WHERE id=@id', { id: user.id });
  ok('a multiply-submitted enable keeps the secret it activated',
    row.totp_secret === setup.json.secret && !!row.totp_enabled_at && !row.totp_pending_secret, JSON.stringify(row));
  /* Which answer the later ones get depends on timing: read before the first
     commit, they see 2FA on and say so; read after, the setup is simply over. */
  ok('…one of them enabled it, and none claims anything untrue',
    burst.some((r) => r.status === 200 && r.json?.enabled === true)
      && burst.every((r) => (r.status === 200 && r.json?.enabled === true) || (r.status === 400 && /setup first/.test(r.message))),
    burst.map((r) => `${r.status} ${r.message}`).join(' | '));
}
{
  // Guessing the code that switches 2FA off, from a stolen session.
  const { user, secret } = await makeUser({ totp: true });
  const { accessToken } = await signIn(user);
  const tries = [];
  for (let i = 0; i < 6; i++) tries.push(await post('/api/auth/totp/disable', { code: wrongCode(secret) }, { bearer: accessToken }));
  ok('wrong codes to switch 2FA off are refused', tries.slice(0, 5).every((r) => r.status === 400));
  ok('…and the sixth in a minute is not even checked', tries[5].status === 429, String(tries[5].status));
}

console.log('— Signing in with a ticket —');
{
  const { user, secret } = await makeUser({ totp: true });
  await freshStep();
  const now = code(secret);
  const t1 = auth.issueTotpTicket(user);
  const first = await post('/api/auth/totp/login', { ticket: t1, code: now });
  ok('a ticket and the current code sign in', first.status === 200 && !!first.json?.accessToken, `${first.status} ${first.message}`);

  const t2 = auth.issueTotpTicket(user);
  const replay = await post('/api/auth/totp/login', { ticket: t2, code: now });
  ok('the same code cannot sign in a second time', replay.status === 400 && /already used/.test(replay.message), `${replay.status} ${replay.message}`);
  ok('…and the try counts against the ticket', (await ticketRow(t2))?.attempts === 1);
  const next = await post('/api/auth/totp/login', { ticket: t2, code: code(secret, 1) });
  ok('the next code does', next.status === 200 && !!next.json?.accessToken, `${next.status} ${next.message}`);

  const reuseTicket = await post('/api/auth/totp/login', { ticket: t2, code: code(secret, 1) });
  ok('a ticket signs in once', reuseTicket.status === 401, `${reuseTicket.status} ${reuseTicket.message}`);
  const oldTicket = await post('/api/auth/totp/login', { ticket: t1, code: code(secret, 1) });
  ok('…including the first one', oldTicket.status === 401, `${oldTicket.status} ${oldTicket.message}`);
}
{
  // What regression.test.mjs used to do: enable, then sign in with the same code.
  const { user } = await makeUser();
  const { accessToken } = await signIn(user);
  const setup = await post('/api/auth/totp/setup', {}, { bearer: accessToken });
  await freshStep();
  const now = code(setup.json.secret);
  await post('/api/auth/totp/enable', { code: now }, { bearer: accessToken });
  const reuse = await post('/api/auth/totp/login', { ticket: auth.issueTotpTicket(user), code: now });
  ok('the code that switched 2FA on cannot also sign in', reuse.status === 400 && /already used/.test(reuse.message), `${reuse.status} ${reuse.message}`);
}

console.log('— Five wrong codes end a ticket —');
{
  const { user, secret } = await makeUser({ totp: true });
  await freshStep();
  const ticket = auth.issueTotpTicket(user);
  const answers = [];
  for (let i = 0; i < 5; i++) answers.push(await post('/api/auth/totp/login', { ticket, code: wrongCode(secret) }));
  ok('four wrong codes are just wrong', answers.slice(0, 4).every((a) => a.status === 400 && /Incorrect/.test(a.message)),
    answers.map((a) => a.status).join(','));
  ok('the fifth ends the ticket (401: start over)', answers[4].status === 401, `${answers[4].status} ${answers[4].message}`);
  const right = await post('/api/auth/totp/login', { ticket, code: code(secret) });
  ok('after that even the right code is refused', right.status === 401, `${right.status} ${right.message}`);
  const row = await get('SELECT totp_last_step FROM users WHERE id=@id', { id: user.id });
  ok('…and is not spent by the refusal (the ticket is checked first)', row.totp_last_step == null, JSON.stringify(row));
  ok('a used-up ticket is refused for its one purpose too',
    (await auth.resolveTotpTicket(ticket).then(() => 'resolved', (e) => e.status)) === 401);
  ok('running out is in the audit log',
    !!(await get("SELECT 1 AS x FROM audit_logs WHERE action='auth.totp_ticket_exhausted' AND actor_id=@u", { u: user.id }).catch(() => null)));
  const fresh = await post('/api/auth/totp/login', { ticket: auth.issueTotpTicket(user), code: code(secret) });
  ok('signing in again from the start works', fresh.status === 200 && !!fresh.json?.accessToken, `${fresh.status} ${fresh.message}`);
}
{
  const { user, secret } = await makeUser({ totp: true });
  await freshStep();
  const ticket = auth.issueTotpTicket(user);
  await post('/api/auth/totp/login', { ticket, code: wrongCode(secret) });
  await post('/api/auth/totp/login', { ticket, code: wrongCode(secret) });
  const r = await post('/api/auth/totp/login', { ticket, code: code(secret) });
  ok('a typo or two is fine: the right code still signs in', r.status === 200 && !!r.json?.accessToken, `${r.status} ${r.message}`);
}

console.log('— Racing requests get no extra guesses —');
{
  const { user, secret } = await makeUser({ totp: true });
  await freshStep();
  const ticket = auth.issueTotpTicket(user);
  const burst = await Promise.all(Array.from({ length: 8 }, () => post('/api/auth/totp/login', { ticket, code: wrongCode(secret) })));
  const s400 = burst.filter((r) => r.status === 400).length;
  const s401 = burst.filter((r) => r.status === 401).length;
  ok('eight parallel guesses on one ticket: five are checked, four of them answered "wrong"', s400 === 4 && s401 === 4,
    burst.map((r) => r.status).join(','));
  ok('…and the ticket counted exactly five', (await ticketRow(ticket))?.attempts === 5);
}
{
  const { user, secret } = await makeUser({ totp: true });
  await freshStep();
  const now = code(secret);
  const pair = await Promise.all([1, 2].map(() => post('/api/auth/totp/login', { ticket: auth.issueTotpTicket(user), code: now })));
  ok('one code on two tickets at once signs in exactly once',
    pair.filter((r) => r.status === 200).length === 1 && pair.filter((r) => r.status === 400 && /already used/.test(r.message)).length === 1,
    pair.map((r) => `${r.status} ${r.message}`).join(' | '));
}

console.log('— What a ticket is, and is not —');
{
  const { user, secret } = await makeUser({ totp: true });
  ok('a fresh ticket still resolves to its user', (await auth.resolveTotpTicket(auth.issueTotpTicket(user)).catch(() => null))?.id === user.id);
  ok('a ticket carries an id of its own', typeof jwt.decode(auth.issueTotpTicket(user)).jti === 'string');
  const legacy = jwt.sign({ sub: user.id, purpose: 'totp' }, config.auth.jwtSecret, { expiresIn: '5m', audience: 'totp-ticket' });
  const r = await post('/api/auth/totp/login', { ticket: legacy, code: '123456' });
  ok('a ticket without an id (no counter to keep) is refused', r.status === 401, `${r.status} ${r.message}`);
  const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${auth.issueTotpTicket(user)}` } });
  ok('…and a ticket is still no login', me.status === 401);
  await run(`INSERT INTO totp_tickets (id, user_id, attempts, expires_at, created_at) VALUES (@id, @u, 0, @exp, @at)`,
    { id: `old_${stamp}`, u: user.id, exp: new Date(Date.now() - 2 * 3_600_000).toISOString(), at: nowIso() });
  await post('/api/auth/totp/login', { ticket: auth.issueTotpTicket(user), code: wrongCode(secret) });
  ok('long-expired ticket rows are cleared as new attempts come in', !(await get('SELECT 1 AS x FROM totp_tickets WHERE id=@id', { id: `old_${stamp}` })));
}

globalThis.fetch = realFetch;
srv.close();
console.log(`\n✅ auth-hardening: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
