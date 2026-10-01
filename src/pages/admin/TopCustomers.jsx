import { useCallback, useEffect, useState } from 'react';
import { Crown, Search, Info } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Growth → Top Customers.
 *
 * Per customer, from paid orders only: revenue, profit (after 21% BTW, cost and
 * the referral commission — or "unknown" where a cost was never entered),
 * orders, average order value, last purchase and the revenue their referrals
 * brought in. And three scores, each explained on hover:
 *
 *   Lifetime Value   spent so far, plus twelve months at their own pace when
 *                    they have one (two orders on different days)
 *   Retention        0–100, how likely they still buy here
 *   VIP              0–100, on fixed scales, so it means the same next year
 */
const SEGMENT = {
  vip: { label: 'VIP', cls: 'text-violet-300 bg-violet-500/10' },
  loyal: { label: 'Loyal', cls: 'text-emerald-300 bg-emerald-500/10' },
  regular: { label: 'Regular', cls: 'text-sky-300 bg-sky-500/10' },
  new: { label: 'New', cls: 'text-slate-300 bg-white/5' },
};
const STATUS = {
  new: { label: 'New', cls: 'text-sky-300' },
  active: { label: 'Active', cls: 'text-emerald-300' },
  at_risk: { label: 'At risk', cls: 'text-amber-300' },
  lapsed: { label: 'Lapsed', cls: 'text-red-300' },
};
const SORTS = [
  ['ltv', 'Lifetime value'], ['vip', 'VIP score'], ['revenue', 'Revenue'], ['profit', 'Profit'],
  ['orders', 'Orders'], ['retention', 'Retention'], ['recent', 'Last purchase'], ['referrals', 'Referral revenue'],
];
const GAP_SOURCE = { own: 'their own gap between orders', shop: 'this shop\'s typical gap', default: 'the default gap' };

const daysAgo = (d) => (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`);

export default function TopCustomers() {
  const [f, setF] = useState({ sort: 'ltv', segment: '', status: '', q: '' });
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api.get(`/api/admin/analytics/customers?${qs}`).then(setData).catch(() => setData(false));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load, f.q]);

  if (data === null) return <PageLoader />;
  if (data === false) return <p className="text-slate-400">Could not load customers.</p>;
  const s = data.summary;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div>
      <h1 className="text-2xl text-white flex items-center gap-2 mb-2"><Crown size={22} className="text-violet-300" /> Top Customers</h1>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Paid orders only — refunds and cancellations are not revenue. Profit is after {data.vat.pct}% BTW, supplier
        cost and referral commission, and is shown as unknown where a product has no cost entered, never as free.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6" data-testid="clv-summary">
        <Stat label="Customers" value={s.customers} sub={s.repeatRate == null ? '' : `${s.repeatRate}% ordered again`} />
        <Stat label="Avg. lifetime value" value={s.averageLifetimeValue == null ? '—' : money(s.averageLifetimeValue)}
          sub={s.averageOrderValue == null ? '' : `avg. order ${money(s.averageOrderValue)}`} />
        <Stat label="Profit from customers" value={s.profit == null ? 'unknown' : money(s.profit)}
          sub={`costed for ${s.profitCoverage.customers} of ${s.profitCoverage.of}`} />
        <Stat label="VIP · at risk" value={`${s.segments.vip} · ${s.statuses.at_risk}`}
          sub={s.statuses.at_risk ? `${money(s.revenueAtRisk)} a visit at risk` : 'nobody slipping away'} />
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400 flex-1 min-w-48">Search
          <div className="relative mt-1">
            <Search size={14} className="absolute left-3 top-3 text-slate-500" />
            <input value={f.q} onChange={set('q')} placeholder="e-mail or name" name="q"
              className="w-full rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm h-10 pl-8 pr-3" />
          </div>
        </label>
        {[['sort', 'Sort by', SORTS], ['segment', 'Segment', [['', 'All'], ...Object.entries(SEGMENT).map(([k, v]) => [k, v.label])]],
          ['status', 'Retention', [['', 'All'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])]]].map(([k, label, opts]) => (
          <label key={k} className="text-xs text-slate-400">{label}
            <select value={f[k]} onChange={set(k)} name={k}
              className="block mt-1 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm h-10 px-3">
              {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
      </div>

      {data.customers.length === 0 ? (
        <p className="text-slate-500 text-sm card p-5">{s.customers
          ? 'No customer matches these filters.'
          : 'No paid orders yet — customers appear here from their first paid order.'}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-slate-400 text-[11px]">
              <tr className="border-b border-white/5">
                <th className="text-left px-4 py-2 font-normal">Customer</th>
                <th className="text-right px-3 py-2 font-normal">Revenue</th>
                <th className="text-right px-3 py-2 font-normal">Profit</th>
                <th className="text-right px-3 py-2 font-normal">Orders · avg</th>
                <th className="text-left px-3 py-2 font-normal">Last purchase</th>
                <th className="text-right px-3 py-2 font-normal">Referral revenue</th>
                <th className="text-right px-3 py-2 font-normal">Lifetime value</th>
                <th className="text-right px-3 py-2 font-normal">Retention</th>
                <th className="text-right px-4 py-2 font-normal">VIP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.customers.map((c) => {
                const seg = SEGMENT[c.vip.segment]; const st = STATUS[c.retention.status];
                return (
                  <tr key={c.id} className="align-top hover:bg-white/5" data-testid="customer-row">
                    <td className="px-4 py-2.5">
                      <div className="text-white">{c.name || c.email}</div>
                      {c.name && <div className="text-[11px] text-slate-500">{c.email}</div>}
                      {!c.userId && <div className="text-[11px] text-slate-500">guest</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-200">{money(c.revenue)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {c.profit == null
                        ? <span className="text-slate-500" title="No cost entered for what they bought">unknown</span>
                        : <span className={c.profit >= 0 ? 'text-emerald-300' : 'text-red-300'}>{money(c.profit)}</span>}
                      {c.profit != null && !c.profitCoverage.complete && (
                        <div className="text-[11px] text-slate-500">{c.profitCoverage.orders} of {c.profitCoverage.of} orders</div>)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">{c.orders}
                      <div className="text-[11px] text-slate-500">{money(c.averageOrderValue)}</div></td>
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap"
                      title={new Date(c.lastPurchaseAt).toLocaleString()}>{daysAgo(c.daysSinceLastPurchase)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-300">
                      {c.referralRevenue ? money(c.referralRevenue) : '—'}
                      {c.referredCustomers > 0 && <div className="text-[11px] text-slate-500">{c.referredCustomers} referred</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right" title={c.lifetimeValue.basis}>
                      <span className="text-white font-semibold">{money(c.lifetimeValue.value)}</span>
                      <div className="text-[11px] text-slate-500">{c.lifetimeValue.projected12m == null
                        ? 'spent so far' : `incl. ${money(c.lifetimeValue.projected12m)} next 12m`}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right"
                      title={`Measured against ${GAP_SOURCE[c.retention.gapSource]} (${c.retention.gapDays} days)`}>
                      <span className="text-white">{c.retention.score}</span>
                      <div className={`text-[11px] ${st.cls}`}>{st.label}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-white font-semibold">{c.vip.score}</span>
                      <div><span className={`text-[11px] rounded px-1.5 py-0.5 ${seg.cls}`}>{seg.label}</span></div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500 mt-4 flex gap-2 max-w-3xl">
        <Info size={13} className="shrink-0 mt-0.5" />
        <span>Retention compares the time since a customer&rsquo;s last order with their own gap between orders, or
          — after one order — {data.gap.measured ? `this shop's typical gap (${data.gap.days} days, from ${data.gap.from} repeat customers)`
            : `${data.gap.days} days, until at least five customers have ordered twice`}. VIP weighs spend, profit,
          repeat orders, retention and referrals on fixed scales: €1,000 spent or 10 orders is full marks.</span>
      </p>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="card p-4">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white text-xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
