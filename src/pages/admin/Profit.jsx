import { useEffect, useState } from 'react';
import { AlertTriangle, HelpCircle, TrendingDown, Trophy, Percent, Euro } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Profit, which is a different question from revenue and a harder one.
 *
 * The one rule this page is built around: AN UNKNOWN COST IS UNKNOWN. It is
 * never zero. Revenue is counted over everything sold; cost, profit and margin
 * are counted only over the units whose cost the shop actually knows, and every
 * figure says what share of the revenue that was.
 *
 * The alternative — the one the analytics page shipped with — is a 100% margin
 * on a shop that has entered no costs at all: a confident, precise, entirely
 * invented number. A dashboard that cannot say "I do not know" will say
 * something else instead.
 */

const pct = (n) => (n == null ? '—' : `${n}%`);

/** Nulls are rendered as "—" everywhere, never as €0.00. */
const eur = (c) => (c == null ? '—' : money(c));

function Coverage({ c }) {
  if (!c || c.unitsTotal === 0) return null;
  if (c.complete) {
    return <p className="text-[11.5px] text-emerald-700 mt-1">every unit costed</p>;
  }
  return (
    <p className="text-[11.5px] text-amber-700 mt-1 flex items-start gap-1">
      <HelpCircle size={11} className="mt-0.5 shrink-0" />
      {c.units} of {c.unitsTotal} units costed{c.pct != null && ` · ${c.pct}% of revenue`}
    </p>
  );
}

function Period({ title, p }) {
  const loss = p.profit < 0;
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{money(p.revenue)}</p>
      <p className="text-[12px] text-slate-500">{p.orders} order(s) · {p.units} unit(s)</p>
      <div className="mt-3 pt-3 border-t border-slate-100">
        <p className={`text-xl font-bold ${loss ? 'text-rose-600' : 'text-slate-900'}`}>
          {p.coverage.units === 0 ? '—' : money(p.profit)}
          {loss && <TrendingDown size={16} className="inline ml-1.5 -mt-1" />}
        </p>
        <p className="text-[12px] text-slate-500">
          profit{p.marginPct != null && ` · ${p.marginPct}% margin`}
        </p>
        <Coverage c={p.coverage} />
      </div>
    </div>
  );
}

function Board({ title, icon: Icon, rows, render }) {
  return (
    <div className="card p-4">
      <p className="font-semibold text-slate-800 flex items-center gap-2 mb-2">
        <Icon size={15} className="text-violet-600" /> {title}
      </p>
      {!rows.length
        ? <p className="text-[13px] text-slate-500">Nothing to rank yet.</p>
        : (
          <ol className="space-y-1.5">
            {rows.map((p, i) => (
              <li key={p.productId || p.name} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-slate-700 truncate"><span className="text-slate-400 mr-1.5">{i + 1}.</span>{p.name}</span>
                <span className="font-semibold text-slate-900 whitespace-nowrap">{render(p)}</span>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}

export default function Profit() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/api/admin/analytics/profit').then(setD).catch((e) => setErr(e?.message || 'Could not load'));
  }, []);

  if (err) return <p className="text-rose-600 text-sm">{err}</p>;
  if (!d) return <PageLoader />;

  const sev = {
    loss: { cls: 'bg-rose-50 text-rose-800 border-rose-200', icon: TrendingDown },
    thin: { cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: AlertTriangle },
    unknown: { cls: 'bg-slate-50 text-slate-600 border-slate-200', icon: HelpCircle },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Profit</h1>
        <p className="text-[13px] text-slate-500">
          Periods are {d.bounds.tz} days, not UTC. Cost and margin cover only the units with a
          known cost — {d.catalogue.withCost} of {d.catalogue.active} active products have one.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Period title="Today" p={d.periods.today} />
        <Period title="This week" p={d.periods.week} />
        <Period title="This month" p={d.periods.month} />
      </div>

      <div className="card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Average margin</p>
        <p className="mt-1 text-3xl font-bold text-slate-900">{pct(d.averageMarginPct)}</p>
        <p className="text-[12px] text-slate-500">
          this month, over costed revenue only
          {d.averageMarginPct == null && ' — nothing with a known cost has sold yet'}
        </p>
      </div>

      {!!d.warnings.length && (
        <div className="space-y-2">
          {d.warnings.map((w) => {
            const s = sev[w.severity] || sev.unknown;
            const Icon = s.icon;
            return (
              <div key={`${w.code}-${w.productId || w.name}`}
                className={`border rounded-xl px-3 py-2 text-[13px] flex items-start gap-2 ${s.cls}`}>
                <Icon size={14} className="mt-0.5 shrink-0" />
                <span>{w.detail}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Board title="Top 10 by profit" icon={Trophy} rows={d.top.profit} render={(p) => eur(p.profit)} />
        <Board title="Top 10 by revenue" icon={Euro} rows={d.top.revenue} render={(p) => money(p.revenue)} />
        <Board title="Top 10 by margin" icon={Percent} rows={d.top.margin} render={(p) => pct(p.marginPct)} />
      </div>

      <div className="card p-4">
        <p className="font-semibold text-slate-800 mb-2">Per product, this month</p>
        {!d.products.length
          ? <p className="text-[13px] text-slate-500">Nothing has sold yet.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-slate-400 text-left">
                  <tr>
                    <th className="py-2 font-semibold">Product</th>
                    <th className="font-semibold">Sold</th>
                    <th className="font-semibold">Revenue</th>
                    <th className="font-semibold">Cost</th>
                    <th className="font-semibold">Gross profit</th>
                    <th className="font-semibold">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {d.products.map((p) => {
                    const loss = p.profit != null && p.profit < 0;
                    const thin = !loss && p.marginPct != null && p.marginPct < d.minimumMarginPercent;
                    return (
                      <tr key={p.productId || p.name} className="border-t border-slate-100">
                        <td className="py-2 pr-3 text-slate-800">
                          {p.name}
                          {p.unitCostCents == null && (
                            <span className="ml-2 text-[11px] text-slate-400">no cost entered</span>
                          )}
                        </td>
                        <td className="pr-3">{p.units}</td>
                        <td className="pr-3">{money(p.revenue)}</td>
                        {/* "—", never "€0.00": a cost nobody entered is unknown,
                            and rendering it as zero is what made the margin
                            read 100%. */}
                        <td className="pr-3 text-slate-500">{eur(p.cost)}</td>
                        <td className={`pr-3 font-semibold ${loss ? 'text-rose-600' : 'text-slate-900'}`}>
                          {eur(p.profit)}
                        </td>
                        <td className={`pr-3 ${loss ? 'text-rose-600 font-semibold' : thin ? 'text-amber-700 font-semibold' : ''}`}>
                          {pct(p.marginPct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}
