/** Verifies the KinguinConnector builds the exact documented requests and maps
 *  the response → deliveries, using a mocked fetch (no network). */
import { KinguinConnector } from '../src/services/supplier/KinguinConnector.js';

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => c ? (pass++, console.log(`  ✅ ${name}`))
  : (fail++, console.log(`  ❌ ${name} ${extra}`));

const calls = [];
function mockFetch(routes) {
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null });
    for (const [match, resp] of routes) {
      if (url.includes(match) && (opts.method || 'GET') === (resp.method || 'GET')) {
        return { ok: resp.status ? resp.status < 400 : true, status: resp.status || 200, text: async () => JSON.stringify(resp.body) };
      }
    }
    return { ok: false, status: 404, text: async () => '{"message":"not found"}' };
  };
}

const c = new KinguinConnector({ config: { apiKey: 'KG-TEST', autoDeliver: true } });

console.log('— Capabilities —');
ok(c.supportsFulfillment === true, 'supportsFulfillment with apiKey + autoDeliver');
ok(new KinguinConnector({ config: { apiKey: 'x', autoDeliver: false } }).supportsFulfillment === false, 'autoDeliver:false disables buying (shadow/off)');
ok(new KinguinConnector({ config: {} }).supportsFulfillment === false, 'no apiKey → no buying');

console.log('\n— testConnection —');
mockFetch([['/v1/products', { body: { results: [] } }]]);
ok((await c.testConnection()).ok === true, 'testConnection validates the key');

console.log('\n— createFulfillment posts the exact buy order —');
mockFetch([['/v1/order', { method: 'POST', body: { orderId: 'KG-ORDER-1' } }]]);
const res = await c.createFulfillment({ orderNumber: 'FM-2026-XYZ', supplierSku: '1234', quantity: 3, cost: 899 });
const buy = calls.find((x) => x.url.includes('/v1/order') && x.method === 'POST');
ok(buy?.url.endsWith('/v1/order'), 'POST to /v1/order', buy?.url);
ok(buy?.headers['X-Api-Key'] === 'KG-TEST', 'sends X-Api-Key header');
ok(buy?.body?.products?.[0]?.kinguinId === 1234, 'kinguinId from the mapping SKU', JSON.stringify(buy?.body));
ok(buy?.body?.products?.[0]?.qty === 3, 'qty = the order quantity');
ok(buy?.body?.products?.[0]?.price === 8.99, 'price = cost in euros (899c → 8.99)');
ok(buy?.body?.orderExternalId === 'FM-2026-XYZ', 'our order number as orderExternalId');
ok(res.status === 'in_progress' && res.externalRef === 'KG-ORDER-1', 'returns in_progress + Kinguin order ref');

console.log('\n— checkFulfillment: not done yet → in_progress —');
mockFetch([['/v2/order/KG-ORDER-1/keys', { body: [] }], ['/v2/order/KG-ORDER-1', { body: { status: 'processing' } }]]);
const mid = await c.checkFulfillment('KG-ORDER-1');
ok(mid.status === 'in_progress', 'still processing → in_progress', mid.status);

console.log('\n— checkFulfillment: completed → real serials delivered —');
mockFetch([
  ['/v2/order/KG-ORDER-1/keys', { body: [{ serial: 'ABCD-EFGH-1234', type: 'text/plain', kinguinId: 1234 }] }],
  ['/v2/order/KG-ORDER-1', { body: { status: 'completed' } }],
]);
const done = await c.checkFulfillment('KG-ORDER-1');
ok(done.status === 'fulfilled', 'completed → fulfilled');
ok(done.deliveries?.length === 1 && done.deliveries[0].content === 'ABCD-EFGH-1234', 'the real serial is delivered', JSON.stringify(done.deliveries));
ok(done.deliveries[0].type === 'code', 'text serial mapped to a code delivery');

console.log('\n— registry knows the kinguin kind —');
const { availableKinds } = await import('../src/services/supplier/registry.js');
ok(availableKinds().includes('kinguin'), 'kinguin registered as a connector kind', availableKinds().join(','));

console.log('\n— …and reachable through the only screen that creates a supplier —');
{
  /* Registering a connector is not enough to be able to USE one. The create
     route validated `connectorKind` against a hardcoded ['api','csv','manual']
     while the registry held six and the admin dropdown offered all six, so
     choosing Kinguin and pressing Create answered
       "Invalid enum value. Expected 'api' | 'csv' | 'manual'"
     — the three integrations that auto-buy and auto-deliver were unreachable,
     and the error blamed the person typing. Reproduced against the running API
     before it was fixed. */
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const route = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
    '..', 'src', 'routes', 'admin', 'suppliers.js'), 'utf8');

  ok(/connectorKind: z\.enum\(availableKinds\(\)\)/.test(route),
    'the create route validates against the registry itself');
  ok(!/z\.enum\(\['api', 'csv', 'manual'\]\)/.test(route),
    'no second hardcoded copy of the kind list is left');

  /* And the dropdown must not offer a kind the server will refuse — the two
     lists disagreeing IS the bug, in whichever direction. */
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'src', 'pages', 'admin', 'Suppliers.jsx'), 'utf8');
  const offered = [...page.matchAll(/<option value="([a-z0-9]+)">/g)].map((m) => m[1]);
  ok(offered.length >= 6, `the dropdown offers ${offered.length} kinds`, offered.join(','));
  const unknown = offered.filter((k) => !availableKinds().includes(k));
  ok(unknown.length === 0, 'every kind the dropdown offers is one the server accepts',
    unknown.join(','));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
