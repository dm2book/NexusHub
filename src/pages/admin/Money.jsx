import { useEffect, useState, useCallback } from 'react';
import { Euro, ShoppingBag, Undo2, ShieldAlert, PackageX, Users2, Clock, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { SkeletonStat, SkeletonRows, EmptyState } from '../../components/ui.jsx';

/**
 * The money screen.
 *
 * Everything here is euros in or euros out. No conversion rate, no repeat rate,
 * no customer count, no reach — those live on /admin and they belong there. On
 * one screen they compete, and the eye goes to the green number: a good
 * conversion rate reads as good news sitting next to a refund that took the
 * day's takings.
 *
 * The order down the page is the order the numbers matter in. Revenue first
 * because it is the question. Money waiting on a transfer second, because it is
 * the only figure here that is still winnable. Then what came out — refunds,
 * chargebacks, commission — and last the two things that cost money by sitting
 * there: empty stock, and a bill that has not arrived yet.
 */

const Card = ({ label, value, sub, tone = 'slate', icon: Icon }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
    <div className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-slate-400">
      {Icon && <Icon size={13} />} {label}
    </div>
    <div className={`mt-1.5 text-2xl font-extrabold tabular-nums ${
      tone === 'emerald' ? 'text-emerald-300'
        : tone === 'amber' ? 'text-amber-300'
          : tone === 'red' ? 'text-red-300' : 'text-white'}`}>{value}</div>
    {sub && <div className="text-[12px] text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

const Section = ({ title, icon: Icon, hint, children }) => (
  <section className="mt-8">
    <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
      {Icon && <Icon size={15} className="text-slate-400" />} {title}
    </h2>
    {hint && <p className="text-[12.5px] text-slate-500 mt-0.5 mb-3">{hint}</p>}
    {children}
  </section>
);

export default function AdminMoney() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    api.get('/api/admin/money')
      .then((r) => { setD(r); setErr(null); })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  }, []);
  useEffect(load, [load]);

  if (err) return <EmptyState title="Could not load the money view" hint={err} />;

  const r = d?.revenue;
  return (
    <div className="pb-16">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Money</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Euros in and euros out. {d ? `Days roll over in ${d.timezone}.` : ''}
          </p>
        </div>
        <button onClick={load} disabled={busy}
          className="text-[13px] font-semibold text-slate-300 hover:text-white inline-flex items-center gap-1.5">
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mt-5">
        {d ? <>
          <Card label="Today" value={r.today.formatted} icon={Euro} tone="emerald"
            sub={`${d.orders.today} order${d.orders.today === 1 ? '' : 's'}`} />
          <Card label="This week" value={r.week.formatted} icon={Euro}
            sub={`${d.orders.week} order${d.orders.week === 1 ? '' : 's'}`} />
          <Card label="This month" value={r.month.formatted} icon={Euro}
            sub={`${d.orders.month} order${d.orders.month === 1 ? '' : 's'}`} />
        </> : <><SkeletonStat /><SkeletonStat /><SkeletonStat /></>}
      </div>

      {/* The only figure on this page that is still winnable. */}
      {d && d.awaitingPayment.count > 0 && (
        <div className="mt-3">
          <Card label="Waiting on a transfer" value={d.awaitingPayment.formatted} tone="amber" icon={Clock}
            sub={`${d.awaitingPayment.count} placed order${d.awaitingPayment.count === 1 ? '' : 's'} — already won, not yet paid`} />
        </div>
      )}

      <Section title="Top products this month" icon={ShoppingBag}
        hint="Ranked by revenue, not by units — twelve €8.49 packs outsell one €174.99 pack and are worth a sixth as much.">
        {!d ? <SkeletonRows rows={4} /> : d.topProducts.length ? (
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            {d.topProducts.map((p, i) => (
              <div key={p.id || i} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
                <span className="text-slate-500 tabular-nums w-5">{i + 1}</span>
                <span className="flex-1 text-slate-200 truncate">{p.name}</span>
                <span className="text-slate-500 text-[12.5px] tabular-nums">{p.units}×</span>
                <span className="text-white font-semibold tabular-nums w-24 text-right">{p.formatted}</span>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Nothing sold this month yet" hint="This fills in from real paid orders." />}
      </Section>

      <div className="grid sm:grid-cols-2 gap-3 mt-8">
        {d && <>
          <Card label="Refunds this month" value={d.refunds.thisMonth.formatted} tone="amber" icon={Undo2}
            sub={`${d.refunds.thisMonth.count} this month · ${d.refunds.allTime.count} ever (${d.refunds.allTime.formatted})`} />
          {/* Chargebacks get red whatever the number: one is a bank decision
              against the shop, and it arrives with a deadline. */}
          <Card label="Chargebacks" value={d.chargebacks.formatted} tone="red" icon={ShieldAlert}
            sub={`${d.chargebacks.count} ever · ${d.chargebacks.last90Days} in the last 90 days`} />
        </>}
      </div>

      <Section title="Affiliate commission" icon={Users2}
        hint="A liability, not revenue: paid is gone, owed is a bill that has not arrived, reversed came back off a sale that stopped being one.">
        {d && (
          <div className="grid sm:grid-cols-3 gap-3">
            <Card label="Paid out" value={d.affiliate.paid.formatted}
              sub={`${d.affiliate.orders} referred order${d.affiliate.orders === 1 ? '' : 's'}`} />
            <Card label="Owed" value={d.affiliate.owed.formatted} tone="amber" />
            <Card label="Reversed" value={d.affiliate.reversed.formatted} />
          </div>
        )}
      </Section>

      <Section title="Stock that costs money" icon={PackageX}
        hint="Five codes or fewer. A product with none, still advertised as automatic, is an order that has to be filled by hand or refunded.">
        {!d ? <SkeletonRows rows={4} /> : d.stockProblems.length ? (
          <div className="rounded-2xl border border-white/10 overflow-hidden">
            {d.stockProblems.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
                <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${
                  p.codes === 0 ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>
                  {p.codes === 0 ? 'none' : `${p.codes} left`}
                </span>
                <span className="flex-1 text-slate-200 truncate">{p.name}</span>
                <span className="text-slate-500 tabular-nums">{p.formatted}</span>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Nothing is low" hint="Every active product has more than five codes." />}
      </Section>
    </div>
  );
}
