/**
 * The lines the product page's trust block shows, from whatever the server
 * sent (productTrustService). Pure and JSX-free so the server tests can run it:
 * a field that is absent produces no line — never a zero or a dash.
 */
export const durationParts = (seconds) => {
  const s = Math.max(0, Number(seconds) || 0);
  /* Seconds as seconds: rounding 20 s up to "1 min" overstated it, and the
     pages that wrote "< 20s" for a figure of about 20 s understated it. */
  if (s < 60) return ['tr.secs', '{n} sec', Math.max(1, Math.round(s))];
  if (s < 3600) return ['tr.mins', '{n} min', Math.max(1, Math.round(s / 60))];
  if (s < 86_400) return ['tr.hours', '{n} h', Math.round((s / 3600) * 10) / 10];
  return ['tr.days', '{n} days', Math.round((s / 86_400) * 10) / 10];
};

/** "40 sec", "12 min", "2.5 h", "3 days" in the reader's language — one spelling for every delivery time on the site. */
export const durationText = (seconds, t) => {
  const [key, en, n] = durationParts(seconds);
  return t(key, en, { n });
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
  /* The median, and the line says so: a mean is dragged by the one order that
     waited a weekend, and the reader should know which of the two this is. */
  if (trust.medianDelivery) {
    out.push({ k: 'avg', text: t('tr.median', 'Typically {d} from payment to delivery (median of {n} orders)',
      { d: durationText(trust.medianDelivery.seconds, t), n: trust.medianDelivery.orders }) });
  }
  if (trust.score != null) out.push({ k: 'score', text: t('tr.score', 'Trust score {s}/100', { s: trust.score }) });
  return out;
}

