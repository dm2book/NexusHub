/**
 * Launch-week simulation: volume, money coming back, and every outside service
 * going down — one at a time, against the real code and a real database.
 *
 *   createdb fmlaunch
 *   node server/test/load/launchweek.mjs postgres://postgres:postgres@127.0.0.1:5432/fmlaunch
 *
 * Everything the shop talks to is replaced at the network edge, not in the
 * code: `fetch` (Resend, Discord, the supplier API) and the Stripe SDK's own
 * HTTPS client are pointed at a fault switch that can be up, down (connection
 * refused / reset), 503, or hanging. So the timeouts, retries and fallbacks that
 * run are the shipped ones — a timeout the code does not set is a hang here too.
 *
 * Not modelled: Vercel itself. Here one process runs everything; in production a
 * request (and whatever it hands to waitUntil) is killed at 30 s. Any request
 * that takes longer is reported as "would be killed", with what that leaves
 * behind.
 *
 * Writes a JSON report next to itself (launchweek-report.json) and prints a
 * summary. Use a SCRATCH database: it creates products, users and orders.
 */
import http from 'node:http';
import https from 'node:https';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = process.argv[2] || 'postgres://postgres:postgres@127.0.0.1:5432/fmlaunch';
const ONLY = (process.argv[3] || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const HANG_CAP_MS = Number(process.env.SIM_HANG_CAP_MS || 45_000);
const KILL_MS = 30_000;

Object.assign(process.env, {
  DATABASE_URL: DB,
  NODE_ENV: 'development',
  LAUNCH_MODE: 'open',
  DEMO_PAYMENTS: 'false',
  STRIPE_SECRET_KEY: 'sk_test_launchweek',
  STRIPE_WEBHOOK_SECRET: 'whsec_launchweek',
  RESEND_API_KEY: 're_launchweek',
  EMAIL_FROM: 'ForgeMarket <orders@forgemarket.nl>',
  DISCORD_ORDER_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/orders',
  DISCORD_STOCK_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/stock',
  NOTIFY_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/2/owner',
  DISCORD_BOT_TOKEN: 'bot-launchweek',
  DISCORD_GUILD_ID: '900000000000000001',
  PAY_TIKKIE: 'https://tikkie.me/pay/launchweek',
  PAY_REVOLUT: 'https://revolut.me/launchweek',
  APP_URL: 'https://www.forgemarket.nl',
});

/* ── The fault switch ───────────────────────────────────────────────────── */
const MODE = { email: 'up', discord: 'up', supplier: 'up', stripe: 'up' };
const CALLS = { email: 0, discord: 0, supplier: 0, stripe: 0 };
const UNBOUNDED = { email: 0, discord: 0, supplier: 0, stripe: 0 };   // hangs no timeout ended
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

function hang(svc, signal) {
  return new Promise((_, reject) => {
    const cap = setTimeout(() => { UNBOUNDED[svc]++; reject(new Error(`${svc} hung ${HANG_CAP_MS}ms (no timeout set by caller)`)); }, HANG_CAP_MS);
    if (signal) {
      if (signal.aborted) { clearTimeout(cap); reject(signal.reason || new Error('aborted')); return; }
      signal.addEventListener('abort', () => { clearTimeout(cap); reject(signal.reason || new Error('aborted')); }, { once: true });
    }
  });
}

const json = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } });

function answer(svc, url, init) {
  const method = (init.method || 'GET').toUpperCase();
  if (svc === 'email') return json({ id: `em_${++seq}` });
  if (svc === 'supplier') {
    if (method === 'POST') return json({ status: 'fulfilled', id: `sup-${++seq}`, codes: [`SUP-${seq}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`] });
    return json({ status: 'fulfilled', id: url.pathname.split('/').pop(), codes: [] });
  }
  // Discord: webhooks, and the bot API the role sync and the DMs use.
  const p = url.pathname;
  if (/\/webhooks\//.test(p)) return new Response(null, { status: 204 });
  if (/\/guilds\/\d+\/roles$/.test(p)) return json([
    { id: '1', name: 'Verified Customer' }, { id: '2', name: 'VIP Customer' }, { id: '3', name: 'Reviewer' }]);
  if (/\/guilds\/\d+\/members\//.test(p) && method === 'GET') return json({ roles: [] });
  if (/\/users\/@me\/channels$/.test(p)) return json({ id: '777' });
  if (/\/channels\/\d+\/messages$/.test(p)) return json({ id: String(++seq) });
  if (method === 'PUT' || method === 'DELETE') return new Response(null, { status: 204 });
  return json({});
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const svc = url.hostname === 'api.resend.com' ? 'email'
    : /(^|\.)discord(app)?\.com$/.test(url.hostname) ? 'discord'
      : url.hostname === 'supplier.launchweek.test' ? 'supplier' : null;
  if (!svc) {
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return realFetch(input, init);
    throw new TypeError(`fetch failed (simulation blocks ${url.hostname})`);
  }
  CALLS[svc]++;
  const mode = MODE[svc];
  if (mode === 'down') { await sleep(15); const e = new TypeError('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; }
  if (mode === '503') return json({ message: 'Service Unavailable' }, 503);
  if (mode === 'hang') return hang(svc, init.signal);
  return answer(svc, url, init);
};

/* Stripe: the SDK speaks HTTPS to api.stripe.com through node:https. Point it
   at a local server that plays Stripe, with the same switch. */
const stripeServer = http.createServer((req, res) => {
  CALLS.stripe++;
  const mode = MODE.stripe;
  if (mode === 'down') { req.socket.destroy(); return; }
  if (mode === 'hang') return;                                   // never answers
  if (mode === '503') { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":{"message":"overloaded","type":"api_error"}}'); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const p = req.url.split('?')[0];
    let out = {};
    if (req.method === 'POST' && p === '/v1/checkout/sessions') {
      const id = `cs_test_lw${++seq}`;
      out = { id, object: 'checkout.session', status: 'open', url: `https://checkout.stripe.com/c/pay/${id}`, payment_intent: null };
    } else if (p.startsWith('/v1/checkout/sessions/')) {
      const id = p.split('/').pop();
      out = { id, object: 'checkout.session', status: 'open', url: `https://checkout.stripe.com/c/pay/${id}`, payment_intent: null };
    } else if (p.startsWith('/v1/payment_intents/')) {
      out = { id: p.split('/').pop(), object: 'payment_intent', latest_charge: { outcome: { risk_level: 'normal', risk_score: 14 }, payment_method_details: { card: { country: 'NL' } } } };
    } else if (p === '/v1/refunds') {
      out = { id: `re_lw${++seq}`, object: 'refund', status: 'succeeded' };
    } else if (p === '/v1/account') {
      out = { id: 'acct_lw', charges_enabled: true, payouts_enabled: true };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
await new Promise((r) => stripeServer.listen(0, '127.0.0.1', r));
const STRIPE_PORT = stripeServer.address().port;
const realHttpsRequest = https.request;
https.request = function patched(opts, ...rest) {
  if (opts && typeof opts === 'object' && (opts.host === 'api.stripe.com' || opts.hostname === 'api.stripe.com')) {
    const req = http.request({ ...opts, host: '127.0.0.1', hostname: undefined, port: STRIPE_PORT, agent: undefined, ciphers: undefined }, ...rest);
    // The SDK waits for 'secureConnect' before writing; a plain socket never says it.
    req.once('socket', (s) => { if (s.connecting) s.once('connect', () => s.emit('secureConnect')); });
    return req;
  }
  return realHttpsRequest.call(this, opts, ...rest);
};

/* ── The shop ───────────────────────────────────────────────────────────── */
const { createApp, ensureReady } = await import('../../src/app.js');
await ensureReady();
const { run, get, all, nowIso } = await import('../../src/db/index.js');
const { createProduct } = await import('../../src/services/productService.js');
const { addProductCodes } = await import('../../src/services/codeStockService.js');
const { createSupplier, mapSupplierProduct } = await import('../../src/services/supplier/supplierService.js');
const { createOrder, getOrder } = await import('../../src/services/orderService.js');
const { confirmProof } = await import('../../src/services/paymentProofService.js');
const { runMaintenance } = await import('../../src/services/maintenanceService.js');
const { retryFailedEmails } = await import('../../src/services/emailService.js');
const { default: Stripe } = await import('stripe');
const signer = new Stripe('sk_test_launchweek');

const srv = createApp().listen(0);
const BASE = `http://127.0.0.1:${srv.address().port}`;
const TAG = Date.now().toString(36);
const report = { startedAt: new Date().toISOString(), hangCapMs: HANG_CAP_MS, phases: {} };

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const lat = (a) => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), max: a.length ? Math.max(...a) : 0, overKill: a.filter((x) => x > KILL_MS).length });
let ipSeq = 0;
const freshIp = () => { ipSeq++; return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`; };

/* Catalogue: a stocked code product, a supplier product, a hand-delivered one
   and a dear one (a guest's first order over €100 waits for review). */
const sup = await createSupplier({ name: `Sim supplier ${TAG}`, connectorKind: 'api', config: {
  baseUrl: 'https://supplier.launchweek.test', auth: { type: 'none' },
  endpoints: { fulfill: '/fulfill', status: '/status/{ref}' } } });
async function catalogue(label, { stock = 0 } = {}) {
  const mk = (name, price, deliveryMode = 'auto') => createProduct({ name: `${name} ${label} ${TAG}`,
    sku: `LW-${name.replace(/\W+/g, '')}-${label}-${TAG}`, category: 'robux', price, currency: 'EUR',
    active: true, announce: false, deliveryMode });
  const stocked = await mk('Robux 800', 999);
  const viaSupplier = await mk('Robux 2000', 2299);
  const manual = await mk('FC Points 2800', 2299, 'manual');
  const dear = await mk('Robux 22500', 19999);
  if (stock) await addProductCodes(stocked.id, Array.from({ length: stock }, (_, i) => `RBX-${label}-${TAG}-${i}`));
  // The stocked product also has the supplier behind it, as a real shop would.
  await mapSupplierProduct({ supplierId: sup.id, productId: stocked.id, supplierSku: `S800-${label}-${TAG}`, cost: 480, priority: 10 });
  await mapSupplierProduct({ supplierId: sup.id, productId: viaSupplier.id, supplierSku: `S2000-${label}-${TAG}`, cost: 1150, priority: 10 });
  await mapSupplierProduct({ supplierId: sup.id, productId: dear.id, supplierSku: `S22500-${label}-${TAG}`, cost: 10500, priority: 10 });
  return { stocked, viaSupplier, manual, dear };
}

/* Buyers: guests and account holders; one in ten account holders has Discord
   linked. A few share one mobile-carrier IP (CGNAT) — an assumption, shown
   separately in the report. */
async function makeUser(i, label, discord) {
  const id = `usr_lw_${label}_${TAG}_${i}`;
  const at = nowIso();
  await run(`INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES (@id,@e,'Sim',@at,@at) ON CONFLICT (id) DO NOTHING`,
    { id, e: `${id}@example.com`, at });
  if (discord) {
    await run(`INSERT INTO oauth_accounts (id,user_id,provider,provider_uid,email,created_at) VALUES (@id,@u,'discord',@uid,@e,@at) ON CONFLICT DO NOTHING`,
      { id: `oa_${id}`, u: id, uid: String(800000000000000000n + BigInt(ipSeq + i)), e: `${id}@example.com`, at });
  }
  return { id, email: `${id}@example.com` };
}

async function placeGuest(productId, { email, ip }) {
  const t = Date.now();
  try {
    const r = await fetch(`${BASE}/api/orders`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, items: [{ productId, quantity: 1 }], consent: true, consentText: 'Immediate delivery, waiving withdrawal.' }),
      signal: AbortSignal.timeout(HANG_CAP_MS + 15_000) });
    const b = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ms: Date.now() - t, order: b.order, code: b.error?.code || b.code, error: b.error?.message || b.message };
  } catch (e) { return { ok: false, status: 0, ms: Date.now() - t, error: e.message }; }
}
async function placeAccount(productId, user, ip) {
  const t = Date.now();
  try {
    const order = await createOrder({ email: user.email, userId: user.id, items: [{ productId, quantity: 1 }], consent: true, consentText: 'Immediate delivery, waiving withdrawal.' },
      { actorId: user.id, ip, country: 'NL' });
    return { ok: true, status: 201, ms: Date.now() - t, order };
  } catch (e) { return { ok: false, status: e.status || 0, ms: Date.now() - t, error: e.message, code: e.code }; }
}

async function stripeCheckout(order) {
  const t = Date.now();
  try {
    const r = await fetch(`${BASE}/api/orders/${order.id}/checkout`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() },
      body: JSON.stringify({ email: order.email }), signal: AbortSignal.timeout(HANG_CAP_MS) });
    const b = await r.json().catch(() => ({}));
    return { ok: r.ok && !!b.url, status: r.status, ms: Date.now() - t, error: b.error?.message };
  } catch (e) { return { ok: false, status: 0, ms: Date.now() - t, error: `client gave up: ${e.message}` }; }
}

async function webhook(type, object) {
  const payload = JSON.stringify({ id: `evt_lw${++seq}`, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: 'whsec_launchweek' });
  const t = Date.now();
  try {
    const r = await fetch(`${BASE}/api/payments/stripe/webhook`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload,
      signal: AbortSignal.timeout(HANG_CAP_MS + 30_000) });
    const b = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ms: Date.now() - t, body: b };
  } catch (e) { return { ok: false, status: 0, ms: Date.now() - t, error: e.message }; }
}
const paySession = (order) => webhook('checkout.session.completed', {
  id: `cs_test_paid${order.id}`, object: 'checkout.session', payment_status: 'paid', status: 'complete',
  amount_total: order.total, currency: 'eur', payment_intent: `pi_lw_${order.id}`,
  client_reference_id: order.id, metadata: { orderId: order.id, orderNumber: order.number } });

async function proof(order) {
  const r = await fetch(`${BASE}/api/orders/${order.id}/proof`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() },
    body: JSON.stringify({ method: 'tikkie', transactionId: `TK${++seq}`, email: order.email }) });
  return r.ok;
}

/** Wait until the background work for these orders has stopped moving. */
async function quiesce(ids, maxMs = 60_000) {
  const until = Date.now() + maxMs;
  let last = '';
  let stable = 0;
  while (Date.now() < until) {
    const rows = await all(`SELECT status, COUNT(*)::int AS n FROM orders WHERE id = ANY(@ids) GROUP BY status ORDER BY status`, { ids });
    const sig = JSON.stringify(rows);
    if (sig === last) { if (++stable >= 4) break; } else stable = 0;
    last = sig;
    await sleep(500);
  }
}

async function outcome(ids, since) {
  const status = Object.fromEntries((await all(`SELECT status, COUNT(*)::int AS n FROM orders WHERE id = ANY(@ids) GROUP BY status`, { ids })).map((r) => [r.status, r.n]));
  const held = (await get(`SELECT COUNT(*)::int AS n FROM orders WHERE id = ANY(@ids) AND fraud_hold=1`, { ids })).n;
  const manualQueue = (await get(`SELECT COUNT(DISTINCT order_id)::int AS n FROM fulfillment_requests WHERE order_id = ANY(@ids) AND mode='manual' AND status IN ('pending','in_progress','assigned')`, { ids })).n;
  const failedSupplier = (await get(`SELECT COUNT(DISTINCT order_id)::int AS n FROM fulfillment_requests WHERE order_id = ANY(@ids) AND mode='auto' AND status='failed'`, { ids })).n;
  const email = Object.fromEntries((await all(`SELECT status, COUNT(*)::int AS n FROM email_log WHERE created_at >= @s GROUP BY status`, { s: since })).map((r) => [r.status, r.n]));
  const outbox = Object.fromEntries((await all(`SELECT kind, COUNT(*)::int AS n FROM discord_outbox WHERE created_at >= @s AND delivered_at IS NULL GROUP BY kind`, { s: since })).map((r) => [r.kind, r.n]));
  const alerts = Object.fromEntries((await all(`SELECT event, COUNT(*)::int AS n FROM owner_alerts WHERE created_at >= @s GROUP BY event`, { s: since })).map((r) => [r.event, r.n]));
  const dupCodes = (await get(`SELECT COUNT(*)::int AS n FROM (SELECT content FROM deliveries WHERE order_id = ANY(@ids) GROUP BY content HAVING COUNT(DISTINCT order_id) > 1) d`, { ids })).n;
  return { status, fraudHeld: held, manualQueue, failedSupplier, email, discordOutboxByKind: outbox, ownerAlerts: alerts, codesOnTwoOrders: dupCodes };
}

/* ── One day of orders ──────────────────────────────────────────────────── */
async function day(label, n, { stock, concurrency = 8, stripeShare = 0.8, accountShare = 0.3, discordShare = 0.1,
  cgnatShare = 0.05, dearShare = 0.04, manualShare = 0.15, burst = 0 } = {}) {
  const since = nowIso();
  const cat = await catalogue(label, { stock });
  const cgnatIp = freshIp();
  const placed = []; const rejected = []; const placeMs = []; const checkoutMs = []; const hookMs = [];
  const checkoutFail = []; let proofs = 0;
  // Seeded per day, so a rerun draws the same buyers.
  let st = [...label].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const plan = Array.from({ length: n }, (_, i) => {
    const product = rnd() < dearShare ? cat.dear : rnd() < manualShare ? cat.manual : rnd() < 0.55 ? cat.stocked : cat.viaSupplier;
    return { i, product, account: rnd() < accountShare, discord: rnd() < discordShare, cgnat: rnd() < cgnatShare, stripe: rnd() < stripeShare };
  });

  async function one(p) {
    const ip = p.cgnat ? cgnatIp : freshIp();
    let res;
    if (p.account) res = await placeAccount(p.product.id, await makeUser(p.i, label, p.discord), ip);
    else res = await placeGuest(p.product.id, { email: `g${p.i}-${label}-${TAG}@example.com`, ip });
    placeMs.push(res.ms);
    if (!res.ok) { rejected.push({ status: res.status, code: res.code, error: (res.error || '').slice(0, 90), cgnat: p.cgnat }); return; }
    placed.push(res.order.id);
    if (p.stripe) {
      const c = await stripeCheckout(res.order);
      checkoutMs.push(c.ms);
      if (!c.ok) { checkoutFail.push({ status: c.status, error: (c.error || '').slice(0, 90) }); return; }
      const h = await paySession(res.order);
      hookMs.push(h.ms);
    } else if (await proof(res.order)) proofs++;
  }

  const t0 = Date.now();
  if (burst) await Promise.all(plan.slice(0, burst).map(one));
  let next = burst;
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < plan.length) await one(plan[next++]); }));
  const wall = Date.now() - t0;
  await quiesce(placed);

  // The human part: every pending proof confirmed, as the owner would.
  const pending = await all(`SELECT id FROM payment_proofs WHERE order_id = ANY(@ids) AND status='pending'`, { ids: placed });
  for (const pr of pending) await confirmProof(pr.id, { user: { id: 'usr_owner', email: 'owner@forgemarket.nl' } }).catch(() => {});
  await quiesce(placed);

  const out = await outcome(placed, since);
  const rej = {};
  for (const r of rejected) { const k = `${r.status} ${r.code || r.error}`; rej[k] = (rej[k] || 0) + 1; }
  return { label, orders: n, wallMs: wall, placed: placed.length, rejected: rej,
    rejectedCgnat: rejected.filter((r) => r.cgnat).length, cgnatBuyers: plan.filter((p) => p.cgnat).length,
    placeLatency: lat(placeMs), checkoutLatency: lat(checkoutMs), webhookLatency: lat(hookMs),
    checkoutFailed: checkoutFail.length, manualProofs: pending.length, proofsSubmitted: proofs, ...out, ids: placed, cat };
}

const strip = ({ ids, cat, ...r }) => r;
const log = (name, r) => { report.phases[name] = strip(r); console.log(`\n■ ${name}\n${JSON.stringify(strip(r), null, 1).slice(0, 3000)}`); };

/* ── Phases ─────────────────────────────────────────────────────────────── */
let base500 = null;

if (want('d100')) {
  log('Day @ 100 orders — everything up', await day('d100', 100, { stock: 60 }));
}

if (want('d500')) {
  base500 = await day('d500', 500, { stock: 250, burst: 60, concurrency: 12 });
  log('Day @ 500 orders — everything up, 60 at once at the start', base500);
}

if (want('money')) {
  const ids = base500?.ids || (await day('m', 120, { stock: 80 })).ids;
  const since = nowIso();
  const done = await all(`SELECT id, total, number FROM orders WHERE id = ANY(@ids) AND status='completed' AND psp_payment_id IS NOT NULL ORDER BY created_at`, { ids })
    .then((r) => r.length ? r : all(`SELECT id, total, number FROM orders WHERE id = ANY(@ids) AND status='completed' ORDER BY created_at`, { ids }));
  const refunds = done.slice(0, Math.max(3, Math.round(done.length * 0.03)));
  const disputes = done.slice(refunds.length, refunds.length + Math.max(2, Math.round(done.length * 0.01)));
  const rMs = []; const dMs = [];
  for (const o of refunds) {
    const h = await webhook('charge.refunded', { id: `ch_${o.id}`, object: 'charge', amount: o.total, amount_refunded: o.total, refunded: true,
      payment_intent: `pi_lw_${o.id}`, metadata: { orderId: o.id } });
    rMs.push(h.ms);
  }
  for (const o of disputes) {
    const h = await webhook('charge.dispute.created', { id: `dp_${o.id}`, object: 'dispute', amount: o.total, currency: 'eur', reason: 'fraudulent',
      charge: `ch_${o.id}`, payment_intent: `pi_lw_${o.id}`, metadata: { orderId: o.id } });
    dMs.push(h.ms);
  }
  await sleep(1500);
  const rIds = refunds.map((o) => o.id); const dIds = disputes.map((o) => o.id);
  const st = async (xs) => Object.fromEntries((await all(`SELECT status, COUNT(*)::int AS n FROM orders WHERE id = ANY(@x) GROUP BY status`, { x: xs })).map((r) => [r.status, r.n]));
  const codesStillValid = (await get(`SELECT COUNT(*)::int AS n FROM deliveries WHERE order_id = ANY(@x)`, { x: [...rIds, ...dIds] })).n;
  const ledger = (await get(`SELECT COUNT(*)::int AS n FROM chargebacks WHERE order_id = ANY(@x)`, { x: dIds })).n;
  const refundMails = (await get(`SELECT COUNT(*)::int AS n FROM email_log WHERE created_at >= @s AND template_id IN (SELECT id FROM email_templates WHERE event_key ILIKE '%refund%')`, { s: since }).catch(() => ({ n: null }))).n;
  // The same buyer comes back after a chargeback.
  const cb = await get(`SELECT email, ip FROM orders WHERE id=@id`, { id: dIds[0] });
  const again = await placeGuest(base500?.cat?.stocked?.id || (await get(`SELECT product_id FROM order_items WHERE order_id=@id`, { id: dIds[0] })).product_id,
    { email: cb.email, ip: cb.ip || freshIp() });
  const againOrder = again.order ? await getOrder(again.order.id) : null;
  let againPaid = null;
  if (againOrder) { await paySession(againOrder); await sleep(2500); againPaid = await get(`SELECT status, fraud_hold, fraud_score, fraud_status FROM orders WHERE id=@id`, { id: againOrder.id }); }
  log('Refunds (3%) and chargebacks (1%)', {
    refunds: refunds.length, refundStatus: await st(rIds), refundWebhook: lat(rMs), refundMailsSent: refundMails,
    chargebacks: disputes.length, chargebackStatus: await st(dIds), chargebackWebhook: lat(dMs), ledgerRows: ledger,
    codesAlreadyDeliveredOnThoseOrders: codesStillValid,
    repeatBuyerAfterChargeback: { placed: again.ok, status: again.status, error: again.error, afterPayment: againPaid },
  });
}

async function recovery(ids, runs = 30) {
  const passes = [];
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    await runMaintenance().catch((e) => ({ error: e.message }));
    await sleep(300);
    const open = (await get(`SELECT COUNT(*)::int AS n FROM orders WHERE id = ANY(@ids) AND status NOT IN ('completed','refunded','cancelled','failed')`, { ids })).n;
    passes.push({ run: i + 1, ms: Date.now() - t, stillOpen: open });
    if (!open) break;
  }
  return passes;
}

if (want('supplier')) {
  MODE.supplier = 'down';
  const r = await day('supdown', 100, { stock: 0, stripeShare: 1, manualShare: 0, dearShare: 0 });
  MODE.supplier = 'up';
  const before = r.status;
  const passes = await recovery(r.ids, 8);
  log('Supplier down for a day (connection refused), 100 orders, no code stock', { ...strip(r), statusAtEndOfOutage: before,
    recovery: passes, afterRecovery: (await outcome(r.ids, '1970-01-01')).status });
}

if (want('supplierhang')) {
  MODE.supplier = 'hang';
  const r = await day('suphang', 12, { stock: 0, stripeShare: 1, manualShare: 0, dearShare: 0, concurrency: 12 });
  const supCalls = CALLS.supplier;
  MODE.supplier = 'up';
  const t = Date.now();
  const passes = await recovery(r.ids, 4);
  log('Supplier hanging (accepts, never answers), 12 orders', { ...strip(r), supplierCalls: supCalls,
    recovery: passes, recoveryMs: Date.now() - t, afterRecovery: (await outcome(r.ids, '1970-01-01')).status });
}

if (want('email')) {
  MODE.email = '503';
  const r = await day('maildown', 100, { stock: 120, accountShare: 0.3 });
  MODE.email = 'up';
  const guestsCompletedNoMail = (await get(`SELECT COUNT(*)::int AS n FROM orders o WHERE o.id = ANY(@ids) AND o.user_id IS NULL AND o.status='completed'`, { ids: r.ids })).n;
  const passes = [];
  for (let i = 0; i < 40; i++) {
    const n = await retryFailedEmails().catch(() => null);
    const left = (await get(`SELECT COUNT(*)::int AS n FROM email_log e WHERE e.status='failed' AND e.created_at >= @s
        AND NOT EXISTS (SELECT 1 FROM email_log s WHERE s.status='sent' AND s.to_email=e.to_email AND s.template_id=e.template_id AND s.created_at > e.created_at)`, { s: r.ids.length ? (await get(`SELECT MIN(created_at) AS m FROM orders WHERE id = ANY(@ids)`, { ids: r.ids })).m : nowIso() })).n;
    passes.push({ run: i + 1, retried: typeof n === 'object' ? n : n, unrecoveredFailed: left });
    if (!left) break;
  }
  log('Email (Resend) down for a day — 503 on every send, 100 orders', { ...strip(r), guestsWithCodeOnlyByMail: guestsCompletedNoMail,
    retryRunsNeeded: passes.length, retryProgress: passes.filter((_, i) => i < 3 || i === passes.length - 1) });
}

if (want('emailhang')) {
  MODE.email = 'hang';
  const r = await day('mailhang', 10, { stock: 20, concurrency: 10 });
  MODE.email = 'up';
  log('Email hanging (Resend accepts the connection, never answers), 10 orders', strip(r));
}

if (want('discord')) {
  MODE.discord = 'down';
  const down = await day('dcdown', 40, { stock: 60, accountShare: 1, discordShare: 0.5 });
  MODE.discord = 'hang';
  const hung = await day('dchang', 10, { stock: 20, accountShare: 1, discordShare: 1, concurrency: 10 });
  MODE.discord = 'up';
  log('Discord down (refused), 40 orders, half the buyers linked', down);
  log('Discord hanging (API accepts, never answers), 10 orders, all buyers linked', { ...strip(hung), unboundedDiscordHangs: UNBOUNDED.discord });
}

if (want('stripe')) {
  MODE.stripe = 'down';
  const down = await day('stdown', 20, { stock: 30, stripeShare: 1, concurrency: 10 });
  MODE.stripe = '503';
  const busy = await day('st503', 10, { stock: 20, stripeShare: 1, concurrency: 10 });
  MODE.stripe = 'hang';
  const hung = await day('sthang', 5, { stock: 10, stripeShare: 1, concurrency: 5 });
  MODE.stripe = 'up';
  // A Stripe that takes payments but whose API hangs for lookups (Radar): the webhook.
  const cat = await catalogue('stpart', { stock: 5 });
  const o = await placeGuest(cat.stocked.id, { email: `part-${TAG}@example.com`, ip: freshIp() });
  await stripeCheckout(o.order);
  MODE.stripe = 'hang';
  const h = await paySession(o.order);
  MODE.stripe = 'up';
  const pendingNoWay = (await get(`SELECT COUNT(*)::int AS n FROM orders WHERE id = ANY(@ids) AND status='pending'`, { ids: [...down.ids, ...busy.ids, ...hung.ids] })).n;
  log('Stripe down (connection reset), 20 checkouts', down);
  log('Stripe 503, 10 checkouts', busy);
  log('Stripe hanging, 5 checkouts', hung);
  log('Stripe API hanging while its webhook still arrives (Radar lookup on the payment path)', {
    webhookMs: h.ms, webhookStatus: h.status, overKill: h.ms > KILL_MS, orderAfter: (await getOrder(o.order.id)).status,
    stillPendingWithNoWayToPay: pendingNoWay });
}

report.calls = CALLS; report.unboundedHangs = UNBOUNDED; report.finishedAt = new Date().toISOString();
writeFileSync(join(HERE, 'launchweek-report.json'), JSON.stringify(report, null, 2));
console.log('\nreport → server/test/load/launchweek-report.json');
srv.close(); stripeServer.close();
process.exit(0);
