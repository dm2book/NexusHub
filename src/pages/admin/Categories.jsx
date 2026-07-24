import { useEffect, useState } from 'react';
import { Image as ImageIcon, Upload, Loader2, X, Scissors, LayoutGrid } from 'lucide-react';
import { api } from '../../lib/api.js';
import { categoryVisual } from '../../lib/catalog.js';
import { iconFor } from '../../lib/sampleCatalog.js';
import { fileToDataUrl, removeSolidBackground } from '../../lib/imageUpload.js';
import { primeCategoryLogos } from '../../lib/useCategoryLogos.js';
import { PageLoader, EmptyState } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Give every category its own logo. These show up on the home page category
 * list + popular tiles, the shop sidebar and the category banner.
 */
export default function AdminCategories() {
  const toast = useToast();
  const [cats, setCats] = useState(null);
  const [logos, setLogos] = useState({});
  const [busy, setBusy] = useState('');   // slug currently uploading/saving

  const load = () => api.get('/api/admin/categories')
    .then((r) => { setCats(r.categories || []); setLogos(r.logos || {}); primeCategoryLogos(r.logos || {}); })
    .catch(() => setCats([]));
  useEffect(() => { load(); }, []);

  const save = async (slug, image) => {
    setBusy(slug);
    try {
      const r = await api.put('/api/admin/categories/logo', { slug, image: image || null });
      setLogos(r.logos || {});
      primeCategoryLogos(r.logos || {});
      toast.success(image ? 'Logo saved.' : 'Logo removed.');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(''); }
  };

  // Upload from the device; a flat background is stripped automatically.
  const upload = async (slug, file) => {
    if (!file) return;
    setBusy(slug);
    try {
      let data = await fileToDataUrl(file);
      try { const clean = await removeSolidBackground(data); if (clean) data = clean; } catch { /* keep original */ }
      await save(slug, data);
    } catch (err) { toast.error(err.message); setBusy(''); }
  };

  // Paste a link — a page link (e.g. a Pinterest pin) resolves to its image.
  const useLink = async (slug, raw) => {
    const url = String(raw || '').trim();
    if (!url) return;
    setBusy(slug);
    try {
      let final = url;
      if (!/^data:/.test(url) && !/\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/i.test(url)) {
        const r = await api.post('/api/admin/products/resolve-image', { url }).catch(() => null);
        if (r?.url) final = r.url;
      }
      await save(slug, final);
    } catch (err) { toast.error(err.message); setBusy(''); }
  };

  const strip = async (slug) => {
    const cur = logos[slug];
    if (!cur) return;
    setBusy(slug);
    try {
      const out = await removeSolidBackground(cur);
      if (out) await save(slug, out);
      else { toast.error('No flat background found to remove.'); setBusy(''); }
    } catch (err) { toast.error(err.message); setBusy(''); }
  };

  if (cats === null) return <PageLoader />;

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-1">Categories</h1>
      <p className="text-slate-400 text-sm mb-5">
        Give each category its own logo. These appear on the home page, the shop sidebar and the category banner.
      </p>

      {cats.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="No categories yet"
          hint="Categories come from your products — add a product with a category first." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cats.map((slug) => {
            const v = categoryVisual(slug);
            const current = logos[slug] || iconFor(slug);
            const isCustom = !!logos[slug];
            const isBusy = busy === slug;
            return (
              <div key={slug} className="card p-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl bg-white/5 border border-white/10 grid place-items-center overflow-hidden shrink-0">
                    {current ? <img src={current} alt="" className="w-full h-full object-contain" />
                      : <ImageIcon size={18} className="text-slate-500" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-medium truncate">{v.label}</div>
                    <div className="text-slate-500 text-xs font-mono truncate">{slug}</div>
                    <div className="text-[11px] mt-0.5">
                      {isCustom ? <span className="text-emerald-400">Custom logo</span>
                        : <span className="text-slate-500">Default icon</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <input
                    className="input py-1.5 text-sm flex-1"
                    placeholder="Paste an image or page link…"
                    disabled={isBusy}
                    onKeyDown={(e) => { if (e.key === 'Enter') { useLink(slug, e.currentTarget.value); e.currentTarget.value = ''; } }}
                    onBlur={(e) => { if (e.currentTarget.value.trim()) { useLink(slug, e.currentTarget.value); e.currentTarget.value = ''; } }} />
                  <label className={`btn-ghost text-xs whitespace-nowrap cursor-pointer flex items-center gap-1 ${isBusy ? 'opacity-60 pointer-events-none' : ''}`}>
                    {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; upload(slug, f); }} />
                  </label>
                </div>

                {isCustom && (
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => strip(slug)} disabled={isBusy}
                      className="btn-ghost text-xs flex items-center gap-1.5 disabled:opacity-50">
                      <Scissors size={13} /> Remove background
                    </button>
                    <button onClick={() => save(slug, null)} disabled={isBusy}
                      className="btn-ghost text-xs flex items-center gap-1.5 text-slate-400 hover:text-red-400 disabled:opacity-50">
                      <X size={13} /> Reset to default
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
