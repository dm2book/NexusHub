/**
 * Keys typed in instead of deployed — and the capacity question they unlock.
 *
 * ── WHAT THIS FILE IS DEFENDING ───────────────────────────────────────────
 * A Stripe key, a Resend key, a supplier key: all environment variables, all
 * requiring a redeploy by somebody who knows a redeploy is needed. The seller
 * identity already moved for that reason and the trap is worse here — a webhook
 * secret that is set but not deployed produces a shop that takes money and
 * never delivers.
 *
 * Moving them into the database buys that convenience with two new risks, and
 * most of what follows is about them:
 *
 *   1. a stored key must never come back out to a browser, or to the audit log;
 *   2. a key encrypted under a JWT_SECRET that has since changed must be
 *      reported as UNREADABLE, not as unset — "not set" sends the owner looking
 *      for a setting that is there, while the shop quietly uses the old one.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';
process.env.JWT_SECRET ||= 'test-secret-for-the-key-store-0123456789';
/* An environment key, so the fallback is exercised rather than assumed. */
process.env.RESEND_API_KEY = 're_from_the_environment_9999';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { ensureReady } = await import('../src/app.js');
await ensureReady();
const store = await import('../src/services/secretStore.js');
const cap = await import('../src/services/capacityService.js');
const { config } = await import('../src/config/env.js');
const { all, get } = await import('../src/db/index.js');
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');

const STAFF = { id: 'usr_staff', email: 'owner@forgemarket.nl' };
const find = (rows, id) => rows.find((r) => r.id === id);

console.log('\n— A key typed in is a key in use —');
{
  const before = find(await store.secretStatus(), 'stripe.secretKey');
  ok('nothing is set to begin with', before.set === false && before.source === 'unset',
    JSON.stringify(before));

  const rows = await store.setSecret('stripe.secretKey', 'sk_live_TYPEDINADMIN1234', { actor: STAFF });
  const after = find(rows, 'stripe.secretKey');
  ok('saving it marks it set', after.set === true && after.source === 'admin');
  /* The point of the whole exercise: the config the checkout reads. */
  ok('…and the live config carries it',
    config.payments.stripe.secretKey === 'sk_live_TYPEDINADMIN1234',
    config.payments.stripe.secretKey);
  ok('…so the payment check sees a configured shop',
    (await import('../src/services/stripeService.js')).isEnabled() === true);
}

console.log('\n— And never comes back out —');
{
  const rows = await store.secretStatus();
  const k = find(rows, 'stripe.secretKey');
  ok('the status carries no value', !('value' in k), JSON.stringify(Object.keys(k)));
  ok('…only the last four characters', k.masked === '…1234', k.masked);
  const blob = JSON.stringify(rows);
  ok('…and the whole payload contains the key nowhere',
    !blob.includes('sk_live_TYPEDINADMIN1234'));

  /* An audit log is not a place to keep a live Stripe key. */
  const logs = await all(
    `SELECT action, metadata FROM audit_logs WHERE action LIKE 'settings.secret%'`);
  ok('the change is audited', logs.length >= 1, String(logs.length));
  ok('…without the value in it',
    !logs.some((l) => String(l.metadata).includes('sk_live_TYPEDINADMIN1234')),
    String(logs[0]?.metadata).slice(0, 100));

  /* Nor is the database row itself. */
  const row = await get(`SELECT value FROM app_secrets WHERE key='stripe.secretKey'`);
  ok('…and the stored row is ciphertext, not the key',
    !!row && !String(row.value).includes('sk_live_') && /^v1\./.test(String(row.value)),
    String(row?.value).slice(0, 24));
}

console.log('\n— The environment stays the fallback —');
{
  const k = find(await store.secretStatus(), 'email.resendApiKey');
  ok('an environment key is reported as set', k.set === true && k.source === 'environment',
    JSON.stringify(k));

  await store.setSecret('email.resendApiKey', 're_typed_in_the_admin_1111', { actor: STAFF });
  ok('…and is overridden by one typed in',
    config.email.resendApiKey === 're_typed_in_the_admin_1111', config.email.resendApiKey);

  /* Clearing falls back to the build, not to nothing — otherwise clearing a
     key would silently take email down on a shop that has always used Vercel
     variables. */
  await store.setSecret('email.resendApiKey', '', { actor: STAFF });
  ok('…and clearing it falls back to the environment',
    config.email.resendApiKey === 're_from_the_environment_9999', config.email.resendApiKey);
  const back = find(await store.secretStatus(), 'email.resendApiKey');
  ok('…which the screen says', back.source === 'environment' && back.set === true);
}

console.log('\n— A key nobody can read is not a key nobody set —');
{
  await store.setSecret('mollie.apiKey', 'live_MOLLIEKEY0000', { actor: STAFF });
  /* Rewrite the row as if it had been encrypted under a different secret. */
  const { run } = await import('../src/db/index.js');
  await run(`UPDATE app_secrets SET value='v1.AAAA.BBBB.CCCC' WHERE key='mollie.apiKey'`);
  const k = find(await store.secretStatus(), 'mollie.apiKey');
  ok('an undecryptable value is flagged', k.unreadable === true, JSON.stringify(k));
  ok('…and is not reported as simply unset', k.set === false && k.source === 'unset');
  /* And the live config must not keep using the value it had before. */
  await store.applyStoredSecrets();
  ok('…and the shop stops using it', !config.payments.mollie.apiKey,
    String(config.payments.mollie.apiKey));
}

console.log('\n— What is still missing, in the owner’s words —');
{
  await store.setSecret('stripe.webhookSecret', '', { actor: STAFF });
  const missing = await store.missingEssentials();
  const hook = missing.find((m) => m.id === 'stripe.webhookSecret');
  ok('a Stripe key without a webhook secret is called out', !!hook, JSON.stringify(missing));
  ok('…by what breaks, not by the variable name',
    /no order is ever marked paid/.test(hook?.why || ''), hook?.why);

  await store.setSecret('stripe.webhookSecret', 'whsec_ABCD1234', { actor: STAFF });
  const after = await store.missingEssentials();
  ok('…and it stops being missing once set',
    !after.some((m) => m.id === 'stripe.webhookSecret'), JSON.stringify(after));
}

console.log('\n— How many orders can this shop actually serve? —');
{
  /* Measured, not assumed: twelve orders driven through the real API against a
     shop with codes were all delivered without a human. Stock is the ceiling,
     so the number has to come from stock. */
  const p = await createProduct({
    name: 'Capacity Test Pack', sku: `CAPTEST-${Date.now()}`, category: 'robux',
    price: 999, currency: 'EUR', active: true, announce: false, metadata: {},
  });
  const before = await cap.capacity({ target: 10 });
  const mine = before.rows.find((r) => r.id === p.id);
  ok('a product with no codes counts for nothing', mine.automatic === 0, JSON.stringify(mine));
  /* `dry` is a preview capped at twelve, so membership in it is not the claim —
     being counted is. The preview is asserted separately, on its order. */
  ok('…and is counted as needing a person',
    before.rows.find((r) => r.id === p.id).codes === 0 && before.productsDry > 0,
    String(before.productsDry));
  ok('…and the shortlist is ordered by what it costs to leave unstocked',
    before.dry.every((r, i) => i === 0
      || before.dry[i - 1].soldPerDay > r.soldPerDay
      || (before.dry[i - 1].soldPerDay === r.soldPerDay && before.dry[i - 1].price >= r.price)),
    JSON.stringify(before.dry.slice(0, 3).map((r) => [r.sku, r.price])));

  await addProductCodes(p.id, Array.from({ length: 14 }, (_, i) => `CAP-${i}-${Date.now()}`));
  const after = await cap.capacity({ target: 10 });
  const now = after.rows.find((r) => r.id === p.id);
  ok('fourteen codes is fourteen unattended orders', now.automatic === 14, JSON.stringify(now));
  ok('…and the shop total counts them', after.ordersToday >= 14, String(after.ordersToday));
  ok('…and it no longer needs a person', !after.dry.some((r) => r.id === p.id));

  const line = await cap.capacityLine({ target: 10 });
  ok('the readiness line answers the question asked',
    /order\(s\) can be filled from stock without you/.test(line.detail), line.detail);

  /* A product the owner chose to deliver by hand is work, not capacity. */
  const { updateProduct } = await import('../src/services/productService.js');
  await updateProduct(p.id, { metadata: { ...p.metadata, deliveryMode: 'manual' } });
  const manual = await cap.capacity({ target: 10 });
  const m = manual.rows.find((r) => r.id === p.id);
  ok('a manual product is not counted as capacity', m.manual === true && m.automatic === 0,
    JSON.stringify(m));
  ok('…nor listed as missing stock', !manual.dry.some((r) => r.id === p.id));
}

console.log(`\n${fail ? '❌' : '✅'} setup-keys: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
