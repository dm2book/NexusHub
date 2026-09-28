import { useCallback, useEffect, useState } from 'react';
import { TrendingDown, Check, EyeOff } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Products that lose money on every sale, and what to do about each one.
 *
 * Two answers, because there are two situations. Most products need a small
 * nudge up to clear BTW and the payment fee. Some would need a price nobody
 * pays — 1,000 Robux bought at €10.14 has to sell at €13.99 — and for those
 * the honest move is to take them off the shelf until a cheaper supplier is
 * found, not to list them at a price that only exists to look fixed. The
 * increase is shown on every row so the owner can tell which is which.
 *
 * Only shown when there is something to fix. Products with no cost price are
 * counted, never guessed at.
 */
export default function LossPrices({ onDone }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/api/admin/products/pricing/loss').then((r) => {
      setData(r);
      setPicked(Object.fromEntries(r.rows.map((x) => [x.id, true])));
    }).catch(() => setData(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data || !data.rows.length) return null;

  const ids = data.rows.filter((r) => picked[r.id]).map((r) => r.id);
  const act = async (action) => {
    if (!ids.length) return;
    const verb = action === 'hide' ? 'Take' : 'Reprice';
    if (!window.confirm(`${verb} ${ids.length} product(s)${action === 'hide' ? ' off the shelf' : ' to the lowest profitable price'}?`)) return;
    setBusy(true);
    try {
      const r = await api.post('/api/admin/products/pricing/loss', { ids, action });
      toast.success(`${r.changed} product(s) ${action === 'hide' ? 'hidden' : 'repriced'}.`);
      load();
      onDone?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card p-5 mb-4 border border-red-500/20">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white text-sm font-semibold flex items-center gap-2">
            <TrendingDown size={15} className="text-red-300" />
            {data.loss > 0 ? `${data.loss} product(s) lose money on every sale` : `${data.thin} product(s) earn under your minimum`}
            {data.loss > 0 && data.thin > 0 && <span className="text-slate-400 font-normal"> · {data.thin} under your minimum</span>}
          </h3>
          <p className="text-slate-400 text-xs mt-1 max-w-2xl">
            Measured after {data.vat.pct}% BTW and the payment fee. The new price is the lowest that earns at
            least {money(Math.round(data.minimumProfitEur * 100))} and {data.minimumMarginPercent}% — rounded up to .49 or .99.
            A big increase means this supplier is too expensive: hiding the product is often the better choice.
            {data.unknown > 0 && ` ${data.unknown} product(s) have no cost price, so they cannot be checked.`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => act('hide')} disabled={busy || !ids.length} className="btn-ghost text-xs disabled:opacity-40">
            <EyeOff size={13} /> Hide {ids.length}
          </button>
          <button onClick={() => act('reprice')} disabled={busy || !ids.length} className="btn-primary text-xs disabled:opacity-40">
            <Check size={13} /> Reprice {ids.length}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 mt-3 max-h-72 overflow-y-auto">
        <table className="w-full text-[12.5px]">
          <thead className="text-slate-400 text-[11px]">
            <tr className="border-b border-white/5">
              <th className="px-3 py-1.5 w-6" />
              <th className="text-left px-3 py-1.5 font-normal">Product</th>
              <th className="text-right px-3 py-1.5 font-normal">Cost</th>
              <th className="text-right px-3 py-1.5 font-normal">Price now</th>
              <th className="text-right px-3 py-1.5 font-normal">Per sale now</th>
              <th className="text-right px-3 py-1.5 font-normal">New price</th>
              <th className="text-right px-3 py-1.5 font-normal">Per sale then</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={!!picked[r.id]}
                    onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.checked }))} />
                </td>
                <td className="px-3 py-1.5 text-slate-200">{r.name}</td>
                <td className="px-3 py-1.5 text-right text-slate-400">{money(r.cost)}</td>
                <td className="px-3 py-1.5 text-right text-slate-400">{money(r.price)}</td>
                <td className={`px-3 py-1.5 text-right ${r.profitCents < 0 ? 'text-red-300' : 'text-amber-300'}`}>
                  {money(r.profitCents)}
                </td>
                <td className="px-3 py-1.5 text-right text-white">
                  {money(r.proposedPrice)}
                  <span className={`ml-1 text-[11px] ${r.increasePct > 20 ? 'text-amber-300' : 'text-slate-500'}`}>+{r.increasePct}%</span>
                </td>
                <td className="px-3 py-1.5 text-right text-emerald-300">{money(r.proposedProfitCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
