/**
 * The store side of the Discord relay: what the bot needs, and what the owner
 * is told when it cannot connect.
 *
 * - /balance carries `completedOrders`. The bot's /vouch read that field and the
 *   response never had it, so every vouch was a "community vouch" and none
 *   ever reached the site's reviews.
 * - The launch check names a missing REVIEW_INGEST_SECRET. It said "no Vercel
 *   setup needed" while every bot call was refused for want of exactly that.
 * - The secrets are trimmed, as the bot trims them: a trailing newline pasted
 *   into one dashboard was a permanent "Bad signature".
 * - The payment-reminder DM follows the payment provider: under Pay. it no
 *   longer tells the buyer to make a bank transfer.
 */
process.env.NODE_ENV = 'development';
process.env.REVIEW_INGEST_SECRET = '  bot-secret-for-tests\n';
process.env.DISCORD_PAYLINK_SECRET = ' paylink-secret \n';
process.env.DISCORD_GUILD_ID = '111111111111111111';
process.env.LAUNCH_MODE = 'open';
process.env.LAUNCH_DATE = '2026-01-01T00:00:00Z';

import { signRequestV2 } from '../../discord/src/signing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { config } = await import('../src/config/env.js');
const srv = createApp().listen(0);
const origin = `http://127.0.0.1:${srv.address().port}`;

let lastTs = 0;
const signed = async (path, body, secret = 'bot-secret-for-tests') => {
  const ts = String(lastTs = Math.max(Date.now(), lastTs + 1));
  const raw = JSON.stringify(body);
  const r = await fetch(`${origin}${path}`, { method: 'POST', body: raw, headers: {
    'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': signRequestV2(secret, ts, 'POST', path, raw) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

console.log('— Secrets are trimmed —');
ok('REVIEW_INGEST_SECRET', config.discord.reviewIngestSecret === 'bot-secret-for-tests', JSON.stringify(config.discord.reviewIngestSecret));
ok('DISCORD_PAYLINK_SECRET', config.discord.paylinkSecret === 'paylink-secret', JSON.stringify(config.discord.paylinkSecret));
{
  const r = await signed('/api/discord/state/get', { key: 'meta' });
  ok('…so the bot\'s trimmed secret is accepted', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
}

console.log('\n— /balance says whether the member has bought something —');
{
  const uid = `9${Date.now()}`;
  const userId = newId('usr');
  const at = nowIso();
  await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'V', @at, @at)`,
    { id: userId, e: `v-${uid}@x.dev`, at });
  await run(`INSERT INTO oauth_accounts (id, user_id, provider, provider_uid, email, raw_profile, created_at)
             VALUES (@id, @u, 'discord', @p, NULL, '{}', @at)`, { id: newId('oa'), u: userId, p: uid, at });
  const before = await signed('/api/discord/balance', { uid });
  ok('a linked member with no orders: completedOrders is 0',
    before.status === 200 && before.body.linked === true && before.body.completedOrders === 0, JSON.stringify(before.body));

  const { createProduct } = await import('../src/services/productService.js');
  const { createOrder } = await import('../src/services/orderService.js');
  const p = await createProduct({ name: `Vouch ${Date.now()}`, category: 'steam', price: 500, currency: 'EUR', active: true, announce: false });
  const o = await createOrder({ email: `v-${uid}@x.dev`, userId, consent: true, consentText: 'ok', items: [{ productId: p.id, quantity: 1 }] });
  await run(`UPDATE orders SET status='completed' WHERE id=@id`, { id: o.id });
  const after = await signed('/api/discord/balance', { uid });
  ok('after a completed order: completedOrders is 1 (so /vouch is a verified purchase)',
    after.body.completedOrders === 1, JSON.stringify(after.body));
  ok('the rest of the answer is unchanged', 'coins' in after.body && 'creditCents' in after.body && 'tier' in after.body);
}

console.log('\n— The launch check names the missing secret —');
{
  const { launchChecks } = await import('../src/services/launchCheckService.js');
  const saved = config.discord.reviewIngestSecret;
  const savedBits = [config.discord.botToken, config.discord.orderWebhookUrl, config.discord.dropsWebhookUrl];
  config.discord.botToken = ''; config.discord.orderWebhookUrl = ''; config.discord.dropsWebhookUrl = '';
  await run(`DELETE FROM kv WHERE key='discord_bot_seen_at'`).catch(() => {});

  config.discord.reviewIngestSecret = '';
  const off = (await launchChecks()).checks.find((c) => c.id === 'discord');
  ok('no REVIEW_INGEST_SECRET on the site: FAIL, naming it', off?.status === 'fail' && /REVIEW_INGEST_SECRET/.test(off?.detail || ''), JSON.stringify(off));
  ok('…and no longer "no Vercel setup needed"', !/no Vercel setup needed/.test(off?.detail || ''));

  config.discord.reviewIngestSecret = 'set';
  const waiting = (await launchChecks()).checks.find((c) => c.id === 'discord');
  ok('secret set, bot not seen: a warning that says what to check', waiting?.status === 'warn' && /store relay: ok/.test(waiting?.detail || ''), JSON.stringify(waiting));

  config.discord.reviewIngestSecret = saved;
  [config.discord.botToken, config.discord.orderWebhookUrl, config.discord.dropsWebhookUrl] = savedBits;
}

console.log('\n— The payment-reminder DM follows the provider —');
{
  const { paymentReminderEmbed } = await import('../src/services/discordService.js');
  const pay = paymentReminderEmbed({ orderNumber: 'FM-2026-AAAA1111', amount: '€ 9,99', lang: 'nl', provider: 'paynl' });
  ok('under Pay.: pay from the order page, no bank transfer', /bestelling/.test(pay.description) && !/Maak het exacte bedrag over/.test(pay.description), pay.description);
  /* The link moved from the text into the message's button (one link, not two). */
  const { paymentReminderMessage } = await import('../src/services/discordService.js');
  const btn = paymentReminderMessage({ orderNumber: 'FM-2026-AAAA1111', amount: '€ 9,99', lang: 'nl', provider: 'paynl' })
    .components?.[0]?.components?.[0] || {};
  ok('…and the button says to pay', /Betaal je bestelling/.test(btn.label || ''), JSON.stringify(btn));
  const manual = paymentReminderEmbed({ orderNumber: 'FM-2026-AAAA1111', lang: 'nl', provider: 'manual' });
  ok('a manual shop still gets the transfer instructions', /Maak het exacte bedrag over/.test(manual.description));
  ok('the button goes to the order\'s track page', /\/track\?number=FM-2026-AAAA1111$/.test(btn.url || ''), btn.url);
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} discord-relay-fixes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
