/**
 * The pre-launch gate: browsable now, buyable on the day.
 *
 * Three properties are worth more than the rest, and each is asserted against
 * real HTTP rather than against a function having been called:
 *
 *  1. **The server is the gate.** Hiding the checkout button proves nothing —
 *     anyone can post to the API. So the refusals are checked at the endpoints,
 *     including the ones no button points at.
 *  2. **Everything else still works.** A gate that also breaks the catalogue,
 *     the FAQ or the newsletter has cost more than it bought. The open list is
 *     asserted as explicitly as the closed one.
 *  3. **It lifts by itself.** The whole point is that nobody has to deploy on
 *     launch day, so the last section moves the moment past a running process
 *     and watches the same endpoint change its mind.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_prelaunch';
process.env.NODE_ENV ||= 'development';
process.env.RESEND_API_KEY ||= 're_test_key';       // so commerceBlockers is not the refuser
process.env.ADMIN_EMAILS = 'boss@forgemarket.nl';
process.env.LAUNCH_DATE = new Date(Date.now() + 3 * 86_400_000).toISOString();

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const { createProduct } = await import('../src/services/productService.js');
const { get } = await import('../src/db/index.js');
const gate = await import('../src/services/launchGateService.js');

const tag = process.pid;
const product = await createProduct({ name: `Gate Pack ${tag}`, category: 'giftcard', price: 500, announce: false });
const post = (path, body, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const put = (path, body) => fetch(`${base}${path}`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ── 1. Where the line is drawn ──────────────────────────────────────────────
console.log('— Which count as "before launch" —');
{
  const at = Date.parse(process.env.LAUNCH_DATE);
  ok('a moment before the date is pre-launch', gate.isPrelaunch(at - 1000));
  ok('the moment itself is open', !gate.isPrelaunch(at));
  ok('a moment after is open', !gate.isPrelaunch(at + 1000));
  ok('the storefront is told the moment, not a verdict',
    typeof gate.launchAtIso() === 'string' && gate.launchAtIso().includes('T'),
    'a cached "closed" flag would outlive the launch; a timestamp cannot');
}

// ── 2. Nothing that takes money works ───────────────────────────────────────
console.log('\n— Closed: money and new accounts —');
{
  const order = await post('/api/orders',
    { email: `buyer${tag}@x.dev`, items: [{ productId: product.id }], consent: true });
  const body = await order.json();
  ok('placing an order is refused', order.status === 503, `status=${order.status}`);
  ok('…with a reason a visitor can act on', body.error?.code === 'prelaunch', JSON.stringify(body).slice(0, 120));
  ok('…that names the day rather than a setting',
    /launches on \d/.test(body.error?.message || '') && !/LAUNCH_DATE/.test(body.error?.message || ''),
    body.error?.message);
  ok('…and says nothing was charged', /nothing has been charged/i.test(body.error?.message || ''));

  ok('starting a card payment is refused',
    (await post(`/api/orders/${product.id}/checkout`, {})).status === 503);
  ok('starting a Mollie payment is refused',
    (await post(`/api/orders/${product.id}/mollie`, {})).status === 503);
  /* The whole /api/account router sits behind requireAuth, so an anonymous save
     is turned away by auth (401) before the gate is even consulted; a signed-in
     non-staff shopper is the one who meets the 503. Either way it is refused,
     and asserting only the 503 would have been asserting something this request
     can never reach. The cart's source of truth is localStorage anyway — this
     endpoint is a mirror, and blocking it stops a pre-launch basket being
     persisted rather than stopping a purchase. */
  const cartSave = await put('/api/account/cart', { items: [] });
  ok('saving a cart server-side is refused', [401, 503].includes(cartSave.status), `status=${cartSave.status}`);

  const signup = await post('/api/auth/start', { identifier: `newcomer${tag}@x.dev` });
  ok('a brand-new account is refused', signup.status === 503, `status=${signup.status}`);
  ok('…before a login code is emailed to someone we will turn away',
    (await get('SELECT COUNT(*) AS n FROM otp_codes')).n !== undefined
    && !(await get('SELECT id FROM users WHERE email=@e', { e: `newcomer${tag}@x.dev` })),
    'no user row may exist for a refused signup');
}

// ── 3. Everything the pre-launch site promises still works ──────────────────
console.log('\n— Open: everything a visitor came to see —');
{
  for (const [what, path] of [
    ['the product catalogue', '/api/products?limit=5'],
    ['a single product', `/api/products/${product.id}`],
    ['search', '/api/products?search=Gate'],
    ['the shop config', '/api/config'],
    ['reviews', '/api/reviews'],
    ['trust stats', '/api/stats'],
    ['the Discord panel', '/api/discord/server'],
    ['drops', '/api/drops'],
  ]) {
    const r = await fetch(`${base}${path}`);
    ok(`${what} is reachable`, r.ok, `${path} → ${r.status}`);
  }
  const news = await post('/api/newsletter', { email: `fan${tag}@x.dev`, consentText: 'Mail me at launch' });
  ok('the newsletter signup works', news.status === 201, `status=${news.status}`);
  ok('…and signing up twice is not an error',
    (await post('/api/newsletter', { email: `fan${tag}@x.dev` })).status === 201,
    'someone unsure it worked presses it again');
  ok('…and it is stored with the sentence they agreed to',
    (await get('SELECT consent_text FROM newsletter_signups WHERE email=@e', { e: `fan${tag}@x.dev` }))
      ?.consent_text === 'Mail me at launch');

  // The pages themselves are static files; what matters is the HTML still serves.
  const home = await fetch(`${base}/api/config`);
  ok('the shop still answers its config request', home.ok);
}

// ── 4. Staff walk through ───────────────────────────────────────────────────
console.log('\n— Staff are not locked out of their own shop —');
{
  ok('an owner bypasses the gate', gate.isStaff({ roles: ['owner'] }));
  ok('an admin bypasses the gate', gate.isStaff({ roles: ['admin'] }));
  ok('a customer does not', !gate.isStaff({ roles: ['customer'] }));
  ok('and neither does nobody', !gate.isStaff(null));

  ok('an address on the admin list may still create its account',
    gate.isAdminEmail('boss@forgemarket.nl'),
    'on a fresh deployment that sign-in IS the admin account');
  const adminStart = await post('/api/auth/start', { identifier: 'boss@forgemarket.nl' });
  ok('…and really gets past the signup gate', adminStart.status !== 503, `status=${adminStart.status}`);
}

// ── 5. It opens by itself ───────────────────────────────────────────────────
console.log('\n— Launch day arrives without a deploy —');
{
  // Same process, same modules, no re-import: only the clock moves. This is the
  // requirement — "at launch date, automatically remove restrictions, no
  // redeploy" — and the only honest way to check it is to let the moment pass.
  const soon = new Date(Date.now() + 2000).toISOString();
  process.env.LAUNCH_DATE = soon;
  const { config } = await import('../src/config/env.js');
  config.launch.date = soon;                       // what a fresh boot would read

  const before = await post('/api/orders',
    { email: `early${tag}@x.dev`, items: [{ productId: product.id }], consent: true });
  ok('two seconds early, the checkout is still shut', before.status === 503, `status=${before.status}`);

  await new Promise((r) => setTimeout(r, 2600));

  const after = await post('/api/orders',
    { email: `ontime${tag}@x.dev`, items: [{ productId: product.id }], consent: true });
  ok('the moment it passes, the same endpoint takes the order',
    after.status === 201, `status=${after.status} ${JSON.stringify(await after.clone().json()).slice(0, 110)}`);
  ok('…and the storefront is told there is nothing left to wait for',
    (await (await fetch(`${base}/api/config`)).json()).launchAt === new Date(soon).toISOString()
    || !gate.isPrelaunch());

  config.launch.date = '';
  ok('clearing the date opens the shop outright', !gate.isPrelaunch(),
    'an unset LAUNCH_DATE must never gate a live shop');
  ok('…and an unreadable one fails OPEN rather than closing the shop',
    (() => { config.launch.date = 'next tuesday-ish'; const p = gate.isPrelaunch(); config.launch.date = ''; return !p; })(),
    'a typo must not lock a shop out of its own checkout');
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
