import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Products → Trust.
 *
 * What the product page shows a buyer, for every product at once: stock, last
 * delivery, successful orders, fulfilment and refund rates, measured delivery
 * time and the trust score — all from real, paid, non-test orders. A blank
 * cell means there is no data yet, and the shop shows nothing there either.
 */
const STOCK = { in_stock: 'Op voorraad', on_order: 'Per bestelling', out_of_stock: 'Uitverkocht' };
const scoreColour = (s) => (s >= 80 ? '#6ee7b7' : s >= 50 ? '#fcd34d' : '#fda4af');
const dur = (sec) => (sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} min` : sec < 86_400 ? `${(sec / 3600).toFixed(1)} uur` : `${(sec / 86_400).toFixed(1)} dagen`);

export default function ProductTrustAdmin() {
  const toast = useToast();
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/api/admin/products/trust').then(setData).catch((e) => { toast.error(e.message); setData(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (data === null) return <PageLoader />;
  if (data === false) return <p className="text-slate-400">Kon de vertrouwensgegevens niet laden.</p>;
  const cell = 'px-4 py-3 tabular-nums';

  return (
    <div>
      <h1 className="text-2xl text-white mb-2">Vertrouwen per product</h1>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Alleen echte, betaalde bestellingen (geen testbetalingen, geen gratis bestellingen). Percentages en de score
        verschijnen pas na {data.minSample} afgeronde bestellingen; de levertijd na {data.minTimed} bestellingen met
        betaal- én levermoment. Een leeg vak betekent: nog geen data — en dan toont de winkel daar ook niets.
        {' '}<span className="text-white">{data.scored}</span> van {data.total} producten hebben een score.
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="text-left text-slate-400 border-b border-white/5">
            <tr>
              <th className="px-4 py-3">Product</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Voorraad</th>
              <th className="px-4 py-3">Laatste levering</th><th className="px-4 py-3">Geslaagd</th><th className="px-4 py-3">Geleverd</th>
              <th className="px-4 py-3">Terugbetaald</th><th className="px-4 py-3">Gem. levertijd</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.items.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3"><div className="text-slate-200">{i.name}</div><div className="text-xs text-slate-500">{i.category}</div></td>
                <td className={cell} style={i.score != null ? { color: scoreColour(i.score) } : undefined}>{i.score != null ? `${i.score}/100` : ''}</td>
                <td className="px-4 py-3 text-slate-300 text-xs">{i.stock ? `${STOCK[i.stock.state]}${i.stock.left ? ` · ${i.stock.left}` : ''}` : ''}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{i.lastDelivery ? date(i.lastDelivery) : ''}</td>
                <td className={`${cell} text-slate-300`}>{i.successfulOrders || ''}</td>
                <td className={`${cell} text-slate-300`}>{i.fulfillmentRate != null ? `${i.fulfillmentRate}% (${i.sample})` : ''}</td>
                <td className={`${cell} text-slate-300`}>{i.refundRate != null ? `${i.refundRate}%` : ''}</td>
                <td className={`${cell} text-slate-300`}>{i.avgDelivery ? `${dur(i.avgDelivery.seconds)} (${i.avgDelivery.orders})` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
