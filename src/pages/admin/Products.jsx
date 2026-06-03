import { useEffect, useState } from 'react';
import { Package, Plus, Pencil, Star, Eye, EyeOff } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, categoryVisual } from '../../lib/catalog.js';
import { PageLoader, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const BLANK = { name: '', sku: '', category: '', description: '', priceEuro: '',
  kind: 'digital', stock: '', active: true, featured: false };

export default function AdminProducts() {
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [editing, setEditing] = useState(null); // product or null
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/api/admin/products').then((r) => setProducts(r.products)).catch(() => setProducts([]));
  useEffect(() => { load(); }, []);
  if (!products) return <PageLoader />;

  const openNew = () => { setEditing('new'); setForm(BLANK); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku || '', category: p.category || '', description: p.description || '',
      priceEuro: (p.price / 100).toFixed(2), kind: p.kind || 'digital',
      stock: p.stock ?? '', active: !!p.active, featured: !!p.featured,
    });
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
        metadata: { featured: form.featured },
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
              <div key={p.id} className="card p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${v.grad} flex items-center justify-center shrink-0`}>
                    <Icon size={18} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white flex items-center gap-1.5">
                      <span className="truncate">{p.name}</span>
                      {p.featured && <Star size={12} className="text-amber-400 fill-amber-400 shrink-0" />}
                    </div>
                    <div className="text-slate-500 text-xs">{v.label} · {p.stock ?? '∞'} stock</div>
                  </div>
                  <div className="text-white font-medium shrink-0">{money(p.price, p.currency)}</div>
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                  <span className={`text-xs px-2 py-1 rounded-md ${p.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-400'}`}>
                    {p.active ? 'Active' : 'Hidden'}
                  </span>
                  <div className="flex-1" />
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
                  <tr key={p.id} className="hover:bg-white/5">
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
          <div><label className="label">Stock</label>
            <input type="number" className="input" value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder="blank = unlimited" /></div>
          <div className="sm:col-span-2"><label className="label">Description</label>
            <textarea rows={3} className="input" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active (visible in shop)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured
          </label>
        </div>
      </Modal>
    </div>
  );
}
