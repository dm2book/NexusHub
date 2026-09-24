import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Check, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Real product photos from the suppliers' own listings.
 *
 * The nightly sweep does this a few products at a time on its own; this is
 * the same search for the whole catalogue now, for an owner who does not want
 * to wait a week. Two steps, like every bulk action here: the first shows the
 * photos it found — the picture is the thing to judge, so it is shown, not
 * described — and the second puts them on the products.
 *
 * Only a placeholder or an empty image is ever replaced. See
 * supplierImageService for which listing a photo may come from.
 */

const BATCH = 4;

export default function SupplierPhotos({ onDone }) {
  const toast = useToast();
  const [queue, setQueue] = useState(null);
  const [rows, setRows] = useState([]);
  const [phase, setPhase] = useState('idle');   // idle | finding | found | applying | done
  const [progress, setProgress] = useState(0);
  const stop = useRef(false);

  const loadQueue = useCallback(() => {
    api.get('/api/admin/products/images/queue').then(setQueue).catch(() => setQueue(false));
  }, []);
  useEffect(() => { loadQueue(); }, [loadQueue]);

  const walk = async (ids, apply) => {
    const out = [];
    stop.current = false;
    for (let i = 0; i < ids.length; i += BATCH) {
      if (stop.current) break;
      // eslint-disable-next-line no-await-in-loop -- one batch at a time is the point
      const r = await api.post('/api/admin/products/images/find', { productIds: ids.slice(i, i + BATCH), apply });
      out.push(...(r.rows || []));
      setRows(apply ? (prev) => prev.map((x) => (r.rows || []).find((y) => y.productId === x.productId) || x) : [...out]);
      setProgress(Math.min(ids.length, i + BATCH));
    }
    return out;
  };

  const find = async () => {
    if (!queue?.ids?.length) return;
    setPhase('finding'); setRows([]); setProgress(0);
    try { await walk(queue.ids, false); setPhase('found'); }
    catch (e) { toast.error(e.message); setPhase('idle'); }
  };

  const apply = async () => {
    const ids = rows.filter((r) => r.status === 'found').map((r) => r.productId);
    if (!ids.length) return;
    setPhase('applying'); setProgress(0);
    try {
      const out = await walk(ids, true);
      const n = out.filter((r) => r.status === 'applied').length;
      toast.success(`${n} product photo(s) added.`);
      setPhase('done');
      loadQueue();
      onDone?.();
    } catch (e) { toast.error(e.message); setPhase('found'); }
  };

  if (!queue) return null;

  const found = rows.filter((r) => r.status === 'found');
  const busy = phase === 'finding' || phase === 'applying';
  const total = phase === 'applying' ? found.length || rows.length : queue.ids.length;

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white text-sm font-semibold flex items-center gap-2">
            <ImageIcon size={15} className="text-violet-300" /> Product photos from your suppliers
          </h3>
          <p className="text-slate-400 text-xs mt-1 max-w-2xl">
            {queue.waiting
              ? `${queue.waiting} of ${queue.total} products still show a placeholder. `
              : 'Every product has a picture. '}
            Photos come from your suppliers&rsquo; own listings, only when the listing is certainly the
            same product. Your own uploads and artwork are never replaced. This also runs a few
            products every night.
          </p>
        </div>
        {phase === 'found' && found.length > 0 ? (
          <button onClick={apply} className="btn-primary text-xs">Use {found.length} photo(s)</button>
        ) : (
          <button onClick={busy ? () => { stop.current = true; } : find}
            disabled={!busy && !queue.ids.length} className="btn-ghost text-xs disabled:opacity-40">
            {busy ? <><Loader2 size={13} className="animate-spin" /> Stop</>
              : <><ImageIcon size={13} /> Find photos</>}
          </button>
        )}
      </div>

      {busy && (
        <p className="text-slate-400 text-xs mt-3">
          {phase === 'finding' ? 'Searching' : 'Adding'} · {progress} of {total}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <p className="text-xs text-slate-300 mt-3">
            <b className="text-emerald-300">{found.length + rows.filter((r) => r.status === 'applied').length}</b> found
            {rows.filter((r) => r.status === 'none').length > 0 && ` · ${rows.filter((r) => r.status === 'none').length} without a matching photo`}
            {rows.filter((r) => r.status === 'failed').length > 0 && ` · ${rows.filter((r) => r.status === 'failed').length} could not be downloaded`}
          </p>
          {/* The pictures themselves: a grid of what will go on the storefront. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-3 max-h-[26rem] overflow-y-auto">
            {rows.filter((r) => r.image).map((r) => (
              <div key={r.productId} className="rounded-xl border border-white/10 overflow-hidden bg-white/5">
                <div className="aspect-[7/6] bg-black/30 grid place-items-center">
                  <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer"
                    className="max-w-full max-h-full object-contain" />
                </div>
                <div className="p-2">
                  <div className="text-[11.5px] text-slate-200 truncate" title={r.name}>{r.name}</div>
                  <div className="text-[10.5px] text-slate-500 truncate" title={r.title}>
                    {r.status === 'applied'
                      ? <span className="text-emerald-300 inline-flex items-center gap-1"><Check size={11} /> added</span>
                      : r.status === 'failed'
                        ? <span className="text-amber-300 inline-flex items-center gap-1"><AlertTriangle size={11} /> {r.detail}</span>
                        : <>from {r.from}</>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
