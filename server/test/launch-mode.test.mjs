/**
 * Launch mode: the shop cannot open by accident, and cannot be closed by this.
 *
 * The gate used to be one environment variable deep — LAUNCH_DATE set meant
 * closed, unset meant open. Measured on this repository with the variable in
 * the state it is in production: an anonymous request created a real order.
 * Every readiness report had been saying LAUNCH_DATE was unset, and what that
 * actually meant was that the shop was open to the public.
 *
 * So these assertions are almost all about the DEFAULT, from both directions:
 * a shop that has never sold must stay shut, and a shop that has sold must not
 * be shut by the change that shuts the first one. Everything else — overrides,
 * staff, the checklist — hangs off that.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_launch_mode';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';
delete process.env.LAUNCH_DATE;
delete process.env.LAUNCH_MODE;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { migrate } = await import('../src/db/migrate.js');
await migrate();
const { run, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');

/* Each scenario runs in its own process.

   `config` reads process.env once, at import, and the gate memoises "this shop
   has opened" per instance. Both are right in production — a Vercel deploy is a
   fresh process — and both make an in-process test of different settings
   meaningless: a query-string cache-bust gives you a new gate module holding
   the same frozen config, which is how the first draft of this file "passed"
   assertions it was not making.

   A child process is what the real thing is, so that is what is measured. */
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const inProcess = (env, script) => {
  /* The explicit exit matters: the gate opens a database pool to look for
     evidence, and a pool with an idle client keeps the process alive long after
     it has printed its answer. Without this the first child hung and took the
     whole suite with it. */
  const out = execFileSync(process.execPath,
    ['--input-type=module', '-e', `${script}\nprocess.exit(0);`], {
    cwd: path.join(HERE, '..'),
    env: {
      ...process.env,
      LAUNCH_DATE: '', LAUNCH_MODE: '',            // cleared unless the case sets them
      ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)])),
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return JSON.parse(line);
};

/** launchState() as this shop would resolve it under `env`. */
const stateUnder = (env = {}) => inProcess(env, `
  const g = await import('./src/services/launchGateService.js');
  console.log(JSON.stringify(await g.launchState()));
`);

/** What assertLaunched() does for a given user under `env`. */
const assertUnder = (env, user) => inProcess(env, `
  const g = await import('./src/services/launchGateService.js');
  try {
    await g.assertLaunched(${JSON.stringify(user)}, 'The checkout', { money: true });
    console.log(JSON.stringify({ allowed: true }));
  } catch (e) {
    console.log(JSON.stringify({ allowed: false, status: e.status, code: e.code, message: e.message }));
  }
`);

const PRODUCT = newId('prd');
await run(
  `INSERT INTO products (id, sku, name, category, price, currency, kind, stock, active, created_at, updated_at)
   VALUES (@id, 'LM-1', 'Launch Test', 'robux', 999, 'EUR', 'digital', 50, 1, @at, @at)`,
  { id: PRODUCT, at: nowIso() });

console.log('\n── A shop that has never sold stays shut ──────────────────');

{
  const state = stateUnder();
  ok('with no LAUNCH_DATE and no LAUNCH_MODE, the gate is CLOSED',
    state.prelaunch === true, JSON.stringify(state));
  ok('…and says why, in words a person can act on',
    /never taken a payment/.test(state.reason), state.reason);

  const r = assertUnder({}, null);
  ok('an anonymous buyer is refused', r.allowed === false && r.status === 503, JSON.stringify(r));
  ok('…with a code the storefront can tell from a crash', r.code === 'prelaunch', r.code);
  ok('…and is told nothing was charged', /Nothing has been charged/.test(r.message || ''), r.message);
}

console.log('\n── …and that is enforced at the choke point, not the button ──');

{
  /* The whole gate is worth nothing if it only exists in the UI. This drives
     createOrder directly — the same path the API route uses — with no user. */
  const { createOrder } = await import('../src/services/orderService.js');
  let err = null;
  try {
    await createOrder({
      email: 'stranger@example.test', items: [{ productId: PRODUCT, quantity: 1 }],
      consent: true, consentText: 'x',
    }, {});
  } catch (e) { err = e; }
  ok('createOrder refuses an anonymous order', err?.status === 503, `${err?.status} ${err?.message}`);
  ok('…and no order row was written',
    Number((await get('SELECT COUNT(*) AS n FROM orders')).n) === 0);
}

console.log('\n── A shop that HAS sold is not closed by any of this ──────');

{
  await run(
    `INSERT INTO orders (id, number, email, status, currency, subtotal, total, billing, created_at, updated_at)
     VALUES (@id, 'FM-HISTORIC', 'a@b.test', 'completed', 'EUR', 999, 999, '{}', @at, @at)`,
    { id: newId('ord'), at: '2026-01-01T00:00:00.000Z' });

  const state = stateUnder();
  ok('a paid order in the history means the shop is open',
    state.prelaunch === false, JSON.stringify(state));
  ok('…dated from that order, not from now',
    state.openedAt === '2026-01-01T00:00:00.000Z', state.openedAt);
  ok('…and it is written down so a restart does not have to work it out again',
    JSON.parse((await get(`SELECT value FROM kv WHERE key='launch.opened_at'`)).value)
      === '2026-01-01T00:00:00.000Z');

  ok('a buyer is served', assertUnder({}, null).allowed === true);
}

console.log('\n── The date, when there is one ────────────────────────────');

{
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const s = stateUnder({ LAUNCH_DATE: future });
  ok('a future LAUNCH_DATE closes the shop again, history or not',
    s.prelaunch === true, JSON.stringify(s));
  ok('…and the reason names the moment', s.reason.includes(future), s.reason);

  const past = new Date(Date.now() - 1000).toISOString();
  ok('a LAUNCH_DATE that has passed opens it',
    stateUnder({ LAUNCH_DATE: past }).prelaunch === false);

  ok('an unreadable LAUNCH_DATE does not close a shop that has sold',
    stateUnder({ LAUNCH_DATE: 'the 24th sometime' }).prelaunch === false,
    'a typo must not lock a live shop out of its own checkout');
}

console.log('\n── The manual override, both ways ─────────────────────────');

{
  const past = new Date(Date.now() - 1000).toISOString();
  const s = stateUnder({ LAUNCH_DATE: past, LAUNCH_MODE: 'prelaunch' });
  ok('LAUNCH_MODE=prelaunch shuts a shop the date says is open',
    s.prelaunch === true && /LAUNCH_MODE/.test(s.reason), JSON.stringify(s));

  const future = new Date(Date.now() + 86_400_000).toISOString();
  const s2 = stateUnder({ LAUNCH_DATE: future, LAUNCH_MODE: 'open' });
  ok('LAUNCH_MODE=open opens a shop the date says is shut',
    s2.prelaunch === false && /LAUNCH_MODE/.test(s2.reason), JSON.stringify(s2));

  ok('the value is read case-insensitively',
    stateUnder({ LAUNCH_MODE: 'PreLaunch' }).prelaunch === true,
    'LAUNCH_MODE=PreLaunch typed by a human must not silently mean nothing');

  ok('an unrecognised value is ignored rather than guessed at',
    !/LAUNCH_MODE/.test(stateUnder({ LAUNCH_MODE: 'yes-open-it' }).reason),
    'guessing at "yes-open-it" would open a shop on a typo');
}

console.log('\n── Staff walk through, everyone else waits ────────────────');

{
  const env = { LAUNCH_MODE: 'prelaunch' };
  ok('an owner can buy during pre-launch',
    assertUnder(env, { roles: ['owner'] }).allowed === true);
  ok('a signed-in customer cannot',
    assertUnder(env, { roles: ['customer'] }).allowed === false);
}

console.log('\n── Nothing about Discord waits for launch ─────────────────');

{
  /* The requirement is explicit: Discord is fully operational BEFORE the day.
     A gate accidentally placed on a Discord route would be invisible until the
     community noticed it was dead. */
  const gated = ['requireLaunched', 'assertLaunched'];
  const discordFiles = [
    'server/src/routes/discord.js',
    'server/src/services/discordService.js',
    'server/src/services/discordRolesService.js',
    'server/src/services/reviewsService.js',
    'server/src/services/codeStockService.js',
  ];
  for (const f of discordFiles) {
    let src = '';
    try { src = rd(f); } catch { continue; }
    ok(`${path.basename(f)} is not behind the launch gate`,
      !gated.some((g) => src.includes(g)),
      'invites, community, support, reviews, proof of delivery and restock alerts run now');
  }
}

console.log('\n── The checklist describes both phases ────────────────────');

{
  const { PHASE } = await import('../src/services/launchPlanService.js');
  const plan = inProcess({ LAUNCH_MODE: 'prelaunch' }, `
    const { launchPlan } = await import('./src/services/launchPlanService.js');
    console.log(JSON.stringify(await launchPlan()));
  `);
  ok('it reports which phase the shop is in', plan.prelaunch === true, JSON.stringify(plan.reason));

  const before = plan.items.filter((i) => i.phase === PHASE.BEFORE);
  const day = plan.items.filter((i) => i.phase === PHASE.DAY);
  ok('today\'s list covers the gate, Discord and the site',
    ['gate', 'discord.invite', 'discord.bot', 'discord.delivery', 'site.browsable', 'site.cta']
      .every((id) => before.some((i) => i.id === id)),
    before.map((i) => i.id).join(','));
  ok('the day\'s list covers payment, fulfilment, email and alerts',
    ['pay', 'fulfil', 'email', 'alerts'].every((id) => day.some((i) => i.id === id)),
    day.map((i) => i.id).join(','));
  ok('the day\'s list is checked before the day, not on it',
    day.every((i) => !!i.status),
    'finding out on the morning that no code is loaded is finding out too late');
  ok('an override left switched on is reported',
    plan.items.some((i) => i.id === 'gate.override'),
    'a manual release nobody remembers pulling back is how a shop opens early');
}

console.log('\n── The command and the wiring ─────────────────────────────');

{
  const cli = rd('scripts/launch-status.mjs');
  ok('the command exists and reads both phases', /PHASE\.BEFORE/.test(cli) && /PHASE\.DAY/.test(cli));
  ok('…and only fails on what is wrong for the phase you are in',
    /launch-day items do not fail the command before launch/i.test(cli));
  ok('…and says which environment it read', /NODE_ENV=/.test(cli));

  ok('both launch variables are documented',
    /LAUNCH_DATE=/.test(rd('server/.env.example')) && /LAUNCH_MODE=/.test(rd('server/.env.example')),
    'LAUNCH_DATE was the most important switch in the shop and was in no example file');

  const gate = rd('server/src/services/launchGateService.js');
  ok('the gate is awaited everywhere it is used',
    ['server/src/services/orderService.js', 'server/src/services/userService.js']
      .every((f) => !/[^t] assertLaunched\(/.test(rd(f).replace(/await assertLaunched\(/g, 'await X('))),
    'an un-awaited async gate is no gate at all');
  ok('the evidence query only counts money that actually arrived',
    /payment_received','processing','awaiting_fulfillment','completed/.test(gate),
    'a pending order is not evidence that a shop ever opened');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} launch mode: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
