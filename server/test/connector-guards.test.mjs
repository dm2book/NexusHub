/** Verifies the audit fixes to the Kinguin + G2A connectors (mocked fetch). */
import { KinguinConnector } from '../src/services/supplier/KinguinConnector.js';
import { G2AConnector } from '../src/services/supplier/G2AConnector.js';

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => c ? (pass++, console.log(`  ✅ ${name}`))
  : (fail++, console.log(`  ❌ ${name} ${extra}`));

const calls = [];
function mockFetch(routes) {
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    for (const [match, resp] of routes) {
      if (url.includes(match) && (opts.method || 'GET') === (resp.method || 'GET')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(resp.body) };
      }
    }
    return { ok: false, status: 404, text: async () => '{"message":"nf"}' };
  };
}

console.log('— Kinguin: completed but /keys transiently empty → NOT fulfilled (lost-key guard) —');
{
  const c = new KinguinConnector({ config: { apiKey: 'K', autoDeliver: true } });
  mockFetch([
    ['/v2/order/O1/keys', { body: [] }],          // keys endpoint returns nothing
    ['/v2/order/O1', { body: { status: 'completed' } }],
  ]);
  const r = await c.checkFulfillment('O1');
  ok(r.status === 'in_progress', 'empty keys on completed order stays in_progress (re-polls)', r.status);
}
console.log('— Kinguin: completed WITH keys → fulfilled + delivered —');
{
  const c = new KinguinConnector({ config: { apiKey: 'K', autoDeliver: true } });
  mockFetch([
    ['/v2/order/O2/keys', { body: [{ serial: 'AAA-BBB', type: 'text/plain' }] }],
    ['/v2/order/O2', { body: { status: 'completed' } }],
  ]);
  const r = await c.checkFulfillment('O2');
  ok(r.status === 'fulfilled' && r.deliveries[0].content === 'AAA-BBB', 'real key delivers', JSON.stringify(r.deliveries));
}

console.log('\n— G2A: no double /v3 in the URL (base fix) —');
{
  calls.length = 0;
  const c = new G2AConnector({ config: { apiHash: 'H', email: 'e@x.dev', apiKey: 'S', autoDeliver: true } });
  mockFetch([['/v3/account', { body: { ok: true } }]]);
  await c.testConnection();
  const acct = calls.find((x) => x.url.includes('/account'));
  ok(acct?.url === 'https://api.g2a.com/v3/account', 'exact URL is …/v3/account (not /v3/v3/…)', acct?.url);
  ok(!acct?.url.includes('/v3/v3/'), 'no doubled /v3 segment');
}

console.log('\n— G2A: order carries quantity and a line-level max_price cap —');
{
  calls.length = 0;
  const c = new G2AConnector({ config: { apiHash: 'H', email: 'e@x.dev', apiKey: 'S', autoDeliver: true } });
  mockFetch([
    ['/v3/order/pay', { method: 'PUT', body: { status: 'paid' } }],
    ['/v3/order', { method: 'POST', body: { order_id: 'G9' } }],
  ]);
  const res = await c.createFulfillment({ supplierSku: '123', quantity: 3, cost: 500 }); // €5/unit
  const add = calls.find((x) => x.url.endsWith('/v3/order') && x.method === 'POST');
  ok(add?.body?.quantity === 3, 'quantity passed to G2A', JSON.stringify(add?.body));
  ok(add?.body?.max_price === 15, 'max_price caps the whole line (3×€5 = €15)', String(add?.body?.max_price));
  ok(res.status === 'in_progress' && res.externalRef === 'G9', 'returns in_progress + order id');
}

console.log('\n— G2A: multiple keys → all delivered —');
{
  const c = new G2AConnector({ config: { apiHash: 'H', email: 'e@x.dev', apiKey: 'S', autoDeliver: true } });
  mockFetch([
    ['/v3/order/key/G9', { body: { keys: [{ key: 'K1' }, { key: 'K2' }] } }],
    ['/v3/order/details/G9', { body: { status: 'complete' } }],
  ]);
  const r = await c.checkFulfillment('G9');
  ok(r.status === 'fulfilled' && r.deliveries.length === 2, 'both keys delivered', JSON.stringify(r.deliveries));
}
console.log('— G2A: no key yet → in_progress —');
{
  const c = new G2AConnector({ config: { apiHash: 'H', email: 'e@x.dev', apiKey: 'S', autoDeliver: true } });
  mockFetch([['/v3/order/details/G9', { body: { status: 'processing' } }]]);
  const r = await c.checkFulfillment('G9');
  ok(r.status === 'in_progress', 'no key → in_progress', r.status);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
