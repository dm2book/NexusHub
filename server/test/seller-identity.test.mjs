/**
 * Who is selling, and whether saying so still needs a deploy.
 *
 * ── THE FAILURE THIS FILE EXISTS FOR ──────────────────────────────────────
 * The seller's name, address, KvK and BTW number were VITE_* variables, which
 * Vite bakes into the browser bundle at BUILD time. The owner registers at the
 * Kamer van Koophandel, types six values into Vercel, sees them saved — and the
 * site keeps telling buyers there is no registered company, because nothing
 * rebuilt. Nothing on any screen would have said why.
 *
 * So the values are stored, the admin edits them, and every surface that states
 * who is selling reads the result: the legal pages via /api/config, the invoice
 * and the terms via the shared LEGAL object, and the readiness panel via the
 * launch check. The assertions below are mostly about those surfaces agreeing.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
/* Set before anything imports the identity: this stands in for a shop that has
   the old environment variables configured, so the fallback is exercised rather
   than assumed. */
process.env.VITE_LEGAL_TRADE_NAME = 'Env Trade Name';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const svc = await import('../src/services/sellerIdentityService.js');
const { LEGAL, legalComplete } = await import('../../src/lib/legalIdentity.js');
const { all } = await import('../src/db/index.js');

const STAFF = { id: 'usr_staff', email: 'owner@forgemarket.nl' };

console.log('\n— Before anything is filled in —');
{
  const before = await svc.sellerIdentity();
  ok('the shop knows it cannot say who is selling',
    before.complete === false && before.missing.length > 0, JSON.stringify(before.missing));
  ok('…and names the fields rather than a file',
    before.missing.every((m) => ['legalName', 'address', 'postcode', 'city'].includes(m)),
    JSON.stringify(before.missing));
  ok('…and is not pretending to be registered', before.registered === false);
}

console.log('\n— The owner fills it in, and nothing is rebuilt —');
{
  const saved = await svc.setSellerIdentity({
    legalName: 'M. El Hannouti', address: 'Voorbeeldstraat 1',
    postcode: '1234 AB', city: 'Amsterdam',
  }, { actor: STAFF });
  ok('the required set is complete', saved.complete === true, JSON.stringify(saved.missing));
  ok('…still without a KvK number, honestly', saved.registered === false);

  /* The whole point: the object every other surface reads was updated in the
     running process, not at the next build. */
  ok('the shared identity is updated in place', LEGAL.city === 'Amsterdam', LEGAL.city);
  ok('…so the legal pages now consider themselves complete', legalComplete() === true);

  const block = await svc.sellerLegalBlock();
  ok('the public config carries it', block.legalName === 'M. El Hannouti' && block.city === 'Amsterdam',
    JSON.stringify(block));
  /* Values only. Where a string was configured is the owner's business. */
  ok('…and nothing about where it came from', !('source' in block) && !('env' in block));

  const identity = await svc.sellerIdentity();
  ok('the admin can see which fields it now owns',
    identity.source.legalName === 'admin', JSON.stringify(identity.source));
}

console.log('\n— The 15th of October —');
{
  const saved = await svc.setSellerIdentity({ kvk: '98765432', vat: 'NL004495445B01' },
    { actor: STAFF });
  ok('a KvK number can be added on its own', saved.values.kvk === '98765432');
  ok('…without losing the address', saved.values.city === 'Amsterdam', JSON.stringify(saved.values));
  ok('…and the shop now says it is registered', saved.registered === true);

  /* The terms make a VAT claim only when there is a number behind it. That
     sentence is derived from this field, so registering has to change it. */
  const { vatStatement } = await import('../../src/lib/legalIdentity.js');
  ok('the terms may now state that prices include VAT',
    /inclusief btw|include VAT/i.test(vatStatement(true) + vatStatement(false)),
    vatStatement(true).slice(0, 60));

  /* And the readiness panel has to agree with the legal page, or the owner is
     reconciling two screens about one fact. */
  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const checks = await launchChecks();
  const identity = checks.checks.find((c) => c.id === 'identity');
  ok('the launch check passes', identity?.status === 'ok', JSON.stringify(identity));
  ok('…and shows the number it read', /98765432/.test(identity?.detail || ''), identity?.detail);
}

console.log('\n— Corrections, clearing, and the audit —');
{
  const cleared = await svc.setSellerIdentity({ vat: '' }, { actor: STAFF });
  /* An empty box means "I have not set this", so it falls back rather than
     storing emptiness that would hide an environment variable. */
  ok('an emptied field is unset, not stored blank', !cleared.values.vat, JSON.stringify(cleared.values.vat));
  ok('…and the rest is untouched', cleared.values.kvk === '98765432');

  /* A field the build also sets goes back to the build's value when emptied,
     rather than to the value that was just removed. */
  const named = await svc.setSellerIdentity({ tradeName: 'Admin Trade Name' }, { actor: STAFF });
  ok('the admin can override a build value', named.values.tradeName === 'Admin Trade Name');
  const unnamed = await svc.setSellerIdentity({ tradeName: '' }, { actor: STAFF });
  ok('…and emptying it falls back to the build, not to what it held',
    unnamed.values.tradeName === 'Env Trade Name', unnamed.values.tradeName);
  ok('…which the shared object agrees with', LEGAL.tradeName === 'Env Trade Name', LEGAL.tradeName);
  ok('…and is labelled as coming from the build again',
    unnamed.source.tradeName === 'environment', unnamed.source.tradeName);

  let tooLong = null;
  try {
    await svc.setSellerIdentity({ legalName: 'x'.repeat(500) }, { actor: STAFF });
  } catch (e) { tooLong = e.message; }
  ok('an absurd value is refused', /too long/i.test(tooLong || ''), tooLong);

  /* This block appears on invoices and in terms a customer agreed to, so a
     later "when did the KvK number change, and from what?" has to have an
     answer. */
  const rows = await all(
    `SELECT metadata FROM audit_logs WHERE action='legal.identity_set' ORDER BY created_at ASC`);
  ok('every change is audited', rows.length >= 3, String(rows.length));
  ok('…with the value it replaced',
    rows.some((r) => /"before":\{[^}]*"kvk":"98765432"/.test(String(r.metadata))),
    String(rows[rows.length - 1]?.metadata).slice(0, 120));
}

console.log(`\n${fail ? '❌' : '✅'} seller-identity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
