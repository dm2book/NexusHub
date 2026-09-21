/**
 * Two things a product needs before it can be sold, and neither of them is a
 * price: a picture, and a shelf.
 *
 * ── WHY THIS SITS UNDER "PRODUCTS TO ADD" ─────────────────────────────────
 * That table proposes products. Approving one used to create a row with no
 * image on a category named after a raw game slug, so the shortlist quietly
 * produced storefront entries nobody would click. This panel is the other half
 * of the same screen: what is still missing a picture, and which shelves the
 * proposals would need that the shop has not got.
 *
 * ── WHY THE BUTTON IS TWO STEPS ───────────────────────────────────────────
 * The report is free and changes nothing; repointing live products is a
 * decision. The first press shows what would happen, the second does it —
 * which is the same shape as every other bulk action in this admin.
 */
import { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, FolderPlus, Check } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function CatalogueFit() {
  const toast = useToast();
  const [art, setArt] = useState(null);
  const [shelves, setShelves] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    /* A dry run IS the report — there is no separate read for it, and adding
       one would be a second implementation of the same question. */
    api.post('/api/admin/products/art/backfill', {}).then(setArt).catch(() => setArt(false));
    api.get('/api/admin/products/categories/proposed')
      .then((r) => setShelves(r.proposed || [])).catch(() => setShelves([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const apply = async () => {
    setBusy(true);
    try {
      const out = await api.post('/api/admin/products/art/backfill', { apply: true });
      toast.success(out.missing === 0
        ? 'Every product already had a picture.'
        : `${out.missing} product(s) given a picture — ${out.matched} matched, ${out.drawn} drawn.`);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4 mb-8">
      {/* ── Pictures ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center gap-2 mb-1">
          <ImageIcon size={15} className="text-violet-300" />
          <h3 className="text-white text-sm font-semibold">Products without a picture</h3>
        </div>
        {!art ? <p className="text-[13px] text-slate-400 mt-2">Checking…</p>
          : art.missing === 0 ? (
            <p className="text-[13px] text-slate-400 mt-2 flex items-center gap-2">
              <Check size={14} className="text-emerald-400" />
              All {art.considered} active products have one.
            </p>
          ) : (
            <>
              <p className="text-[13px] text-slate-400 mt-2">
                <b className="text-white">{art.missing}</b> of {art.considered} have none.
                {' '}{art.matched} can take artwork this shop already ships;
                {' '}{art.drawn} would get a drawn tile stating their own amount.
              </p>
              {/* Named, with the reason, because a drawn tile is a placeholder
                  and an owner should be able to see which products got one. */}
              <ul className="mt-3 space-y-1.5 max-h-44 overflow-auto">
                {art.rows.slice(0, 12).map((r) => (
                  <li key={r.id} className="text-[12px] text-slate-300">
                    <span className="text-white">{r.name}</span>
                    <span className="text-slate-500"> — {r.drawn ? 'drawn tile' : 'shop artwork'}</span>
                    <div className="text-slate-500 text-[11px]">{r.reason}</div>
                  </li>
                ))}
              </ul>
              <button onClick={apply} disabled={busy}
                className="btn-primary mt-4 disabled:opacity-40">
                {busy ? 'Working…' : `Give all ${art.missing} a picture`}
              </button>
            </>
          )}
      </div>

      {/* ── Shelves ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center gap-2 mb-1">
          <FolderPlus size={15} className="text-sky-300" />
          <h3 className="text-white text-sm font-semibold">Categories the proposals would need</h3>
        </div>
        <p className="text-[12px] text-slate-500 mt-1">
          Read from what the shop already sells. A discovered product whose game is already
          on a shelf goes there; these are the ones with nowhere to go.
        </p>
        {!shelves ? <p className="text-[13px] text-slate-400 mt-3">Checking…</p>
          : shelves.length === 0 ? (
            <p className="text-[13px] text-slate-400 mt-3 flex items-center gap-2">
              <Check size={14} className="text-emerald-400" />
              Every proposal fits a category you already have.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 max-h-56 overflow-auto">
              {shelves.map((s) => (
                <li key={s.category} className="text-[12.5px]">
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-semibold">{s.category}</span>
                    <span className="text-slate-500">
                      {s.candidates} candidate{s.candidates === 1 ? '' : 's'} waiting
                    </span>
                  </div>
                  {/* The titles themselves, because one stray listing is not a
                      reason to add a shelf and eleven is. */}
                  <div className="text-slate-500 text-[11px] truncate">{s.examples.join(' · ')}</div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
