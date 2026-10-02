import { useEffect, useState } from 'react';
import { Clapperboard, Copy, Info, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Growth → Ad Scripts.
 *
 * Per product: 10 hooks, 10 scripts and 10 CTAs over eight hook kinds, built
 * only from the product, its real orders, measured deliveries and observed
 * competitor prices — and passed through the claim gate. What could not be
 * said, and why, is listed under the scripts. Scores are predicted from how a
 * script is built; each script's link is tagged so Ad Intelligence measures it.
 */
const SCORES = [
  ['hookStrength', 'Hook'], ['retention', 'Retention'], ['scrollStop', 'Scroll stop'], ['conversion', 'Conversion'],
];
const tone = (v) => (v >= 75 ? 'text-emerald-300' : v >= 50 ? 'text-amber-300' : 'text-slate-400');

export default function AdScripts() {
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [pid, setPid] = useState('');
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('scripts');

  useEffect(() => {
    api.get('/api/admin/analytics/ad-scripts').then((r) => {
      setProducts(r.products || []);
      if (r.products?.[0]) setPid(r.products[0].id);
    }).catch(() => setProducts([]));
  }, []);
  useEffect(() => {
    if (!pid) return;
    setData(null);
    api.get(`/api/admin/analytics/ad-scripts/${encodeURIComponent(pid)}`).then(setData).catch(() => setData(false));
  }, [pid]);

  const copy = (text) => {
    try { navigator.clipboard.writeText(text); toast.success('Copied.'); } catch { toast.error('Could not copy.'); }
  };

  if (products === null) return <PageLoader />;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h1 className="text-2xl text-white flex items-center gap-2"><Clapperboard size={22} className="text-violet-300" /> Ad Scripts</h1>
        <select value={pid} onChange={(e) => setPid(e.target.value)} name="product"
          className="rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm h-10 px-3 max-w-sm">
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sold ? ` · ${p.sold} sold` : ''}</option>)}
        </select>
      </div>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Built only from the product, its real orders, measured delivery times and competitor prices actually observed.
        No &ldquo;shop now&rdquo;; &ldquo;best prices&rdquo; and &ldquo;instant delivery&rdquo; only when the numbers prove them.
      </p>

      {!products.length && <p className="text-slate-500 text-sm card p-5">No active products.</p>}
      {pid && data === null && <PageLoader />}
      {data === false && <p className="text-slate-400">Could not generate scripts for this product.</p>}
      {data && (
        <>
          <Facts d={data} />
          {data.shortfall && (
            <p className="text-amber-300/90 text-[12.5px] mb-4 flex gap-2"><Info size={14} className="shrink-0 mt-0.5" />{data.shortfall}.</p>
          )}
          <div className="flex gap-1.5 mb-4">
            {[['scripts', `Scripts (${data.scripts.length})`], ['hooks', `Hooks (${data.hooks.length})`], ['ctas', `CTAs (${data.ctas.length})`],
              ['refused', `Not allowed (${data.refused.length})`]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold border transition
                  ${tab === k ? 'bg-violet-500/15 border-violet-500/40 text-violet-300' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>{l}</button>
            ))}
          </div>

          {tab === 'scripts' && (
            <div className="space-y-3">
              {data.scripts.map((s) => (
                <div key={s.id} className="card p-4" data-testid="script">
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                    <div className="text-[11px] text-slate-400">{s.typeLabel} · {s.seconds}s</div>
                    <div className="flex gap-3 text-[12px]">
                      {SCORES.map(([k, l]) => (
                        <span key={k} title={(s.why[k] || []).join('\n')} className="text-slate-400">{l}{' '}
                          <span className={`font-semibold ${tone(s.scores[k])}`}>{s.scores[k]}</span></span>
                      ))}
                    </div>
                  </div>
                  <ol className="space-y-1 text-[13px]">
                    {s.beats.map((b) => (
                      <li key={b.kind} className="flex gap-3">
                        <span className="text-slate-500 tabular-nums w-14 shrink-0">{b.from}–{b.to}s</span>
                        <span className={b.kind === 'hook' ? 'text-white font-semibold' : b.kind === 'proof' ? 'text-slate-400 italic' : 'text-slate-200'}>{b.text}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="flex items-center justify-between gap-3 flex-wrap mt-3 text-[11px] text-slate-500">
                    <span className="break-all">{s.link}</span>
                    <span>{s.measured ? `measured: ${s.measured.visits} landings · ${s.measured.purchases} purchases` : 'not measured yet'}</span>
                    <button onClick={() => copy(`${s.beats.map((b) => `${b.from}-${b.to}s ${b.text}`).join('\n')}\n${s.link}`)}
                      className="btn-ghost text-xs"><Copy size={12} /> Copy</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'hooks' && (
            <div className="card divide-y divide-white/5">
              {data.hooks.map((h) => (
                <div key={h.id} className="p-3 flex items-start justify-between gap-3" data-testid="hook">
                  <div>
                    <div className="text-white">{h.text}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{h.typeLabel} · from {h.uses.join(', ')}</div>
                  </div>
                  <div className="text-[12px] text-slate-400 shrink-0 text-right">
                    <div title={h.why.hookStrength.join('\n')}>Hook <span className={`font-semibold ${tone(h.scores.hookStrength)}`}>{h.scores.hookStrength}</span></div>
                    <div title={h.why.scrollStop.join('\n')}>Scroll stop <span className={`font-semibold ${tone(h.scores.scrollStop)}`}>{h.scores.scrollStop}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'ctas' && (
            <div className="card divide-y divide-white/5">
              {data.ctas.map((c) => (
                <div key={c.id} className="p-3 flex items-center justify-between gap-3" data-testid="cta">
                  <div className="text-white">{c.text}</div>
                  <div className="text-[11px] text-slate-500 shrink-0">from {c.uses.join(', ')}</div>
                </div>
              ))}
            </div>
          )}

          {tab === 'refused' && (
            <div className="card divide-y divide-white/5">
              {data.refused.length === 0 && <p className="p-3 text-slate-500 text-sm">Nothing had to be refused.</p>}
              {data.refused.map((r, i) => (
                <div key={i} className="p-3">
                  <div className="text-slate-300 line-through">{r.text}</div>
                  <div className="text-[11px] text-amber-300/90 mt-0.5">{r.why.join(' · ')}</div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-500 mt-4 flex gap-2 max-w-3xl"><Info size={13} className="shrink-0 mt-0.5" />{data.scoreNote}</p>
        </>
      )}
    </div>
  );
}

/** What the scripts were built from — the owner can check every line against it. */
function Facts({ d }) {
  const f = d.facts;
  const items = [
    ['Price', f.price], ['Pack', f.pack], ['Per 1.000', f.perThousand], ['Delivered as', f.delivery],
    ['Sold (real)', f.sold.total ? `${f.sold.total} · last ${f.sold.lastAgo}` : 'none yet'],
    ['Delivery time', f.deliveryMeasured.n ? `median ${f.deliveryMeasured.median} over ${f.deliveryMeasured.n}` : 'not measured yet'],
    ['Competitor price', f.market?.cheaper ? `${f.market.source} ${f.market.price} (${f.market.date})` : (f.market ? `${f.market.source} is cheaper — not used` : 'none observed')],
    ['Stock', f.stockLeft ? `${f.stockLeft} left` : null],
  ].filter(([, v]) => v);
  return (
    <div className="card p-4 mb-4">
      <div className="text-[11px] text-slate-400 mb-2 flex items-center gap-1.5"><ShieldCheck size={13} /> Built from</div>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4 text-[12.5px]">
        {items.map(([k, v]) => <div key={k}><span className="text-slate-500">{k}: </span><span className="text-slate-200">{v}</span></div>)}
      </div>
    </div>
  );
}
