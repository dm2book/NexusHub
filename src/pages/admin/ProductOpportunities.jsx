import { useCallback, useEffect, useState } from 'react';
import { Rocket, RefreshCw, Truck, Info } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Growth → Product Opportunities.
 *
 * Products the shop does not sell yet that the marketplaces do, graded HIGH,
 * MEDIUM or LOW. Every number on this page is either observed or labelled as
 * what it is:
 *
 *   average market price  the mean of the prices actually observed
 *   competitors           distinct sellers seen, and on how many of the four
 *                         marketplaces
 *   estimated margin      after 21% BTW and the payment fee, against a cost
 *                         basis that is named: your own supplier's price,
 *                         a ratio from products you already sell, an
 *                         assumption you set — or unknown, never guessed
 *   supplier              whether a supplier you connected was seen holding it
 *                         in stock
 *   opportunity score     0–100, from your own sales in the category where
 *                         there are any, and market breadth where there are not
 *
 * A marketplace the shop cannot read is shown as unavailable at the top. Its
 * absence from a row then means "not looked at", not "not sold there".
 */

const eurToCents = (e) => (e == null ? null : Math.round(Number(e) * 100));

const GRADE = {
  high: { label: 'HIGH OPPORTUNITY', cls: 'text-emerald-300', frame: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  medium: { label: 'MEDIUM OPPORTUNITY', cls: 'text-amber-300', frame: 'border-amber-500/30', dot: 'bg-amber-400' },
  low: { label: 'LOW OPPORTUNITY', cls: 'text-slate-300', frame: 'border-white/10', dot: 'bg-slate-500' },
};

const BASIS = {
  supplier: 'your supplier',
  derived: 'from your catalogue',
  assumed: 'assumed ratio',
  none: 'unknown',
};

export default function ProductOpportunities() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/api/admin/market/opportunity-scan').then(setData).catch(() => setData(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/market/discovery/run', {});
      toast.success('Scan finished.');
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (data === null) return <PageLoader />;
  if (data === false) return <p className="text-slate-400">Could not load the opportunity scan.</p>;

  const readable = data.marketplaces.filter((m) => m.status === 'available').length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h1 className="text-2xl text-white flex items-center gap-2"><Rocket size={22} className="text-violet-300" /> Product Opportunities</h1>
        <button onClick={scan} disabled={busy || !readable} className="btn-primary text-sm disabled:opacity-40">
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> {busy ? 'Scanning…' : 'Run scan'}
        </button>
      </div>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Products ForgeMarket does not sell yet that competitors do. Margins are after 21% BTW and payment fees;
        a margin with no cost basis is shown as unknown, never guessed.
      </p>

      {/* Which of the four could actually be read. */}
      <div className="flex flex-wrap gap-2 mb-6" data-testid="marketplaces">
        {data.marketplaces.map((m) => (
          <span key={m.key} title={m.reason || ''}
            className={`text-xs rounded-full px-3 py-1 border ${m.status === 'available'
              ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
              : 'border-white/10 text-slate-400'}`}>
            {m.label}: {m.status === 'available' ? 'scanned'
              : m.status === 'disabled' ? 'key present, switched off' : 'not available'}
          </span>
        ))}
      </div>

      {!readable && (
        <div className="card p-4 mb-6 text-sm text-amber-200 flex gap-2">
          <Info size={16} className="shrink-0 mt-0.5" />
          <span>No marketplace can be read yet. Each one is read through its official API: connect it as a
            supplier with its API key (Suppliers → Add supplier), or set its key in the environment — then add
            it to <code className="text-amber-100">MARKET_SOURCES</code>, which is off by default so a source is
            only queried once you decide it should be. Hover a marketplace above for the exact reason.
            Nothing is scraped from their websites.</span>
        </div>
      )}

      {data.evidence?.blockers?.length > 0 && (
        <ul className="mb-6 space-y-1">
          {data.evidence.blockers.map((b) => (
            <li key={b} className="text-xs text-slate-400 flex gap-2"><Info size={13} className="shrink-0 mt-0.5" />{b}</li>
          ))}
        </ul>
      )}

      {['high', 'medium', 'low'].map((g) => (
        <Section key={g} grade={g} rows={data.groups[g] || []} />
      ))}

      {data.unrated > 0 && (
        <p className="text-xs text-slate-500 mt-2">
          {data.unrated} more product(s) were seen too few times to judge, and are not graded rather than graded LOW.
        </p>
      )}
    </div>
  );
}

function Section({ grade, rows }) {
  const st = GRADE[grade];
  return (
    <section className={`card border ${st.frame} mb-6`} data-testid={`grade-${grade}`}>
      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
        <span className={`w-2 h-2 rounded-full ${st.dot}`} />
        <h2 className={`text-sm font-semibold tracking-wide ${st.cls}`}>{st.label}</h2>
        <span className="text-slate-500 text-xs">· {rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-4 text-slate-500 text-sm">Nothing in this group yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-slate-400 text-[11px]">
              <tr className="border-b border-white/5">
                <th className="text-left px-5 py-2 font-normal">Product</th>
                <th className="text-left px-3 py-2 font-normal">Category</th>
                <th className="text-right px-3 py-2 font-normal">Avg market price</th>
                <th className="text-right px-3 py-2 font-normal">Competitors</th>
                <th className="text-right px-3 py-2 font-normal">Est. margin</th>
                <th className="text-left px-3 py-2 font-normal">Supplier</th>
                <th className="text-right px-5 py-2 font-normal">Opportunity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.candidateId || r.marketProductId} className="hover:bg-white/5 align-top"
                  title={(r.gradeReasons || []).join('\n')}>
                  <td className="px-5 py-2.5 text-white">{r.name}</td>
                  <td className="px-3 py-2.5 text-slate-400">{r.categoryLabel || r.category || '—'}</td>
                  <td className="px-3 py-2.5 text-right text-slate-200">
                    {r.meanEur == null ? '—' : money(eurToCents(r.meanEur))}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300">
                    {r.offerCount}
                    <div className="text-[11px] text-slate-500">on {r.sourceCount} of 4 marketplaces</div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.margin?.marginPct == null
                      ? <span className="text-slate-500" title={r.margin?.reason || ''}>unknown</span>
                      : <span className={r.margin.marginPct > 0 ? 'text-emerald-300' : 'text-red-300'}>
                          {Math.round(r.margin.marginPct)}%
                        </span>}
                    <div className="text-[11px] text-slate-500">{BASIS[r.margin?.basis] || ''}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.supplier?.available
                      ? <span className="text-emerald-300 inline-flex items-center gap-1"><Truck size={13} /> {r.supplier.supplierName}
                          <span className="text-slate-500"> · {money(eurToCents(r.supplier.costEur))}</span></span>
                      : <span className="text-slate-500" title={r.supplier?.reason || ''}>none</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="text-white font-semibold">{r.revenue?.score ?? '—'}</span>
                    <span className="text-slate-500">/100</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
