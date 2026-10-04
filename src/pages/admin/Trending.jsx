import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Products → Trending.
 *
 * What the trending engine sees: sales in 24 h and 7 days, revenue, views and
 * conversion per product, and the label each one earned. Read-only on purpose —
 * the lists are the numbers, and there is nothing here to pick or pin. The
 * page refreshes itself every minute, as the engine does.
 */
const LABEL = {
  hot: { t: '🔥 Hot', c: '#fda4af', rule: '≥2 verkocht in 24 u en minstens 2× het dagtempo van de 6 dagen ervoor' },
  trending: { t: '📈 Trending', c: '#fcd34d', rule: 'verkocht in 24 u, op of boven het 7-daagse dagtempo' },
  popular: { t: '⭐ Popular', c: '#7dd3fc', rule: '≥3 verkocht in 7 dagen' },
  new: { t: '✨ New', c: '#6ee7b7', rule: 'toegevoegd in de laatste 14 dagen' },
};

export default function Trending() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const load = () => api.get('/api/admin/products/trending').then(setData).catch((e) => { toast.error(e.message); setData((d) => d ?? false); });
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (data === null) return <PageLoader />;
  if (data === false) return <p className="text-slate-400">Kon de trending-gegevens niet laden.</p>;
  const name = new Map(data.rows.map((r) => [r.id, r.name]));
  const cell = 'px-4 py-3 tabular-nums text-slate-300';

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl text-white">Trending</h1>
        <button type="button" className="btn-ghost text-xs" onClick={load}><RefreshCw size={13} /> Ververs</button>
      </div>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Automatisch berekend uit echte, betaalde bestellingen (geen test- of gratis bestellingen), omzet, productweergaven
        en de leeftijd van het product. Er is niets handmatig te kiezen of vast te pinnen. Bijgewerkt {date(data.updatedAt)}.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-5">
        {Object.entries(LABEL).map(([k, v]) => (
          <div key={k} className="rounded-xl border px-4 py-3" style={{ color: v.c, background: `${v.c}14`, borderColor: `${v.c}4d` }} data-testid={`trend-${k}`}>
            <div className="text-sm">{v.t} <span className="text-white tabular-nums">· {data.lists[k].length}</span></div>
            <div className="text-xs text-slate-400 mt-1">{v.rule}</div>
            <ol className="text-xs text-slate-200 mt-2 space-y-0.5">
              {data.lists[k].slice(0, 5).map((id) => <li key={id} className="truncate">{name.get(id)}</li>)}
              {!data.lists[k].length && <li className="text-slate-500">Nog niets dat hieraan voldoet</li>}
            </ol>
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 820 }}>
          <thead className="text-left text-slate-400 border-b border-white/5">
            <tr>
              <th className="px-4 py-3">Product</th><th className="px-4 py-3">Label</th><th className="px-4 py-3">24 u</th>
              <th className="px-4 py-3">7 dagen</th><th className="px-4 py-3">Omzet 7 d</th><th className="px-4 py-3">Weergaven</th>
              <th className="px-4 py-3">Conversie</th><th className="px-4 py-3">Momentum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3"><div className="text-slate-200">{r.name}</div><div className="text-xs text-slate-500">{r.category}</div></td>
                <td className="px-4 py-3 text-xs" style={r.label ? { color: LABEL[r.label].c } : undefined}>{r.label ? LABEL[r.label].t : ''}</td>
                <td className={cell}>{r.sales24h || ''}</td>
                <td className={cell}>{r.sales7d || ''}</td>
                <td className={cell}>{r.revenue7d ? money(r.revenue7d) : ''}</td>
                <td className={cell}>{r.views7d || ''}</td>
                <td className={cell}>{r.conversion != null ? `${r.conversion}%` : ''}</td>
                <td className={cell}>{r.momentum || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 mt-3">Conversie verschijnt pas na 20 weergaven in 7 dagen; een leeg vak betekent nog geen data.</p>
    </div>
  );
}
