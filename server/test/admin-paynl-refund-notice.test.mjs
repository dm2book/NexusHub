/**
 * Refunding a Pay. order from the admin never claims the money went back.
 *
 * A Pay. refund is made by hand in my.pay.nl: the server marks the order
 * refunded and answers `refund.via === 'paynl'`. The order detail page said so,
 * but the Orders list and Operations toasted "refund done", and the confirm
 * prompt promised "This really sends the money back" — so a buyer's order read
 * "Terugbetaald" while nobody was reminded to send the money.
 *
 * Checks the shared helper's wording directly, and that every refunding admin
 * page uses it. No server needed.
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

console.log('— What the refund toast says —');
{
  const fmt = await import('../../src/lib/format.js').catch((e) => ({ error: e }));
  const outcome = fmt.refundOutcome;
  ok('there is a shared helper for the refund outcome', typeof outcome === 'function');
  if (typeof outcome === 'function') {
    const paynl = outcome({ method: 'money', provider: 'manual', cents: 999, via: 'paynl' }, 'FM-1', 'EUR');
    ok('a Pay. refund says to refund it in my.pay.nl', /my\.pay\.nl/.test(paynl) && /not automatic/.test(paynl), paynl);
    ok('…and never that it is done', !/\bdone\b/i.test(paynl) && !/^Order FM-1: refunded\.$/.test(paynl), paynl);
    const stripe = outcome({ method: 'money', provider: 'stripe', id: 're_1', cents: 999 }, 'FM-1', 'EUR');
    ok('a Stripe refund says it went back through Stripe', /through Stripe/.test(stripe), stripe);
    const manual = outcome({ method: 'money', provider: 'manual', cents: 500 }, 'FM-1', 'EUR');
    ok('a manual payment says to send it back by hand', /by hand/.test(manual), manual);
  }
}

console.log('\n— The confirm prompt —');
{
  const src = read('src/lib/format.js');
  ok('the prompt knows a Pay. order is refunded in my.pay.nl',
    /pspProvider === 'paynl'/.test(src) && /refund it yourself in my\.pay\.nl/.test(src));
}

console.log('\n— Every refunding admin page uses it —');
for (const page of ['src/pages/admin/Orders.jsx', 'src/pages/admin/Operations.jsx', 'src/pages/admin/OrderDetail.jsx']) {
  const src = read(page);
  ok(`${page.split('/').pop()} reports the refund through refundOutcome`, /refundOutcome\(r\.refund/.test(src));
}
{
  const ops = read('src/pages/admin/Operations.jsx');
  ok('the Operations refund dialog warns about Pay.', /pspProvider === 'paynl'/.test(ops) && /my\.pay\.nl/.test(ops));
  const svc = read('server/src/services/orderService.js');
  ok('the admin list rows carry the payment provider', /pspProvider: row\.psp_provider \|\| null,\n\s+currency: row\.currency, status: row\.status, statusLabel/.test(svc));
}

console.log(`\n${fail ? '❌' : '✅'} admin-paynl-refund-notice: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
