/**
 * The Discord integration, checked against what it actually does rather than
 * what it looks like it does.
 *
 * Every failure fixed here was silent. Discord calls are best-effort by design —
 * they are wrapped in `.catch(() => {})` so a Discord hiccup can never block an
 * order — and that same wrapper hides a call that never had anywhere to go. So
 * these tests do not check that a function was called; they check what came out
 * the other end, by reading the relay outbox the events are queued into.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_discordfix';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const { ensureReady } = await import('../src/app.js');
await ensureReady();

const { postDropEvent, postDeliveryProof, pruneOutbox } = await import('../src/services/discordService.js');
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { createOrder, markPaymentReceived, getOrder } = await import('../src/services/orderService.js');
const { run, all, get, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const fs = await import('node:fs');

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const tag = Date.now() % 1000000;
const outbox = (kind) => all(
  `SELECT * FROM discord_outbox WHERE kind=@k ORDER BY created_at DESC`, { k: kind });

/** Auto-dispense and every Discord post it triggers run in the background.
 *  Reading the outbox before the order stops moving reads someone else's run. */
const settled = async (orderId, ms = 8000) => {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    last = (await getOrder(orderId)).status;
    if (['completed', 'awaiting_fulfillment', 'refunded', 'cancelled', 'failed'].includes(last)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // The status flips before the best-effort Discord calls have resolved.
  await new Promise((r) => setTimeout(r, 400));
  return last;
};

// ── 1. A scheduled drop reaches Discord at all ──────────────────────────────
console.log('— A scheduled drop is announced, not swallowed —');
{
  await run('DELETE FROM discord_outbox');
  const { createDrop } = await import('../src/services/dropService.js');
  const starts = new Date(Date.now() + 3 * 864e5).toISOString();
  await createDrop({ title: `Robux restock ${tag}`, category: 'robux', note: 'Big one', startsAt: starts });
  // createDrop fires this best-effort and does not await it.
  await new Promise((r) => setTimeout(r, 250));

  const rows = await outbox('deals');
  ok('scheduling a drop queues a Discord event', rows.length === 1, `rows=${rows.length}`);

  const body = rows.length ? JSON.parse(rows[0].payload) : {};
  const embed = body.embeds?.[0] || {};
  ok('…with the drop title in it', String(embed.title || '').includes(`Robux restock ${tag}`), embed.title);
  ok('…and the note the owner wrote', String(embed.description || '').includes('Big one'));
  ok('…and a Discord timestamp so it counts down by itself',
    /<t:\d+:[FR]>/.test(embed.description || ''), embed.description);

  // An unmapped kind used to build /discord/banner-undefined.png.
  ok('the banner image resolves to a file that exists',
    typeof embed.image?.url === 'string' && !embed.image.url.includes('undefined'), embed.image?.url);
  const banner = String(embed.image?.url || '').split('/').pop();
  ok(`…specifically ${banner}`, fs.existsSync(new URL(`../../public/discord/${banner}`, import.meta.url)));
}

// ── 2. Low stock alerts work on the deployment this project documents ───────
console.log('\n— Low stock alerts fire without a webhook configured —');
{
  await run('DELETE FROM discord_outbox');
  const { config } = await import('../src/config/env.js');
  ok('this test really is running relay-only (no webhooks set)',
    !config.discord.stockWebhookUrl && !config.discord.orderWebhookUrl,
    'a webhook is configured — the guard being tested is bypassed');

  const p = await createProduct({ name: `Low Stock Pack ${tag}`, category: 'robux', price: 999, announce: false });
  const codes = Array.from({ length: 3 }, (_, i) => `LOW-${tag}-${i}`);
  await addProductCodes(p.id, codes);
  await run('DELETE FROM discord_outbox');   // ignore the restock announcement

  const o = await createOrder({
    consent: true, consentText: 'test consent', email: `low${tag}@x.dev`,
    items: [{ productId: p.id, quantity: 1 }],
  });
  await markPaymentReceived(o.id, `tx-low-${tag}`, { actorId: 'test' });
  const status = await settled(o.id);
  ok('the order was auto-dispensed', status === 'completed', status);

  const rows = await outbox('leads');
  const alert = rows.map((r) => JSON.parse(r.payload)?.embeds?.[0])
    .find((e) => /low stock|out of stock/i.test(e?.title || ''));
  ok('a low-stock alert is queued for the bot', !!alert, `queued kinds: ${rows.length}`);
  ok('…naming the product', String(alert?.title || '').includes(`Low Stock Pack ${tag}`), alert?.title);

  const src = read('../src/services/codeStockService.js');
  ok('the webhook precondition is gone from checkLowStock',
    !/if \(!config\.discord\.stockWebhookUrl && !config\.discord\.orderWebhookUrl\) return;/.test(src),
    'the early return that disabled alerts on relay-only deploys is back');
}

// ── 3. Public delivery proof carries no buyer identity ──────────────────────
console.log('\n— #proof-of-delivery says what, never who —');
{
  await run('DELETE FROM discord_outbox');
  const p = await createProduct({ name: `Proof Pack ${tag}`, category: 'giftcard', price: 2500, announce: false });
  await addProductCodes(p.id, [`PROOF-${tag}-1`]);
  await run('DELETE FROM discord_outbox');

  const email = `proofbuyer${tag}@x.dev`;
  const o = await createOrder({ consent: true, consentText: 'test consent', email, items: [{ productId: p.id, quantity: 1 }] });
  await markPaymentReceived(o.id, `tx-proof-${tag}`, { actorId: 'test' });
  const status = await settled(o.id);
  ok('the order really did complete', status === 'completed', status);

  const rows = await outbox('proof');
  ok('a completed order posts to the public proof channel', rows.length === 1, `rows=${rows.length}`);

  const raw = rows.length ? rows[0].payload : '';
  const embed = raw ? JSON.parse(raw).embeds?.[0] : {};
  ok('…naming what was delivered', String(embed.description || '').includes(`Proof Pack ${tag}`), embed.description);
  ok('the buyer email is NOT in it', !raw.includes(email), 'email leaked to a public channel');
  ok('the order number is NOT in it', !raw.includes(o.number),
    'order number leaked — it is the public lookup key for /track');
  ok('no buyer name field of any kind', !/customer|buyer|e-?mail/i.test(raw), raw.slice(0, 120));

}

// ── 4. The outbox does not grow forever when the bot never runs ─────────────
console.log('\n— Events nobody will deliver are eventually discarded —');
{
  await run('DELETE FROM discord_outbox');
  const old = new Date(Date.now() - 45 * 864e5).toISOString();
  const recent = new Date(Date.now() - 2 * 864e5).toISOString();
  const oldDelivered = new Date(Date.now() - 45 * 864e5).toISOString();

  await run(`INSERT INTO discord_outbox (id, kind, payload, created_at) VALUES (@id,'leads','{}',@at)`,
    { id: newId('dox'), at: old });
  await run(`INSERT INTO discord_outbox (id, kind, payload, created_at) VALUES (@id,'leads','{}',@at)`,
    { id: newId('dox'), at: recent });
  await run(`INSERT INTO discord_outbox (id, kind, payload, created_at, delivered_at) VALUES (@id,'leads','{}',@at,@d)`,
    { id: newId('dox'), at: oldDelivered, d: oldDelivered });

  const removed = await pruneOutbox();
  ok('an undelivered event older than 30 days is removed', removed === 1, `removed=${removed}`);

  const left = await all('SELECT created_at, delivered_at FROM discord_outbox');
  ok('a recent undelivered event is kept', left.some((r) => !r.delivered_at), 'recent event was purged too');
  ok('nothing that is still fresh was touched', left.length === 2, `left=${left.length}`);

  const maint = read('../src/services/maintenanceService.js');
  ok('maintenance actually calls it', /pruneOutbox\(\)/.test(maint), 'pruning is defined but never scheduled');
  ok('…and reports what it removed', /discordOutboxPruned/.test(maint));
}

// ── 5. The /discord page describes the server the bot builds ────────────────
console.log('\n— The page and the server agree —');
{
  const page = read('../../src/pages/Discord.jsx');
  const botCfg = read('../../discord/src/config.js');

  // Every channel the bot creates, including its historical aliases.
  const realNames = new Set();
  for (const m of botCfg.matchAll(/name: '([a-z0-9-]+)'/g)) realNames.add(m[1]);
  for (const m of botCfg.matchAll(/aka: \[([^\]]+)\]/g)) {
    for (const a of m[1].matchAll(/'([a-z0-9-]+)'/g)) realNames.add(a[1]);
  }

  const listed = [];
  const block = page.match(/const CHANNELS = \[[\s\S]*?\n\];/)?.[0] || '';
  for (const m of block.matchAll(/'([a-z0-9-]+)'/g)) listed.push(m[1]);

  ok('the page lists channels at all', listed.length >= 10, `listed=${listed.length}`);
  const invented = listed.filter((c) => !realNames.has(c));
  ok('every channel the page advertises actually exists', invented.length === 0,
    `the bot never creates: ${invented.join(', ')}`);

  // The channels that sell the server hardest were the ones being left out.
  for (const must of ['proof-of-delivery', 'restocks', 'deals', 'ask-the-bot', 'vouches']) {
    ok(`#${must} is on the page`, listed.includes(must), 'a channel worth joining for is not mentioned');
  }

  // Role colours are Discord's, chosen for Discord's dark chrome. On the white
  // card this page uses in light mode they measured 2.15:1 to 3.96:1.
  ok('role names are not painted in the role colour',
    !/className="font-medium" style=\{\{ color \}\}/.test(page),
    'role names still take an inline colour that fails contrast on a light card');
  ok('the colour swatch is marked decorative', /aria-hidden[\s\S]{0,140}background: color/.test(page));
}

// ── 6. Signed-in customers get the invite that still works ──────────────────
console.log('\n— The account page serves the live invite —');
{
  const acct = read('../src/routes/account.js');
  ok('the account route asks for the live invite',
    /inviteUrl: await getLiveInviteUrl\(\)/.test(acct),
    'still serving config.discord.inviteUrl, which is the env fallback');
  ok('…and imports it', /import \{ getLiveInviteUrl \} from '\.\.\/services\/discordService\.js'/.test(acct));
}

// ── 7. The bot knows where the new events go ────────────────────────────────
console.log('\n— The bot can route everything the store emits —');
{
  const bot = read('../../discord/src/bot.js');
  const service = read('../src/services/discordService.js');

  const emitted = new Set();
  for (const m of service.matchAll(/deliver\('([a-z-]+)'/g)) emitted.add(m[1]);
  const routed = new Set(['dm']);
  const map = bot.match(/const OUTBOX_CHANNEL = \{[\s\S]*?\n\};/)?.[0] || '';
  for (const m of map.matchAll(/^\s{2}([a-z-]+):/gm)) routed.add(m[1]);

  const unrouted = [...emitted].filter((c) => !routed.has(c));
  ok('every channel the store emits to has a route in the bot', unrouted.length === 0,
    `unrouted: ${unrouted.join(', ')}`);
  ok('the proof channel falls back to a channel older servers already have',
    /proof: \['proof-of-delivery',[^\]]*'reviews'/.test(bot));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
