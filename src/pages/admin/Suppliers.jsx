import { useEffect, useState } from 'react';
import { Truck, Plus, RefreshCw, Plug, Link2, Search } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date, money } from '../../lib/format.js';
import { PageLoader, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import SupplyDashboard from '../../components/admin/SupplyDashboard.jsx';
import CatalogScan from '../../components/admin/CatalogScan.jsx';

const KIND_HINT = {
  api: 'config: { baseUrl, auth:{type,token}, endpoints:{catalog,fulfill,status}, fieldMap }',
  csv: 'config: { source:{type:"url"|"inline",url,content}, columns:{sku,name,price,stock,status} }',
  manual: 'No connection — catalog curated in-app, fulfillment routed to the manual queue.',
  /* One supplier row, two jobs. These credentials are also what Market →
     Sources reads to turn competitor price discovery on: without a row here
     that source reports UNAVAILABLE with the reason, which is deliberate — it
     is the difference between "nobody sells this" and "we are not allowed to
     ask". See server/src/services/market/sources.js. */
  eldorado: 'Eldorado.gg has no public BUYER API — you cannot auto-buy others’ listings. '
    + 'config: { apiKey, autoDeliver }. The same apiKey enables Eldorado as a price-discovery source under Market.',
  kinguin: 'Real auto-buy: config: { apiKey:"<kinguin key>", autoDeliver:true }. Map product → kinguinId; paid orders are purchased & keys delivered automatically.',
  g2a: 'Real auto-buy: config: { apiHash, email, apiKey, currency:"EUR", autoDeliver:true }. '
    + 'Map product → G2A product_id; buy price is capped at your cost. '
    + 'The same three credentials enable G2A as a price-discovery source under Market.',
};

const fmtSecs = (s) => (s == null ? '—' : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);
const relColor = (r) => (r == null ? 'text-slate-400' : r >= 95 ? 'text-emerald-300' : r >= 80 ? 'text-amber-300' : 'text-red-300');

export default function Suppliers() {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', connectorKind: 'api', config: '{\n  \n}' });
  const [busy, setBusy] = useState(false);
  // Product-mapping modal state
  const [mapFor, setMapFor] = useState(null);      // supplier being mapped
  const [products, setProducts] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [mapForm, setMapForm] = useState({ productId: '', supplierSku: '', supplierUrl: '', costEuro: '', priority: '100' });
  // Catalogue picker: search the supplier instead of hunting for an id by hand.
  const [search, setSearch] = useState({ q: '', results: [], busy: false, err: '', ran: false, serverSide: false, searchedFor: '' });

  const load = () => {
    api.get('/api/admin/suppliers').then((r) => setSuppliers(r.suppliers)).catch(() => setSuppliers([]));
    api.get('/api/admin/suppliers/metrics').then((r) => setMetrics(r.metrics || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const metricFor = (id) => metrics.find((m) => m.id === id);
  if (!suppliers) return <PageLoader />;

  const create = async () => {
    setBusy(true);
    try {
      let config = {};
      try { config = JSON.parse(form.config || '{}'); }
      catch { toast.error('Config must be valid JSON'); setBusy(false); return; }
      await api.post('/api/admin/suppliers', { name: form.name, connectorKind: form.connectorKind, config });
      toast.success('Supplier created.');
      setOpen(false); setForm({ name: '', connectorKind: 'api', config: '{\n  \n}' }); load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const sync = async (s) => {
    try { const { run } = await api.post(`/api/admin/suppliers/${s.id}/sync`, { type: 'full' });
      toast[run.status === 'success' ? 'success' : 'error'](`Sync ${run.status}: ${run.items_processed} items`); load(); }
    catch (err) { toast.error(err.message); }
  };
  const test = async (s) => {
    try { const r = await api.post(`/api/admin/suppliers/${s.id}/test`);
      toast[r.ok ? 'success' : 'error'](r.ok ? 'Connection OK' : `Failed: ${r.detail}`); }
    catch (err) { toast.error(err.message); }
  };

  const openMap = async (s) => {
    setMapFor(s); setMapForm({ productId: '', supplierSku: '', supplierUrl: '', costEuro: '', priority: '100' });
    setSearch({ q: '', results: [], busy: false, err: '', ran: false, serverSide: false, searchedFor: '' });
    if (!products.length) api.get('/api/admin/products').then((r) => setProducts(r.products || [])).catch(() => {});
    api.get(`/api/admin/suppliers/${s.id}/products`).then((r) => setMappings(r.mappings || [])).catch(() => setMappings([]));
  };
  /* The picker. Mapping used to ask for a supplier SKU — for Kinguin a numeric
     kinguinId — that could not be looked up anywhere in this admin, so the only
     way to fill it was to go hunting on their site and retype a number, once
     per product, with a chance each time of pointing a product at the wrong
     listing and selling somebody the wrong thing. */
  const runSearch = async (q, productId) => {
    const term = (q || '').trim();
    if (term.length < 3) {
      setSearch((v) => ({ ...v, results: [], ran: false, err: '' }));
      return;
    }
    setSearch((v) => ({ ...v, busy: true, err: '' }));
    try {
      const params = new URLSearchParams({ q: term });
      if (productId) params.set('productId', productId);
      const r = await api.get(`/api/admin/suppliers/${mapFor.id}/search?${params}`);
      setSearch((v) => ({
        ...v, busy: false, ran: true, results: r.results || [],
        serverSide: !!r.serverSide, searchedFor: r.searchedFor || term,
      }));
    } catch (err) {
      setSearch((v) => ({ ...v, busy: false, ran: true, results: [], err: err.message }));
    }
  };

  /* Picking a product searches for it immediately, so the common path is
     "choose product → click the right listing" with nothing typed at all. */
  const pickProduct = (productId) => {
    setMapForm((f) => ({ ...f, productId, supplierSku: '', costEuro: '', supplierUrl: '' }));
    const p = products.find((x) => x.id === productId);
    const q = p?.name || '';
    setSearch((v) => ({ ...v, q }));
    if (productId) runSearch(q, productId);
  };

  /** One click fills everything the mapping needs. */
  const useResult = (r) => {
    setMapForm((f) => ({
      ...f,
      supplierSku: r.supplierSku,
      costEuro: r.cost != null ? (r.cost / 100).toFixed(2) : '',
      supplierUrl: r.url || '',
    }));
  };

  const addMapping = async () => {
    if (!mapForm.productId || !mapForm.supplierSku.trim()) { toast.error('Pick a product and enter the supplier SKU/ID.'); return; }
    setBusy(true);
    try {
      await api.post(`/api/admin/suppliers/${mapFor.id}/products`, {
        productId: mapForm.productId, supplierSku: mapForm.supplierSku.trim(),
        supplierUrl: mapForm.supplierUrl.trim() || undefined,
        cost: mapForm.costEuro === '' ? undefined : Math.round(parseFloat(mapForm.costEuro) * 100),
        priority: Number(mapForm.priority) || 100,
      });
      toast.success('Product mapped — paid orders for it are auto-sourced, one at a time.');
      setMapForm({ ...mapForm, supplierSku: '', supplierUrl: '', costEuro: '' });
      const r = await api.get(`/api/admin/suppliers/${mapFor.id}/products`); setMappings(r.mappings || []);
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl text-white">Suppliers</h1>
        <button onClick={() => setOpen(true)} className="btn-primary text-sm"><Plus size={16} /> Add supplier</button>
      </div>
      <p className="text-slate-400 text-sm mb-6">
        Connector-based integration layer — API, CSV, Eldorado and manual suppliers. No suppliers are hardcoded.
      </p>

      {/* Supply, product-first: the view that shows a product NO supplier
          covers, which by definition appears on no supplier's card below. */}
      <SupplyDashboard />

      {/* Performance dashboard */}
      {metrics.length > 0 && (() => {
        const withRel = metrics.filter((m) => m.reliability != null);
        const avgRel = withRel.length ? Math.round(withRel.reduce((a, m) => a + m.reliability, 0) / withRel.length) : null;
        const withMargin = metrics.filter((m) => m.avgMargin != null);
        const avgMargin = withMargin.length ? Math.round(withMargin.reduce((a, m) => a + m.avgMargin, 0) / withMargin.length) : null;
        const withSpeed = metrics.filter((m) => m.avgFulfillSeconds != null);
        const avgSpeed = withSpeed.length ? Math.round(withSpeed.reduce((a, m) => a + m.avgFulfillSeconds, 0) / withSpeed.length) : null;
        const fulfilled = metrics.reduce((a, m) => a + m.fulfilled, 0);
        const cards = [
          ['Avg reliability', avgRel == null ? '—' : `${avgRel}%`],
          ['Avg margin', avgMargin == null ? '—' : `${avgMargin}%`],
          ['Avg fulfil speed', fmtSecs(avgSpeed)],
          ['Orders fulfilled', fulfilled.toLocaleString('en-US')],
        ];
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {cards.map(([label, value]) => (
              <div key={label} className="card p-5">
                <div className="text-slate-400 text-sm">{label}</div>
                <div className="text-3xl font-display gradient-text mt-1">{value}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="No suppliers configured"
          action={<button onClick={() => setOpen(true)} className="btn-primary">Add supplier</button>} />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {suppliers.map((s) => (
            <div key={s.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-white">{s.name}</h3>
                  <span className="text-xs uppercase tracking-wider text-indigo-400 font-rajdhani">{s.connector_kind}</span>
                </div>
                <span className={`text-xs px-2 py-1 rounded-md ${s.status === 'active'
                  ? 'bg-emerald-500/15 text-emerald-300' : s.status === 'error'
                  ? 'bg-red-500/15 text-red-300' : 'bg-slate-500/15 text-slate-300'}`}>{s.status}</span>
              </div>
              {(() => {
                const m = metricFor(s.id);
                if (!m) return null;
                return (
                  <div className="grid grid-cols-4 gap-2 mt-4 text-center">
                    <Metric label="Reliability" value={m.reliability == null ? '—' : `${m.reliability}%`} className={relColor(m.reliability)} />
                    <Metric label="Margin" value={m.avgMargin == null ? '—' : `${m.avgMargin}%`} />
                    <Metric label="Speed" value={fmtSecs(m.avgFulfillSeconds)} />
                    <Metric label="Products" value={m.products} />
                  </div>
                );
              })()}
              <div className="text-slate-500 text-xs mt-3">
                Last sync: {s.last_sync_at ? `${date(s.last_sync_at)} (${s.last_sync_status})` : 'never'}
                {(() => { const m = metricFor(s.id); return m && (m.fulfilled + m.failed) > 0
                  ? ` · ${m.fulfilled} ok / ${m.failed} failed` : ''; })()}
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => test(s)} className="btn-ghost text-xs"><Plug size={13} /> Test</button>
                {s.connector_kind !== 'manual' && (
                  <button onClick={() => sync(s)} className="btn-ghost text-xs"><RefreshCw size={13} /> Sync</button>
                )}
                <button onClick={() => openMap(s)} className="btn-ghost text-xs"><Link2 size={13} /> Map products</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add supplier" size="lg"
        footer={<>
          <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          <button onClick={create} disabled={busy || !form.name} className="btn-primary">Create</button>
        </>}>
        <div className="space-y-4">
          <div><label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Connector kind</label>
            <select className="input" value={form.connectorKind}
              onChange={(e) => setForm({ ...form, connectorKind: e.target.value })}>
              <option value="kinguin">Kinguin (auto-buy)</option>
              <option value="g2a">G2A (auto-buy)</option>
              <option value="api">API</option>
              <option value="csv">CSV</option>
              <option value="eldorado">Eldorado</option>
              <option value="manual">Manual</option>
            </select>
            <p className="text-slate-500 text-xs mt-2 font-mono">{KIND_HINT[form.connectorKind]}</p>
          </div>
          {form.connectorKind !== 'manual' && (
            <div><label className="label">Config (JSON)</label>
              <textarea rows={8} className="input font-mono text-xs" value={form.config}
                onChange={(e) => setForm({ ...form, config: e.target.value })} /></div>
          )}
        </div>
      </Modal>

      {/* Map supplier SKUs → our products (enables auto-fulfillment for that product) */}
      <Modal open={!!mapFor} onClose={() => setMapFor(null)} title={`Map products — ${mapFor?.name || ''}`} size="lg">
        <p className="text-slate-500 text-sm mb-4">Link one of your products to this supplier’s SKU. Once mapped (and the supplier can fulfil), paid orders for that product are auto-sourced &amp; delivered — no manual step.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><label className="label">Your product</label>
            <select className="input" value={mapForm.productId} onChange={(e) => pickProduct(e.target.value)}>
              <option value="">Select a product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price, p.currency)}</option>)}
            </select></div>
        </div>

        {/* Search the supplier's own catalogue. */}
        <div className="mt-4">
          <label className="label">Find it in {mapFor?.name || 'the supplier'}’s catalogue</label>
          <div className="flex gap-2">
            <input className="input flex-1" value={search.q}
              onChange={(e) => setSearch((v) => ({ ...v, q: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch(search.q, mapForm.productId)}
              placeholder="e.g. Roblox gift card — at least 3 characters" />
            <button onClick={() => runSearch(search.q, mapForm.productId)}
              disabled={search.busy || search.q.trim().length < 3} className="btn-ghost text-sm">
              <Search size={14} /> {search.busy ? 'Searching…' : 'Search'}
            </button>
          </div>
          <p className="text-slate-400 text-xs mt-1">
            Picking a product above searches for it automatically. Click a result to fill the SKU and cost.
            {search.ran && !search.serverSide && ' This supplier has no catalogue search, so only what it already listed was filtered.'}
          </p>

          {/* What was actually asked is often not what was typed — the shop
              writes "1,000 Robux" and the supplier lists "1000 Robux". Saying so
              stops an empty list reading as "they do not carry it". */}
          {search.ran && search.searchedFor && search.searchedFor !== search.q.trim() && (
            <p className="text-slate-400 text-xs mt-1">
              Searched for “{search.searchedFor}” — your product name found nothing.
            </p>
          )}
          {search.err && <p className="text-amber-300 text-xs mt-2">{search.err}</p>}
          {search.ran && !search.busy && !search.results.length && !search.err && (
            <p className="text-slate-400 text-sm mt-2">
              Nothing found for “{search.searchedFor || search.q}”. This supplier may simply not carry it —
              which is worth knowing before you promise it on the shop.
            </p>
          )}

          {search.results.length > 0 && (
            <div className="card mt-2 max-h-72 overflow-y-auto divide-y divide-white/5">
              {search.results.map((r) => (
                <button key={r.supplierSku} onClick={() => useResult(r)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-white/5 transition
                    ${mapForm.supplierSku === r.supplierSku ? 'bg-white/[0.07]' : ''}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-slate-200 text-sm truncate">{r.name}</span>
                    <span className="text-slate-300 text-sm whitespace-nowrap">{money(r.cost, 'EUR')}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-x-2">
                    <span className="font-mono">#{r.supplierSku}</span>
                    {r.platform && <span>· {r.platform}</span>}
                    {r.region && <span>· {r.region}</span>}
                    <span className={r.status === 'in_stock' ? 'text-emerald-300' : 'text-amber-300'}>
                      · {r.status === 'in_stock' ? `${r.availableStock ?? '?'} in stock` : 'out of stock'}
                    </span>
                    {/* The exact condition fulfillmentService refuses on. It is
                        silent at order time — the order just never auto-delivers —
                        so it has to be loud while choosing. */}
                    {r.wouldRefuseAutoBuy
                      ? <span className="text-red-300">· costs more than you sell it for — would never auto-buy</span>
                      : r.marginPct != null && <span className="text-emerald-300">· {r.marginPct}% margin</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div><label className="label">Supplier SKU / offer ID</label>
            <input className="input" value={mapForm.supplierSku} onChange={(e) => setMapForm({ ...mapForm, supplierSku: e.target.value })} placeholder="e.g. ELD-ROBUX-1000" /></div>
          <div className="sm:col-span-2"><label className="label">Listing URL (e.g. Eldorado link)</label>
            <input className="input" value={mapForm.supplierUrl} onChange={(e) => setMapForm({ ...mapForm, supplierUrl: e.target.value })} placeholder="https://www.eldorado.gg/robux/…" /></div>
          <div><label className="label">Your cost (€)</label>
            <input type="number" step="0.01" min="0" className="input" value={mapForm.costEuro} onChange={(e) => setMapForm({ ...mapForm, costEuro: e.target.value })} placeholder="what you pay" /></div>
          <div><label className="label">Priority</label>
            <input type="number" className="input" value={mapForm.priority} onChange={(e) => setMapForm({ ...mapForm, priority: e.target.value })} placeholder="100 (lower = preferred)" /></div>
        </div>
        <button onClick={addMapping} disabled={busy} className="btn-primary mt-4">Map product</button>

        {/* …or answer the question for the whole catalogue at once. Doing it a
            product at a time is an hour of clicking to reach one number. */}
        {mapFor && (
          <div className="mt-6 pt-5 border-t border-white/5">
            <div className="text-white text-sm">Or check every product at once</div>
            <p className="text-slate-400 text-xs mt-1">
              Searches {mapFor.name}’s catalogue for each active product and reports what it would
              cost you and whether it could be auto-delivered. Nothing is mapped without your click.
            </p>
            <CatalogScan supplier={mapFor} onMapped={async () => {
              const r = await api.get(`/api/admin/suppliers/${mapFor.id}/products`);
              setMappings(r.mappings || []);
            }} />
          </div>
        )}

        {mappings.length > 0 && (
          <div className="mt-6">
            <div className="text-slate-400 text-xs uppercase tracking-wide mb-2">Mapped products ({mappings.length})</div>
            <div className="card divide-y divide-white/5">
              {mappings.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="text-white truncate">{m.product_name || <span className="text-amber-300">unmapped SKU</span>} <span className="text-slate-500 font-mono text-xs">{m.supplier_sku}</span></div>
                    <div className="text-slate-500 text-xs">
                      cost {m.cost != null ? money(m.cost, 'EUR') : '—'}
                      {m.product_price != null ? ` · sell ${money(m.product_price, 'EUR')}` : ''}
                      {m.cost != null && m.product_price != null && m.cost >= m.product_price ? ' · ⚠️ no margin' : ''}
                      · prio {m.priority} · stock {m.available_stock ?? '—'}
                    </div>
                    {m.supplier_url && <a href={m.supplier_url} target="_blank" rel="noreferrer" className="text-indigo-300 text-xs hover:underline truncate block">🔗 {m.supplier_url}</a>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Metric({ label, value, className = 'text-white' }) {
  return (
    <div className="bg-space-black rounded-lg py-2">
      <div className={`text-sm font-semibold ${className}`}>{value}</div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
