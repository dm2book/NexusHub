/**
 * APP_URL has to be the host buyers actually arrive on.
 *
 * It is the single origin nearly everything public is built from — every
 * canonical tag, the sitemap, the OG urls, the CORS allow-list, and every link
 * in every email — and until now nothing checked it. Its production default is
 * `https://forgemarket.nl`.
 *
 * That default is wrong for this shop today. The Vercel project has
 * `www.forgemarket.nl` attached and NOT the apex, so unless APP_URL is set the
 * shop names a host the deployment does not serve. It has no symptom on the
 * shop's own pages — they render fine either way — and four invisible ones:
 * canonicals, the sitemap, CORS, and email links all point somewhere else.
 *
 * The server is the only thing that can settle it, because it is the only thing
 * that sees the Host header. So it writes down what it is served on, and these
 * are the rules for comparing.
 */
import { migrate } from '../src/db/migrate.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const { cleanHost, hostOf, classifyHost, noteServedHost, servedHosts, appUrlVerdict } =
  await import('../src/services/servedHostService.js');
const { setSetting } = await import('../src/services/settingsService.js');
const { config } = await import('../src/config/env.js');

const seed = (...hosts) => setSetting('served_hosts',
  hosts.map((host) => ({ host, at: new Date().toISOString() })));
/* The production default, passed explicitly. config.appUrl reads the
   environment once at import, so a test that depended on it would be testing
   NODE_ENV — and the deployed shop is the only case this check exists for. */
const PROD = 'https://forgemarket.nl';
const appHost = hostOf(PROD);
const verdict = () => appUrlVerdict({ appUrl: PROD });

console.log('— A Host header is not to be trusted —');
{
  /* Supplied by the client, so everything here is about refusing the ones that
     are not hostnames rather than about believing the ones that are. */
  ok('a plain hostname survives', cleanHost('www.forgemarket.nl') === 'www.forgemarket.nl');
  ok('case and a port do not', cleanHost('WWW.ForgeMarket.NL:443') === 'www.forgemarket.nl');
  ok('whitespace does not', cleanHost('  forgemarket.nl  ') === 'forgemarket.nl');
  for (const bad of ['', null, undefined, 'a b', 'http://x.nl', 'x.nl/path', '-lead.nl',
    'trail-.nl', 'a'.repeat(300), '<script>', 'x.nl\nInjected: 1']) {
    ok(`refused: ${JSON.stringify(String(bad).slice(0, 24))}`, cleanHost(bad) === null);
  }
  ok('a URL gives up its host', hostOf('https://www.forgemarket.nl/nl/shop') === 'www.forgemarket.nl');
  ok('…and a non-URL gives null', hostOf('not a url') === null);
}

console.log('\n— Only a real domain answers "is the address right" —');
{
  ok('a custom domain is the one that counts', classifyHost('www.forgemarket.nl') === 'custom');
  ok('a deployment URL is not', classifyHost('forgemarket-abc.vercel.app') === 'vercel');
  ok('a laptop is not', classifyHost('localhost') === 'local' && classifyHost('127.0.0.1') === 'local');
}

console.log('\n— The verdict —');
{
  await seed(appHost);
  let v = await verdict();
  ok('the host it is served on matches, so it passes', v.status === 'ok', `${v.status}: ${v.detail}`);

  await setSetting('served_hosts', []);
  v = await verdict();
  ok('nothing seen yet is a warning, not a failure', v.status === 'warn');
  ok('…and says so plainly', /no request has been recorded/.test(v.detail));

  await seed('forgemarket-abc.vercel.app');
  v = await verdict();
  ok('served only on a deployment URL is a warning', v.status === 'warn', v.detail);
  ok('…because the real domain has not been used yet', /has not served a request/.test(v.detail));

  /* THE ONE THIS SHOP HAS. www and the apex are different hosts. The Vercel
     project has www attached and not the apex, and APP_URL defaults to the
     apex — so the pages render and every canonical names the wrong host. */
  await seed(`www.${appHost}`);
  v = await verdict();
  ok('www against the apex fails', v.status === 'fail', v.detail);
  ok('…and names both hosts', v.detail.includes(appHost) && v.detail.includes(`www.${appHost}`));
  ok('…and says what it breaks',
    /canonical/.test(v.detail) && /sitemap/.test(v.detail) && /CORS/.test(v.detail) && /email/.test(v.detail));
  ok('…and offers both ways out',
    /APP_URL=https:\/\/www\./.test(v.fix) && /attach/.test(v.fix), v.fix);

  await seed('someoneelse.example');
  v = await verdict();
  ok('any other mismatch fails too', v.status === 'fail');
  ok('…naming the host actually being served', v.detail.includes('someoneelse.example'));

  /* A deployment URL alongside the real one is normal — Vercel always serves
     both — and must not be read as a mismatch. */
  await seed(appHost, 'forgemarket-abc.vercel.app', 'localhost');
  v = await verdict();
  ok('a deployment URL beside the real one is fine', v.status === 'ok', v.detail);

  /* A laptop pointed at a laptop is consistent, and nagging about it on every
     development run is how a check gets ignored on the day it matters. */
  await seed('localhost');
  const dev = await appUrlVerdict({ appUrl: 'http://localhost:3000' });
  ok('development is not a warning', dev.status === 'ok', `${dev.status}: ${dev.detail}`);
  ok('…and says why it is not being judged', /development/.test(dev.detail));
  ok('…but a laptop URL on a real domain still fails',
    (await appUrlVerdict({ appUrl: 'http://localhost:3000' })).status === 'ok'
    && (await seed('www.forgemarket.nl'),
      (await appUrlVerdict({ appUrl: 'http://localhost:3000' })).status) === 'fail');
}

console.log('\n— Recording, cheaply and safely —');
{
  await setSetting('served_hosts', []);
  await noteServedHost('www.forgemarket.nl');
  ok('a host is written down', (await servedHosts()).some((x) => x.host === 'www.forgemarket.nl'));

  /* Once per host per six hours. This runs on a request path, and a write per
     request to record a value that changes once a year is a round trip nobody
     asked for. */
  const before = (await servedHosts()).find((x) => x.host === 'www.forgemarket.nl').at;
  await new Promise((r) => setTimeout(r, 5));
  await noteServedHost('www.forgemarket.nl');
  ok('…and not written again on the next request',
    (await servedHosts()).find((x) => x.host === 'www.forgemarket.nl').at === before);

  await noteServedHost('nonsense header');
  ok('a bad Host is not stored at all',
    !(await servedHosts()).some((x) => /nonsense/.test(x.host)));

  /* A poisoned Host cannot grow the list without bound, and cannot push the
     real one out of the way of a human reading it — the list is capped and the
     verdict only cares whether the real one is in it. */
  for (let i = 0; i < 20; i++) await noteServedHost(`junk${i}.example`);
  const list = await servedHosts();
  ok('the list is capped', list.length <= 6, `${list.length}`);
  ok('…most recent first', list[0].host === 'junk19.example');

  ok('it never throws, whatever it is handed',
    await (async () => {
      for (const x of [null, undefined, 0, {}, [], 'x'.repeat(500)]) await noteServedHost(x);
      return true;
    })());
}

console.log('\n— One rule, in one place —');
{
  const plan = read('server/src/services/launchPlanService.js');
  const checks = read('server/src/services/launchCheckService.js');
  const app = read('server/src/app.js');
  const svc = read('server/src/services/servedHostService.js');

  ok('the launch plan asks for the verdict', /const url = await appUrlVerdict\(\)/.test(plan));
  ok('…and the admin dashboard asks the same function', /const url = await appUrlVerdict\(\)/.test(checks));
  ok('…so the two cannot disagree about the domain',
    /import \{ appUrlVerdict \} from '\.\/servedHostService\.js'/.test(plan)
    && /import \{ appUrlVerdict \} from '\.\/servedHostService\.js'/.test(checks));
  ok('it is a before-launch item, not a launch-day one',
    /add\(PHASE\.BEFORE, 'site\.url'/.test(plan));

  ok('the request path records the host', /noteServedHost\(req\.hostname \|\| req\.headers\.host\)/.test(app));
  ok('…and does not await it, because a diagnostic may not slow a request',
    !/await noteServedHost/.test(app));
  ok('…and it swallows its own failures', /catch \{ \/\* a diagnostic is never worth failing/.test(svc));

  /* The reason APP_URL is worth a check at all: it is what everything public is
     built from, and CORS is the one that fails loudest. */
  ok('CORS is built from the same value', /cors\(\{ origin: config\.appUrl/.test(app));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} served-host: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
