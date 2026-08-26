import { useEffect, useState } from 'react';
import { TrendingUp, ShoppingCart, Percent, Users, Trophy, Rocket, CheckCircle2, AlertTriangle, XCircle, ChevronDown, MailCheck, Megaphone, EyeOff, Lock } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Launch checklist — live readiness checks (payments, email, stock, security,
 * cron, Discord) so "can I sell today?" is answered at a glance, with the fix
 * for anything red right next to it.
 */
/**
 * Which phase is this shop in, and is that the phase it is supposed to be in?
 *
 * The readiness checklist below answers "can I sell today?". It cannot answer
 * this one, because a shop that has quietly opened three weeks early looks
 * perfectly healthy to it — everything is green, and that is the problem.
 *
 * So this sits above it and says one thing plainly: open or shut, and why.
 * Green while shut before launch is the correct state, which is why "closed" is
 * not styled as a fault.
 */
function LaunchPhase() {
  const [p, setP] = useState(null);
  useEffect(() => { api.get('/api/admin/launch-plan').then(setP).catch(() => {}); }, []);
  if (!p) return null;

  const shut = p.prelaunch;
  const todo = shut ? p.blockingNow : p.blockingOnTheDay;
  const tone = todo
    ? 'border-red-500/40 bg-red-500/10'
    : shut ? 'border-indigo-500/30 bg-indigo-500/10' : 'border-emerald-500/30 bg-emerald-500/10';

  return (
    <div className={`rounded-2xl border ${tone} mb-4 p-5 fm-pop`}>
      <div className="flex items-start gap-3">
        <span className="w-11 h-11 rounded-xl grid place-items-center shrink-0 bg-white/10">
          {shut ? <Lock size={20} className="text-indigo-300" />
            : <Rocket size={20} className="text-emerald-300" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-white font-semibold">
            {shut ? 'Closed to the public' : 'Open to the public'}
          </div>
          <div className="text-slate-400 text-sm mt-0.5">{p.reason}.</div>
          <div className="text-slate-400 text-sm mt-2">
            {shut
              ? <>Discord runs as normal. {p.blockingNow
                ? <span className="text-red-300">{p.blockingNow} thing(s) wrong for today.</span>
                : 'Nothing wrong for today.'}{' '}
                {p.blockingOnTheDay
                  ? `${p.blockingOnTheDay} still to sort before launch day.`
                  : 'The launch-day list is clear too.'}</>
              : (p.blockingOnTheDay
                ? <span className="text-red-300">
                  {p.blockingOnTheDay} thing(s) needed to serve a customer are wrong.
                </span>
                : 'Payment, fulfilment, email and alerts all check out.')}
          </div>
          <div className="text-slate-500 text-xs mt-2">
            Full list: <code className="text-slate-400">node scripts/launch-status.mjs</code>
          </div>
        </div>
      </div>
    </div>
  );
}

function LaunchChecklist() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { api.get('/api/admin/launch-check').then(setData).catch(() => {}); }, []);
  if (!data) return null;

  const ICONS = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle };
  const TONES = { ok: 'text-emerald-400', warn: 'text-amber-400', fail: 'text-red-400' };
  const failing = data.checks.filter((c) => c.status === 'fail');
  const tone = data.ready ? (data.checks.some((c) => c.status === 'warn') ? 'amber' : 'emerald') : 'red';
  const frame = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10',
    amber: 'border-amber-500/30 bg-amber-500/10',
    red: 'border-red-500/40 bg-red-500/10',
  }[tone];

  return (
    <div className={`rounded-2xl border ${frame} mb-8 fm-pop`}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 p-5 text-left">
        <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ${
          tone === 'emerald' ? 'bg-emerald-500/20' : tone === 'amber' ? 'bg-amber-500/20' : 'bg-red-500/20'}`}>
          <Rocket size={20} className={TONES[data.ready ? (tone === 'amber' ? 'warn' : 'ok') : 'fail']} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-white font-semibold">
            {data.ready ? '🚀 Ready to sell' : '⛔ Not ready to sell yet'}
          </div>
          <div className="text-slate-400 text-sm">{data.summary}{failing.length ? ` — ${failing.map((c) => c.label).join(', ')}` : ''}</div>
        </div>
        <ChevronDown size={18} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-2">
          {data.checks.map((c) => {
            const Icon = ICONS[c.status];
            return (
              <div key={c.id} className="flex items-start gap-3 bg-space-black/60 rounded-xl px-4 py-3">
                <Icon size={17} className={`${TONES[c.status]} shrink-0 mt-0.5`} />
                <div className="min-w-0">
                  <div className="text-white text-sm font-medium">{c.label}</div>
                  <div className="text-slate-400 text-xs mt-0.5">{c.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [clv, setClv] = useState(null);
  const [top, setTop] = useState(null);
  const [ret, setRet] = useState(null);
  const [rec, setRec] = useState(null);
  const [attr, setAttr] = useState(null);

  useEffect(() => {
    api.get('/api/admin/analytics/overview?days=30').then(setData).catch(() => {});
    api.get('/api/admin/analytics/clv').then(setClv).catch(() => {});
    api.get('/api/admin/analytics/top-products').then((r) => setTop(r.products)).catch(() => {});
    api.get('/api/admin/analytics/retention').then(setRet).catch(() => {});
    api.get('/api/admin/analytics/recovery?days=30').then(setRec).catch(() => {});
    api.get('/api/admin/analytics/attribution?days=30').then(setAttr).catch(() => {});
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

      <LaunchPhase />
      <LaunchChecklist />

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

      {/* Abandoned-payment recovery — what the reminder emails actually bring back */}
      {rec && <RecoveryCard rec={rec} />}

      {/* Which advert sold something */}
      {attr && <AttributionCard attr={attr} />}

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

/**
 * Recovery reporting. Two rules here, both deliberate:
 *  · a rate of null means nothing was sent yet — show "no data yet", never 0%,
 *    which would read as "the emails don't work".
 *  · cart recovery is correlation (an order within the attribution window), so
 *    it says so on the card instead of being blended into one hero number.
 */
function RecoveryCard({ rec }) {
  const p = rec.paymentReminders;
  const c = rec.cartReminders;
  const pct = (v) => (v == null ? 'no data yet' : `${v}%`);

  return (
    <div className="card p-6 mt-6">
      <h3 className="text-white mb-1 flex items-center gap-2">
        <MailCheck size={16} className="text-emerald-400" /> Recovered after abandoning ({rec.rangeDays} days)
      </h3>
      <p className="text-slate-500 text-xs mb-5">
        What the automatic reminder emails bring back. Money that would otherwise have been lost.
      </p>

      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-4">
          <div className="text-emerald-300 text-xs font-semibold uppercase tracking-wide">Revenue recovered</div>
          <div className="text-2xl text-white font-semibold mt-1">{rec.totalRecoveredFormatted}</div>
          <div className="text-slate-400 text-xs mt-1">{p.recovered + c.recovered} orders</div>
        </div>
        <div className="rounded-xl bg-white/5 border border-white/10 p-4">
          <div className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Unpaid orders chased</div>
          <div className="text-2xl text-white font-semibold mt-1">{pct(p.recoveryRate)}</div>
          <div className="text-slate-400 text-xs mt-1">{p.recovered} of {p.sent} paid after the email</div>
        </div>
        <div className="rounded-xl bg-white/5 border border-white/10 p-4">
          <div className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Abandoned carts chased</div>
          <div className="text-2xl text-white font-semibold mt-1">{pct(c.recoveryRate)}</div>
          <div className="text-slate-400 text-xs mt-1">ordered within {rec.windowHours}h of the email</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-8">
        <div>
          <Row label="Payment reminders sent" value={p.sent} />
          <Row label="→ paid afterwards" value={p.recovered} accent="text-emerald-300" />
          <Row label="→ still waiting" value={p.stillWaiting} accent="text-amber-300" />
          <Row label="→ cancelled / expired" value={p.lost} accent="text-slate-400" />
        </div>
        <div>
          <Row label="Recovered from unpaid orders" value={p.recoveredRevenueFormatted} accent="text-emerald-300" />
          <Row label="Recovered from carts" value={c.recoveredRevenueFormatted} accent="text-emerald-300" />
          <Row label="Cart reminders sent" value={c.sent} />
        </div>
      </div>

      {/* A stalled cron is invisible until you look for unpaid orders that never
          got their email — so put it right here, with the money attached. */}
      {p.notSentYet > 0 && (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3">
          <AlertTriangle size={17} className="text-amber-300 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="text-amber-200 font-semibold">{p.notSentYet} unpaid {p.notSentYet === 1 ? 'order has' : 'orders have'} had no reminder yet</span>
            <span className="text-slate-300"> — {p.notSentValueFormatted} not being chased. The reminder runs on the hourly cron; if this number keeps growing, the cron is not running.</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Which advert actually generated purchases.
 *
 * Sorted by revenue, because that is the question. A creative with four hundred
 * visits and no sales is not a good advert with a checkout problem — it belongs
 * below the one with nine visits and two sales, and sorting by traffic is how a
 * shop ends up spending more on the loud one.
 *
 * Three rules the numbers here follow, all of them the same rule:
 *
 *  · a rate over zero visits is null, shown as "—", never 0%. An advert that
 *    has not run yet does not have a conversion rate, and printing 0% for it
 *    reads as a verdict on an advert nobody has seen.
 *  · the funnel's first stage is "website visit", not "ad click". The click
 *    happens on TikTok's servers and we cannot see it; calling arrivals clicks
 *    would silently absorb every click that never finished loading.
 *  · visitors who refused marketing storage are counted and reported as
 *    uncounted, rather than folded into the denominator. A funnel that narrows
 *    sharply is a different problem from a funnel measuring people it is not
 *    allowed to follow, and the difference is worth a line.
 */
function AttributionCard({ attr }) {
  const { funnel: f, creatives, campaigns } = attr;
  const pct = (v) => (v == null ? '—' : `${v}%`);
  const top = Math.max(1, ...f.stages.map((s) => s.count));
  const sellers = creatives.filter((c) => c.purchases > 0).length;

  return (
    <div className="card p-6 mt-6">
      <h3 className="text-white mb-1 flex items-center gap-2">
        <Megaphone size={16} className="text-fuchsia-400" /> Advertising ({f.rangeDays} days)
      </h3>
      <p className="text-slate-500 text-xs mb-5">
        Tagged links only. {sellers > 0
          ? `${sellers} of ${creatives.length} ${creatives.length === 1 ? 'creative' : 'creatives'} `
            + `${sellers === 1 ? 'has' : 'have'} produced a sale.`
          : 'No tagged link has produced a sale yet.'}
      </p>

      {creatives.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
          <p>
            Nothing has arrived from a tagged link yet. Build one with{' '}
            <code className="text-slate-200">node scripts/ad/links.mjs --sku=… --variants=all</code>{' '}
            and put it behind the advert — an untagged link cannot be measured, however well it performs.
          </p>
          {/* The accepted spellings, in front of whoever is building a link by
              hand, rather than in a source file they would have to go and find. */}
          {attr.recognisedParams?.length > 0 && (
            <p className="text-slate-500 text-xs mt-3 leading-relaxed">
              Parameters read from the address:{' '}
              {attr.recognisedParams.join(', ')}. Click ids are read for the network
              name only and never stored.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* The funnel */}
          <div className="grid sm:grid-cols-4 gap-3 mb-6">
            {f.stages.map((st, i) => (
              <div key={st.id} className="rounded-xl bg-white/5 border border-white/10 p-4">
                <div className="text-slate-400 text-xs font-semibold uppercase tracking-wide">{st.label}</div>
                <div className="text-2xl text-white font-semibold mt-1">{st.count}</div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-2">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500"
                       style={{ width: `${Math.max(2, (st.count / top) * 100)}%` }} />
                </div>
                <div className="text-slate-500 text-xs mt-2">
                  {i === 0 ? 'from a tagged link' : `${pct(st.ofPrevious)} of ${f.stages[i - 1].label.toLowerCase()}`}
                </div>
              </div>
            ))}
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-4">
              <div className="text-emerald-300 text-xs font-semibold uppercase tracking-wide">Revenue from adverts</div>
              <div className="text-2xl text-white font-semibold mt-1">{money(f.revenue)}</div>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <div className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Visit → purchase</div>
              <div className="text-2xl text-white font-semibold mt-1">{pct(f.conversionRate)}</div>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <div className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Attribution window</div>
              <div className="text-2xl text-white font-semibold mt-1">{attr.windowDays} days</div>
              <div className="text-slate-400 text-xs mt-1">last click before the order</div>
            </div>
          </div>

          {/* The table that answers the question */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="text-left text-slate-400 border-b border-white/5">
                <tr>
                  <th className="py-2 font-medium">Creative</th>
                  <th className="py-2 font-medium">Campaign</th>
                  <th className="py-2 font-medium text-right">Visits</th>
                  <th className="py-2 font-medium text-right">Product views</th>
                  <th className="py-2 font-medium text-right">Checkouts</th>
                  <th className="py-2 font-medium text-right">Purchases</th>
                  <th className="py-2 font-medium text-right">Conv.</th>
                  <th className="py-2 font-medium text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {creatives.map((c) => (
                  <tr key={`${c.creative}|${c.campaign}|${c.network}`}
                      className={c.purchases > 0 ? '' : 'opacity-70'}>
                    <td className="py-2 text-slate-200 whitespace-nowrap">
                      {c.creative}
                      {c.network && <span className="text-slate-500 ml-2 text-xs">{c.network}</span>}
                    </td>
                    <td className="py-2 text-slate-400">{c.campaign}</td>
                    <td className="py-2 text-right text-slate-300">{c.visits}</td>
                    <td className="py-2 text-right text-slate-300">{c.productViews}</td>
                    <td className="py-2 text-right text-slate-300">{c.checkouts}</td>
                    <td className="py-2 text-right text-white font-semibold">{c.purchases}</td>
                    <td className="py-2 text-right text-slate-300">{pct(c.conversionRate)}</td>
                    <td className={`py-2 text-right ${c.revenue ? 'text-emerald-300 font-semibold' : 'text-slate-500'}`}>
                      {money(c.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {campaigns.length > 1 && (
            <div className="mt-6">
              <h4 className="text-slate-300 text-sm mb-3">By campaign</h4>
              {campaigns.map((c) => (
                <div key={c.campaign} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-slate-400">
                    {c.campaign}
                    <span className="text-slate-600 ml-2 text-xs">
                      {c.creatives} {c.creatives === 1 ? 'creative' : 'creatives'}
                      {c.networks.length ? ` · ${c.networks.join(', ')}` : ''}
                    </span>
                  </span>
                  <span className="text-white font-semibold">
                    {money(c.revenue)} <span className="text-slate-500 font-normal">· {c.purchases} sold</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {f.notFollowed > 0 && (
        <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4 flex items-start gap-3">
          <EyeOff size={17} className="text-slate-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="text-slate-200 font-semibold">
              {f.notFollowed} {f.notFollowed === 1 ? 'arrival is' : 'arrivals are'} counted but not followed
            </span>
            <span className="text-slate-400">
              {' '}— those visitors refused marketing storage, so their click is in the visit
              column and cannot appear in the purchase one. They are excluded from nothing and
              added to nothing; the conversion rates above are simply measured over everybody,
              including people we are not allowed to follow.
            </span>
          </div>
        </div>
      )}
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
