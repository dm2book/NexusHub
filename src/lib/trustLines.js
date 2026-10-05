/**
 * The lines the product page's trust block shows, from whatever the server
 * sent (productTrustService). Pure and JSX-free so the server tests can run it:
 * a field that is absent produces no line — never a zero or a dash.
 */
export const durationParts = (seconds) => {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 3600) return ['tr.mins', '{n} min', Math.max(1, Math.round(s / 60))];
  if (s < 86_400) return ['tr.hours', '{n} h', Math.round((s / 3600) * 10) / 10];
  return ['tr.days', '{n} days', Math.round((s / 86_400) * 10) / 10];
};

/** The lines to show, from whatever the server sent. Pure, so it is testable. */
export function trustLines(trust, t, locale = 'en-GB') {
  if (!trust) return [];
  const out = [];
  const st = trust.stock?.state;
  if (st === 'in_stock') out.push({ k: 'stock', text: trust.stock.left ? t('tr.inStockLeft', 'In stock · {n} left', { n: trust.stock.left }) : t('tr.inStock', 'In stock') });
  /* "Bought in per order" is already the delivery box right above this block;
     saying it twice reads like a warning. Only real shelf stock is a fact here. */
  if (trust.lastDelivery) {
    const d = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(trust.lastDelivery));
    out.push({ k: 'last', text: t('tr.last', 'Last delivered on {d}', { d }) });
  }
  if (trust.successfulOrders) {
    out.push({ k: 'orders', text: trust.successfulOrders === 1 ? t('tr.order1', '1 successful order')
      : t('tr.orders', '{n} successful orders', { n: trust.successfulOrders }) });
  }
  if (trust.fulfillmentRate != null) out.push({ k: 'fulfil', text: t('tr.fulfilled', '{p}% delivered, of {n} completed orders', { p: trust.fulfillmentRate, n: trust.sample }) });
  if (trust.refundRate != null) out.push({ k: 'refund', text: t('tr.refunds', '{p}% refunded', { p: trust.refundRate }) });
  if (trust.avgDelivery) {
    const [key, en, n] = durationParts(trust.avgDelivery.seconds);
    out.push({ k: 'avg', text: t('tr.avg', 'On average {d} from payment to delivery, over {n} orders', { d: t(key, en, { n }), n: trust.avgDelivery.orders }) });
  }
  if (trust.score != null) out.push({ k: 'score', text: t('tr.score', 'Trust score {s}/100', { s: trust.score }) });
  return out;
}

