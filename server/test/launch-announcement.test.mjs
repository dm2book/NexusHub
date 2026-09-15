/**
 * The mail the banner promised.
 *
 * The pre-launch banner says "we will email you on the day", and until now
 * nothing could keep that. newsletterService could subscribe, unsubscribe,
 * count and list — and send nothing at all. Every address collected before
 * launch was a promise that would quietly break at midnight unless somebody
 * remembered to export a list and write the mail by hand, on the one night they
 * will be busiest.
 *
 * Most of what is checked here is about NOT sending: not before the shop opens,
 * not to people who never asked, and never twice. A launch list is the one
 * moment a shop mails hundreds of strangers at once, and a duplicate on launch
 * night is how a domain gets marked as spam on day one.
 */
import { migrate } from '../src/db/migrate.js';
import { run, get, all, nowIso } from '../src/db/index.js';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const codeOf = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const { syncEmailTemplates } = await import('../src/db/seed.js');
await syncEmailTemplates();
const {
  subscribe, unsubscribe, unsubscribeToken, tokenMatches, unsubscribeUrl,
} = await import('../src/services/newsletterService.js');
const { EMAIL_LANGS } = await import('../src/services/emailCopy.js');

const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();

/* config reads the launch date once at import, so every case about "is the
   shop open" is its own process — the trap the Stripe suite documents. */
const sendUnder = (env) => {
  const r = spawnSync(process.execPath, ['-e', `
    const { sendLaunchAnnouncements } = await import('${join(ROOT, 'server/src/services/newsletterService.js')}');
    process.stdout.write(JSON.stringify(await sendLaunchAnnouncements(${JSON.stringify(env.opts || {})})));
    process.exit(0);
  `, '--input-type=module'], {
    encoding: 'utf8',
    env: { ...process.env, LAUNCH_DATE: '', DEMO_PAYMENTS: 'false', ...env.env },
  });
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); }
  catch { return { sent: -1, err: r.stderr }; }
};

const seed = async (rows) => {
  await run('DELETE FROM newsletter_signups');
  await run(`DELETE FROM email_log WHERE template_id = 'launch_announcement'`);
  for (const [email, lang, hoursAgo, unsub] of rows) {
    // eslint-disable-next-line no-await-in-loop
    await subscribe(email, { lang });
    // eslint-disable-next-line no-await-in-loop
    await run('UPDATE newsletter_signups SET created_at = @at WHERE email = @e',
      { at: ago(hoursAgo), e: email });
    // eslint-disable-next-line no-await-in-loop
    if (unsub) await unsubscribe(email);
  }
};

console.log('— Never before the shop opens —');
{
  await seed([['a@x.test', 'nl', 48]]);
  /* Announcing a launch that has not happened is the single worst thing this
     function could do, so it asks the same gate the checkout asks. */
  const early = sendUnder({ env: { LAUNCH_DATE: '2099-01-01T00:00:00Z' } });
  ok('with the launch in the future, nothing is sent', early.sent === 0, JSON.stringify(early));
  ok('…and it says why', early.reason === 'not open yet', early.reason);

  const noDate = sendUnder({ env: {} });
  ok('with no launch date at all, nothing is sent either', noDate.sent === 0, JSON.stringify(noDate));

  const still = await get(`SELECT COUNT(*) AS n FROM newsletter_signups WHERE announced_at IS NOT NULL`);
  ok('…and nobody is marked as told', Number(still.n) === 0);
}

console.log('\n— Only the people who actually asked —');
{
  await seed([
    ['before@x.test', 'nl', 48, false],   // signed up before launch — gets it
    ['after@x.test', 'nl', 1, false],     // signed up after — never wanted it
    ['gone@x.test', 'nl', 48, true],      // unsubscribed — must not be mailed
  ]);
  const r = sendUnder({ env: { LAUNCH_DATE: ago(12) } });
  ok('the person who signed up before launch is mailed', r.sent === 1, JSON.stringify(r));

  const told = await all(`SELECT email FROM newsletter_signups WHERE announced_at IS NOT NULL`);
  ok('…and only them', told.length === 1 && told[0].email === 'before@x.test',
    told.map((t) => t.email).join(','));
  /* Someone who subscribed after the shop opened was already looking at an
     open shop. "We are open now" is not news to them. */
  ok('somebody who signed up after opening is not told the shop opened',
    !told.some((t) => t.email === 'after@x.test'));
  ok('an unsubscribed address is never mailed', !told.some((t) => t.email === 'gone@x.test'));
}

console.log('\n— Never twice —');
{
  await seed([['a@x.test', 'nl', 48], ['b@x.test', 'en', 48]]);
  const first = sendUnder({ env: { LAUNCH_DATE: ago(12) } });
  ok('the first run mails everyone waiting', first.sent === 2, JSON.stringify(first));
  const second = sendUnder({ env: { LAUNCH_DATE: ago(12) } });
  ok('a second run mails nobody', second.sent === 0, JSON.stringify(second));

  const logged = await all(`SELECT to_email FROM email_log WHERE template_id = 'launch_announcement'`);
  ok('…and exactly one mail exists per address',
    logged.length === 2 && new Set(logged.map((l) => l.to_email)).size === 2,
    `${logged.length} rows`);

  /* Stamped BEFORE the send, like review requests: a crash in between costs one
     missed mail, the other order costs a duplicate — and on launch night a
     duplicate to hundreds of strangers is how a domain gets marked as spam. */
  const svc = codeOf('server/src/services/newsletterService.js');
  ok('the row is claimed before the mail goes out',
    /UPDATE newsletter_signups SET announced_at[\s\S]{0,180}if \(!claim\?\.changes\) continue;[\s\S]{0,120}sendEmailAsync/.test(svc));
  ok('…with a conditional update, so two sweeps racing cannot both win',
    /WHERE id = @id AND announced_at IS NULL/.test(svc));
}

console.log('\n— In the language they signed up in —');
{
  await seed([['nl@x.test', 'nl', 48], ['en@x.test', 'en', 48],
    ['de@x.test', 'de', 48], ['fr@x.test', 'fr', 48]]);
  sendUnder({ env: { LAUNCH_DATE: ago(12) } });
  const rows = await all(`SELECT to_email, context FROM email_log WHERE template_id = 'launch_announcement'`);
  ok('everyone is mailed', rows.length === 4, String(rows.length));
  for (const r of rows) {
    const lang = JSON.parse(r.context || '{}').lang;
    ok(`${r.to_email} is mailed in ${lang}`, r.to_email.startsWith(lang), `${r.to_email} got ${lang}`);
  }
  /* The banner is shown in the visitor's language and the consent sentence is
     stored in it, so guessing at launch would be a choice, not a necessity. */
  ok('the signup records the language it was read in',
    /lang = null/.test(codeOf('server/src/services/newsletterService.js'))
    && /lang,$/m.test(codeOf('src/components/store/LaunchBanner.jsx')));

  const trans = read('server/src/services/templateTranslations.js');
  ok('the template exists in all four languages',
    trans.split('launch_announcement:').length === 4
    && /launch_announcement/.test(read('server/src/services/defaultTemplates.js')),
    String(trans.split('launch_announcement:').length - 1));
  ok('…and every language has an unsubscribe link in it',
    trans.split('launch_announcement:').slice(1)
      .every((chunk) => chunk.slice(0, 1400).includes('newsletter.unsubscribeUrl')));
}

console.log('\n— Getting off the list actually works —');
{
  const token = unsubscribeToken('Sam@Example.TEST');
  ok('the token is derived from the address', token.length === 32);
  ok('…case-insensitively, so the link in the mail matches the row',
    tokenMatches('sam@example.test', token));
  ok('…and does not match a different address', !tokenMatches('other@example.test', token));
  ok('…nor a guess', !tokenMatches('sam@example.test', 'a'.repeat(32)));
  /* A bare ?email= would make this a way to unsubscribe strangers and, by
     answering differently for a known address, a way to ask who is on the
     list — which is exactly what subscribe() is careful never to reveal. */
  const route = codeOf('server/src/routes/catalog.js');
  ok('the route requires the token', /if \(tokenMatches\(e, t\)\) await unsubscribe\(e\)/.test(route));
  ok('…and answers the same either way', !/tokenMatches[\s\S]{0,200}else[\s\S]{0,80}status\(4/.test(route));
  ok('…in plain text, because it is opened from an inbox',
    /res\.type\('text\/plain/.test(route));
  ok('the link points at that route', unsubscribeUrl('a@b.test').includes('/api/newsletter/unsubscribe'));
  ok('…carrying both the address and the token',
    /e=a%40b\.test/.test(unsubscribeUrl('a@b.test')) && /&t=[a-f0-9]{32}/.test(unsubscribeUrl('a@b.test')));
}

console.log('\n— It runs unattended —');
{
  const mnt = codeOf('server/src/services/maintenanceService.js');
  ok('the sweep sends them', /sendLaunchAnnouncements\(\{ limit: \d+ \}\)/.test(mnt));
  ok('…and reports how many went', /summary\.launchAnnounced = ann\.sent/.test(mnt));
  /* A launch that slips by a day should still send the mail on the day it
     actually happened, which a timer fired at a fixed moment would not. */
  ok('…in batches, because the provider has a rate limit',
    /limit = 40/.test(codeOf('server/src/services/newsletterService.js')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} launch-announcement: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
