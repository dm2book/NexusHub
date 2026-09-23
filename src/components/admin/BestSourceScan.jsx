import { useCallback, useRef, useState } from 'react';
import { Search, Loader2, Check, AlertTriangle, CircleSlash, Sparkles } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * Every supplier, every product: the cheapest place to buy each one, and one
 * button to map all the ones that can be mapped safely.
 *
 * The per-supplier scan further down answers the question for ONE supplier,
 * and maps a row at a time. With several suppliers that meant a scan each,
 * comparing tables by eye, and seventy clicks. This asks every active supplier
 * at once and keeps the most profitable listing per product.
 *
 * ── WHAT THE BUTTON MAPS ──────────────────────────────────────────────────
 * Only "ready" rows: the amount in our product name is in the supplier's
 * title, the region sells to a Dutch buyer, it is in stock, and it clears the
 * minimum margin AFTER BTW. A mapped product is bought automatically when an
 * order arrives, so everything the server could not check goes to a person,
 * with the reason on the row. Products you already mapped are never touched by
 * the button.
 *
 * Mapping also sets the cost price: a supplier mapping is what the shop reads
 * its purchase cost from first, so the margins everywhere else fill in too.
 */

const BATCH = 4;

const STYLE = {
  ready: { cls: 'text-emerald-300', Icon: Check, label: 'ready to map' },
  thin: { cls: 'text-amber-300', Icon: AlertTriangle, label: 'profitable, under your minimum margin' },
  loss: { cls: 'text-red-300', Icon: AlertTriangle, label: 'loses money after BTW' },
  out_of_stock: { cls: 'text-amber-300', Icon: AlertTriangle, label: 'right listing, none in stock' },
  check: { cls: 'text-amber-300', Icon: AlertTriangle, label: 'found, check it yourself' },
  not_found: { cls: 'text-slate-400', Icon: CircleSlash, label: 'no supplier carries it' },
  no_price: { cls: 'text-slate-400', Icon: CircleSlash, label: 'your product has no price' },
};

const pickOf = (r) => ({
  productId: r.productId,
  supplierId: r.best.supplierId, supplierSku: r.best.supplierSku,
  supplierUrl: r.best.url || null, cost: r.best.cost,
  fallback: r.fallback ? {
    supplierId: r.fallback.supplierId, supplierSku: r.fallback.supplierSku,
    supplierUrl: r.fallback.url || null, cost: r.fallback.cost,
  } : null,
});

export default function BestSourceScan({ onMapped }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [sources, setSources] = useState(null);
  const [vat, setVat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState({});          // productId → true once mapped here
  const stop = useRef(false);

  const run = useCallback(async () => {
    setBusy(true); setErr(''); setRows([]); setDone({}); stop.current = false;
    try {
      const t = await api.get('/api/admin/suppliers/best/targets');
      setSources(t.suppliers);
      if (!t.suppliers.length) return;
      setTotal(t.products.length);
      for (let i = 0; i < t.products.length; i += BATCH) {
        if (stop.current) break;
        // eslint-disable-next-line no-await-in-loop -- one batch at a time is the point
        const r = await api.post('/api/admin/suppliers/best/scan', {
          productIds: t.products.slice(i, i + BATCH).map((p) => p.id),
        });
        setVat(r.vat);
        setRows((prev) => [...prev, ...(r.results || [])]);
      }
    } catch (e) {
      setErr(e?.message || 'Scan failed');
    } finally {
      setBusy(false);
    }
  }, []);

  const map = async (list, { replace = false } = {}) => {
    if (!list.length) return;
    setSaving(true);
    try {
      const r = await api.post('/api/admin/suppliers/best/map', { picks: list.map(pickOf), replace });
      const skipped = new Set((r.skipped || []).map((s) => s.productId));
      setDone((d) => ({ ...d, ...Object.fromEntries(list.filter((x) => !skipped.has(x.productId)).map((x) => [x.productId, true])) }));
      toast.success(`${r.mapped} product(s) mapped${r.skipped?.length ? ` · ${r.skipped.length} skipped` : ''}.`);
      onMapped?.();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const ready = rows.filter((r) => r.verdict === 'ready' && !r.mapped && !done[r.productId]);
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const alreadyMapped = rows.filter((r) => r.mapped || done[r.productId]).length;
  const pct = total ? Math.round((rows.length / total) * 100) : 0;

  const mapAll = () => {
    /* A confirmation, because this buys automatically from now on. It says
       how many and that nothing mapped by hand is touched. */
    if (!window.confirm(`Map ${ready.length} product(s) to their cheapest safe supplier?\n\n`
      + 'Orders for them will be bought from that supplier automatically. '
      + 'Products you already mapped are left as they are.')) return;
    map(ready);
  };

  return (
    <div className="card p-5 mb-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white text-sm font-semibold flex items-center gap-2">
            <Sparkles size={15} className="text-violet-300" /> Best source for every product
          </h3>
          <p className="text-slate-400 text-xs mt-1 max-w-2xl">
            Asks every active supplier for every product, keeps the most profitable listing and a
            fallback from another supplier. Mapping sets the product&rsquo;s cost price too.
          </p>
        </div>
        <button onClick={busy ? () => { stop.current = true; } : run} className="btn-ghost text-xs">
          {busy ? <><Loader2 size={13} className="animate-spin" /> Stop</>
            : <><Search size={13} /> Scan all suppliers</>}
        </button>
      </div>

      {err && <p className="text-amber-300 text-xs mt-3">{err}</p>}

      {/* No supplier is not "nothing found". Saying which it is. */}
      {sources && !sources.length && (
        <p className="text-amber-300 text-xs mt-3">
          No active supplier to ask yet. Add one below with its API key (Kinguin, G2A, Eldorado),
          or upload a CSV price list as a supplier.
        </p>
      )}

      {busy && (
        <>
          <p className="text-slate-400 text-xs mt-3">
            {rows.length} of {total} products · {sources?.length || 0} supplier(s) · {pct}%
          </p>
          <div className="h-1 rounded-full bg-white/10 mt-2 overflow-hidden">
            <div className="h-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap mt-4">
            <span className="text-xs text-slate-300">
              {/* The same number as the button. Counting already-mapped rows here
                  read "6 ready" beside "Map all 5", which looks like one got lost. */}
              <b className="text-emerald-300">{ready.length}</b> ready
              {alreadyMapped > 0 && <> · {alreadyMapped} already mapped</>}
              {count('thin') > 0 && <> · <b className="text-amber-300">{count('thin')}</b> thin</>}
              {count('loss') > 0 && <> · <b className="text-red-300">{count('loss')}</b> at a loss</>}
              {count('check') > 0 && <> · {count('check')} to check</>}
              {count('out_of_stock') > 0 && <> · {count('out_of_stock')} out of stock</>}
              {count('not_found') > 0 && <> · {count('not_found')} not carried</>}
            </span>
            {!busy && (
              <button onClick={mapAll} disabled={saving || !ready.length}
                className="btn-primary text-xs disabled:opacity-40">
                {saving ? 'Mapping…' : `Map all ${ready.length} ready`}
              </button>
            )}
          </div>
          {vat && (
            <p className="text-slate-500 text-[11px] mt-1">
              Profit is after {vat.pct}% BTW and payment fees{vat.registered ? '' : ' — the rate you will charge once registered'}.
            </p>
          )}

          <div className="rounded-xl border border-white/10 mt-3 max-h-[30rem] overflow-y-auto divide-y divide-white/5">
            {rows.map((r) => {
              const s = STYLE[r.verdict] || STYLE.not_found;
              const b = r.best;
              const isDone = r.mapped || done[r.productId];
              return (
                <div key={r.productId} className="px-3 py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-slate-200 text-sm truncate">
                      {r.name} <span className="text-slate-400">· {money(r.priceCents, 'EUR')}</span>
                    </div>
                    {b ? (
                      <div className="text-xs text-slate-400 mt-0.5">
                        {/* The supplier's own title and region: the only way to see
                            that a "Robux" search found a gift card. */}
                        <span className="text-slate-300">{b.supplierName}</span> → {b.title}
                        {b.region && ` · ${b.region}`} · {money(b.cost, 'EUR')}
                        {b.profitCents != null && (
                          <span className={s.cls}> · {b.profitCents >= 0 ? '+' : ''}{money(b.profitCents, 'EUR')} ({Math.round(b.marginPct)}%)</span>
                        )}
                        {r.fallback && (
                          <span className="text-slate-500"> · fallback {r.fallback.supplierName} {money(r.fallback.cost, 'EUR')}</span>
                        )}
                      </div>
                    ) : null}
                    <div className={`text-xs mt-0.5 ${s.cls}`}>
                      {/* Once mapped here the verdict is history; "ready to map" beside a
                          tick reads as if the click did not take. */}
                      {done[r.productId] && !r.mapped ? `mapped to ${b.supplierName}` : s.label}
                      {!done[r.productId] && b?.reasons?.length ? ` — ${b.reasons.join('; ')}` : ''}
                      {r.mapped && r.current && (
                        <span className="text-slate-500"> · already mapped to {r.current.supplierName}
                          {r.current.cost != null && ` at ${money(r.current.cost, 'EUR')}`}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isDone && !r.mapped
                      ? <span className="text-emerald-300 text-xs inline-flex items-center gap-1"><Check size={13} /> mapped</span>
                      : r.verdict === 'ready' && (
                        <button onClick={() => map([r], { replace: r.mapped })} disabled={saving}
                          className="btn-ghost text-xs disabled:opacity-40">
                          {r.mapped ? 'Switch' : 'Map'}
                        </button>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
