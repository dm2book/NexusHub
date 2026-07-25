/**
 * Turning a raw order status into something a buyer understands.
 *
 * Lives outside bot.js on purpose: bot.js logs in to Discord the moment it is
 * imported, so nothing in it can be tested. This module is pure — payload in,
 * embed data out — and is covered by discord/test/order-status.test.mjs.
 *
 * The question behind every /order is the same: "is something wrong, and do I
 * have to do anything?". Colour answers it before the text does —
 * amber = your move, blue = ours, green = done, grey = closed.
 */

export const ORDER_STATE = {
  pending: {
    color: 0xf5b324, emoji: '⏳', title: 'Waiting for your payment',
    next: 'We haven’t received the payment yet. Pay the amount with your order number as the reference — the status flips by itself once it lands.',
  },
  payment_received: {
    color: 0x38bdf8, emoji: '✅', title: 'Payment confirmed',
    next: 'Nothing left for you to do. In-stock items go out automatically; anything else we deliver by hand, usually within a few hours.',
  },
  processing: {
    color: 0x38bdf8, emoji: '🔧', title: 'Being prepared',
    next: 'We’re getting your items ready right now. Your code arrives by email.',
  },
  awaiting_fulfillment: {
    color: 0x38bdf8, emoji: '📦', title: 'Almost there',
    next: 'Payment is in and your order is queued for delivery. If it’s been longer than a few hours, open a ticket and we’ll chase it.',
  },
  completed: {
    color: 0x22c55e, emoji: '🎉', title: 'Delivered',
    next: 'Your code was sent to the email used at checkout. Can’t find it? Check spam, then open a ticket — we can resend.',
  },
  refunded: {
    color: 0xa855f7, emoji: '↩️', title: 'Refunded',
    next: 'The money is on its way back to where you paid from — usually 1–3 working days.',
  },
  cancelled: {
    color: 0x64748b, emoji: '✖️', title: 'Cancelled',
    next: 'This order was closed. Think that’s wrong? Open a ticket with the order number.',
  },
  failed: {
    color: 0x64748b, emoji: '⚠️', title: 'Closed',
    next: 'Something went wrong with this order. Open a ticket and we’ll sort it out.',
  },
};

const FALLBACK = { color: 0x6366f1, emoji: '📦', title: 'Order status', next: '' };

/**
 * Shape a /api/track payload into embed fields.
 * Returns plain data so this stays testable without discord.js.
 */
export function orderStatusView(o, { money = (c) => `€${(c / 100).toFixed(2)}` } = {}) {
  const s = ORDER_STATE[o.status] || { ...FALLBACK, title: o.statusLabel || o.status || FALLBACK.title };
  const progress = (o.history || []).slice(-4).map((h) => {
    const key = h.to || h.to_status;
    const at = new Date(h.at || h.created_at);
    const stamp = Number.isNaN(at.getTime()) ? '' : ` — <t:${Math.floor(at.getTime() / 1000)}:R>`;
    // Discord renders the timestamp in the reader's own timezone and language.
    return `• ${ORDER_STATE[key]?.title || key}${stamp}`;
  }).join('\n') || '—';

  const fields = [{ name: 'Progress', value: progress }];
  if (o.totalFormatted || o.total != null) {
    fields.push({ name: 'Total', value: o.totalFormatted || money(o.total, o.currency), inline: true });
  }
  // The reference only matters while we're still waiting for the money.
  if (o.status === 'pending') fields.push({ name: 'Payment reference', value: `\`${o.number}\``, inline: true });

  return { color: s.color, title: `${s.emoji} ${s.title}`, description: s.next, author: `Order ${o.number}`, fields };
}
