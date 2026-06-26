import { useEffect, useState } from 'react';
import { TrendingUp, ShoppingCart, Percent, Users, Trophy } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';

export default function Analytics() {
  const [data, setData] = useState(null);
  const [clv, setClv] = useState(null);
  const [top, setTop] = useState(null);
  const [ret, setRet] = useState(null);

  useEffect(() => {
    api.get('/api/admin/analytics/overview?days=30').then(setData).catch(() => {});
    api.get('/api/admin/analytics/clv').then(setClv).catch(() => {});
    api.get('/api/admin/analytics/top-products').then((r) => setTop(r.products)).catch(() => {});
    api.get('/api/admin/analytics/retention').then(setRet).catch(() => {});
  }, []);

  if (!data) return <PageLoader />;
  const o = data.overview;

  const kpis = [
    { icon: TrendingUp, label: 'Revenue (30d)', value: o.revenueFormatted, sub: `${o.paidOrders} paid orders` },
    { icon: TrendingUp, label: 'Profit (30d)', value: o.profitFormatted ?? '—', sub: o.margin != null ? `${o.margin}% margin` : 'set product costs' },
    { icon: Percent, label: 'Margin', value: o.margin != null ? `${o.margin}%` : '—', sub: `cost ${o.costFormatted ?? '—'}` },
    { icon: ShoppingCart, label: 'Orders (30d)', value: o.totalOrders, sub: `${o.completedOrders} completed` },
    { icon: Percent, label: 'Conversion', value: `${o.conversionRate}%`, sub: 'paid / placed' },
    { icon: Users, label: 'Avg. order value', value: o.averageOrderValueFormatted, sub: `Avg LTV ${clv?.averageLtvFormatted || '—'}` },
  ];

  const maxRev = Math.max(1, ...data.revenueSeries.map((d) => d.revenue));

  return (
    <div>
      <h1 className="text-2xl text-white mb-6">Analytics</h1>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {kpis.map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="card p-5 hover:border-primary/30 transition">
            <Icon size={18} className="text-primary mb-3" />
            <div className="text-slate-400 text-sm">{label}</div>
            <div className="text-3xl font-display gradient-text mt-1">{value}</div>
            <div className="text-slate-500 text-xs mt-1">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-6">
          <h3 className="text-white mb-5">Revenue (last 30 days)</h3>
          {data.revenueSeries.length === 0 ? (
            <p className="text-slate-500 text-sm py-12 text-center">No revenue yet.</p>
          ) : (
            <div className="flex items-end gap-1.5 h-48">
              {data.revenueSeries.map((d) => (
                <div key={d.day} className="flex-1 h-full flex items-end justify-center group relative">
                  <div className="w-full max-w-[40px] rounded-t bg-gradient-to-t from-indigo-600 to-fuchsia-500 transition-all hover:from-indigo-500 hover:to-fuchsia-400"
                       style={{ height: `${Math.max(3, (d.revenue / maxRev) * 100)}%` }} />
                  <div className="absolute -top-9 left-1/2 -translate-x-1/2 hidden group-hover:block z-10
                       bg-space-black border border-white/10 rounded px-2 py-1 text-xs text-white whitespace-nowrap">
                    {money(d.revenue)} · {d.day.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6">
          <h3 className="text-white mb-4 flex items-center gap-2"><Trophy size={16} className="text-amber-400" /> Top products</h3>
          <div className="space-y-3">
            {(top || []).length === 0 && <p className="text-slate-500 text-sm">No sales yet.</p>}
            {(top || []).map((p, i) => (
              <div key={p.product_id || i} className="flex items-center justify-between text-sm">
                <span className="text-slate-300 truncate">{i + 1}. {p.name}</span>
                <span className="text-white">{p.revenueFormatted}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Retention */}
      {ret && (
        <div className="grid lg:grid-cols-3 gap-6 mt-6">
          <div className="card p-6">
            <h3 className="text-white mb-4">Retention</h3>
            <Row label="Repeat-purchase rate" value={`${ret.repeatRate}%`} />
            <Row label="Repeat customers" value={`${ret.repeatCustomers} / ${ret.customersWithOrders}`} />
            <Row label="Total customers" value={ret.totalCustomers} />
            <Row label="Forge+ members" value={ret.activeMembers} accent="text-violet-300" />
          </div>
          <div className="card p-6">
            <h3 className="text-white mb-4">Loyalty tiers</h3>
            {[['Platinum', ret.tiers.platinum, '#a78bfa'], ['Gold', ret.tiers.gold, '#f59e0b'],
              ['Silver', ret.tiers.silver, '#9ca3af'], ['Bronze', ret.tiers.bronze, '#cd7f32']].map(([n, c, col]) => {
              const total = ret.tiers.platinum + ret.tiers.gold + ret.tiers.silver + ret.tiers.bronze || 1;
              return (
                <div key={n} className="mb-3">
                  <div className="flex justify-between text-sm mb-1"><span style={{ color: col }}>{n}</span><span className="text-slate-300">{c}</span></div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(c / total) * 100}%`, background: col }} /></div>
                </div>
              );
            })}
          </div>
          <div className="card p-6">
            <h3 className="text-white mb-4">Affiliate program</h3>
            <Row label="Referred customers" value={ret.affiliate.referrals} />
            <Row label="Commission earned" value={ret.affiliate.commissionTotalFormatted} />
            <Row label="Commission owed" value={ret.affiliate.commissionOwedFormatted} accent="text-amber-300" />
          </div>
        </div>
      )}

      {/* Product performance */}
      <div className="card p-6 mt-6">
        <h3 className="text-white mb-4 flex items-center gap-2"><Trophy size={16} className="text-amber-400" /> Product performance (90 days)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead className="text-left text-slate-400 border-b border-white/5">
              <tr><th className="py-2 font-medium">Product</th><th className="py-2 font-medium text-right">Units</th><th className="py-2 font-medium text-right">Revenue</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(top || []).length === 0 && <tr><td colSpan={3} className="py-4 text-slate-500">No sales yet.</td></tr>}
              {(top || []).map((p) => (
                <tr key={p.name}><td className="py-2 text-slate-200">{p.name}</td><td className="py-2 text-right text-slate-300">{p.units}</td><td className="py-2 text-right text-white">{p.revenueFormatted}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6 mt-6">
        <h3 className="text-white mb-4">Top customers by lifetime value</h3>
        <div className="space-y-2">
          {(clv?.top || []).length === 0 && <p className="text-slate-500 text-sm">No customers yet.</p>}
          {(clv?.top || []).map((c) => (
            <div key={c.email} className="flex items-center justify-between text-sm">
              <span className="text-slate-300">{c.email} <span className="text-slate-500">({c.orders} orders)</span></span>
              <span className="text-white">{c.ltvFormatted}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, accent = 'text-white' }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold ${accent}`}>{value}</span>
    </div>
  );
}
