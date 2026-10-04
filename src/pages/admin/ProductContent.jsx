import { useEffect, useState } from 'react';
import { FileWarning, SearchX, Copy, Sparkles } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Products → Content.
 *
 * Every active product's copy, scored 0–100, with three flags: missing
 * description, weak SEO, duplicate content. The generator writes a short and a
 * long description, an FAQ, an SEO title and description and keywords from the
 * product name, category and platform only — no delivery times, no speed, no
 * guarantees beyond the written refund rule. Anything that would say more is
 * refused, not published.
 */
const FLAGS = {
  /* Inline colours: three tints are not worth new classes under the CSS budget. */
  missing_description: { label: 'Missing description', icon: FileWarning, c: '#fda4af' },
  weak_seo: { label: 'Weak SEO', icon: SearchX, c: '#fcd34d' },
  duplicate_content: { label: 'Duplicate content', icon: Copy, c: '#7dd3fc' },
};
const scoreColour = (s) => (s >= 80 ? '#6ee7b7' : s >= 50 ? '#fcd34d' : '#fda4af');

export default function ProductContent() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/api/admin/products/content').then(setData).catch((e) => { toast.error(e.message); setData(false); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (item) => {
    try {
      const r = await api.get(`/api/admin/products/${item.id}/content/preview`);
      setPreview({ item, ...r });
    } catch (e) { toast.error(e.message); }
  };
  const apply = async (ids, onlyMissing = false) => {
    setBusy(true);
    try {
      const r = await api.post('/api/admin/products/content/apply', { productIds: ids, onlyMissing });
      const refused = r.rows.filter((x) => x.status === 'refused').length;
      toast.success(`${r.applied} bijgewerkt${refused ? `, ${refused} geweigerd door de claimcheck` : ''}.`);
      setPreview(null);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); load(); }
  };

  if (data === null) return <PageLoader />;
  if (data === false) return <p className="text-slate-400">Kon de productcontent niet laden.</p>;
  const items = data.items.filter((i) => !filter || i.flags.includes(filter));
  const c = preview?.content?.nl;

  return (
    <div>
      <h1 className="text-2xl text-white mb-2">Productcontent</h1>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Korte en lange beschrijving, FAQ, SEO-titel, SEO-beschrijving en zoekwoorden — alleen uit productnaam, categorie
        en platform. Geen levertijden, geen "snel", geen garanties behalve het terugbetaalbeleid. Een tekst die meer
        belooft wordt geweigerd. Gemiddelde score: <span className="text-white tabular-nums">{data.average}/100</span>.
      </p>
      <div className="grid gap-3 sm:grid-cols-3 mb-5">
        {Object.entries(FLAGS).map(([k, v]) => (
          <button key={k} type="button" onClick={() => setFilter(filter === k ? '' : k)} data-testid={`content-${k}`}
            className="rounded-xl border px-4 py-3 text-left"
            style={{ color: v.c, background: `${v.c}14`, borderColor: filter === k ? v.c : `${v.c}4d` }}>
            <div className="flex items-center gap-2 text-sm"><v.icon size={15} /> {v.label}</div>
            <div className="text-2xl text-white mt-1 tabular-nums">{data.flags[k] || 0}</div>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 mb-4">
        <button type="button" className="btn-primary text-sm" disabled={busy}
          onClick={() => apply(data.items.filter((i) => i.flags.length).map((i) => i.id).slice(0, 200), true)}>
          <Sparkles size={14} /> {busy ? 'Bezig…' : 'Genereer voor alles met een vlag'}
        </button>
        <span className="text-xs text-slate-500">Beschrijvingen die je zelf schreef blijven staan.</span>
      </div>

      {preview && (
        <div className="card p-4 mb-5 text-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-white">{preview.item.name}</div>
            <div className="flex gap-2">
              {preview.ok && <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => apply([preview.item.id])}>Toepassen</button>}
              <button type="button" className="btn-ghost text-xs" onClick={() => setPreview(null)}>Sluiten</button>
            </div>
          </div>
          {!preview.ok ? (
            <p style={{ color: '#fda4af' }}>Geweigerd door de claimcheck: {preview.refused.join(' | ')}</p>
          ) : (
            <div className="grid gap-3 text-slate-300">
              <div><div className="text-xs text-slate-500">SEO-titel ({c.seoTitle.length})</div>{c.seoTitle}</div>
              <div><div className="text-xs text-slate-500">SEO-beschrijving ({c.seoDescription.length})</div>{c.seoDescription}</div>
              <div><div className="text-xs text-slate-500">Korte beschrijving</div>{c.short}</div>
              <div><div className="text-xs text-slate-500">Lange beschrijving</div><div style={{ whiteSpace: 'pre-line' }}>{c.long}</div></div>
              <div><div className="text-xs text-slate-500">FAQ</div>
                {c.faq.map(([q, a]) => <div key={q} className="mt-1"><span className="text-white">{q}</span> — {a}</div>)}</div>
              <div><div className="text-xs text-slate-500">Zoekwoorden</div>{c.keywords.join(', ')}</div>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 640 }}>
          <thead className="text-left text-slate-400 border-b border-white/5">
            <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Vlaggen</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3"><div className="text-slate-200">{i.name}</div><div className="text-xs text-slate-500">{i.category}</div></td>
                <td className="px-4 py-3 tabular-nums" style={{ color: scoreColour(i.score) }}>{i.score}/100</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {i.flags.map((f) => {
                      const v = FLAGS[f];
                      return <span key={f} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs" style={{ color: v.c, background: `${v.c}14`, borderColor: `${v.c}4d` }}><v.icon size={12} /> {v.label}</span>;
                    })}
                    {!i.flags.length && <span className="text-xs text-slate-500">—</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-right"><button type="button" className="btn-ghost text-xs" onClick={() => open(i)}>Genereer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
