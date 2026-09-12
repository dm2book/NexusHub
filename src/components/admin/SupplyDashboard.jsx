import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, HelpCircle, Info, PackageX, Boxes } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';

/**
 * Supply, seen from the product rather than from the supplier.
 *
 * Two rules this component does not bend:
 *
 *  1. NULL RENDERS AS "—", NEVER AS €0.00 OR 0. A cost nobody entered and a
 *     free product are different facts; a supplier that has never reported its
 *     stock and a supplier that is empty are different facts. The admin product
 *     table renders a null `products.stock` as "∞", which is how a shop holding
 *     no deliverable codes reads as infinitely in stock. Not here.
 *
 *  2. THE PALETTE IS THE DARK ONE. `theme-light` is applied by StoreLayout, not
 *     by the admin shell, so `.card` here is #101019 and `text-slate-900` on it
 *     measures 1.06:1 — text that is present in the DOM and invisible on the
 *     screen. Body copy is slate-300/400 (7.4:1), headings white (18.9:1).
 */

const eur = (c) => (c == null ? '—' : money(c, 'EUR'));
const int = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

const SEV = {
  critical: { cls: 'bg-red-500/10 border-red-500/25 text-red-300', Icon: PackageX },
  warn: { cls: 'bg-amber-500/10 border-amber-500/25 text-amber-300', Icon: AlertTriangle },
  info: { cls: 'bg-slate-500/10 border-white/10 text-slate-300', Icon: Info },
};

function Stat({ label, value, sub }) {
  return (
    <div className="card p-5">
      <div className="text-slate-400 text-sm">{label}</div>
      <div className="text-3xl font-display gradient-text mt-1">{value}</div>
      {sub && <div className="text-slate-400 text-xs mt-1">{sub}</div>}
    </div>
  );
}

export default function SupplyDashboard() {
  const [d, setD] = useState(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    api.get('/api/admin/suppliers/dashboard').then(setD).catch(() => setD(false));
  }, []);

  const flagged = useMemo(() => {
    if (!d) return new Set();
    return new Set((d.warnings || []).map((w) => w.productId));
  }, [d]);

  /* This panel is embedded in the supplier MANAGEMENT page, so it must never
     be the reason that page fails to render. A stale bundle against a newer
     server (or the reverse) hands it a payload missing a field, and reading
     `.length` off that undefined took the whole route down — no supplier list,
     no sync buttons, a blank screen. Caught by loading the page, not by
     reading it. Missing pieces degrade to empty here. */
  if (!d || !d.totals || !Array.isArray(d.products)) return null;

  const t = d.totals;
  const groups = Array.isArray(d.warningGroups) ? d.warningGroups : [];
  const cov = t.stockValueCoverage || { counted: 0, total: 0 };
  const rows = d.products.filter((p) => p.active);
  /* Default to the products the shop actually HAS supply for.
     Loading this page showed why: filtering to "anything with a warning" put 40
     rows on screen reading `none · — · 0 · — · never synced`, one per product
     with no supplier and no codes — the same list the grouped warning above
     already states in one line. The rows that carry information are the ones
     with a supplier or a shelf; the rest are a count, not a table. */
  const managed = rows.filter((p) => p.supplierCount > 0 || p.codeStock > 0);
  const shown = all ? rows : managed;
  const hidden = rows.length - managed.length;

  return (
    <div className="mb-10">
      <h2 className="text-lg text-white flex items-center gap-2 mb-1">
        <Boxes size={18} className="text-indigo-400" /> Supply
      </h2>
      <p className="text-slate-400 text-sm mb-4">
        What each product costs, who supplies it and how much is on the shelf.
        {' '}Stock means pre-loaded codes — the only stock orders are delivered from automatically.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Products with a supplier" value={`${t.withSupplier}/${t.activeProducts}`}
          sub={`${t.suppliers} supplier(s), ${t.activeSuppliers} active`} />
        <Stat label="Products with a cost" value={`${t.withCost}/${t.activeProducts}`}
          sub={t.withCost === 0 ? 'profit and pricing need this' : 'used for profit and pricing'} />
        <Stat label="Codes in stock" value={int(t.codeUnits)}
          sub={`${t.withCodes} of ${t.activeProducts} product(s) can auto-deliver`} />
        {/* Coverage sits under the number on purpose: an inventory value over 2
            of 40 mappings is not an inventory value, and saying so is cheaper
            than being believed. */}
        <Stat label="Supplier stock value" value={eur(t.stockValueCents)}
          sub={cov.total === 0
            ? 'no supplier mappings yet'
            : `${cov.counted} of ${cov.total} mapping(s) have both a cost and a stock count`} />
      </div>

      {/* Grouped, not one row per product. Seeded with this shop's catalogue the
          ungrouped list was 124 rows across 72 products, 116 of them the same
          two sentences — a page nobody reads twice. */}
      {groups.length > 0 && (
        <div className="space-y-1.5 mb-6">
          {groups.map((w) => {
            const s = SEV[w.severity] || SEV.info;
            return (
              <div key={`${w.code}-${w.productId || 'all'}`}
                className={`border rounded-xl px-3 py-2 text-sm flex items-start gap-2 ${s.cls}`}>
                <s.Icon size={14} className="mt-0.5 shrink-0" />
                <span>
                  {w.count === 1
                    ? <><span className="font-medium">{w.names[0]}</span> — {w.detail}</>
                    : <>{w.detail}{' '}
                      <span className="opacity-70">
                        {w.names.join(', ')}{w.count > w.names.length && ` +${w.count - w.names.length} more`}
                      </span></>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-slate-400 text-left">
            <tr className="border-b border-white/5">
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
              <th className="px-4 py-3 font-medium">Cost</th>
              <th className="px-4 py-3 font-medium">Codes</th>
              <th className="px-4 py-3 font-medium">Supplier stock</th>
              <th className="px-4 py-3 font-medium">Last update</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.productId} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-2.5 text-slate-200">
                  {p.name}
                  {p.costFulfilSplit && (
                    <span className="ml-2 text-[11px] text-amber-300"
                      title="The cheapest supplier is out of stock, so the order would be filled by a different one — the margin shown is not the margin you would get.">
                      cost ≠ fulfiller
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {p.supplier
                    ? (
                      <span className={p.supplier.status === 'active' ? 'text-slate-300' : 'text-amber-300'}>
                        {p.supplier.name}
                        {p.supplier.status !== 'active' && ` (${p.supplier.status})`}
                      </span>
                    )
                    : <span className="text-slate-500 inline-flex items-center gap-1"><HelpCircle size={11} /> none</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-300">
                  {eur(p.costCents)}
                  {p.costSource === 'manual' && <span className="ml-1.5 text-[11px] text-slate-500">entered by hand</span>}
                </td>
                <td className={`px-4 py-2.5 ${p.codeStock === 0 ? 'text-slate-500' : 'text-slate-300'}`}>
                  {int(p.codeStock)}
                </td>
                {/* null, not 0: "never told us" is not "has none". */}
                <td className="px-4 py-2.5 text-slate-300">{int(p.supplierStock)}</td>
                <td className="px-4 py-2.5 text-slate-400">
                  {p.lastSyncAt ? date(p.lastSyncAt) : <span className="text-slate-500">never synced</span>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-slate-400 text-center">
                No product has a supplier or codes yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button onClick={() => setAll((v) => !v)} className="btn-ghost text-xs">
          {all ? `Show only the ${managed.length} with supply` : `Show all ${rows.length} active products`}
        </button>
        {!all && hidden > 0 && (
          <span className="text-slate-400 text-xs">
            {hidden} active product(s) with no supplier and no codes are not listed — they are counted in the warning above.
          </span>
        )}
      </div>
    </div>
  );
}
