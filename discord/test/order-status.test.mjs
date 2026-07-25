/**
 * /order tells a buyer what is happening and whether they need to act.
 * Runs without Postgres or a Discord token — pure payload → view.
 */
import { orderStatusView, ORDER_STATE } from '../src/orderStatus.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

const base = { number: 'FM-2026-8KQ2R7XZ', total: 999, currency: 'EUR', totalFormatted: '€9.99' };

console.log('— /order status view —');

// Waiting on the buyer: amber, and the reference must be right there.
{
  const v = orderStatusView({ ...base, status: 'pending', history: [{ to: 'pending', at: '2026-07-25T10:00:00.000Z' }] });
  ok('pending is amber', v.color === 0xf5b324, `#${v.color.toString(16)}`);
  ok('pending shows the payment reference', v.fields.some((f) => f.value.includes(base.number)));
  ok('pending explains what the buyer must do', /reference/i.test(v.description));
}

// Waiting on us: no call to action, no reference clutter.
{
  const v = orderStatusView({ ...base, status: 'payment_received', history: [] });
  ok('paid is blue', v.color === 0x38bdf8);
  ok('paid says nothing is required from the buyer', /nothing left for you to do/i.test(v.description));
  ok('paid drops the payment reference', !v.fields.some((f) => f.name === 'Payment reference'));
  ok('paid never promises instant delivery', !/instant/i.test(v.description));
}

// Done.
{
  const v = orderStatusView({ ...base, status: 'completed', history: [] });
  ok('delivered is green', v.color === 0x22c55e);
  ok('delivered says where the code went', /email/i.test(v.description));
  ok('delivered offers a route when it is missing', /spam|ticket/i.test(v.description));
}

// Money back.
{
  const v = orderStatusView({ ...base, status: 'refunded', history: [] });
  ok('refunded gives a real timeframe', /1–3 working days/.test(v.description));
}

// Unknown status must degrade, never crash or show a raw enum as the headline.
{
  const v = orderStatusView({ ...base, status: 'quantum_superposition', statusLabel: 'In limbo', history: [] });
  ok('an unknown status still renders', typeof v.title === 'string' && v.title.length > 0);
  ok('an unknown status uses the human label', v.title.includes('In limbo'));
}

// History is rendered as Discord relative timestamps, in the reader's own locale.
{
  const v = orderStatusView({ ...base, status: 'completed',
    history: [{ to: 'pending', at: '2026-07-25T10:00:00.000Z' }, { to: 'completed', at: '2026-07-25T10:05:00.000Z' }] });
  const progress = v.fields.find((f) => f.name === 'Progress').value;
  ok('progress uses Discord timestamps', /<t:\d+:R>/.test(progress));
  ok('progress uses human titles, not enums', progress.includes('Delivered') && !progress.includes('payment_received'));
}

// A malformed timestamp must not produce "Invalid Date" in a customer's face.
{
  const v = orderStatusView({ ...base, status: 'completed', history: [{ to: 'completed', at: 'not-a-date' }] });
  const progress = v.fields.find((f) => f.name === 'Progress').value;
  ok('a broken timestamp degrades quietly', !/Invalid|NaN/.test(progress), progress);
}

// Every status the store can emit needs a mapping — a missing one shows a raw enum.
{
  const STORE_STATUSES = ['pending', 'payment_received', 'processing', 'awaiting_fulfillment', 'completed', 'refunded', 'cancelled', 'failed'];
  ok('every store status has buyer-facing copy', STORE_STATUSES.every((s) => ORDER_STATE[s]?.next),
    STORE_STATUSES.filter((s) => !ORDER_STATE[s]).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
