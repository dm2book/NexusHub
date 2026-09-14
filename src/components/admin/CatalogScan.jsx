import { useCallback, useRef, useState } from 'react';
import { Search, Loader2, Check, AlertTriangle, CircleSlash, Euro } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';

/**
 * "Which of the things I sell can this supplier deliver, profitably?" — for the
 * whole catalogue, in one go.
 *
 * The picker answers that one product at a time. Seventy-one products is an
 * hour of clicking to reach a single number, and that number is the one that
 * decides whether a launch date is real.
 *
 * ── IT PROPOSES, IT DOES NOT MAP ──────────────────────────────────────────
 * The match is by NAME: "Robux" finds a gift card as happily as the top-up a
 * product actually is. A bulk scan is precisely the feature that invites blind
 * trust, so every row shows the SUPPLIER'S own title, platform and region, and
 * mapping is a click per row. Nothing here maps on its own.
 *
 * ── WHY IT WALKS IN BATCHES ───────────────────────────────────────────────
 * Two hundred-odd calls to someone else's API is minutes of wall clock, and a
 * single request that dies at the function timeout leaves you with nothing and
 * no idea how far it got. Ten at a time finishes, reports, and the progress bar
 * is the honest version of "this takes a while".
 */

const BATCH = 8;

const STYLE = {
  profitable: { cls: 'text-emerald-300', Icon: Check, label: 'can be sourced' },
  below_cost: { cls: 'text-red-300', Icon: AlertTriangle, label: 'costs more than you charge' },
  out_of_stock: { cls: 'text-amber-300', Icon: AlertTriangle, label: 'priced fine, none in stock' },
  not_found: { cls: 'text-slate-400', Icon: CircleSlash, label: 'not carried here' },
  no_price: { cls: 'text-slate-400', Icon: CircleSlash, label: 'your product has no price' },
};

export default function CatalogScan({ supplier, onMapped }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mapped, setMapped] = useState({});     // productId → 'saving' | 'done' | error
  const stop = useRef(false);

  const run = useCallback(async () => {
    setBusy(true); setErr(''); setRows([]); setMapped({}); stop.current = false;
    try {
      const { products } = await api.get(`/api/admin/suppliers/${supplier.id}/scan-targets`);
      setTotal(products.length);
      for (let i = 0; i < products.length; i += BATCH) {
        if (stop.current) break;
        const slice = products.slice(i, i + BATCH);
        // eslint-disable-next-line no-await-in-loop -- one batch at a time is the point
        const r = await api.post(`/api/admin/suppliers/${supplier.id}/scan`, {
          productIds: slice.map((p) => p.id),
        });
        setRows((prev) => [...prev, ...(r.rows || [])]);
      }
    } catch (e) {
      setErr(e?.message || 'Scan failed');
    } finally {
      setBusy(false);
    }
  }, [supplier.id]);

  const mapOne = async (row) => {
    if (!row.best) return;
    setMapped((m) => ({ ...m, [row.productId]: 'saving' }));
    try {
      await api.post(`/api/admin/suppliers/${supplier.id}/products`, {
        productId: row.productId,
        supplierSku: row.best.supplierSku,
        supplierUrl: row.best.url || undefined,
        cost: row.best.cost,
        priority: 10,
      });
      setMapped((m) => ({ ...m, [row.productId]: 'done' }));
      onMapped?.();
    } catch (e) {
      setMapped((m) => ({ ...m, [row.productId]: e?.message || 'failed' }));
    }
  };

  const done = rows.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const good = rows.filter((r) => r.verdict === 'profitable');
  const avg = good.length
    ? Math.round((good.reduce((a, r) => a + r.marginPct, 0) / good.length) * 10) / 10 : null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={busy ? () => { stop.current = true; } : run} className="btn-ghost text-xs">
          {busy ? <><Loader2 size={13} className="animate-spin" /> Stop</>
            : <><Search size={13} /> Scan the whole catalogue</>}
        </button>
        {busy && <span className="text-slate-400 text-xs">{done} of {total} · {pct}%</span>}
        {!busy && done > 0 && (
          <span className="text-slate-300 text-xs">
            <b className="text-emerald-300">{good.length}</b> of {done} can be sourced
            {avg != null && ` · ${avg}% average margin`}
          </span>
        )}
      </div>
      {err && <p className="text-amber-300 text-xs mt-2">{err}</p>}

      {busy && (
        <div className="h-1 rounded-full bg-white/10 mt-3 overflow-hidden">
          <div className="h-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="card mt-3 max-h-[28rem] overflow-y-auto divide-y divide-white/5">
          {rows.map((r) => {
            const s = STYLE[r.verdict] || STYLE.not_found;
            const state = mapped[r.productId];
            return (
              <div key={r.productId} className="px-3 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-slate-200 text-sm truncate">
                    {r.name} <span className="text-slate-400">· {money(r.priceCents, 'EUR')}</span>
                  </div>
                  {/* The supplier's OWN title, not ours — the only way to see
                      that a "Robux" search found a gift card. */}
                  {r.best ? (
                    <div className="text-xs text-slate-400 mt-0.5 truncate">
                      → {r.best.name} <span className="font-mono">#{r.best.supplierSku}</span>
                      {r.best.region && ` · ${r.best.region}`}
                      {' · '}{money(r.best.cost, 'EUR')}
                      <span className={`${s.cls} ml-1`}>· {s.label}</span>
                      {r.marginPct != null && <span className={s.cls}> ({r.marginPct}%)</span>}
                    </div>
                  ) : (
                    /* Every term that was tried, not just the first. Showing
                       one of three reads as "we barely looked", and the whole
                       point of the fallback is that the shop's own product name
                       is usually not what the supplier calls it. */
                    <div className={`text-xs mt-0.5 ${s.cls}`}>
                      {s.label} — searched {(r.tried || [r.searchedFor]).map((t) => `“${t}”`).join(', ')}
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  {r.verdict === 'profitable' && (
                    state === 'done'
                      ? <span className="text-emerald-300 text-xs inline-flex items-center gap-1"><Check size={13} /> mapped</span>
                      : state === 'saving'
                        ? <Loader2 size={13} className="animate-spin text-slate-400" />
                        : <button onClick={() => mapOne(r)} className="btn-ghost text-xs">Map</button>
                  )}
                  {state && state !== 'done' && state !== 'saving'
                    && <span className="text-red-300 text-xs">{state}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && !busy && (
        <p className="text-slate-400 text-xs mt-2 flex items-start gap-1.5">
          <Euro size={12} className="mt-0.5 shrink-0" />
          Matched on name, so check the supplier’s title and region before mapping —
          a wrong match sells somebody a product they did not order.
        </p>
      )}
    </div>
  );
}
