import { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp, Search, ShieldCheck, ShieldAlert, RefreshCw, Check, X, Upload,
  AlertTriangle, Clock, ExternalLink, Copy, PackageX, HelpCircle, Loader2,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Market intelligence: what the market sells, what it charges, and what we
 * should do about it.
 *
 * Three panels, in the order the work actually happens — sources first, because
 * a discovery list is meaningless until you know which markets it could even
 * see. A source we may not query is shown as prominently as one we can: an
 * empty result from an unavailable source looks identical to "nobody sells
 * this", and confusing those two is how a shop decides a product is not worth
 * stocking.
 *
 * Nothing on this page changes a customer-facing price except the Publish
 * button, and that button is disabled until a recommendation has been approved.
 */

const fmt = (cents) => (cents == null ? '—' : `€${(cents / 100).toFixed(2)}`);
const pct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
const ago = (iso) => {
  if (!iso) return 'never';
  const h = (Date.now() - Date.parse(iso)) / 3600_000;
  if (!Number.isFinite(h)) return 'never';
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

function Section({ title, subtitle, right, children }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm mb-6">
      <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="font-bold text-slate-800">{title}</h2>
          {subtitle && <p className="text-[13px] text-slate-500 mt-0.5 max-w-2xl">{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const STATUS_STYLE = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  unavailable: 'bg-amber-50 text-amber-800 border-amber-200',
  disabled: 'bg-slate-100 text-slate-600 border-slate-200',
  recommended: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  requires_review: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-violet-50 text-violet-700 border-violet-200',
  published: 'bg-sky-50 text-sky-700 border-sky-200',
  rejected: 'bg-slate-100 text-slate-500 border-slate-200',
};
const Pill = ({ status, children }) => (
  <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${STATUS_STYLE[status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
    {children || String(status).replace(/_/g, ' ')}
  </span>
);

/** The five discovery buckets, each with what it means for the reader. */
const BUCKETS = [
  { key: 'newCandidates', label: 'New product candidates', icon: TrendingUp,
    hint: 'The market sells these and ForgeMarket does not.' },
  { key: 'alreadyListed', label: 'Already listed', icon: Check,
    hint: 'Matched to a product you already sell — nothing to add.' },
  { key: 'possibleDuplicates', label: 'Possible duplicate', icon: Copy,
    hint: 'Differs from something you sell in exactly one dimension. You decide.' },
  { key: 'unavailable', label: 'Unavailable', icon: PackageX,
    hint: 'Observed, but nobody has it in stock.' },
  { key: 'needsManualReview', label: 'Needs manual review', icon: HelpCircle,
    hint: 'The listing could not be read confidently enough to classify.' },
];

export default function AdminMarket() {
  const toast = useToast();
  const [sources, setSources] = useState(null);
  const [discovery, setDiscovery] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState('newCandidates');
  const [form, setForm] = useState({ source: 'manual', title: '', price: '', currency: 'EUR', url: '', availability: 'in_stock' });

  const load = useCallback(async () => {
    const [s, d, p, h] = await Promise.all([
      api.get('/api/admin/market/sources').catch(() => null),
      api.get('/api/admin/market/discovery').catch(() => null),
      api.get('/api/admin/market/pricing').catch(() => null),
      api.get('/api/admin/market/price-history').catch(() => ({ history: [] })),
    ]);
    setSources(s?.sources || []);
    setDiscovery(d || null);
    setPricing(p || null);
    setHistory(h?.history || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (label, fn) => {
    setBusy(label);
    try { await fn(); await load(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(''); }
  };

  const submitObservation = async (e) => {
    e.preventDefault();
    const cents = Math.round(Number(String(form.price).replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return toast.error('Enter a price.');
    await act('observe', async () => {
      await api.post('/api/admin/market/observations', {
        source: form.source, title: form.title.trim(), priceCents: cents,
        currency: form.currency.toUpperCase(), url: form.url.trim(),
        availability: form.availability,
      });
      toast.success('Observation recorded.');
      setForm({ ...form, title: '', price: '', url: '' });
    });
  };

  if (!sources) {
    return <div className="p-8 text-slate-500 flex items-center gap-2"><Loader2 className="animate-spin" size={16} /> Loading market data…</div>;
  }

  const recs = pricing?.recommendations || [];
  const cfg = pricing?.config || {};

  return (
    <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Market intelligence</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            What the market sells, what it charges, and what we should do about it.
          </p>
        </div>
        <button onClick={() => act('refresh', async () => {
          await api.post('/api/admin/market/sources/refresh', {});
          await api.post('/api/admin/market/discovery/run', { classifyOnly: true });
          toast.success('Re-checked sources and re-matched the catalogue.');
        })}
          disabled={!!busy}
          className="btn-primary inline-flex items-center gap-2 min-h-[40px]">
          {busy === 'refresh' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </div>

      {/* ── Sources ─────────────────────────────────────────────────────── */}
      <Section
        title="Where the data may come from"
        subtitle="A source is used only when the owner has an agreement for it and it is switched on deliberately. A source that may not be queried is shown here rather than silently skipped — an empty market and a market we are not allowed to look at are different things.">
        <div className="grid md:grid-cols-2 gap-3">
          {sources.map((s) => (
            <div key={s.key} className="border border-slate-200 rounded-xl p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 text-[14px] flex items-center gap-2">
                    {s.status === 'available' ? <ShieldCheck size={15} className="text-emerald-600" />
                      : <ShieldAlert size={15} className="text-amber-600" />}
                    {s.label}
                  </p>
                  <p className="text-[12.5px] text-slate-500 mt-1">{s.legalBasis}</p>
                  <p className="text-[12.5px] text-slate-700 mt-1.5">{s.statusReason}</p>
                </div>
                <Pill status={s.status} />
              </div>
              <div className="flex flex-wrap gap-3 mt-2.5 text-[11.5px] text-slate-400">
                {s.termsUrl && <a href={s.termsUrl} target="_blank" rel="noreferrer noopener"
                  className="hover:text-violet-600 inline-flex items-center gap-1">terms <ExternalLink size={11} /></a>}
                {s.robotsAllows != null && <span>robots.txt: {s.robotsAllows ? 'allows' : 'disallows'}</span>}
                {s.neverAutomated && <span>never fetched automatically</span>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Record an observation by hand ───────────────────────────────── */}
      <Section title="Record a price you saw"
        subtitle="The always-permitted input. Source, URL and timestamp are stored with every figure, so any recommendation can be traced back to something a person actually looked at.">
        <form onSubmit={submitObservation} className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <label className="lg:col-span-2 text-[12.5px] font-semibold text-slate-600">Listing title
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="EA FC Points 1050 PS5 EU"
              className="mt-1 w-full h-10 rounded-xl border border-slate-200 px-3 text-sm font-normal" />
          </label>
          <label className="text-[12.5px] font-semibold text-slate-600">Price
            <input required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
              inputMode="decimal" placeholder="12.49"
              className="mt-1 w-full h-10 rounded-xl border border-slate-200 px-3 text-sm font-normal" />
          </label>
          <label className="text-[12.5px] font-semibold text-slate-600">Currency
            <input required value={form.currency} maxLength={3}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              className="mt-1 w-full h-10 rounded-xl border border-slate-200 px-3 text-sm font-normal uppercase" />
          </label>
          <label className="lg:col-span-2 text-[12.5px] font-semibold text-slate-600">Source URL
            <input required type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://…"
              className="mt-1 w-full h-10 rounded-xl border border-slate-200 px-3 text-sm font-normal" />
          </label>
          <div className="lg:col-span-6 flex items-center gap-3">
            <select value={form.availability} onChange={(e) => setForm({ ...form, availability: e.target.value })}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm">
              <option value="in_stock">In stock</option>
              <option value="out_of_stock">Out of stock</option>
              <option value="unknown">Unknown</option>
            </select>
            <button disabled={!!busy} className="btn-primary inline-flex items-center gap-2 min-h-[40px]">
              <Upload size={15} /> Record observation
            </button>
          </div>
        </form>
      </Section>

      {/* ── Discovery ───────────────────────────────────────────────────── */}
      <Section title="Product discovery"
        subtitle="Every canonical product we have observed, and whether ForgeMarket already sells it. Nothing here has been added to the catalogue — approving a candidate is a decision you make, recorded with your name against it."
        right={<button onClick={() => act('discover', async () => {
          const r = await api.post('/api/admin/market/discovery/run', {});
          toast.success(r.skipped ? 'Discovery is not due yet.' : 'Discovery run complete.');
        })} disabled={!!busy}
          className="text-sm font-semibold text-violet-700 hover:text-violet-800 inline-flex items-center gap-1.5">
          {busy === 'discover' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Run discovery
        </button>}>
        <div className="flex flex-wrap gap-2 mb-4">
          {BUCKETS.map((b) => {
            const n = discovery?.[b.key]?.length || 0;
            const Icon = b.icon;
            return (
              <button key={b.key} onClick={() => setOpen(b.key)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold border transition
                  ${open === b.key ? 'bg-violet-50 border-violet-300 text-violet-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                <Icon size={14} /> {b.label}
                <span className="text-[11px] rounded-full bg-slate-900/5 px-1.5 py-0.5">{n}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[12.5px] text-slate-500 mb-3">{BUCKETS.find((b) => b.key === open)?.hint}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-slate-400 text-left">
              <tr><th className="py-2 font-semibold">Product</th><th className="font-semibold">Identity</th>
                <th className="font-semibold">Why</th><th className="font-semibold">Seen</th>
                <th className="font-semibold text-right">Decision</th></tr>
            </thead>
            <tbody>
              {(discovery?.[open] || []).map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-2.5 pr-3 font-semibold text-slate-800">{c.title}</td>
                  <td className="pr-3 text-slate-400 font-mono text-[11px]">{c.canonical_key}</td>
                  <td className="pr-3 text-slate-600">{c.reason}</td>
                  <td className="pr-3 text-slate-500 whitespace-nowrap">
                    {c.observations} obs · {ago(c.last_seen)}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => act(`ap-${c.id}`, async () => {
                      await api.post(`/api/admin/market/candidates/${c.id}/approved`, {});
                      toast.success('Approved for the catalogue.');
                    })} disabled={!!busy}
                      className="text-emerald-700 hover:bg-emerald-50 rounded-lg px-2 py-1 font-semibold">
                      <Check size={14} className="inline" /> Approve
                    </button>
                    <button onClick={() => act(`rj-${c.id}`, async () => {
                      await api.post(`/api/admin/market/candidates/${c.id}/rejected`, {});
                      toast.success('Rejected.');
                    })} disabled={!!busy}
                      className="text-slate-500 hover:bg-slate-100 rounded-lg px-2 py-1 font-semibold ml-1">
                      <X size={14} className="inline" /> Reject
                    </button>
                  </td>
                </tr>
              ))}
              {!(discovery?.[open] || []).length && (
                <tr><td colSpan={5} className="py-8 text-center text-slate-400">Nothing in this bucket.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Competitor pricing ──────────────────────────────────────────── */}
      <Section title="Competitor pricing"
        subtitle={`Formula: ${cfg.formula || '—'} · target position ${cfg.targetMarketPosition ?? '—'} · minimum profit €${cfg.minimumProfitEur ?? '—'} · needs ${cfg.minCompetitors ?? '—'} competitors and data under ${cfg.maxObservationAgeHours ?? '—'}h old.`}
        right={<button onClick={() => act('price', async () => {
          const r = await api.post('/api/admin/market/pricing/refresh', {});
          toast.success(r.skipped ? 'Pricing is not due yet.' : `Priced ${r.priced}, ${r.requiresReview} need review.`);
        })} disabled={!!busy}
          className="text-sm font-semibold text-violet-700 hover:text-violet-800 inline-flex items-center gap-1.5">
          {busy === 'price' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Recalculate
        </button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-slate-400 text-left">
              <tr>
                <th className="py-2 font-semibold">Product</th>
                <th className="font-semibold">Low</th><th className="font-semibold">Median</th>
                <th className="font-semibold">High</th><th className="font-semibold">Official</th>
                <th className="font-semibold">Sellers</th><th className="font-semibold">Ours</th>
                <th className="font-semibold">Recommended</th><th className="font-semibold">Margin</th>
                <th className="font-semibold">Profit</th><th className="font-semibold">Data</th>
                <th className="font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="py-2.5 pr-3">
                    <p className="font-semibold text-slate-800">{r.title}</p>
                    {!!r.blockers.length && (
                      <ul className="mt-1 space-y-0.5">
                        {r.blockers.map((b) => (
                          <li key={b.code} className="text-[11.5px] text-amber-700 flex items-start gap-1">
                            <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {b.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="pr-3">{fmt(r.low_cents)}</td>
                  <td className="pr-3 font-semibold">{fmt(r.median_cents)}</td>
                  <td className="pr-3">{fmt(r.high_cents)}</td>
                  <td className="pr-3 text-slate-500">{fmt(r.official_cents)}</td>
                  <td className="pr-3">{r.competitor_count}</td>
                  <td className="pr-3">{fmt(r.forge_price_cents)}</td>
                  <td className="pr-3 font-bold text-slate-900">{fmt(r.recommended_cents)}</td>
                  <td className="pr-3">{pct(r.margin_pct)}</td>
                  <td className="pr-3">{fmt(r.profit_cents)}</td>
                  <td className="pr-3 whitespace-nowrap">
                    <span className={r.stale ? 'text-amber-700 font-semibold' : 'text-slate-500'}>
                      <Clock size={11} className="inline mr-1" />{ago(r.freshest_at)}
                    </span>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <div className="flex flex-col items-end gap-1">
                      <Pill status={r.status} />
                      <div>
                        <button onClick={() => act(`ra-${r.id}`, async () => {
                          await api.post(`/api/admin/market/recommendations/${r.id}/approved`, {});
                          toast.success('Price approved.');
                        })} disabled={!!busy || r.status === 'published'}
                          className="text-emerald-700 hover:bg-emerald-50 rounded-lg px-2 py-1 font-semibold disabled:opacity-40">
                          Approve
                        </button>
                        <button onClick={() => act(`rr-${r.id}`, async () => {
                          await api.post(`/api/admin/market/recommendations/${r.id}/rejected`, {});
                          toast.success('Rejected.');
                        })} disabled={!!busy || r.status === 'published'}
                          className="text-slate-500 hover:bg-slate-100 rounded-lg px-2 py-1 font-semibold disabled:opacity-40">
                          Reject
                        </button>
                        {/* Publish is the only control on this page that changes a
                            price a customer can see, so it stays dark until the
                            recommendation has actually been approved. */}
                        <button onClick={() => act(`rp-${r.id}`, async () => {
                          const out = await api.post(`/api/admin/market/recommendations/${r.id}/publish`, {});
                          toast.success(`Published: ${fmt(out.oldCents)} → ${fmt(out.newCents)}`);
                        })} disabled={!!busy || r.status !== 'approved'}
                          title={r.status !== 'approved' ? 'Approve it first' : 'Change the live price'}
                          className="text-violet-700 hover:bg-violet-50 rounded-lg px-2 py-1 font-semibold disabled:opacity-40">
                          Publish
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {!recs.length && (
                <tr><td colSpan={12} className="py-8 text-center text-slate-400">
                  No recommendations yet. Record some observations, then recalculate.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Price history ───────────────────────────────────────────────── */}
      <Section title="Price history"
        subtitle="Every observation-driven price decision: what it was, what it became, who decided, and the margin at the time.">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-slate-400 text-left">
              <tr><th className="py-2 font-semibold">When</th><th className="font-semibold">Old</th>
                <th className="font-semibold">New</th><th className="font-semibold">Margin</th>
                <th className="font-semibold">Status</th><th className="font-semibold">Who</th>
                <th className="font-semibold">Reason</th></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{ago(h.created_at)}</td>
                  <td className="pr-3">{fmt(h.old_cents)}</td>
                  <td className="pr-3 font-semibold">{fmt(h.new_cents)}</td>
                  <td className="pr-3">{pct(h.margin_pct)}</td>
                  <td className="pr-3"><Pill status={h.approval_status}>{h.approval_status}</Pill></td>
                  <td className="pr-3 text-slate-600">{h.actor || '—'}</td>
                  <td className="text-slate-500">{h.reason}</td>
                </tr>
              ))}
              {!history.length && (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400">No price decisions recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
