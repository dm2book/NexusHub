/**
 * A missing setting must not take the whole site down.
 *
 * The launch audit turned "no email transport" from a console.warn into a hard
 * production failure, for a good reason: without a way to email a code, a guest
 * pays and receives nothing, and the only trace is one line in a log.
 *
 * The reason was right and the mechanism was wrong. assertProductionConfig runs
 * at module scope in api/index.js, so throwing there killed the ENTIRE function:
 * no storefront, no order tracking for orders already placed, and no admin panel
 * — so the owner could not sign in to find out why. Vercel answered every
 * request with the plain text "A server error has occurred", which reached the
 * browser as `JSON Parse error: Unexpected identifier "A"`. One unset variable,
 * total outage, and a symptom that pointed at the wrong layer.
 *
 * What is actually worth preventing is narrower than "the site exists": it is
 * TAKING MONEY the shop cannot honour. So the checkout refuses and everything
 * else keeps running.
 *
 * These tests pin both halves — that the site still boots, and that it still
 * will not sell.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_blockers';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const app = createApp();
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

const { commerceBlockers, assertProductionConfig, config } = await import('../src/config/env.js');
const { createProduct } = await import('../src/services/productService.js');
const fs = await import('node:fs');
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const tag = Date.now() % 1000000;

// ── 1. Boot survives a missing email transport ──────────────────────────────
console.log('— One unset variable must not be an outage —');
{
  const env = read('../src/config/env.js');

  ok('this test runs with no email transport configured',
    !config.email.resendApiKey && !config.email.smtpUrl,
    'a transport is set — the condition under test is not present');

  ok('assertProductionConfig no longer refuses to boot over email',
    !/assertProductionConfig[\s\S]*?RESEND_API_KEY[\s\S]*?throw new Error\(`Refusing to start/.test(env),
    'a missing email key still kills the whole function');

  // What SHOULD still be fatal: no safe degraded mode exists for either.
  ok('a dev JWT secret is still fatal', /assertProductionConfig[\s\S]{0,600}jwtSecret[\s\S]{0,600}missing\.push\('JWT_SECRET'\)/.test(env));
  ok('a missing database is still fatal', /assertProductionConfig[\s\S]{0,700}DATABASE_URL \(or POSTGRES_URL\)/.test(env));
  ok('…and nothing else is', (env.match(/missing\.push\(/g) || []).length === 2,
    'something new was added to the fatal list — check it has no degraded mode');

  ok('assertProductionConfig is still exported and still callable',
    typeof assertProductionConfig === 'function');
}

// ── 2. The pages a buyer and an owner need stay up ──────────────────────────
console.log('\n— Everything except selling keeps working —');
{
  for (const [path, what] of [
    ['/api/config', 'the storefront config'],
    ['/api/products', 'the catalog'],
    ['/api/stats', 'the trust stats'],
    ['/api/reviews', 'the reviews feed'],
  ]) {
    const r = await fetch(`${base}${path}`);
    ok(`${what} still answers`, r.ok, `status=${r.status}`);
  }

  // The login route is the one that matters most: without it the owner cannot
  // reach the admin panel to fix whatever is blocking the checkout.
  const login = await fetch(`${base}/api/auth/otp/request`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `blocked${tag}@x.dev` }),
  });
  ok('sign-in still works', login.ok, `status=${login.status}`);
}

// ── 3. …but the shop will not take money it cannot honour ───────────────────
console.log('\n— The checkout refuses instead —');
{
  const reasons = commerceBlockers();
  ok('a missing email transport is a commerce blocker', reasons.length >= 1, JSON.stringify(reasons));
  ok('…and it says which variable to set',
    reasons.some((r) => /RESEND_API_KEY|SMTP_URL/.test(r)), JSON.stringify(reasons));

  const p = await createProduct({ name: `Blocked Pack ${tag}`, category: 'robux', price: 999, announce: false });
  const r = await fetch(`${base}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `buyer${tag}@x.dev`, consent: true, consentText: 'test consent',
      items: [{ productId: p.id, quantity: 1 }],
    }),
  });
  ok('an order is refused while the shop cannot deliver', r.status === 503, `status=${r.status}`);

  const body = await r.json().catch(() => ({}));
  const msg = body?.error?.message || '';
  ok('the buyer is told nothing was charged', /nothing has been charged/i.test(msg), msg);
  ok('the buyer is NOT shown which env var is unset',
    !/RESEND_API_KEY|SMTP_URL|MOLLIE|DEMO_PAYMENTS/.test(JSON.stringify(body)),
    'configuration detail leaked to whoever is standing at the checkout');
  ok('the refusal is machine-readable', body?.error?.code === 'commerce_paused', body?.error?.code);
}

// ── 4. The storefront can say so before the last step ───────────────────────
console.log('\n— Say it up front, not after the cart is full —');
{
  const cfg = await (await fetch(`${base}/api/config`)).json();
  ok('/api/config reports that ordering is paused', cfg.orderingPaused === true, String(cfg.orderingPaused));
  ok('…without naming the unset variables',
    !/RESEND_API_KEY|SMTP_URL/.test(JSON.stringify(cfg)), 'config endpoint leaks env detail');
}

// ── 5. The owner's dashboard still calls it a blocker ───────────────────────
console.log('\n— The launch dashboard still flags it —');
{
  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const checks = (await launchChecks()).checks;
  const email = checks.find((c) => c.id === 'email');
  ok('the launch dashboard still fails on a missing transport', email?.status === 'fail', email?.status);
  ok('…and says what buyers lose', /login codes|order emails|receive/i.test(email?.detail || ''), email?.detail);
}

// ── 6. A broken configuration explains itself ───────────────────────────────
console.log('\n— A misconfiguration must not look like a crash —');
{
  const entry = read('../../api/index.js');

  // Bare at module scope, a throw here leaves Vercel with nothing to invoke, so
  // it answers with its own page: "This Serverless Function has crashed /
  // FUNCTION_INVOCATION_FAILED". That page cannot name the missing setting, so
  // the one fact the owner needs is reachable only by digging through logs.
  ok('the boot check is caught rather than thrown at the platform',
    /try \{\s*assertProductionConfig\(\);/.test(entry),
    'assertProductionConfig still crashes the function');

  // Catching must not soften it: every request still has to fail, or a dev JWT
  // secret would start authenticating people.
  ok('a broken config still refuses every request',
    /if \(bootError\)[\s\S]{0,400}statusCode = 503/.test(entry), 'requests are served anyway');
  ok('…and the app is never even constructed',
    /app = createApp\(\{ lazyReady: true \}\);\s*\} catch/.test(entry), 'the app boots on a broken config');
  // A module that throws on import fails identically from the outside and used
  // to produce the same uninformative crash page.
  ok('building the app is inside the same guard',
    /try \{[\s\S]{0,700}createApp\([\s\S]{0,80}\} catch/.test(entry),
    'only the config check is guarded — any other boot error still crashes opaquely');

  ok('the reason is logged where the owner will see it',
    /console\.error\([\s\S]{0,400}err\.message/.test(entry));
  ok('…and points at where to fix it',
    /Environment Variables/.test(entry));
  ok('the response does NOT name the setting',
    /message: 'This shop is temporarily unavailable/.test(entry)
      && !/message: `[^`]*\$\{(err|bootError)/.test(entry),
    'the failure reason is echoed to the public');
  ok('the refusal is JSON, so the API client can read it',
    /content-type', 'application\/json/.test(entry),
    'a non-JSON body here is what produced the original parse error');
}

// ── 7. The owner can diagnose without first being able to log in ────────────
console.log('\n— The checklist reaches the one place that has no login wall —');
{
  const appSrc = read('../src/app.js');

  // Everything needed to diagnose a broken shop already existed on /admin. It
  // is just unreachable exactly when it matters: reading it needs a sign-in,
  // signing in needs an email transport, and a missing transport is one of the
  // things it reports. The boot log has no such circularity.
  ok('the launch checks are printed into the boot log',
    /async function logReadiness\(\)[\s\S]{0,600}launchChecks\(\)/.test(appSrc),
    'the readiness picture is still only behind the admin login');
  /* Read the function's actual body by counting braces rather than allowing N
     characters between two strings. The property here is "logReadiness is called
     from inside startBackgroundUpkeep" — a proximity regex answers a different
     question, and answered it wrongly the moment a comment was added between
     the two lines. */
  const bodyOf = (src, decl) => {
    const start = src.indexOf(decl);
    if (start === -1) return '';
    let depth = 0;
    const i = src.indexOf('{', start);
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return src.slice(i, j);
    }
    return '';
  };
  ok('…once the process is up, not on every request',
    /logReadiness\(\)/.test(bodyOf(appSrc, 'function startBackgroundUpkeep')),
    'the checklist would run on every request instead of once per boot');
  ok('diagnostics can never fail a request',
    /logReadiness\(\)[\s\S]{0,900}catch \(e\)[\s\S]{0,160}readiness/.test(appSrc),
    'an error in the checklist could break serving');

  // Status words and setting names, never a value.
  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const dump = JSON.stringify((await launchChecks()).checks);
  ok('the log never contains a secret value',
    !dump.includes(config.auth.jwtSecret) && !/re_[A-Za-z0-9]{10,}/.test(dump),
    'a secret value reached the readiness output');
}

srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
