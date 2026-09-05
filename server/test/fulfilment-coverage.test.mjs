/**
 * How much of the shelf can sell itself, and the one setting that must never
 * be on where it can be reached.
 *
 * The catalogue audit answers "can this be delivered at all". This answers the
 * question that decides how much the shop can take in a day: how many products
 * go from paid to delivered with nobody watching. The two are different, and
 * the difference is the whole business — 72 products that all need a person are
 * 72 products capped by one person's hours.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DELIVERY_INFO } from '../../src/lib/deliveryInfo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('— Demo payments cannot be on where a buyer can reach —');
{
  /* Demo mode marks an order paid without any money arriving. It defaults ON
     outside production, which is right on a laptop and wrong the moment the
     same build answers on a public domain — a shop handing out codes for free,
     one missing environment variable away. NODE_ENV is the usual guard and it
     is the one that goes missing; the URL people reach the shop on does not. */
  /* The keys are DELETED rather than set to '', because bool('') is false and
     bool(undefined) is the default — so an empty string is a third answer, not
     an absent one, and probing with '' would test something else entirely. */
  const probe = (envs) => {
    const env = { ...process.env };
    for (const k of ['NODE_ENV', 'APP_URL', 'DEMO_PAYMENTS']) delete env[k];
    const out = execFileSync(process.execPath, ['-e',
      "import('./server/src/config/env.js').then(m=>console.log(m.config.payments.demoMode))"],
    { cwd: ROOT, env: { ...env, ...envs }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n').pop() === 'true';
  };
  ok('a public https origin refuses it even when asked for',
    probe({ APP_URL: 'https://forgemarket.nl', DEMO_PAYMENTS: 'true' }) === false);
  ok('and so does any other public host',
    probe({ APP_URL: 'https://forgemarket.vercel.app', DEMO_PAYMENTS: 'true' }) === false);
  // Developing against the real thing has to keep working.
  ok('localhost still allows it', probe({ APP_URL: 'http://localhost:3000', DEMO_PAYMENTS: 'true' }) === true);
  ok('and a bare dev shell is unchanged', probe({}) === true);
  ok('production without the flag is off', probe({ NODE_ENV: 'production' }) === false);
  const env = readFileSync(join(ROOT, 'server', 'src', 'config', 'env.js'), 'utf8');
  ok('the refusal says why rather than failing quietly', /DEMO_PAYMENTS refused/.test(env));
}

console.log('\n— The audit reads the shop’s own delivery copy —');
{
  const src = readFileSync(join(ROOT, 'scripts', 'audit-fulfilment.mjs'), 'utf8');
  ok('there is a fulfilment audit', /sellableWithoutAHuman/.test(src));
  /* Which categories need a person is DERIVED from what the buyer is shown
     before they pay, not from a list somebody has to remember to update. */
  ok('account-based categories are derived, not listed',
    /Object\.entries\(DELIVERY_INFO\)/.test(src) && /username\|gebruikersnaam/.test(src));
  ok('and it counts a supplier as automatic too', /an active supplier will buy one/.test(src));

  /* The classification, run against the real delivery copy. Robux says "we only
     need your username" and lists 2FA as step one; V-Bucks says "an official
     gift card code that you redeem yourself". Same shop, opposite answers, and
     only one of them can be fixed by loading stock. */
  const needsAccount = (cat) => {
    const v = DELIVERY_INFO[cat];
    return !!v && /username|gebruikersnaam|account name|player id|2fa|2-step|2-staps/i
      .test([v.en?.method, ...(v.en?.steps || [])].join(' '));
  };
  ok('robux is read as an account top-up', needsAccount('robux'));
  ok('v-bucks is read as a code', !needsAccount('v-bucks'));
  ok('and the default is not assumed to need an account', !needsAccount('default'));
}

console.log('\n— A product set to auto that cannot auto-deliver is reported —');
{
  /* Already enforced by catalogAuditService; pinned here because it is the rule
     that turns 66 silent manual orders into a warning somebody reads. */
  const audit = readFileSync(join(ROOT, 'server', 'src', 'services', 'catalogAuditService.js'), 'utf8');
  ok('auto with no codes and no supplier is a finding',
    /deliveryMode === 'auto' && !codes && !activeLinks\.length/.test(audit));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
