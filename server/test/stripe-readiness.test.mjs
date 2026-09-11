/**
 * Stripe, checked the way Mollie already was.
 *
 * Every payment check in this shop was Mollie-shaped. A shop running Stripe was
 * told, in the readiness dashboard it is supposed to trust, that it had "no
 * iDEAL" — which is false, Stripe does iDEAL in the Netherlands — and was sent
 * off to configure a provider it is not using.
 *
 * And underneath that, the one that costs real money:
 *
 *   constructEvent refuses without STRIPE_WEBHOOK_SECRET. That is the SAFE
 *   direction and the invisible one. With the secret key set and the webhook
 *   secret missing, a buyer pays, Stripe takes the money, the webhook is
 *   rejected unverified, and no order is ever marked paid. The shop does not
 *   notice, because from its side the payment simply never came back.
 *
 * Nothing warned about that. These tests are mostly about making sure something
 * always does.
 */
import { migrate } from '../src/db/migrate.js';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const svc = read('server/src/services/stripeService.js');
const checks = read('server/src/services/launchCheckService.js');
const compliance = read('server/src/services/complianceCheckService.js');
const route = read('server/src/routes/payments.js');

/* Each case is its own PROCESS.
 *
 * config reads process.env once, at the moment env.js is first imported, and
 * cache-busting launchCheckService does not bust the already-cached env.js
 * underneath it — so setting STRIPE_SECRET_KEY in-process and re-importing gave
 * every case the same answer, which was whatever the first import happened to
 * see. Every assertion below passed or failed for the wrong reason until this
 * spawned instead. */
const withEnv = (env) => {
  const r = spawnSync(process.execPath, ['-e', `
    const { launchChecks } = await import('${join(ROOT, 'server/src/services/launchCheckService.js')}');
    const out = await launchChecks();
    const rows = Array.isArray(out) ? out : (out.checks || []);
    console.log(JSON.stringify(rows.find((c) => c.id === 'payments') || {}));
    process.exit(0);
  `, '--input-type=module'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', MOLLIE_API_KEY: '',
      DEMO_PAYMENTS: 'false', PAY_TIKKIE: '', PAY_REVOLUT: '', PAY_PAYPAL: '',
      ...env,
    },
  });
  const line = (r.stdout || '').trim().split('\n').pop();
  try { return JSON.parse(line); } catch { return { status: '?', detail: r.stderr || line }; }
};

console.log('— The one that takes the money and delivers nothing —');
{
  /* The webhook fails CLOSED, which is right: an unverified payment
     notification must never mark an order paid. The cost is silence. */
  ok('the webhook refuses to run without a signing secret',
    /if \(!s \|\| !secret\) throw new Error\('Stripe webhook not configured'\)/.test(svc));
  ok('…and the route answers 400 rather than accepting it',
    /signature verification failed[\s\S]{0,120}status\(400\)/.test(route));

  const r = withEnv({ STRIPE_SECRET_KEY: 'sk_live_abc' });
  ok('a key with no webhook secret is a FAILURE, not a warning', r.status === 'fail', r.status);
  ok('…and it says what actually happens: money in, nothing delivered',
    /money[\s\S]{0,60}arrives/.test(r.detail)
    && /no order is ever marked paid/.test(r.detail), r.detail);
  ok('…and where to fix it', /Developers → Webhooks/.test(r.detail));
  ok('…naming the endpoint the shop actually serves',
    /\/api\/payments\/stripe\/webhook/.test(r.detail));
  ok('…and the event it needs', /checkout\.session\.completed/.test(r.detail));
  ok('the compliance audit fails on it too',
    /payments\.stripe-webhook/.test(compliance) && /'FAIL', 'Stripe cannot confirm a payment'/.test(compliance));
}

console.log('\n— A test key is the expensive mistake —');
{
  const r = withEnv({ STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_abc' });
  ok('a sk_test_ key fails', r.status === 'fail', r.status);
  ok('…because everything works and no money moves',
    /NO money arrives/.test(r.detail), r.detail);
  ok('the service can tell the difference', /export const isTestKey = \(\) => \/\^sk_test_\//.test(svc));
  ok('…and a live key is not mistaken for one',
    !/^sk_test_/.test('sk_live_abc') && /sk_live/.test('sk_live_abc'));
}

console.log('\n— Stripe does iDEAL, and the check used to say it did not —');
{
  ok('nothing claims Stripe has no iDEAL any more',
    !/no MOLLIE_API_KEY, so no iDEAL/.test(checks));
  /* Checkout does not hardcode a method list, on purpose: naming `ideal`
     throws at session creation if the account has not enabled it, which takes
     the checkout down rather than degrading it. */
  ok('checkout leaves the method list to the account',
    !/payment_method_types/.test(svc));
  /* Which makes it silent — so the check ASKS Stripe instead of assuming. */
  ok('…so the readiness check asks Stripe which methods are live',
    /export async function enabledMethods/.test(svc) && /await stripeMethods\(\)/.test(checks));
  ok('…and warns a Dutch shop that has iDEAL switched off',
    /iDEAL is not enabled on the account/.test(checks));
  ok('…while an unreachable API proves nothing either way',
    /return null;\s*\/\/ no permission, old API version, offline/.test(svc)
    && /Could not read which payment methods are enabled/.test(checks));

  const r = withEnv({ STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_WEBHOOK_SECRET: 'whsec_abc' });
  ok('a live key with a webhook secret is not a failure', r.status !== 'fail', `${r.status}: ${r.detail}`);
  ok('…and does not tell a Stripe shop to configure Mollie', !/MOLLIE/.test(r.detail), r.detail);
}

console.log('\n— The advice matches the provider that is actually configured —');
{
  const none = withEnv({});
  ok('with nothing set, Stripe is offered as an option',
    /STRIPE_SECRET_KEY/.test(none.detail), none.detail);
  ok('…and so is Mollie', /MOLLIE_API_KEY/.test(none.detail));
  ok('…and it is a failure, because orders dead-end', none.status === 'fail');

  const manual = withEnv({ PAY_TIKKIE: 'https://tikkie.me/pay/x' });
  ok('manual-only is a warning, not a failure — it does sell', manual.status === 'warn');
  ok('…and names both automatic options', /STRIPE_SECRET_KEY/.test(manual.detail) && /MOLLIE/.test(manual.detail));

  const demo = withEnv({ DEMO_PAYMENTS: 'true' });
  ok('demo mode names Stripe first now', /STRIPE_SECRET_KEY/.test(demo.detail), demo.detail);
  ok('…and still says the checkout refuses in production',
    /checkout refuses orders/.test(demo.detail));

  /* "Ask Mollie whether your categories are allowed" is useless advice to a
     shop running Stripe — and it is the single largest business risk in this
     category, so it has to reach the right dashboard. */
  ok('the account-restriction question names the configured processor',
    /Does your \$\{processor\} account allow what you sell\?/.test(compliance));
  ok('…and falls back to something true when neither is set',
    /'your payment provider'/.test(compliance));
}

console.log('\n— Stripe is checked ahead of Mollie —');
{
  /* A shop with both configured sends buyers to whichever the checkout picks.
     A readiness dashboard that disagrees with the checkout is worse than none —
     the same reason this file's Mollie-over-manual ordering exists. */
  const both = withEnv({
    STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_WEBHOOK_SECRET: 'whsec_abc', MOLLIE_API_KEY: 'live_abc',
  });
  ok('with both configured, the check reports Stripe', /Stripe/.test(both.detail), both.detail);
  ok('…and the code says why', /Stripe first, because a shop with both/.test(checks));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} stripe-readiness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
