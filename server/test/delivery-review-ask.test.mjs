/**
 * The review ask, in the mail that arrives WITH the thing bought.
 *
 * This shop has zero reviews and its whole trust position rests on getting the
 * first ones. The ask went out in a separate `review_request` mail on a delay —
 * correct, and a day after the only moment the buyer is holding what they paid
 * for. The delivery mail is the message with the highest open rate this shop
 * will ever send, and it asked for nothing.
 *
 * ── THE PART THAT WOULD HAVE SHIPPED AS A NO-OP ───────────────────────────
 * Email templates live in the DATABASE, seeded once and admin-editable after.
 * Editing defaultTemplates.js therefore changes new installs and nothing else:
 * the live shop keeps the row it was seeded with. The first version of this
 * passed every template test and produced no change in a single real email.
 *
 * Found by rendering an order and looking for the block, not by reading the
 * diff. The migration is what makes it real, so most of what is checked here is
 * the migration: that it lands in all four languages, that it runs twice
 * without doubling, and that it leaves an admin's rewritten mail alone.
 */
import { migrate } from '../src/db/migrate.js';
import { run, get, all, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { spawnSync } from 'node:child_process';
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
const { emailCopy, EMAIL_LANGS } = await import('../src/services/emailCopy.js');
/* migrate() creates the table; the rows come from the seeder, exactly as they
   do on a real install. Without this the whole email_templates table is empty
   and renderOrderEmail returns null — which is how this suite found out that a
   migration alone does not put a template anywhere. */
const { syncEmailTemplates } = await import('../src/db/seed.js');
await syncEmailTemplates();

const at = nowIso();
const makeOrder = async (lang = 'nl') => {
  const pid = newId('prd');
  await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
             VALUES (@id,@s,'1,000 Robux','robux','t',999,'EUR','digital',1,'{}',@at,@at)`,
    { id: pid, s: `RV-${pid.slice(-8)}`, at });
  const oid = newId('ord');
  await run(`INSERT INTO orders (id,number,email,status,subtotal,total,currency,billing,created_at,updated_at)
             VALUES (@id,@n,'buyer@example.test','completed',999,999,'EUR',@b,@at,@at)`,
    { id: oid, n: `FM-${oid.slice(-8)}`, b: JSON.stringify({ full_name: 'Sam', lang }), at });
  await run(`INSERT INTO order_items (id,order_id,product_id,name,quantity,unit_price)
             VALUES (@id,@o,@p,'1,000 Robux',1,999)`, { id: newId('oi'), o: oid, p: pid });
  return oid;
};

/* config reads process.env once at import, so each case is its own process —
   the same trap the Stripe suite documents. */
const renderUnder = (env, orderId, lang = 'nl') => {
  const r = spawnSync(process.execPath, ['-e', `
    const { renderOrderEmail } = await import('${join(ROOT, 'server/src/services/orderService.js')}');
    const mail = await renderOrderEmail('${orderId}', 'order_completed');
    process.stdout.write(JSON.stringify({ subject: mail.subject, html: mail.html || mail.body_html || '' }));
    process.exit(0);
  `, '--input-type=module'], {
    encoding: 'utf8', maxBuffer: 20e6,
    env: { ...process.env, TRUSTPILOT_URL: '', TRUSTPILOT_REVIEW_URL: '', ...env },
  });
  try { return JSON.parse(r.stdout.trim()); } catch { return { subject: '', html: '', err: r.stderr }; }
};

const PROFILE = 'https://nl.trustpilot.com/review/forgemarket.nl';

console.log('— The ask lands in the delivery mail —');
{
  const oid = await makeOrder('nl');
  const on = renderUnder({ TRUSTPILOT_URL: PROFILE }, oid);
  ok('the delivery mail renders', /Robux/.test(on.html), on.err || on.subject);
  ok('…and now carries a Trustpilot ask', /trustpilot/i.test(on.html));
  /* The WRITE form, not the profile page: this is an ask, and a profile page
     makes them hunt for the button before they can start. */
  ok('…pointing at the write form, not the profile page',
    /trustpilot\.com\/evaluate\/forgemarket\.nl/.test(on.html)
    && !/trustpilot\.com\/review\/forgemarket\.nl/.test(on.html),
    (on.html.match(/https:\/\/[^"']*trustpilot[^"']*/) || [''])[0]);
  ok('…in the buyer\'s own language', on.html.includes(emailCopy('nl').reviewAskTitle));
  /* Above the "something not right?" line. A complaint route followed by a
     request for five stars reads as tone-deaf. */
  ok('…before the support line, not after it',
    on.html.indexOf('trustpilot') < on.html.indexOf('Klopt er iets niet'),
    `${on.html.indexOf('trustpilot')} vs ${on.html.indexOf('Klopt er iets niet')}`);

  const off = renderUnder({}, oid);
  ok('with no profile configured the mail simply has one block fewer',
    !/trustpilot/i.test(off.html) && /Robux/.test(off.html));
  ok('…and leaves no empty panel behind', !/#14141f/.test(off.html));
}

console.log('\n— Every language, or it is a mail that breaks in three of four —');
{
  for (const lang of EMAIL_LANGS) {
    const oid = await makeOrder(lang);
    const m = renderUnder({ TRUSTPILOT_URL: PROFILE }, oid, lang);
    const c = emailCopy(lang);
    ok(`${lang}: the ask is there, in ${lang}`,
      m.html.includes(c.reviewAskTitle) && m.html.includes(c.reviewAskCta),
      m.err || c.reviewAskTitle);
    ok(`${lang}: …and no raw token is left unsubstituted`,
      !/\{\{order\.reviewAskHtml\}\}/.test(m.html));
  }
  ok('the phrase exists in all four languages, not one',
    EMAIL_LANGS.every((l) => emailCopy(l).reviewAskTitle && emailCopy(l).reviewAskBody && emailCopy(l).reviewAskCta));
  ok('…and none of them silently fell back to Dutch',
    new Set(EMAIL_LANGS.map((l) => emailCopy(l).reviewAskCta)).size === EMAIL_LANGS.length);
}

console.log('\n— The migration, which is the part that reaches a live shop —');
{
  /* A fresh install gets the token from the seeder, because defaultTemplates
     now carries it. The shop that is ALREADY RUNNING does not: its rows were
     written before this change and the seeder deliberately never overwrites a
     body it does not recognise. So this rewinds the rows to that state and
     checks the migration is what closes the gap. */
  await run(`UPDATE email_templates
                SET body_html = REPLACE(body_html, '{{order.reviewAskHtml}}', '')
              WHERE id = 'order_completed'`);
  const before = await all(`SELECT lang, body_html FROM email_templates WHERE id='order_completed'`);
  ok('rewound: no row carries the token', before.length >= 4
    && before.every((r) => !r.body_html.includes('{{order.reviewAskHtml}}')), `${before.length} rows`);

  await run(`DELETE FROM schema_migrations WHERE id = '038_delivery_mail_review_ask'`);
  await migrate();

  const rows = await all(`SELECT lang, body_html FROM email_templates WHERE id = 'order_completed'`);
  ok('every language row carries the token after migrating',
    rows.length >= 4 && rows.every((r) => r.body_html.includes('{{order.reviewAskHtml}}')),
    rows.filter((r) => !r.body_html.includes('{{order.reviewAskHtml}}')).map((r) => r.lang).join(','));
  ok('…exactly once per row, not twice',
    rows.every((r) => r.body_html.split('{{order.reviewAskHtml}}').length === 2));
  ok('…and above the support line in every language',
    rows.every((r) => r.body_html.indexOf('{{order.reviewAskHtml}}')
      < r.body_html.indexOf("color:#8b8fa3;text-align:center")));

  /* A migration that is not idempotent corrupts the second time anyone runs
     it, and migrations get re-run — on a restore, on a new environment. */
  await run(`DELETE FROM schema_migrations WHERE id = '038_delivery_mail_review_ask'`);
  await migrate();
  const again = await all(`SELECT body_html FROM email_templates WHERE id = 'order_completed'`);
  ok('running it twice changes nothing',
    again.every((r) => r.body_html.split('{{order.reviewAskHtml}}').length === 2));

  const mig = read('server/src/db/migrations.js');
  ok('…because it is guarded rather than blind',
    /body_html NOT LIKE '%reviewAskHtml%'/.test(mig));

  /* An owner who rewrote the mail keeps their version: the anchor is absent, so
     REPLACE does nothing. Better than a half-patched template. */
  await run(`INSERT INTO email_templates (id, lang, name, subject, body_html, enabled, updated_at)
             VALUES ('order_completed','es','Custom','s','<p>totally rewritten by the owner</p>',1,@at)`,
    { at }).catch(() => {});
  await run(`DELETE FROM schema_migrations WHERE id = '038_delivery_mail_review_ask'`);
  await migrate();
  const custom = await get(`SELECT body_html FROM email_templates WHERE id='order_completed' AND lang='es'`);
  ok('a rewritten template is left exactly as the owner wrote it',
    custom && custom.body_html === '<p>totally rewritten by the owner</p>', custom?.body_html);
}

console.log('\n— The shipped defaults, so a fresh install matches a migrated one —');
{
  const dflt = read('server/src/services/defaultTemplates.js');
  const trans = read('server/src/services/templateTranslations.js');
  ok('the Dutch default carries the token', dflt.includes('{{order.reviewAskHtml}}'));
  ok('…and all three translations do too',
    trans.split('{{order.reviewAskHtml}}').length === 4,
    String(trans.split('{{order.reviewAskHtml}}').length - 1));
  const svc = read('server/src/services/orderService.js');
  ok('the block is generated server-side, like every other optional block',
    /function reviewAskHtml\(order, lang\)/.test(svc));
  ok('…and renders empty with no profile configured',
    /const url = config\.shop\.trustpilotReviewUrl;\s*\n\s*if \(!url\) return '';/.test(svc));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} delivery-review-ask: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
