import { useEffect, useState } from 'react';
import { Package, Plus, Pencil, Star, Eye, EyeOff } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, categoryVisual } from '../../lib/catalog.js';
import { PageLoader, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const BLANK = { name: '', sku: '', category: '', description: '', priceEuro: '', costEuro: '',
  compareAtEuro: '', kind: 'digital', stock: '', deliveryMode: 'auto', active: true, featured: false, imageUrl: '' };

// Suggested sell price from a supplier cost (e.g. what you pay on Eldorado /
// Eneba): a ~18% markup with a €2 minimum profit, rounded to a clean .99.
// So €140 cost → €165, €10 cost → €12.99. Tune MARKUP/FLOOR to taste.
const MARKUP = 0.18, FLOOR = 2;
function suggestPrice(costEuro) {
  const cost = parseFloat(costEuro);
  if (!cost || cost <= 0) return null;
  const raw = Math.max(cost + FLOOR, cost * (1 + MARKUP));
  return Math.max(0.99, Math.ceil(raw) - 0.01).toFixed(2); // → clean .99 ending
}

export default function AdminProducts() {
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [editing, setEditing] = useState(null); // product or null
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState(null); // { p, codes } or null
  const [rewards, setRewards] = useState(null); // mystery reward pool [{label,weight,creditEuro}]
  const [sel, setSel] = useState(() => new Set()); // selected product ids for bulk actions

  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulk = async (action, value) => {
    setBusy(true);
    try {
      const r = await api.post('/api/admin/products/bulk', { ids: [...sel], action, value });
      toast.success(`Updated ${r.updated} product(s).`);
      setSel(new Set()); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const addCodes = async () => {
    if (!stock?.codes.trim()) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/admin/products/${stock.p.id}/codes`, { codes: stock.codes });
      toast.success(`Added ${r.added} code(s) — ${r.available} in stock.`);
      setStock(null); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const load = () => api.get('/api/admin/products').then((r) => setProducts(r.products)).catch(() => setProducts([]));
  useEffect(() => { load(); }, []);
  if (!products) return <PageLoader />;

  const openNew = () => { setEditing('new'); setForm(BLANK); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku || '', category: p.category || '', description: p.description || '',
      priceEuro: (p.price / 100).toFixed(2),
      costEuro: p.metadata?.cost != null ? (p.metadata.cost / 100).toFixed(2) : '',
      compareAtEuro: p.metadata?.compareAt != null ? (p.metadata.compareAt / 100).toFixed(2) : '',
      deliveryMode: p.metadata?.deliveryMode === 'manual' ? 'manual' : 'auto',
      kind: p.kind || 'digital',
      stock: p.stock ?? '', active: !!p.active, featured: !!p.featured,
      imageUrl: p.image || '',
    });
    setRewards(null);
    if (p.kind === 'mystery') {
      api.get(`/api/admin/products/${p.id}/mystery`)
        .then((r) => setRewards(r.rewards.map((x) => ({ label: x.label, weight: x.weight, creditEuro: (x.credit / 100).toFixed(2) }))))
        .catch(() => setRewards([]));
    }
  };

  const saveRewards = async () => {
    setBusy(true);
    try {
      await api.put(`/api/admin/products/${editing.id}/mystery`, {
        rewards: (rewards || []).filter((r) => r.label.trim()).map((r) => ({
          label: r.label.trim(), weight: Math.max(1, parseInt(r.weight, 10) || 1),
          credit: Math.max(0, Math.round(parseFloat(r.creditEuro || '0') * 100)),
        })),
      });
      toast.success('Mystery rewards saved.');
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name, sku: form.sku || undefined, category: form.category || undefined,
        description: form.description || undefined,
        price: Math.round(parseFloat(form.priceEuro || '0') * 100),
        kind: form.kind, active: form.active,
        stock: form.stock === '' ? null : Number(form.stock),
        metadata: {
          featured: form.featured,
          image: form.imageUrl || undefined,
          cost: form.costEuro === '' ? undefined : Math.round(parseFloat(form.costEuro || '0') * 100),
          compareAt: form.compareAtEuro === '' ? undefined : Math.round(parseFloat(form.compareAtEuro || '0') * 100),
          deliveryMode: form.deliveryMode === 'manual' ? 'manual' : undefined,
        },
      };
      if (editing === 'new') await api.post('/api/admin/products', payload);
      else await api.patch(`/api/admin/products/${editing.id}`, payload);
      toast.success('Product saved.');
      setEditing(null); load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const toggleActive = async (p) => {
    try { await api.patch(`/api/admin/products/${p.id}`, { active: !p.active }); load(); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl text-white">Products</h1>
        <button onClick={openNew} className="btn-primary text-sm"><Plus size={16} /> New product</button>
      </div>
      <p className="text-slate-400 text-sm mb-6">Manage your catalog. Featured items get highlighted on the storefront.</p>

      {sel.size > 0 && (
        <div className="card p-3 mb-4 flex flex-wrap items-center gap-2 border border-violet-500/30 bg-violet-500/5">
          <span className="text-sm text-white font-semibold mr-1">{sel.size} selected</span>
          <button disabled={busy} onClick={() => bulk('deliveryMode', 'auto')} className="btn-ghost text-xs">🤖 Automatic</button>
          <button disabled={busy} onClick={() => bulk('deliveryMode', 'manual')} className="btn-ghost text-xs">✋ Manual</button>
          <span className="w-px h-5 bg-white/10 mx-1" />
          <button disabled={busy} onClick={() => bulk('featured', true)} className="btn-ghost text-xs">★ Feature</button>
          <button disabled={busy} onClick={() => bulk('featured', false)} className="btn-ghost text-xs">Unfeature</button>
          <span className="w-px h-5 bg-white/10 mx-1" />
          <button disabled={busy} onClick={() => bulk('active', true)} className="btn-ghost text-xs">👁 Show</button>
          <button disabled={busy} onClick={() => bulk('active', false)} className="btn-ghost text-xs">🚫 Hide</button>
          <div className="flex-1" />
          <button onClick={() => setSel(new Set())} className="btn-ghost text-xs">Clear</button>
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState icon={Package} title="No products yet"
          hint="Add your first product, or run the demo seeder (npm run seed:demo)."
          action={<button onClick={openNew} className="btn-primary">Add product</button>} />
      ) : (
       <>
        {/* Mobile: cards */}
        <div className="space-y-3 lg:hidden">
          {products.map((p) => {
            const v = categoryVisual(p.category); const Icon = v.icon;
            return (
              <div key={p.id} className={`card p-4 ${sel.has(p.id) ? 'ring-1 ring-violet-500/40' : ''}`}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" aria-label={`Select ${p.name}`} className="shrink-0"
                    checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} />
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${v.grad} flex items-center justify-center shrink-0`}>
                    <Icon size={18} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white flex items-center gap-1.5">
                      <span className="truncate">{p.name}</span>
                      {p.featured && <Star size={12} className="text-amber-400 fill-amber-400 shrink-0" />}
                    </div>
                    <div className="text-slate-500 text-xs">
                      {v.label}
                      {p.kind !== 'mystery' && <> · <span className={p.codesAvailable ? 'text-emerald-400' : 'text-amber-400'}>🔑 {p.codesAvailable ?? 0}</span></>}
                      {p.kind !== 'mystery' && <> · {p.metadata?.deliveryMode === 'manual' ? '✋ Manual' : '🤖 Auto'}</>}
                    </div>
                  </div>
                  <div className="text-white font-medium shrink-0">{money(p.price, p.currency)}</div>
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                  <span className={`text-xs px-2 py-1 rounded-md ${p.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-400'}`}>
                    {p.active ? 'Active' : 'Hidden'}
                  </span>
                  <div className="flex-1" />
                  {p.kind !== 'mystery' && (
                    <button onClick={() => setStock({ p, codes: '' })} className="btn-ghost text-xs">🔑 Codes</button>
                  )}
                  <button onClick={() => toggleActive(p)} className="btn-ghost text-xs">
                    {p.active ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Show</>}
                  </button>
                  <button onClick={() => openEdit(p)} className="btn-ghost text-xs"><Pencil size={14} /> Edit</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop: table */}
        <div className="card overflow-x-auto hidden lg:block">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-left text-slate-400 border-b border-white/5">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" aria-label="Select all"
                    checked={products.length > 0 && sel.size === products.length}
                    onChange={(e) => setSel(e.target.checked ? new Set(products.map((p) => p.id)) : new Set())} />
                </th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {products.map((p) => {
                const v = categoryVisual(p.category); const Icon = v.icon;
                return (
                  <tr key={p.id} className={`hover:bg-white/5 ${sel.has(p.id) ? 'bg-violet-500/5' : ''}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" aria-label={`Select ${p.name}`}
                        checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${v.grad} flex items-center justify-center shrink-0`}>
                          <Icon size={16} className="text-white" />
                        </div>
                        <div>
                          <div className="text-white flex items-center gap-1.5">
                            {p.name}{p.featured && <Star size={12} className="text-amber-400 fill-amber-400" />}
                          </div>
                          {p.sku && <div className="text-slate-500 text-xs font-mono">{p.sku}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{v.label}</td>
                    <td className="px-4 py-3 text-white">{money(p.price, p.currency)}</td>
                    <td className="px-4 py-3 text-slate-400">{p.stock ?? '∞'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-md ${p.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-400'}`}>
                        {p.active ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {p.kind !== 'mystery' && p.metadata?.deliveryMode === 'manual' && (
                          <span title="Manual delivery — you deliver each order by hand" className="text-xs text-amber-300 px-1.5 py-1">✋ Manual</span>
                        )}
                        {p.kind !== 'mystery' && (
                          <button title="Auto-delivery code stock — paste codes for instant delivery" onClick={() => { setStock({ p, codes: '' }); }}
                            className={`px-2 py-1 rounded-lg hover:bg-white/10 text-xs inline-flex items-center gap-1 ${p.codesAvailable ? 'text-emerald-300' : 'text-amber-300'}`}>
                            🔑 {p.codesAvailable ?? 0}
                          </button>
                        )}
                        <button title={p.active ? 'Hide' : 'Show'} onClick={() => toggleActive(p)}
                          className="p-2 rounded-lg hover:bg-white/10 text-slate-300">
                          {p.active ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <button title="Edit" onClick={() => openEdit(p)}
                          className="p-2 rounded-lg hover:bg-white/10 text-slate-300"><Pencil size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
       </>
      )}

      <Modal open={!!stock} onClose={() => setStock(null)} title={`Code stock — ${stock?.p?.name || ''}`}
        footer={<>
          <button onClick={() => setStock(null)} className="btn-ghost">Cancel</button>
          <button onClick={addCodes} disabled={busy || !stock?.codes.trim()} className="btn-primary">Add to stock</button>
        </>}>
        <p className="text-slate-400 text-sm mb-3">
          Currently <span className="text-white font-semibold">{stock?.p?.codesAvailable ?? 0}</span> code(s) in stock.
          Paste codes below — <strong>one per line</strong> (or comma-separated). When a customer pays, a code is
          auto-pulled from here, e-mailed, and the order is completed.
        </p>
        <textarea rows={8} className="input font-mono text-sm" placeholder={'ABCD-1234-EFGH\nWXYZ-5678-IJKL\n…'}
          value={stock?.codes || ''} onChange={(e) => setStock((s) => ({ ...s, codes: e.target.value }))} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New product' : 'Edit product'} size="lg"
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={busy || !form.name || !form.priceEuro} className="btn-primary">Save</button>
        </>}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">SKU</label>
            <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="optional" /></div>
          <div><label className="label">Category</label>
            <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="e.g. steam, discord-nitro, v-bucks" /></div>
          <div><label className="label">Price (€)</label>
            <input type="number" step="0.01" min="0" className="input" value={form.priceEuro}
              onChange={(e) => setForm({ ...form, priceEuro: e.target.value })} placeholder="9.99" /></div>
          <div><label className="label">Sale — original price (€)</label>
            <input type="number" step="0.01" min="0" className="input" value={form.compareAtEuro}
              onChange={(e) => setForm({ ...form, compareAtEuro: e.target.value })} placeholder="blank = no sale" />
            {form.compareAtEuro && parseFloat(form.compareAtEuro) > parseFloat(form.priceEuro || '0') && (
              <p className="text-xs text-rose-400 mt-1">Shows a crossed-out €{parseFloat(form.compareAtEuro).toFixed(2)} and a
                −{Math.round((1 - parseFloat(form.priceEuro || '0') / parseFloat(form.compareAtEuro)) * 100)}% badge.</p>
            )}</div>
          <div><label className="label">Cost / supplier price (€) — e.g. Eldorado / Eneba</label>
            <input type="number" step="0.01" min="0" className="input" value={form.costEuro}
              onChange={(e) => setForm({ ...form, costEuro: e.target.value })} placeholder="what you pay to buy it" />
            {suggestPrice(form.costEuro) && (
              <button type="button"
                onClick={() => setForm({ ...form, priceEuro: suggestPrice(form.costEuro) })}
                className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 bg-violet-500/15 border border-violet-500/30 rounded-lg px-2.5 py-1 hover:bg-violet-500/25 transition">
                💡 Suggest price: €{suggestPrice(form.costEuro)}
                <span className="text-slate-400 font-normal">(+{Math.round(MARKUP * 100)}%, min €{FLOOR}) — apply</span>
              </button>
            )}
            {form.priceEuro && form.costEuro && (
              <p className="text-xs text-emerald-400 mt-1">
                Margin: €{(parseFloat(form.priceEuro || 0) - parseFloat(form.costEuro || 0)).toFixed(2)}
                {parseFloat(form.priceEuro) > 0 ? ` (${Math.round((1 - parseFloat(form.costEuro || 0) / parseFloat(form.priceEuro)) * 100)}%)` : ''}
              </p>
            )}</div>
          <div><label className="label">Stock cap</label>
            <input type="number" className="input" value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="blank = unlimited" />
            <p className="text-xs text-slate-500 mt-1">Optional manual limit. For instant auto-delivery, use the <strong className="text-slate-300">🔑 Codes</strong> button on the product row to paste real codes.</p></div>

          {form.kind !== 'mystery' && (
            <div className="sm:col-span-2">
              <label className="label">Delivery</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setForm({ ...form, deliveryMode: 'auto' })}
                  className={`rounded-xl border p-3 text-left text-sm transition ${form.deliveryMode !== 'manual' ? 'border-violet-500 bg-violet-500/10 text-white' : 'border-white/10 text-slate-400 hover:border-white/20'}`}>
                  <div className="font-semibold">🤖 Automatic</div>
                  <div className="text-xs mt-0.5 opacity-80">Pull a code from stock, e-mail it &amp; complete the order on payment.</div>
                </button>
                <button type="button" onClick={() => setForm({ ...form, deliveryMode: 'manual' })}
                  className={`rounded-xl border p-3 text-left text-sm transition ${form.deliveryMode === 'manual' ? 'border-violet-500 bg-violet-500/10 text-white' : 'border-white/10 text-slate-400 hover:border-white/20'}`}>
                  <div className="font-semibold">✋ Manual</div>
                  <div className="text-xs mt-0.5 opacity-80">Never auto-deliver — you enter the code per order from the order page.</div>
                </button>
              </div>
            </div>
          )}
          <div className="sm:col-span-2"><label className="label">Image URL</label>
            <input className="input" value={form.imageUrl} placeholder="https://… (product photo)"
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Description</label>
            <textarea rows={3} className="input" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active (visible in shop)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2">
            <input type="checkbox" checked={form.kind === 'mystery'}
              onChange={(e) => setForm({ ...form, kind: e.target.checked ? 'mystery' : 'digital' })} />
            🎁 Mystery box (buyers win a random reward — set the pool below after saving)
          </label>

          {/* Mystery reward pool — only for saved mystery products */}
          {form.kind === 'mystery' && editing !== 'new' && (
            <div className="sm:col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-amber-300">🎁 Reward pool</div>
                <button type="button" onClick={() => setRewards([...(rewards || []), { label: '', weight: 10, creditEuro: '' }])}
                  className="text-xs font-semibold text-amber-300 hover:text-amber-200">+ Add reward</button>
              </div>
              {rewards === null ? <p className="text-slate-500 text-sm">Loading…</p> : (
                <>
                  {rewards.length === 0 && <p className="text-slate-500 text-sm mb-2">No rewards yet — add a few. Weight = relative odds; credit = what the winner gets as store credit.</p>}
                  <div className="space-y-2">
                    {rewards.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1fr_70px_90px_auto] gap-2 items-center">
                        <input className="input py-1.5 text-sm" placeholder="e.g. €50 JACKPOT" value={r.label}
                          onChange={(e) => setRewards(rewards.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                        <input className="input py-1.5 text-sm" type="number" min="1" placeholder="odds" value={r.weight}
                          onChange={(e) => setRewards(rewards.map((x, j) => j === i ? { ...x, weight: e.target.value } : x))} />
                        <input className="input py-1.5 text-sm" type="number" min="0" step="0.01" placeholder="€ credit" value={r.creditEuro}
                          onChange={(e) => setRewards(rewards.map((x, j) => j === i ? { ...x, creditEuro: e.target.value } : x))} />
                        <button type="button" onClick={() => setRewards(rewards.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 text-lg px-1">×</button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={saveRewards} disabled={busy}
                    className="btn-primary mt-3 py-2 text-sm">Save rewards</button>
                </>
              )}
            </div>
          )}
          {form.kind === 'mystery' && editing === 'new' && (
            <p className="sm:col-span-2 text-xs text-amber-300/80">Save the product first, then reopen it to set the reward pool.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
