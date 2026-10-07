import { useEffect, useState } from 'react';
import { Megaphone, Trophy, TrendingDown, MousePointerClick, Euro, PiggyBank, Info } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader } from '../../components/ui.jsx';
import AdPerformance from '../../components/admin/AdPerformance.jsx';
import AdSpendImport from '../../components/admin/AdSpendImport.jsx';
import { SERIES_COLOURS } from '../../components/admin/TimeSeriesPlot.jsx';

/**
 * Growth → Ad Intelligence.
 *
 * Per advert: views, clicks, CTR, checkout starts, purchases, revenue, profit.
 * Per platform: the same, for TikTok, Instagram, Facebook, Discord and YouTube.
 * And the five answers: winner, loser, highest CTR, highest revenue, highest
 * profit — each with the rule that picked it, or the reason there is none yet.
 *
 * Views, clicks and spend come from the platforms (entered or imported); the
 * rest is measured here. Profit is after 21% BTW, the cost of what was sold,
 * referral commission and the advert's own spend, and is blank with a reason
 * when any of those is not known.
 *
 * Charts: one measure at a time, one hue, the platform named on the axis and
 * the value on the bar — identity is never colour alone.
 */
const money = (c) => (c == null ? '—' : `${c < 0 ? '−' : ''}€${(Math.abs(c) / 100).toFixed(2)}`);
const nfmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
const BAR = SERIES_COLOURS[0];

const MEASURES = [
  { key: 'revenueCents', label: 'Revenue', fmt: money },
  { key: 'profitCents', label: 'Profit', fmt: money, why: 'cost or spend not recorded' },
  { key: 'ctr', label: 'CTR', fmt: (v) => `${v}%`, why: 'no views recorded' },
  { key: 'purchases', label: 'Purchases', fmt: nfmt },
  { key: 'spendCents', label: 'Spend', fmt: money, why: 'no spend recorded' },
];

const HIGHLIGHTS = [
  { key: 'winner', label: 'Winner', icon: Trophy, value: (h) => h.gradeReason },
  { key: 'loser', label: 'Loser', icon: TrendingDown, value: (h) => h.gradeReason },
  { key: 'highestCtr', label: 'Highest CTR', icon: MousePointerClick, value: (h) => `${h.value}% CTR` },
  { key: 'highestRevenue', label: 'Highest revenue', icon: Euro, value: (h) => `${money(h.value)} revenue` },
  { key: 'highestProfit', label: 'Highest profit', icon: PiggyBank, value: (h) => `${money(h.value)} profit` },
];

export default function AdIntelligence() {
  const [days, setDays] = useState(30);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState(null);
  const [measure, setMeasure] = useState('revenueCents');

  useEffect(() => {
    api.get(`/api/admin/analytics/ads/intelligence?days=${days}`).then(setData).catch(() => setData(false));
  }, [days]);

  if (data === null) return <PageLoader />;
  if (data === false) return <p className="text-slate-400">Could not load the ad report.</p>;
  const m = MEASURES.find((x) => x.key === measure);
  const rows = [...data.platforms, ...(data.other ? [data.other] : [])];

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h1 className="text-2xl text-white flex items-center gap-2"><Megaphone size={22} className="text-violet-300" /> Ad Intelligence</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} name="days"
          className="rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm h-10 px-3">
          {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Views, clicks and spend are the platforms&rsquo; numbers — enter or import them below. Landings, checkout
        starts, purchases and revenue are measured here. Profit is after 21% BTW, the cost of what sold, referral
        commission and the advert&rsquo;s spend, and stays blank until all of those are known.
      </p>

      {data.evidence?.blockers?.length > 0 && (
        <ul className="mb-5 space-y-1">
          {data.evidence.blockers.map((b) => (
            <li key={b} className="text-xs text-slate-400 flex gap-2"><Info size={13} className="shrink-0 mt-0.5" />{b}</li>
          ))}
        </ul>
      )}

      {/* The five answers. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-6" data-testid="ad-highlights">
        {HIGHLIGHTS.map(({ key, label, icon: Icon, value }) => {
          const h = data.highlights[key];
          return (
            <div key={key} className="card p-4" data-testid={`hl-${key}`}>
              <div className="text-slate-400 text-xs flex items-center gap-1.5"><Icon size={13} /> {label}</div>
              {h.creative ? (
                <>
                  <div className="text-white font-semibold mt-1 break-words">{h.creative}</div>
                  <div className="text-[11px] text-slate-500">{[h.network, h.campaign].filter((x) => x && x !== '—').join(' · ')}</div>
                  <div className="text-[12.5px] text-slate-300 mt-1">{value(h)}</div>
                </>
              ) : <div className="text-[12.5px] text-slate-500 mt-1">None yet — {h.reason}</div>}
            </div>
          );
        })}
      </div>

      {/* Per platform: chart, then the table it is drawn from. */}
      <section className="card p-5 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="font-bold text-slate-200">By platform</h2>
          <div className="flex gap-1.5 flex-wrap">
            {MEASURES.map((x) => (
              <button key={x.key} onClick={() => setMeasure(x.key)}
                className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold border transition
                  ${measure === x.key ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>{x.label}</button>
            ))}
          </div>
        </div>
        <Bars rows={rows.map((p) => ({ label: p.label, value: p[measure],
          note: p.status !== 'measured' ? p.status : (m.why || 'not recorded') }))} fmt={m.fmt} measure={m.label} />

        <div className="overflow-x-auto mt-5">
          <table className="w-full text-[12.5px]">
            <thead className="text-slate-400 text-[11px]">
              <tr className="border-b border-white/5">
                {['Platform', 'Views', 'Clicks', 'CTR', 'Checkout starts', 'Purchases', 'Revenue', 'Spend', 'Profit'].map((h, i) => (
                  <th key={h} className={`${i ? 'text-right' : 'text-left'} px-3 py-2 font-normal`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((p) => (
                <tr key={p.key} data-testid="platform-row">
                  <td className="px-3 py-2 text-white">{p.label}
                    <div className="text-[11px] text-slate-500">{p.status === 'measured' ? `${p.adverts} advert(s)` : p.status}</div></td>
                  <td className="px-3 py-2 text-right text-slate-300">{nfmt(p.impressions)}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{nfmt(p.platformClicks)}
                    <div className="text-[11px] text-slate-500">{nfmt(p.visits)} landed</div></td>
                  <td className="px-3 py-2 text-right text-slate-300">{p.ctr == null ? '—' : `${p.ctr}%`}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{nfmt(p.checkouts)}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{nfmt(p.purchases)}</td>
                  <td className="px-3 py-2 text-right text-slate-200">{money(p.revenueCents)}</td>
                  <td className="px-3 py-2 text-right text-slate-300">{money(p.spendCents)}</td>
                  <td className="px-3 py-2 text-right">
                    {p.profitCents == null ? <span className="text-slate-500">—</span>
                      : <span className={p.profitCents < 0 ? 'text-red-300' : 'text-emerald-300'}>{money(p.profitCents)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Where people drop out, all platforms together. */}
      <section className="card p-5 mb-6" data-testid="ad-funnel">
        <h2 className="font-bold text-slate-200 mb-4">From view to purchase</h2>
        <Bars rows={data.funnel.map((f) => ({ label: f.label, value: f.count,
          note: f.count == null ? 'not recorded — a platform number' : f.source }))} fmt={nfmt} measure="People" />
      </section>

      {/* The platforms' numbers in: CSV export or API pull. */}
      <AdSpendImport onDone={() => setReload((x) => x + 1)} />

      {/* Over time per advert, the per-advert table with profit, and spend entry. */}
      <AdPerformance key={reload} days={days} />
    </div>
  );
}

/**
 * Horizontal bars, one measure, one hue. The label is on the axis and the
 * value is written on every bar (there are at most six); a loss is drawn to the
 * left of zero and says "loss". Null is "—" with the reason, never a zero bar.
 */
function Bars({ rows, fmt, measure }) {
  const vals = rows.map((r) => r.value).filter((v) => v != null);
  const max = Math.max(1e-9, ...vals.map((v) => Math.abs(v)));
  const hasNeg = vals.some((v) => v < 0);
  return (
    <div className="space-y-2" role="img" aria-label={`${measure} per row`}>
      {rows.map((r) => {
        const w = r.value == null ? 0 : (Math.abs(r.value) / max) * (hasNeg ? 50 : 100);
        const neg = r.value != null && r.value < 0;
        return (
          <div key={r.label} className="flex items-center gap-3 text-[12.5px]"
            title={`${r.label}: ${r.value == null ? 'no data' : fmt(r.value)} ${measure}`}>
            <div className="w-36 shrink-0 text-slate-300 truncate">{r.label}</div>
            <div className="flex-1 relative h-4">
              {hasNeg && <div className="absolute top-0 bottom-0 border-l border-white/20" style={{ left: '50%' }} />}
              {r.value != null && w > 0 && (
                <div className="absolute top-0 h-4" style={{
                  background: neg ? 'transparent' : BAR,
                  border: neg ? `2px solid ${BAR}` : 'none',
                  width: `${Math.max(w, 0.5)}%`,
                  left: hasNeg ? (neg ? `${50 - w}%` : '50%') : 0,
                  borderRadius: neg ? '4px 0 0 4px' : '0 4px 4px 0',
                }} />
              )}
            </div>
            <div className="w-32 shrink-0 text-right text-slate-200 tabular-nums">
              {r.value == null ? <span className="text-slate-500">—</span> : `${fmt(r.value)}${neg ? ' loss' : ''}`}
              {r.value == null && r.note && <div className="text-[11px] text-slate-500 truncate">{r.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
