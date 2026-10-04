/**
 * What the mail audit found, checked against the real send path.
 *
 *   the email log holds no login codes, and the admin log returns no context;
 *   every marketing mail carries RFC 8058 List-Unsubscribe headers and a
 *   signed link; opening that link only asks, the POST unsubscribes, and a
 *   suppressed address gets no more of that list;
 *   newsletters go only to people who said yes (opt-in, not opt-out), and so
 *   do cart reminders;
 *   the footer names the seller once the identity is filled in.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV = 'development';
process.env.LAUNCH_MODE = 'open';
process.env.RESEND_API_KEY = 're_test_key';
process.env.EMAIL_FROM_ADDRESS = 'shop@forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
  }
  return realFetch(url, init);
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { finalizeLogin, requestEmailOtp } = await import('../src/services/authService.js');
const mail = await import('../src/services/emailService.js');
const { broadcastRecipients } = await import('../src/services/broadcastService.js');
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const stamp = Date.now();
const settle = () => new Promise((r) => setTimeout(r, 300));

console.log('\n— The log holds no secrets —');
{
  const email = `otp-${stamp}@example.test`;
  await requestEmailOtp(email, {}).catch(() => {});
  await settle();
  const row = await get(`SELECT context FROM email_log WHERE to_email=@e AND template_id='login_otp' ORDER BY created_at DESC LIMIT 1`, { e: email });
  const code = (sent.find((m) => m.to?.includes?.(email) || m.to === email)?.text || '').match(/\b\d{6}\b/)?.[0];
  ok('a login code is sent…', !!code, JSON.stringify(sent.at(-1) || {}).slice(0, 120));
  ok('…and not stored in the email log', row && !String(row.context || '').includes(code || 'zzzz'), String(row?.context).slice(0, 120));

  const ownerId = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`, { id: ownerId, e: `own-${stamp}@example.test`, at: nowIso() });
  await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at)`, { u: ownerId, at: nowIso() });
  const { accessToken } = await finalizeLogin(await get('SELECT * FROM users WHERE id=@id', { id: ownerId }), {});
  const log = await (await fetch(`${base}/api/admin/emails/log`, { headers: { authorization: `Bearer ${accessToken}` } })).json();
  ok('the admin email log returns no context at all', Array.isArray(log.log) && log.log.length > 0 && log.log.every((r) => !('context' in r)));
}

console.log('\n— Unsubscribing —');
{
  const email = `news-${stamp}@example.test`;
  sent.length = 0;
  await mail.sendEmail('launch_announcement', email, { lang: 'de' });
  await settle();
  const m = sent.find((x) => (Array.isArray(x.to) ? x.to : [x.to]).includes(email));
  ok('a marketing mail carries List-Unsubscribe and the one-click header', !!m?.headers?.['List-Unsubscribe'] && m.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click',
    JSON.stringify(m?.headers || {}));
  const link = mail.unsubscribeUrl(email, 'marketing');
  ok('…and the same signed link is in the mail itself', !!m && m.html.includes(link.replace(/&/g, '&amp;')) || m?.html.includes(link));
  const path = link.replace(/^https?:\/\/[^/]+/, '');
  const page = await fetch(`${base}${path}&lang=de`);
  ok('opening the link only asks', page.status === 200 && /Ja, abmelden/.test(await page.text()) && !(await mail.isSuppressed(email, 'marketing')));
  const forged = await fetch(`${base}${path.replace(/t=[0-9a-f]+/, 't=' + '0'.repeat(32))}`, { method: 'POST' });
  ok('a forged token changes nothing', forged.status === 200 && !(await mail.isSuppressed(email, 'marketing')));
  const done = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  ok('the POST unsubscribes (one click from the mail client works too)', done.status === 200 && await mail.isSuppressed(email, 'marketing'));
  sent.length = 0;
  await mail.sendEmail('launch_announcement', email, { lang: 'de' });
  await settle();
  ok('…after which that list sends nothing to the address', !sent.some((x) => (Array.isArray(x.to) ? x.to : [x.to]).includes(email)));
}

console.log('\n— Consent first —');
{
  const mk = async (prefs) => {
    const id = newId('usr');
    const e = `${id}@example.test`.toLowerCase();
    await run(`INSERT INTO users (id, email, display_name, preferences, created_at, updated_at) VALUES (@id, @e, 'U', @p, @at, @at)`,
      { id, e, p: JSON.stringify(prefs), at: nowIso() });
    return e;
  };
  const yes = await mk({ emailMarketing: true });
  const unset = await mk({});
  const no = await mk({ emailMarketing: false });
  const list = (await broadcastRecipients()).map((r) => r.email);
  ok('a newsletter goes to the account that said yes', list.includes(yes));
  ok('…not to one that never said anything (opt-in, not opt-out)', !list.includes(unset));
  ok('…nor to one that said no', !list.includes(no));

  const { sendCartReminders } = await import('../src/services/cartService.js');
  const cartFor = async (email) => {
    const u = await get('SELECT id FROM users WHERE email=@e', { e: email });
    const old = new Date(Date.now() - 6 * 3_600_000).toISOString();
    await run(`INSERT INTO saved_carts (user_id, items, updated_at) VALUES (@u, @i, @at)
               ON CONFLICT (user_id) DO UPDATE SET items=@i, updated_at=@at, reminded_at=NULL`,
      { u: u.id, i: JSON.stringify([{ productId: 'x', name: 'Card', quantity: 1, price: 999 }]), at: old });
  };
  await cartFor(yes); await cartFor(unset);
  sent.length = 0;
  await sendCartReminders({ afterHours: 4 }).catch((e) => console.log('cart err', e.message));
  await settle();
  const to = sent.flatMap((x) => (Array.isArray(x.to) ? x.to : [x.to]));
  ok('a cart reminder only reaches someone who agreed to marketing', to.includes(yes) && !to.includes(unset), to.join(','));
}

console.log('\n— Who is sending —');
{
  const { setSellerIdentity } = await import('../src/services/sellerIdentityService.js');
  await setSellerIdentity({ legalName: 'ForgeMarket Test BV', address: 'Teststraat 1, 1234 AB Utrecht', kvk: '12345678', vat: 'NL123456789B01' }).catch((e) => console.log('identity', e.message));
  sent.length = 0;
  await mail.sendEmail('account_created', `who-${stamp}@example.test`, { lang: 'en', user: { name: 'Sam' } });
  await settle();
  const html = sent.at(-1)?.html || '';
  ok('the footer names the seller once the identity is set', /ForgeMarket Test BV/.test(html) && /12345678/.test(html), html.slice(-600).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
}

console.log('\n— No delivery time the shop cannot back —');
{
  const fs = await import('node:fs');
  const src = (f) => fs.readFileSync(new URL(`../src/services/${f}`, import.meta.url), 'utf8');
  const current = src('defaultTemplates.js').split('export const LEGACY_TEMPLATE_BODIES')[0]
    + src('templateTranslations.js') + src('emailCopy.js') + src('assistantService.js');
  const claim = /(within|binnen|innerhalb|en)\s+(a few|een paar|weniger|quelques)\s+(hours|uur|Stunden|heures|minutes|minuten|Minuten)/i;
  ok('mails and the assistant promise no "within a few hours/minutes"', !claim.test(current), (current.match(claim) || [''])[0]);
}

srv.close();
globalThis.fetch = realFetch;
console.log(`\n${fail ? '❌' : '✅'} mail-compliance: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
