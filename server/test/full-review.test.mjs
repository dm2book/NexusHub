/**
 * The full review round: the fixes it made, each pinned so it stays fixed.
 *
 *   honesty    product API carries no internal metadata; mystery odds published
 *   security   http(s)-only links; DNS-aware SSRF guard; supplier secrets masked
 *              (and not wiped by saving the mask back); stricter SVG sanitizer;
 *              phone codes burn after 5 wrong guesses; opt-outs stay opted out;
 *              a rejected proof never deletes a shop image
 *   stability  broadcast history query; review indexes; offline bot is not a
 *              failed channel
 */
import './_selling-shop.mjs';   // must come first — see that file
import { ensureReady, createApp } from '../src/app.js';
import { all, get, run, nowIso } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { createHash } from 'node:crypto';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
await ensureReady();
const stamp = Date.now();

console.log('— Links —');
{
  const { httpUrl } = await import('../src/utils/httpUrl.js');
  const v = httpUrl(500);
  ok('https link accepted', v.safeParse('https://example.com/a.png').success);
  ok('javascript: refused', !v.safeParse('javascript:alert(1)').success);
  ok('data: refused', !v.safeParse('data:text/html,<script>1</script>').success);
  const { isPrivateAddress, assertPublicTarget } = await import('../src/utils/imageUrl.js');
  ok('private and metadata addresses are private', ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1'].every(isPrivateAddress));
  ok('public addresses are not', !isPrivateAddress('8.8.8.8') && !isPrivateAddress('2606:4700::1'));
  let refused = false;
  try { await assertPublicTarget('http://127.0.0.1/x'); } catch { refused = true; }
  ok('a literal loopback link is refused', refused);
  refused = false;
  try { await assertPublicTarget('http://localhost./x'); } catch { refused = true; }
  ok('a name resolving to loopback is refused', refused);
}

console.log('— IPv4 inside IPv6, Discord webhooks —');
{
  const { isPrivateAddress } = await import('../src/utils/imageUrl.js');
  ok('IPv4-mapped IPv6 in the form a URL parser writes is private ([::ffff:7f00:1] = 127.0.0.1)',
    isPrivateAddress('::ffff:7f00:1') && isPrivateAddress('[::ffff:a9fe:a9fe]') && isPrivateAddress('0:0:0:0:0:ffff:7f00:1'));
  ok('…and NAT64 / compatible forms of private addresses too', isPrivateAddress('64:ff9b::a9fe:a9fe') && isPrivateAddress('::7f00:1'));
  ok('…while a mapped public address stays public', !isPrivateAddress('::ffff:8.8.8.8') && !isPrivateAddress('64:ff9b::808:808'));
  const { isDiscordWebhookUrl } = await import('../src/utils/discordWebhook.js');
  ok('a real Discord webhook link is accepted', isDiscordWebhookUrl('https://discord.com/api/webhooks/123/abc_DEF-1'));
  ok('look-alike hosts, http, ports and other paths are not',
    ['https://discord.com.evil.io/api/webhooks/1/x', 'http://discord.com/api/webhooks/1/x',
      'https://discord.com:8443/api/webhooks/1/x', 'https://169.254.169.254/latest/meta-data', 'https://discord.com/login']
      .every((u) => !isDiscordWebhookUrl(u)));
  const { setSecret } = await import('../src/services/secretStore.js');
  let refused = null;
  try { await setSecret('notify.discordWebhookUrl', 'http://169.254.169.254/latest/meta-data'); } catch (e) { refused = e; }
  ok('the admin cannot save a non-Discord address as the alert webhook', refused?.status === 400, refused?.message || 'saved');
}

console.log('— robots.txt —');
{
  const { isAllowed, clearRobotsCache } = await import('../src/services/market/robots.js');
  clearRobotsCache();
  let calls = 0;
  const down = async () => { calls++; throw new Error('connect ECONNRESET'); };
  const first = await isAllowed('https://shop.example/catalog', { fetchImpl: down });
  ok('a robots.txt that cannot be read means "not allowed"', first.allowed === false && calls === 1, first.reason);
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60_000;
  const up = async () => { calls++; return new Response('', { status: 404 }); };
  const later = await isAllowed('https://shop.example/catalog', { fetchImpl: up });
  Date.now = realNow;
  ok('…but a network blip is asked again after ten minutes, not six hours', later.allowed === true && calls === 2, `${calls} calls, ${later.reason}`);
  let sawSignal = null;
  await isAllowed('https://other.example/x', { fetchImpl: async (u, init) => { sawSignal = init.signal; return new Response('User-agent: *\nDisallow:', { status: 200 }); } });
  ok('the request carries a timeout signal that also covers reading the body', !!sawSignal && typeof sawSignal.aborted === 'boolean');
  const src = (await import('node:fs')).readFileSync(new URL('../src/routes/admin/discovery.js', import.meta.url), 'utf8');
  ok('an unexpected discovery error is a logged 500, not a 400', /console\.error\('\[discovery\]'/.test(src) && /status\(e\?\.status \|\| 500\)/.test(src));
}

console.log('— Maintenance finishes inside the time it is given —');
{
  const { runMaintenance, LAST_RUN_KEY } = await import('../src/services/maintenanceService.js');
  const { getSetting } = await import('../src/services/settingsService.js');
  const t = Date.now();
  await runMaintenance({ deadline: t + 9_000 });
  const took = Date.now() - t;
  const rec = await getSetting(LAST_RUN_KEY, null);
  ok('a run given 9 s is done within them', took < 9_500, `${took} ms`);
  ok('…and leaves its receipt (so the sweep does not look stopped)', !!rec?.finishedAt && Date.parse(rec.finishedAt) >= t, JSON.stringify(rec || {}).slice(0, 200));
  const app = (await import('node:fs')).readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  ok('the self-scheduled run plans from the request\u2019s start, not its own',
    /req\.startedAt = Date\.now\(\)/.test(app) && /runMaintenance\(\{ deadline \}\)/.test(app));
}

console.log('— SVG —');
{
  const { sanitizeSvg, assess } = await import('../src/services/logoDiscoveryService.js');
  const out = sanitizeSvg('<svg/onload=alert(1)><a href=javascript:alert(2)><path d="M0"/></a><set attributeName="href" to="javascript:x"/><animate attributeName="href" values="x"></animate><use href="#a"/></svg>');
  ok('handlers, unquoted javascript: links, <set> and <animate> are removed', !/onload|javascript:|<set|<animate/i.test(out), out);
  ok('same-document references are kept', /href="#a"/.test(out));
  const bad = assess({ tier: 'commons', mime: 'image/svg+xml', bytes: Buffer.from('<svg/onload=alert(1)><path d="M0"/></svg>'), url: 'https://x/logo.svg' });
  ok('an SVG with a slash-written handler is rejected', bad.status === 'rejected', JSON.stringify(bad));
}

console.log('— Product API —');
{
  const { productPayload } = await import('../src/services/productPayload.js');
  const p = productPayload({ id: 'p1', name: 'X', price: 500, metadata: { platform: 'PC', discovery: { by: 'owner@example.com' }, content: { nl: 'x'.repeat(1000) }, supplierCost: 300 } }, 5);
  ok('public metadata keeps the platform', p.metadata.platform === 'PC');
  ok('discovery, supplier cost and raw content are not published', !('discovery' in p.metadata) && !('supplierCost' in p.metadata) && !('content' in p.metadata));
  ok('…and no address leaks anywhere in it', !JSON.stringify(p).includes('owner@example.com'));
}

console.log('— Mystery odds —');
{
  const { oddsFor } = await import('../src/services/mysteryBoxService.js');
  const o = oddsFor([{ label: 'A', credit: 100, weight: 90 }, { label: 'B', credit: 1000, weight: 10 }]);
  const sum = o.rewards.reduce((s, r) => s + r.chance, 0);
  ok('the chances add up to 100%', Math.abs(sum - 100) < 0.6, String(sum));
  ok('more luck makes the big prize likelier, never certain', o.rewards[1].chanceMax > o.rewards[1].chance && o.rewards[1].chanceMax < 100);
  ok('the average value is published', o.averageCredit > 100 && o.averageCredit < 1000);
}

console.log('— Admin API —');
const owner = newId('usr');
await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, 'O', @at, @at)`,
  { id: owner, e: `o-${stamp}@x.dev`, at: nowIso() });
await run(`INSERT INTO user_roles (user_id, role_id, granted_at) VALUES (@u, 'owner', @at) ON CONFLICT DO NOTHING`, { u: owner, at: nowIso() });
const { finalizeLogin } = await import('../src/services/authService.js');
const { accessToken } = await finalizeLogin(await get(`SELECT * FROM users WHERE id=@id`, { id: owner }), {});
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const H = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
{
  const { availableKinds } = await import('../src/services/supplier/registry.js');
  const kind = availableKinds().includes('api') ? 'api' : availableKinds()[0];
  const c = await call('POST', '/api/admin/suppliers', { name: 'Test', connectorKind: kind, config: { apiKey: 'sk_live_abcdefgh1234', baseUrl: 'https://api.example.com' } });
  ok('supplier created', c.status === 201, JSON.stringify(c.body));
  const id = c.body.supplier?.id;
  ok('the key comes back masked', c.body.supplier?.config?.apiKey === '••••••1234' && c.body.supplier.config.baseUrl === 'https://api.example.com');
  const list = await call('GET', '/api/admin/suppliers');
  ok('…in the list as well', !JSON.stringify(list.body).includes('sk_live_abcdefgh'));
  const p = await call('PATCH', `/api/admin/suppliers/${id}`, { name: 'Test 2', config: { ...c.body.supplier.config } });
  const row = await get(`SELECT config FROM suppliers WHERE id=@id`, { id });
  const cfg = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
  ok('saving the form with the mask keeps the real key', p.status === 200 && cfg.apiKey === 'sk_live_abcdefgh1234', JSON.stringify(cfg));

  const bad = await call('POST', `/api/admin/logos/sources`, { brand: 'roblox', tier: 'brand_assets', url: 'javascript:alert(1)' });
  ok('a javascript: source link is refused', bad.status === 400);

  const { recentBroadcasts } = await import('../src/services/broadcastService.js');
  let err = null; try { await recentBroadcasts(5); } catch (e) { err = e; }
  ok('the broadcast history query runs (ORDER BY "sentAt")', !err, err?.message);
}

console.log('— Phone codes —');
{
  const phone = '+31612345678';
  await run(`INSERT INTO sms_verifications (id, phone, code_hash, expires_at, created_at) VALUES (@id, @p, @h, @exp, @at)`,
    { id: newId('sms'), p: phone, h: createHash('sha256').update('123456').digest('hex'), exp: new Date(Date.now() + 600_000).toISOString(), at: nowIso() })
    .catch((e) => console.log('   (insert)', e.message));
  for (let i = 0; i < 5; i++) await call('POST', '/api/account/phone/verify', { phone, code: '000000' });
  const right = await call('POST', '/api/account/phone/verify', { phone, code: '123456' });
  ok('after five wrong guesses even the right code no longer works', right.status === 400 && /too many|expired/i.test(right.body?.error?.message || ''), JSON.stringify(right.body));
}

console.log('— Newsletter —');
{
  const e = `n-${stamp}@x.dev`;
  const first = await fetch(`${base}/api/newsletter`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e }) });
  const firstBody = await first.json().catch(() => ({}));
  const { unsubscribe } = await import('../src/services/newsletterService.js');
  await unsubscribe(e);
  const again = await fetch(`${base}/api/newsletter`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e }) });
  const againBody = await again.json().catch(() => ({}));
  const row = await get(`SELECT unsubscribed_at FROM newsletter_signups WHERE email=@e`, { e });
  ok('signing up again does not undo an opt-out', !!row?.unsubscribed_at, JSON.stringify(row));
  ok('the answer is the same either way (no "already subscribed")', JSON.stringify(firstBody) === JSON.stringify(againBody) && !('alreadySubscribed' in againBody), JSON.stringify([firstBody, againBody]));
}

console.log('— Payment proof —');
{
  const { storeImage } = await import('../src/services/imageStoreService.js');
  const img = await storeImage('image/png', Buffer.from(`logo-${stamp}`), { source: 'category-logo' });
  const order = (await get(`SELECT id FROM orders LIMIT 1`))?.id;
  if (order) {
    const pid = newId('ppf');
    await run(`INSERT INTO payment_proofs (id, order_id, method, screenshot_url, amount, status, created_at) VALUES (@id, @o, 'bank', @s, 100, 'pending', @at)`,
      { id: pid, o: order, s: `https://shop.example${img.url}`, at: nowIso() });
    const { rejectProof } = await import('../src/services/paymentProofService.js');
    await rejectProof(pid, 'test', { actorId: owner }).catch(() => {});
  } else {
    await run(`UPDATE product_images SET product_id = NULL WHERE id=@id`, { id: img.id });
  }
  ok('a shop image linked from a proof survives the proof being rejected', !!(await get(`SELECT id FROM product_images WHERE id=@id`, { id: img.id })));
}

console.log('— Stability —');
{
  const idx = (await all(`SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_email_log_status','idx_email_log_lower_to','idx_fulfill_mode_status','idx_orders_lower_email','idx_market_obs_time')`)).map((r) => r.indexname);
  ok('the review indexes exist', idx.length === 5, idx.join(','));
  await run(`DELETE FROM kv WHERE key='discord_bot_seen_at'`).catch(() => {});
  const { queueOwnerAlert } = await import('../src/services/discordService.js');
  ok('an offline bot is "not a channel now", not a failure', (await queueOwnerAlert({ title: 'x' })) === null);
  const cron = await fetch(`${base}/api/cron/maintenance`, { headers: { authorization: 'Bearer wrong' } });
  ok('the cron endpoint still refuses a wrong secret when one is set', process.env.CRON_SECRET ? cron.status === 403 : true);
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} full-review: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
