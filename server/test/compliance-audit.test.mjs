/**
 * The compliance audit, and the one property that makes it worth having.
 *
 * A launch-readiness check that goes green because the right files exist is
 * worse than no check at all: it is a document somebody points at afterwards.
 * So the assertions here are mostly about what the audit REFUSES to do —
 * refuses to pass an unbacked claim, refuses to call anything "compliant",
 * refuses to answer a question that needs a real fact about a real business.
 *
 * The seller identity is deliberately empty in this repository. That is not an
 * oversight to be fixed by a test fixture; it is the state the shop is actually
 * in, and the audit's most important job is to keep saying so.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_compliance';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { auditCompliance } = await import('../src/services/complianceCheckService.js');
const result = await auditCompliance();
const { checks, summary } = result;
const by = (id) => checks.find((c) => c.id === id);

console.log('\n── It refuses to certify ──────────────────────────────────');

{
  const cli = rd('scripts/audit-compliance.mjs');
  ok('a clear run is not called compliance',
    /not a statement that this shop is legally compliant/i.test(cli),
    'the one sentence that stops this tool becoming an alibi');
  ok('the result field is named for what it measures',
    'automatedChecksClear' in result && !('compliant' in result),
    Object.keys(result).join(','));
  ok('OWNER items never gate the exit code',
    /OWNER items never change the exit code/.test(cli));
  ok('the report says which environment it read',
    /NODE_ENV=/.test(cli) && /Not a production environment/.test(cli),
    'half these checks read env vars, so running it locally audits the laptop');
}

console.log('\n── It tests facts, not the existence of files ─────────────');

{
  /* The shop has terms, privacy and cookie pages, all substantive. None of that
     makes it legal to open, and the audit must not imply it does. */
  ok('/terms, /privacy and /cookies are found',
    ['docs.terms', 'docs.privacy', 'docs.cookies'].every((id) => by(id)?.level === 'PASS'));
  ok('…and their existence is not treated as the end of it',
    by('docs.reviewed')?.level === 'OWNER',
    'a written document is not a document that is right for this business');

  ok('the VAT sentence is checked for being conditional, not for being present',
    !!by('tax.claim-gated') || !!by('tax.claim-unbacked'));
  ok('an unconditional VAT claim in the document body would fail',
    /hardCodedClaim/.test(rd('server/src/services/complianceCheckService.js')));

  ok('consent is judged by behaviour',
    ['consent.default-deny', 'consent.withdraw', 'consent.refuse-is-equal']
      .every((id) => !!by(id)),
    'a banner existing proves nothing; defaulting to no, deleting on refusal and '
    + 'offering an equal-weight refusal are the things that do');
}

console.log('\n── The state this repository is actually in ───────────────');

{
  /* If any of these start passing without the owner having filled anything in,
     something has been faked. */
  ok('the seller identity is still unpublished, and still blocking',
    by('identity.missing')?.level === 'FAIL',
    'legalName/address/postcode/city are empty in src/lib/legalIdentity.js');
  ok('no legal information has been invented',
    /legalName: ''/.test(rd('src/lib/legalIdentity.js'))
    && /address: ''/.test(rd('src/lib/legalIdentity.js')),
    'these fields belong to a person, and no audit may fill them in');
  ok('registration is asked of the owner, never assumed',
    by('tax.registration')?.level === 'OWNER');
  ok('the processing agreements are asked of the owner, never assumed',
    by('privacy.dpas')?.level === 'OWNER',
    'the privacy policy asserts a DPA with each processor — that is paperwork, not code');
}

console.log('\n── The invoice ────────────────────────────────────────────');

{
  const billing = rd('server/src/services/billingService.js');
  ok('the invoice names the seller from the one source of legal facts',
    /legalIdentity\.js/.test(billing) && /LEGAL\.legalName/.test(billing));
  ok('…and omits unset fields rather than printing them empty',
    /LEGAL\.kvk \?/.test(billing) && /LEGAL\.vat \?/.test(billing));
  ok('an invoice that cannot be valid says so on itself',
    /not a valid invoice/i.test(billing),
    'a buyer should not need to know invoicing law to spot the problem');
  ok('no VAT rate is invented to fill the gap',
    !/0\.21|21%|vatRate\s*=\s*[\d.]/.test(billing),
    'a missing line is better than a false one');

  /* Rendered, not just grepped: the seller block is built by an async helper
     and a mistake there produces a document with the words missing. */
  const { run, get, nowIso } = await import('../src/db/index.js');
  const { newId } = await import('../src/utils/ids.js');
  const { migrate } = await import('../src/db/migrate.js');
  await migrate();
  const id = newId('ord');
  await run(`INSERT INTO orders (id,number,email,status,currency,subtotal,total,billing,created_at,updated_at)
     VALUES (@id,'FM-TEST-INVOICE','buyer@example.test','completed','EUR',999,999,'{}',@at,@at)`,
  { id, at: nowIso() });
  await run(`INSERT INTO order_items (id,order_id,product_id,name,quantity,unit_price,metadata)
     VALUES (@i,@o,NULL,'1,000 Robux',1,999,'{}')`, { i: newId('oit'), o: id });
  const { renderInvoice } = await import('../src/services/billingService.js');
  const html = await renderInvoice(id);
  ok('a rendered invoice with no identity carries the warning',
    /not a valid invoice/i.test(html));
  ok('…and states the VAT position rather than showing a blank',
    /No VAT is itemised/.test(html) || /Prices include VAT/.test(html));
  ok('…and does not print an empty seller address',
    !/From:<\/strong><br>\s*<br>/.test(html));
  await get('SELECT 1');
}

console.log('\n── It is wired where the owner will see it ────────────────');

{
  const launch = rd('server/src/services/launchCheckService.js');
  ok('the readiness dashboard runs the compliance audit',
    /complianceCheckService/.test(launch) && /Legal & tax/.test(launch));
  ok('…and points at the command that lists the detail',
    /audit-compliance\.mjs/.test(launch));
  /* Written and then deleted: an assertion here ended `|| true`, which made it
     pass unconditionally. A test file whose subject is "do not mistake the
     appearance of a check for a check" is the worst possible place to keep
     one. The property it was reaching for — one implementation, not two — is
     already covered by the import assertion above. */
}

console.log('\n── Summary shape ──────────────────────────────────────────');

{
  ok('every check carries an area, a level and a title',
    checks.every((c) => c.area && c.level && c.title));
  ok('levels are only the four defined ones',
    checks.every((c) => ['FAIL', 'WARN', 'OWNER', 'PASS'].includes(c.level)),
    [...new Set(checks.map((c) => c.level))].join(','));
  ok('there is at least one owner item — there always will be',
    summary.owner > 0);
  ok('automatedChecksClear tracks FAIL only',
    result.automatedChecksClear === (summary.fail === 0));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} compliance audit: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
