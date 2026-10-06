import { useEffect, useMemo, useState } from 'react';
import { Film, Copy, Download, Info } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Growth → Ad Concepts.
 *
 * 100 TikTok concepts in seven formats — UGC, Story, POV, Comparison, Meme,
 * Reddit-style and TikTok native — each a shooting script a phone can film:
 * the first frame, the beats with timings, the words on screen, the sound, the
 * caption and a tagged link. Filled in from the product's own facts; anything
 * that could not be proven for this product is under "Not possible", with why.
 */
const PERSONA = { maker: 'Maker (you or a creator)', 'de baas': 'De baas (the owner)', Bolt: 'Bolt (the logo as a character)' };

function scriptText(c, productName) {
  const rows = c.beats.map((b) => `${b.time}  ·  ${b.shot}\n      “${b.text}”`).join('\n');
  return [`${c.title} — ${c.formatLabel}`, `Product: ${productName}`, '',
    `HOOK: ${c.hook}`, `Why: ${c.angle}`, `Who: ${PERSONA[c.persona] || c.persona} · Sound: ${c.sound}`, '',
    rows, '', c.vo ? `Voice-over: ${c.vo}\n` : '', `Caption: ${c.caption}`, `CTA: ${c.cta}`, `Link: ${c.link}`].join('\n');
}

export default function AdConcepts() {
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [pid, setPid] = useState('');
  const [data, setData] = useState(null);
  const [format, setFormat] = useState('all');
  const [tab, setTab] = useState('concepts');

  useEffect(() => {
    api.get('/api/admin/analytics/ad-concepts').then((r) => {
      setProducts(r.products || []);
      if (r.products?.[0]) setPid(r.products[0].id);
    }).catch(() => setProducts([]));
  }, []);
  useEffect(() => {
    if (!pid) return;
    setData(null);
    api.get(`/api/admin/analytics/ad-concepts/${encodeURIComponent(pid)}`).then(setData).catch(() => setData(false));
  }, [pid]);

  const shown = useMemo(() => (data?.concepts || []).filter((c) => format === 'all' || c.format === format), [data, format]);

  const copy = (text) => {
    try { navigator.clipboard.writeText(text); toast.success('Copied.'); } catch { toast.error('Could not copy.'); }
  };
  const download = () => {
    const text = shown.map((c) => scriptText(c, data.product.name)).join('\n\n────────────────────────\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `tiktok-concepten-${data.product.id}.txt` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (products === null) return <PageLoader />;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <h1 className="text-2xl text-white flex items-center gap-2"><Film size={22} className="text-violet-300" /> Ad Concepts</h1>
        <select value={pid} onChange={(e) => setPid(e.target.value)} name="product"
          className="rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm h-10 px-3 max-w-sm">
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sold ? ` · ${p.sold} sold` : ''}</option>)}
        </select>
      </div>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        TikTok shooting scripts: first frame, timed shots, on-screen text, sound, caption and a tagged link.
        Prices, delivery times and sales counts come only from real data. UGC and forum-style captions carry #advertentie.
        The ad copy itself is Dutch, for the Dutch market.
      </p>

      {!products.length && <p className="text-slate-500 text-sm card p-5">No active products.</p>}
      {pid && data === null && <PageLoader />}
      {data === false && <p className="text-slate-400">Could not build concepts for this product.</p>}
      {data && (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-3" data-testid="concept-formats">
            {[['all', `All (${data.produced})`], ...data.formats.map((k) => [k, `${data.formatLabels[k]} (${data.byFormat[k]})`])].map(([k, l]) => (
              <button key={k} onClick={() => { setFormat(k); setTab('concepts'); }}
                className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold border transition
                  ${tab === 'concepts' && format === k ? 'bg-violet-500/15 border-violet-500/40 text-violet-300' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>{l}</button>
            ))}
            <button onClick={() => setTab('skipped')}
              className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold border transition
                ${tab === 'skipped' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>
              Not possible ({data.skipped.length})
            </button>
            {tab === 'concepts' && shown.length > 0 && (
              <button onClick={download} className="btn-ghost text-xs ml-auto"><Download size={13} /> Download {shown.length} scripts</button>
            )}
          </div>

          {tab === 'concepts' && (
            <div className="grid xl:grid-cols-2 gap-3">
              {shown.map((c) => (
                <div key={c.id} className="card p-4" data-testid="concept">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide">{c.formatLabel}{c.seconds ? ` · ±${c.seconds}s` : ''}</div>
                    <button onClick={() => copy(scriptText(c, data.product.name))} className="btn-ghost text-xs"><Copy size={12} /> Copy script</button>
                  </div>
                  <div className="text-white font-semibold">{c.title}</div>
                  <div className="text-[13px] text-slate-200 mt-2 rounded-lg bg-white/5 px-3 py-2">“{c.hook}”</div>
                  <div className="text-[11.5px] text-slate-500 mt-1.5">{c.angle} · {PERSONA[c.persona] || c.persona} · 🎵 {c.sound}</div>
                  <ol className="mt-3 space-y-1.5 text-[12.5px]">
                    {c.beats.map((b, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="text-slate-500 tabular-nums w-14 shrink-0">{b.time}</span>
                        <span className="min-w-0"><span className="text-slate-400">{b.shot}</span><br /><span className="text-slate-100">{b.text}</span></span>
                      </li>
                    ))}
                  </ol>
                  {c.vo && <p className="text-[12px] text-slate-400 mt-2"><b className="text-slate-300">VO:</b> {c.vo}</p>}
                  <p className="text-[12px] text-slate-400 mt-1"><b className="text-slate-300">Caption:</b> {c.caption} · <b className="text-slate-300">CTA:</b> {c.cta}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'skipped' && (
            <div className="card divide-y divide-white/5">
              {data.skipped.length === 0 && <p className="p-3 text-slate-500 text-sm">Every concept fits this product.</p>}
              {data.skipped.map((s) => (
                <div key={s.id} className="p-3 flex items-start gap-2" data-testid="skipped">
                  <Info size={14} className="text-amber-300 shrink-0 mt-0.5" />
                  <div><div className="text-slate-200 text-sm">{s.title} <span className="text-slate-500">· {s.format}</span></div>
                    <div className="text-[12px] text-slate-500">{s.why.join(' · ')}</div></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
