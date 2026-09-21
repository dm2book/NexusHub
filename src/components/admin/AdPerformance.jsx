/**
 * Is this advert working.
 *
 * Half of that question this shop can answer from its own database — arrivals,
 * checkout starts, purchases, revenue. The other half belongs to the ad
 * platform: impressions happen on TikTok's servers and the money leaves on
 * TikTok's invoice, so CTR and ROAS are blank with a reason until somebody
 * enters them or imports the export.
 *
 * The grade is relative to the other adverts in the same window, and refuses
 * below a minimum sample: a creative with four landings and one sale has a 25%
 * conversion rate and means nothing, and a plain sort hands it the best badge.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import TimeSeriesPlot, { SeriesLegend, SERIES_COLOURS } from './TimeSeriesPlot.jsx';

const money = (cents) => (cents == null ? '—' : `€${(cents / 100).toFixed(2)}`);
const pct = (v) => (v == null ? '—' : `${v}%`);
const nfmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

const GRADE = {
  winner: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  average: 'bg-white/5 text-slate-300 border-white/10',
  loser: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  unrated: 'bg-white/5 text-slate-500 border-white/10',
};
const SEV = {
  critical: 'text-rose-300',
  warn: 'text-amber-300',
  info: 'text-slate-400',
};

const METRICS = [
  { key: 'roas', label: 'ROAS', format: (v) => `${v}×` },
  { key: 'conversion', label: 'Conversion', format: (v) => `${v}%` },
  { key: 'ctr', label: 'CTR', format: (v) => `${v}%` },
  { key: 'revenue', label: 'Revenue', format: money },
];

export default function AdPerformance() {
  const toast = useToast();
  const [report, setReport] = useState(null);
  const [metric, setMetric] = useState('roas');
  const [chart, setChart] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    day: new Date().toISOString().slice(0, 10), network: 'tiktok',
    campaign: '', creative: '', impressions: '', clicks: '', spendEuro: '',
  });

  const load = () => api.get('/api/admin/analytics/ads?days=30')
    .then(setReport).catch(() => setReport({ creatives: [] }));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api.get(`/api/admin/analytics/ads/timeseries?metric=${metric}&days=30`)
      .then(setChart).catch(() => setChart(null));
  }, [metric]);

  const submit = async (e) => {
    e.preventDefault();
    const num = (v) => (String(v).trim() === '' ? null : Number(v));
    try {
      await api.post('/api/admin/analytics/ads/spend', {
        day: form.day, network: form.network,
        campaign: form.campaign.trim() || null,
        creative: form.creative.trim() || null,
        impressions: num(form.impressions), clicks: num(form.clicks),
        spendCents: form.spendEuro === '' ? null
          : Math.round(Number(String(form.spendEuro).replace(',', '.')) * 100),
      });
      toast.success('Recorded.');
      setAdding(false);
      setForm({ ...form, creative: '', impressions: '', clicks: '', spendEuro: '' });
      await load();
    } catch (err) { toast.error(err.message); }
  };

  if (!report) return null;
  const chartSeries = (chart?.series || []).map((s) => ({ ...s }));
  const colours = chartSeries.map((_, i) => SERIES_COLOURS[i % SERIES_COLOURS.length]);
  const chartMetric = METRICS.find((m) => m.key === metric);

  return (
    <section className="card mb-8">
      <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/5">
        <div>
          <h2 className="font-bold text-slate-200">Ad performance</h2>
          <p className="text-[13px] text-slate-400 mt-0.5 max-w-3xl">
            Arrivals, checkouts, purchases and revenue are measured here. Impressions and
            spend are not — those happen on the ad platform, so CTR and ROAS stay blank
            until they are entered. Grades compare adverts against each other in this window.
          </p>
        </div>
        <button onClick={() => setAdding((v) => !v)}
          className="text-sm font-semibold text-violet-300 hover:text-violet-200 inline-flex items-center gap-1.5">
          <Plus size={14} /> Record spend
        </button>
      </header>

      <div className="p-5">
        {adding && (
          <form onSubmit={submit} className="mb-5 grid grid-cols-2 lg:grid-cols-7 gap-2 items-end">
            <div><label className="label">Day</label>
              <input className="input" type="date" value={form.day}
                onChange={(e) => setForm({ ...form, day: e.target.value })} /></div>
            <div><label className="label">Network</label>
              <select className="input" value={form.network}
                onChange={(e) => setForm({ ...form, network: e.target.value })}>
                {['tiktok', 'instagram', 'facebook', 'youtube', 'discord'].map((x) =>
                  <option key={x} value={x}>{x}</option>)}
              </select></div>
            <div><label className="label">Campaign</label>
              <input className="input" value={form.campaign}
                onChange={(e) => setForm({ ...form, campaign: e.target.value })} /></div>
            <div><label className="label">Creative</label>
              <input className="input" value={form.creative} placeholder="utm_content"
                onChange={(e) => setForm({ ...form, creative: e.target.value })} /></div>
            <div><label className="label">Impressions</label>
              <input className="input" inputMode="numeric" value={form.impressions}
                onChange={(e) => setForm({ ...form, impressions: e.target.value })} /></div>
            <div><label className="label">Clicks</label>
              <input className="input" inputMode="numeric" value={form.clicks}
                onChange={(e) => setForm({ ...form, clicks: e.target.value })} /></div>
            <div><label className="label">Spend €</label>
              <input className="input" inputMode="decimal" value={form.spendEuro}
                onChange={(e) => setForm({ ...form, spendEuro: e.target.value })} /></div>
            <div className="col-span-2 lg:col-span-7">
              <button className="btn-primary text-sm" type="submit">Save</button>
            </div>
          </form>
        )}

        {report.evidence?.blockers?.length > 0 && (
          <ul className="mb-4 space-y-1.5">
            {report.evidence.blockers.map((b, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] text-amber-300/90">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {report.creatives?.length > 0 && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
              {[
                ['Revenue', money(report.totals.revenueCents)],
                ['Spend', report.totals.spendCents ? money(report.totals.spendCents) : '—'],
                ['Blended ROAS', report.totals.blendedRoas == null ? '—' : `${report.totals.blendedRoas}×`],
                ['Winners', String(report.counts.winner)],
                ['Losers', String(report.counts.loser)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-white/5 bg-space-black/40 px-3 py-2">
                  <div className="text-[11.5px] text-slate-500">{k}</div>
                  <div className="text-slate-100 font-semibold tabular-nums">{v}</div>
                </div>
              ))}
            </div>

            {/* One measure at a time. Two on one frame would invent a crossing
                point out of whichever ranges happened to be picked. */}
            <div className="mb-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex gap-1.5">
                  {METRICS.map((m) => (
                    <button key={m.key} onClick={() => setMetric(m.key)}
                      className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold border transition
                        ${metric === m.key ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                          : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <SeriesLegend series={chartSeries} colours={colours} />
              </div>
              {chartSeries.length === 0
                ? <p className="text-[12.5px] text-slate-400 py-3">
                    Nothing to plot for {chartMetric.label} yet.
                  </p>
                : <TimeSeriesPlot series={chartSeries} colours={colours}
                    label={chartMetric.label} value={(p) => p.value} format={chartMetric.format}
                    zeroFloor={metric !== 'roas'}
                    emptyNote={`${chartMetric.label}: one day of data is not a line yet.`} />}
            </div>
          </>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-slate-400 text-left">
              <tr>
                <th className="py-2 font-semibold">Advert</th>
                <th className="font-semibold text-right">Views</th>
                <th className="font-semibold text-right">Clicks</th>
                <th className="font-semibold text-right">CTR</th>
                <th className="font-semibold text-right">Checkouts</th>
                <th className="font-semibold text-right">Purchases</th>
                <th className="font-semibold text-right">Conv.</th>
                <th className="font-semibold text-right">Revenue</th>
                <th className="font-semibold text-right">ROAS</th>
                <th className="font-semibold">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {report.creatives?.length === 0 && (
                <tr><td colSpan={10} className="py-3 text-slate-400">
                  No tagged arrivals in this window.
                </td></tr>
              )}
              {report.creatives?.map((c) => (
                <tr key={`${c.network}-${c.campaign}-${c.creative}`}
                  className="border-t border-white/5 align-top">
                  <td className="py-2.5 pr-3">
                    <div className="text-slate-200 font-medium">{c.creative}</div>
                    <div className="text-[11.5px] text-slate-500">
                      {[c.network, c.campaign].filter((x) => x && x !== '—').join(' · ') || '—'}
                    </div>
                  </td>
                  <td className="text-right tabular-nums text-slate-300">{nfmt(c.impressions)}</td>
                  <td className="text-right tabular-nums text-slate-300">
                    {nfmt(c.platformClicks)}
                    {/* The shop's own count, never merged with the platform's. */}
                    <div className="text-[11.5px] text-slate-500" title="arrivals this shop measured">
                      {nfmt(c.visits)} landed
                    </div>
                  </td>
                  <td className="text-right tabular-nums text-slate-300" title={c.ctrBasis || ''}>
                    {c.ctr == null ? <span className="text-slate-500">—</span> : `${c.ctr}%`}
                  </td>
                  <td className="text-right tabular-nums text-slate-300">{nfmt(c.checkouts)}</td>
                  <td className="text-right tabular-nums text-slate-300">{nfmt(c.purchases)}</td>
                  <td className="text-right tabular-nums text-slate-300">{pct(c.conversionRate)}</td>
                  <td className="text-right tabular-nums text-slate-200">{money(c.revenueCents)}</td>
                  <td className="text-right tabular-nums text-slate-200" title={c.roasBasis || ''}>
                    {c.roas == null ? <span className="text-slate-500">—</span> : `${c.roas}×`}
                  </td>
                  <td>
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px]
                      font-semibold ${GRADE[c.grade]}`}>{c.grade.toUpperCase()}</span>
                    <div className="text-[11.5px] text-slate-500 mt-1 max-w-xs">{c.gradeReason}</div>
                    {c.flags.map((f) => (
                      <div key={f.code} className={`text-[11.5px] mt-1 ${SEV[f.severity]}`}>
                        <TrendingUp size={11} className="inline mr-1 rotate-180" />{f.detail}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
