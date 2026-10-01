import { useCallback, useEffect, useState } from 'react';
import { Shuffle, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date, money } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Every time the shop moved a product to another supplier by itself.
 *
 * The switch changes who gets paid for the next order, so the owner sees each
 * one: which product, the supplier it left, the one it moved to, and why — in
 * the words the decision was made on, with the numbers behind it on hover.
 */
const WHY = {
  offline: { label: 'Offline', cls: 'text-red-300 bg-red-500/10' },
  errors: { label: 'Errors', cls: 'text-red-300 bg-red-500/10' },
  out_of_stock: { label: 'Out of stock', cls: 'text-amber-300 bg-amber-500/10' },
  too_expensive: { label: 'Too expensive', cls: 'text-sky-300 bg-sky-500/10' },
};
const TRIGGER = { order: 'at an order', failure: 'after a failed delivery', sweep: 'by the hourly check' };

export default function SupplierSwitches() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/api/admin/suppliers/failover/switches').then((r) => setRows(r.switches || [])).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/admin/suppliers/failover/run', {});
      toast.success(r.switched ? `${r.switched} product(s) moved to a better supplier.` : `Checked ${r.checked} product(s) — no switch needed.`);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (rows === null) return null;

  return (
    <div className="card p-5 mb-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white text-sm font-semibold flex items-center gap-2">
            <Shuffle size={15} className="text-violet-300" /> Automatic supplier switches
          </h3>
          <p className="text-slate-400 text-xs mt-1 max-w-2xl">
            When a product&rsquo;s supplier is offline, failing, out of stock or too expensive, the shop moves it to
            the best one that is not — on stock, price, reliability and fulfilment rate — and tries the next supplier
            before a failed delivery reaches you. Checked at every order and every hour.
          </p>
        </div>
        <button onClick={runNow} disabled={busy} className="btn-ghost text-xs disabled:opacity-40">
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-500 text-sm mt-4">No switches yet — every product is still with its first-choice supplier.</p>
      ) : (
        <div className="rounded-xl border border-white/10 mt-4 overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-slate-400 text-[11px]">
              <tr className="border-b border-white/5">
                <th className="text-left px-3 py-1.5 font-normal">When</th>
                <th className="text-left px-3 py-1.5 font-normal">Product</th>
                <th className="text-left px-3 py-1.5 font-normal">Old supplier</th>
                <th className="text-left px-3 py-1.5 font-normal">New supplier</th>
                <th className="text-left px-3 py-1.5 font-normal">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => {
                const w = WHY[r.code] || { label: r.code, cls: 'text-slate-300 bg-white/5' };
                const f = r.detail?.from || {};
                const t = r.detail?.to || {};
                return (
                  <tr key={r.id} className="align-top" data-testid="switch-row">
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{date(r.at)}
                      <div className="text-[11px] text-slate-500">{TRIGGER[r.trigger] || r.trigger}</div></td>
                    <td className="px-3 py-2 text-slate-200">{r.productName || r.productId}</td>
                    <td className="px-3 py-2 text-slate-300">{r.from?.name || '—'}
                      {f.cost != null && <div className="text-[11px] text-slate-500">{money(f.cost)}
                        {f.reliabilityPct != null && ` · ${f.reliabilityPct}% delivered`}</div>}</td>
                    <td className="px-3 py-2 text-emerald-300">{r.to?.name || '—'}
                      {t.cost != null && <div className="text-[11px] text-slate-500">{money(t.cost)}
                        {t.reliabilityPct != null && ` · ${t.reliabilityPct}% delivered`}</div>}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] rounded px-1.5 py-0.5 ${w.cls}`}>{w.label}</span>
                      <div className="text-slate-400 mt-1">{r.reason}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
