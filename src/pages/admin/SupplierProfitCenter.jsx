import { Fragment, useCallback, useEffect, useState } from 'react';
import { Scale, Search, Info, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader } from '../../components/ui.jsx';

/**
 * Supplier Profit Center.
 *
 * Per product, Kinguin, G2A, Eneba and Eldorado side by side: what each would
 * leave the shop after 21% BTW and the Stripe fee, and which one wins on
 * profit, on price and on stock. A price comes from a supplier you connected,
 * or from a listing observed through the marketplace's API (with link and
 * time) — or it is not shown. Click a product for the full sum per source.
 */
const money = (c) => (c == null ? '—' : `${c < 0 ? '−' : ''}€${(Math.abs(c) / 100).toFixed(2)}`);
const BADGE = {
  bestProfit: { label: 'BEST PROFIT', cls: 'text-emerald-300 bg-emerald-500/10' },
  bestPrice: { label: 'BEST PRICE', cls: 'text-sky-300 bg-sky-500/10' },
  bestStock: { label: 'BEST STOCK', cls: 'text-violet-300 bg-violet-500/10' },
};
const BASIS = { supplier: 'your supplier', listing: 'listing' };
const ago = (iso) => {
  if (!iso) return '';
  const h = Math.round((Date.now() - new Date(iso)) / 3600_000);
  return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export default function SupplierProfitCenter() {
  const [f, setF] = useState({ q: '', only: '' });
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api.get(`/api/admin/suppliers/profit-center?${qs}`).then(setData).catch(() => setData(false));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load, f.q]);

  if (data === null) return <PageLoader />;
  if (data === false) return <p className="text-slate-400">Could not load the profit center.</p>;
  const s = data.summary;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div>
      <h1 className="text-2xl text-white flex items-center gap-2 mb-2"><Scale size={22} className="text-violet-300" /> Supplier Profit Center</h1>
      <p className="text-slate-400 text-sm mb-5 max-w-3xl">
        Netto winst = verkoopprijs − inkoop − {data.vat.pct}% BTW − Stripe ({data.fees.stripePercent}% of the full price
        + {money(data.fees.stripeFixedCents)}){data.fees.otherPercent || data.fees.fulfilmentCents ? ' − other costs' : ''}.
        Prices come from a supplier you connected or a listing seen through the marketplace&rsquo;s API in the last 7 days — never an estimate.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Products with a price" value={`${s.priced} / ${s.products}`} />
        <Stat label="Could earn more" value={s.withGain}
          sub={s.withGain ? `${money(s.gainPerSaleTotalCents)} more per sale, summed` : 'every product is on its best source'} />
        <Stat label="Loss even at the best source" value={s.lossMaking} sub={s.lossMaking ? 'reprice or hide these' : ''} />
        <Stat label="Marketplaces" value={data.marketplaces.map((m) => `${m.label} ${m.products}`).join(' · ')}
          sub="products with a price, per marketplace" />
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400 flex-1 min-w-48">Search
          <div className="relative mt-1">
            <Search size={14} className="absolute left-3 top-3 text-slate-500" />
            <input value={f.q} onChange={set('q')} placeholder="product" name="q"
              className="w-full rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm h-10 pl-8 pr-3" />
          </div>
        </label>
        <label className="text-xs text-slate-400">Show
          <select value={f.only} onChange={set('only')} name="only"
            className="block mt-1 rounded-xl bg-white/5 border border-white/10 text-slate-200 text-sm h-10 px-3">
            <option value="">All products</option>
            <option value="priced">With a price somewhere</option>
            <option value="gain">Could earn more elsewhere</option>
            <option value="loss">Loss at every source</option>
          </select>
        </label>
      </div>

      {data.products.length === 0 ? (
        <p className="text-slate-500 text-sm card p-5">No product matches.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[12.5px]" style={{ minWidth: 980 }}>
            <thead className="text-slate-400 text-[11px]">
              <tr className="border-b border-white/5">
                <th className="text-left px-4 py-2 font-normal">Product</th>
                {data.marketplaces.map((m) => <th key={m.key} className="text-left px-3 py-2 font-normal">{m.label}</th>)}
                <th className="text-right px-4 py-2 font-normal">Switch gain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.products.map((p) => (
                <Fragment key={p.productId}>
                  <tr className="align-top hover:bg-white/5 cursor-pointer" data-testid="profit-row"
                    onClick={() => setOpen(open === p.productId ? null : p.productId)}>
                    <td className="px-4 py-2.5">
                      <div className="text-white flex items-center gap-1">
                        <ChevronDown size={13} className={`text-slate-500 transition ${open === p.productId ? '' : '-rotate-90'}`} />{p.name}
                      </div>
                      <div className="text-[11px] text-slate-500">sells at {money(p.priceCents)}
                        {p.current && ` · now from ${p.current.supplierName}`}</div>
                    </td>
                    {p.offers.map((o) => <Cell key={o.key} o={o} p={p} />)}
                    <td className="px-4 py-2.5 text-right">
                      {p.gainPerSaleCents > 0
                        ? <span className="text-emerald-300">+{money(p.gainPerSaleCents)}<div className="text-[11px] text-slate-500">per sale</div></span>
                        : <span className="text-slate-500">—</span>}
                    </td>
                  </tr>
                  {open === p.productId && (
                    <tr><td colSpan={6} className="px-4 pb-4"><Breakdown p={p} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-500 mt-4 flex gap-2 max-w-3xl">
        <Info size={13} className="shrink-0 mt-0.5" />
        <span>BEST PROFIT is the highest netto winst among sources in stock. BEST PRICE is the lowest purchase price
          anywhere, even if it is sold out right now. BEST STOCK is the most units reported — only a connected
          supplier reports a quantity. A listing is a marketplace&rsquo;s retail offer; to buy from it automatically,
          connect that marketplace as a supplier.</span>
      </p>
    </div>
  );
}

function Cell({ o, p }) {
  if (o.basis === 'none') {
    return <td className="px-3 py-2.5 text-slate-500" title={o.reason}>not available</td>;
  }
  const badges = Object.keys(BADGE).filter((k) => p[k] === o.key);
  return (
    <td className="px-3 py-2.5" data-testid={`cell-${o.key}`}>
      <div className={o.netProfitCents < 0 ? 'text-red-300' : 'text-emerald-300'}>
        {money(o.netProfitCents)} <span className="text-slate-500 text-[11px]">{o.marginPct}%</span>
      </div>
      <div className="text-[11px] text-slate-400">buy {money(o.costCents)} · {BASIS[o.basis]}</div>
      <div className={`text-[11px] ${o.inStock ? 'text-slate-500' : 'text-amber-300'}`}>
        {o.inStock ? (o.stock != null ? `${o.stock} in stock` : 'in stock') : (o.status || 'out of stock').replace(/_/g, ' ')}
      </div>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {badges.map((k) => <span key={k} className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${BADGE[k].cls}`}>{BADGE[k].label}</span>)}
        </div>
      )}
    </td>
  );
}

/** The whole sum per source, so every netto winst can be checked by hand. */
function Breakdown({ p }) {
  const priced = p.offers.filter((o) => o.basis !== 'none');
  if (!priced.length) {
    return <p className="text-slate-500 text-[12px] pt-1">No price at any of the four. {p.reasons.bestPrice}.</p>;
  }
  const lines = [
    ['Verkoopprijs', (o) => o.priceCents], ['− Inkoop', (o) => -o.costCents], ['= Winst', (o) => o.profitCents, true],
    ['− BTW', (o) => -o.vatCents], ['− Stripe', (o) => -o.stripeCents],
    ...(priced.some((o) => o.otherCostsCents) ? [['− Other costs', (o) => -o.otherCostsCents]] : []),
    ['= Netto winst', (o) => o.netProfitCents, true], ['Marge', null],
  ];
  return (
    <div className="rounded-xl border border-white/10 p-3 bg-white/5">
      <table className="text-[12px]">
        <thead><tr>
          <th />
          {priced.map((o) => <th key={o.key} className="text-right font-normal text-slate-400 px-3">{o.label}</th>)}
        </tr></thead>
        <tbody>
          {lines.map(([label, fn, strong]) => (
            <tr key={label}>
              <td className={`pr-4 ${strong ? 'text-white' : 'text-slate-400'}`}>{label}</td>
              {priced.map((o) => (
                <td key={o.key} className={`text-right px-3 tabular-nums ${strong ? 'text-white font-semibold' : 'text-slate-300'}`}>
                  {fn ? money(fn(o)) : `${o.marginPct}%`}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td className="pr-4 text-slate-500">Source</td>
            {priced.map((o) => (
              <td key={o.key} className="text-right px-3 text-[11px] text-slate-500">
                {o.basis === 'supplier' ? o.supplierName : 'listing'}{o.observedAt ? ` · ${ago(o.observedAt)}` : ''}
                {o.url && <> · <a href={o.url} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline"
                  onClick={(e) => e.stopPropagation()}>link</a></>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {p.offers.filter((o) => o.basis === 'none').map((o) => (
        <p key={o.key} className="text-[11px] text-slate-500 mt-2">{o.label}: {o.reason}.</p>
      ))}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="card p-4">
      <div className="text-slate-400 text-xs">{label}</div>
      <div className="text-white text-lg font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
