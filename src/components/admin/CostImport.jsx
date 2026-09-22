/**
 * Paste a supplier price list; the shop reads it.
 *
 * ── WHY THIS IS A TEXTAREA AND NOT A FILE PICKER ──────────────────────────
 * The source of these numbers is a supplier's page or a spreadsheet, and both
 * of those are already on the clipboard by the time anybody thinks about cost
 * prices. A file upload would mean save-as, find-the-file, and a format
 * argument about CSV. Paste is the shortest path from where the numbers are to
 * where they need to be.
 *
 * ── AND WHY IT SHOWS THE RESULT BEFORE WRITING ANYTHING ───────────────────
 * Costs decide every margin in this shop. A paste with a decimal in the wrong
 * place is not a typo, it is a product that reports a profit it does not make.
 * So the first press reads and reports — what matched, what it would change,
 * what it could not find — and the second one writes. Same report either way.
 */
import { useState } from 'react';
import { Euro, AlertTriangle, Check } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function CostImport({ onDone }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (apply) => {
    setBusy(true);
    try {
      const r = await api.post('/api/admin/products/costs/import', { text, apply });
      setReport(r);
      if (apply) {
        toast.success(`${r.changed} product(s) updated — ${r.catalogue.withCost} of ${r.catalogue.total} now have a cost.`);
        setText('');
        onDone?.();
      }
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="text-white text-sm font-semibold flex items-center gap-2">
          <Euro size={15} className="text-emerald-300" /> Import cost prices
        </h3>
        <p className="text-slate-400 text-xs mt-1">
          One line per product: <code className="text-slate-300">SKU</code> then what you pay for it.
          Tab, semicolon or comma between them — a whole column pasted from a spreadsheet works as is.
          Without a cost, every margin in this shop is blank rather than wrong.
        </p>
      </div>

      <textarea className="input font-mono text-xs h-40" spellCheck="false"
        placeholder={'APEX-1000\t6.20\nAPEX-2150\t12,50\nRBX-1000;7.10'}
        value={text} onChange={(e) => setText(e.target.value)} />

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => run(false)} disabled={busy || !text.trim()}
          className="btn-ghost text-xs disabled:opacity-40">
          {busy ? 'Reading…' : 'Check it first'}
        </button>
        <button onClick={() => run(true)}
          disabled={busy || !report || !report.changed}
          className="btn-primary text-xs disabled:opacity-40">
          {report?.changed ? `Apply ${report.changed} cost(s)` : 'Apply'}
        </button>
        {report && !report.applied && (
          <span className="text-slate-500 text-xs">Nothing written yet.</span>
        )}
      </div>

      {report && (
        <div className="space-y-3">
          <div className="text-[12.5px] text-slate-300">
            {report.matched} line(s) matched a product · <b className="text-white">{report.changed}</b> would change
            {report.unchanged ? ` · ${report.unchanged} already correct` : ''}
            {report.unmatched ? <span className="text-amber-300"> · {report.unmatched} could not be used</span> : ''}
          </div>
          <div className="text-[12px] text-slate-500">
            {report.catalogue.withCost} of {report.catalogue.total} products have a cost price.
          </div>

          {/* Named, not counted: a line that did not land has to be findable. */}
          {report.problems?.length > 0 && (
            <ul className="space-y-1 max-h-32 overflow-auto">
              {report.problems.map((p, i) => (
                <li key={i} className="text-[12px] text-amber-300/90 flex gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span><span className="font-mono">{p.raw}</span> — {p.error}</span>
                </li>
              ))}
            </ul>
          )}

          {report.rows?.length > 0 && (
            <div className="rounded-xl border border-white/10 overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead className="text-slate-400 text-[11px]">
                  <tr className="border-b border-white/5">
                    <th className="text-left px-3 py-1.5 font-normal">SKU</th>
                    <th className="text-right px-3 py-1.5 font-normal">Sells for</th>
                    <th className="text-right px-3 py-1.5 font-normal">Cost now</th>
                    <th className="text-right px-3 py-1.5 font-normal">Cost after</th>
                    <th className="text-right px-3 py-1.5 font-normal">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {report.rows.map((r) => (
                    <tr key={r.id} className={r.warning ? 'bg-amber-500/10' : ''}>
                      <td className="px-3 py-1.5 font-mono text-slate-300">{r.sku}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{money(r.price)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500">
                        {r.before == null ? '—' : money(r.before)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-white">{money(r.after)}</td>
                      {/* The reason anybody is doing this at all. */}
                      <td className={`px-3 py-1.5 text-right ${r.warning ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {r.price > 0 ? `${Math.round(((r.price - r.after) / r.price) * 100)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.applied && (
            <div className="text-[12.5px] text-emerald-300 flex items-center gap-2">
              <Check size={14} /> Written. Profit, pricing and the supplier comparison can see these now.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
