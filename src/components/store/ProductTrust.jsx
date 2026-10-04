import { useEffect, useState } from 'react';
import { Boxes, PackageCheck, Truck, Undo2, Timer, Gauge } from 'lucide-react';
import { api } from '../../lib/api.js';
import { trustLines } from '../../lib/trustLines.js';

/**
 * The trust layer on the product page: stock, last delivery, successful
 * orders, fulfilment and refund rates, measured delivery time and a score —
 * all from this shop's own orders (productTrustService).
 *
 * The server only sends a field that has data behind it, and this renders only
 * what it was sent. A new product shows its stock and nothing else; with no
 * data at all the block is not drawn. No placeholder, no zero, no estimate.
 */
const ICONS = { stock: Boxes, last: Truck, orders: PackageCheck, fulfil: PackageCheck, refund: Undo2, avg: Timer, score: Gauge };

export default function ProductTrust({ productId, t, locale }) {
  const [trust, setTrust] = useState(null);
  useEffect(() => {
    if (!productId) return undefined;
    let live = true;
    api.get(`/api/products/${productId}/trust`).then((r) => { if (live) setTrust(r.trust || null); }).catch(() => { if (live) setTrust(null); });
    return () => { live = false; };
  }, [productId]);
  const lines = trustLines(trust, t, locale);
  if (!lines.length) return null;
  return (
    <section className="mt-4" data-testid="product-trust">
      <div className="text-[12.5px] font-semibold text-slate-800">{t('tr.title', 'Measured on this shop’s own orders')}</div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
        {lines.map(({ k, text }) => {
          const Icon = ICONS[k];
          return (
          <li key={k} className="flex items-start gap-2 text-[12.5px] text-slate-600">
            <Icon size={14} className="text-emerald-600 shrink-0 mt-0.5" />
            <span className="leading-snug">{text}</span>
          </li>
          );
        })}
      </ul>
    </section>
  );
}
