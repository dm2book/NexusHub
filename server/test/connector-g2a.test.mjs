/** Verifies the G2AConnector builds the documented 3-step buy flow + auth header
 *  and maps the key → delivery, using a mocked fetch (no network). */
import { createHash } from 'node:crypto';
import { G2AConnector } from '../src/services/supplier/G2AConnector.js';

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => c ? (pass++, console.log(`  ✅ ${name}`))
  : (fail++, console.log(`  ❌ ${name} ${extra}`));

const calls = [];
function mockFetch(routes) {
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    for (const [match, resp] of routes) {
      if (url.includes(match) && (opts.method || 'GET') === (resp.method || 'GET')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(resp.body) };
      }
    }
    return { ok: false, status: 404, text: async () => '{"message":"nf"}' };
  };
}

const cfg = { apiHash: 'HASH1', email: 'me@shop.dev', apiKey: 'SECRET1', currency: 'EUR', autoDeliver: true };
const c = new G2AConnector({ config: cfg });

console.log('— Capabilities —');
ok(c.supportsFulfillment === true, 'supportsFulfillment with full creds + autoDeliver');
ok(new G2AConnector({ config: { ...cfg, autoDeliver: false } }).supportsFulfillment === false, 'autoDeliver:false disables buying');
ok(new G2AConnector({ config: { apiHash: 'x' } }).supportsFulfillment === false, 'missing email/key → no buying');

console.log('\n— Auth header = apiHash, sha256(apiHash+email+apiKey) —');
mockFetch([['/v3/account', { body: { ok: true } }]]);
await c.testConnection();
const authCall = calls.find((x) => x.url.includes('/v3/account'));
const expectedToken = createHash('sha256').update('HASH1me@shop.devSECRET1').digest('hex');
ok(authCall?.headers['Authorization'] === `HASH1, ${expectedToken}`, 'exact G2A Authorization header', authCall?.headers['Authorization']);

console.log('\n— createFulfillment: add order → pay —');
calls.length = 0;
mockFetch([
  ['/v3/order/pay', { method: 'PUT', body: { transaction_id: 'TX1', status: 'paid' } }],
  ['/v3/order', { method: 'POST', body: { order_id: 'G2A-9' } }],
]);
const res = await c.createFulfillment({ supplierSku: '10000037846002', quantity: 1, cost: 1250 });
const add = calls.find((x) => x.url.endsWith('/v3/order') && x.method === 'POST');
const pay = calls.find((x) => x.url.includes('/v3/order/pay') && x.method === 'PUT');
ok(add?.body?.product_id === '10000037846002', 'POST /v3/order with product_id from the mapping', JSON.stringify(add?.body));
ok(add?.body?.currency === 'EUR', 'currency EUR');
ok(add?.body?.max_price === 12.5, 'max_price capped at our cost (1250c → 12.50)', String(add?.body?.max_price));
ok(!!pay && pay.body?.order_id === 'G2A-9', 'PUT /v3/order/pay for the created order');
ok(res.status === 'in_progress' && res.externalRef === 'G2A-9', 'returns in_progress + G2A order id');

console.log('\n— checkFulfillment: key not ready → in_progress —');
mockFetch([['/v3/order/details/G2A-9', { body: { status: 'processing' } }]]); // key endpoint 404s → not ready
const mid = await c.checkFulfillment('G2A-9');
ok(mid.status === 'in_progress', 'no key yet → in_progress', mid.status);

console.log('\n— checkFulfillment: key issued → delivered —');
mockFetch([
  ['/v3/order/key/G2A-9', { body: { key: 'AAAA-BBBB-CCCC' } }],
  ['/v3/order/details/G2A-9', { body: { status: 'complete' } }],
]);
const done = await c.checkFulfillment('G2A-9');
ok(done.status === 'fulfilled' && done.deliveries?.[0]?.content === 'AAAA-BBBB-CCCC', 'real G2A key delivered', JSON.stringify(done.deliveries));

console.log('\n— checkFulfillment: refunded → failed —');
mockFetch([['/v3/order/details/G2A-9', { body: { status: 'refunded' } }]]);
ok((await c.checkFulfillment('G2A-9')).status === 'failed', 'refunded order → failed');

console.log('\n— registry knows g2a —');
const { availableKinds } = await import('../src/services/supplier/registry.js');
ok(availableKinds().includes('g2a') && availableKinds().includes('kinguin'), 'g2a + kinguin registered', availableKinds().join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
