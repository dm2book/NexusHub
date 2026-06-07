import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, PackageX } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { categoryVisual } from '../lib/catalog.js';
import { withFallback } from '../lib/sampleCatalog.js';
import ProductCard from '../components/ProductCard.jsx';
import Reveal from '../components/Reveal.jsx';
import { Skeleton, EmptyState } from '../components/ui.jsx';
import { usePageMeta } from '../lib/useMeta.js';

const SORTS = {
  popular: { label: 'Popular', fn: (a, b) => (b.featured === true) - (a.featured === true) },
  price_asc: { label: 'Price: Low → High', fn: (a, b) => a.price - b.price },
  price_desc: { label: 'Price: High → Low', fn: (a, b) => b.price - a.price },
  name: { label: 'Name A–Z', fn: (a, b) => a.name.localeCompare(b.name) },
};

export default function Shop() {
  const { add } = useCart();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('popular');
  const category = params.get('category') || '';
  usePageMeta('Shop', 'Browse game currency, gift cards and subscriptions — instant delivery.');

  useEffect(() => {
    api.get('/api/products')
      .then((r) => setProducts(withFallback(r.products)))
      .catch(() => setProducts(withFallback([])));
  }, []);

  const categories = useMemo(
    () => [...new Set((products || []).map((p) => p.category).filter(Boolean))], [products]);

  const visible = useMemo(() => {
    let list = (products || []).slice();
    if (category) list = list.filter((p) => (p.category || '') === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
    }
    return list.sort(SORTS[sort].fn);
  }, [products, category, search, sort]);

  const setCategory = (c) => {
    const next = new URLSearchParams(params);
    if (c) next.set('category', c); else next.delete('category');
    setParams(next);
  };

  const onAdd = (p) => { add(p); toast.success(`${p.name} added to cart`); };

  return (
    <div className="section py-12">
      {/* header */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] p-8 sm:p-10 mb-8">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="orb w-72 h-72 bg-primary/20 -top-24 right-10" />
        <div className="relative">
          <h1 className="text-3xl sm:text-4xl text-white">Shop</h1>
          <p className="text-slate-400 mt-2">Digital goods, delivered instantly to your dashboard.</p>
        </div>
      </div>

      {/* controls */}
      <div className="flex flex-col lg:flex-row gap-4 lg:items-center justify-between mb-6">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCategory('')} className={`chip ${!category ? 'chip-active' : ''}`}>All</button>
          {categories.map((c) => {
            const v = categoryVisual(c); const Icon = v.icon;
            return (
              <button key={c} onClick={() => setCategory(c)} className={`chip ${category === c ? 'chip-active' : ''}`}>
                <Icon size={14} /> {v.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1 lg:w-64">
            <Search size={16} className="absolute left-3 top-3 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="input pl-9" />
          </div>
          <div className="relative">
            <SlidersHorizontal size={15} className="absolute left-3 top-3.5 text-slate-500 pointer-events-none" />
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="input pl-9 pr-8 appearance-none cursor-pointer">
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* grid */}
      {products === null ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-72" />)}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={PackageX} title={products.length === 0 ? 'No products yet' : 'No matches'}
          hint={products.length === 0
            ? 'Products added by the team or synced from suppliers will appear here.'
            : 'Try a different category or search term.'} />
      ) : (
        <>
          <div className="text-slate-500 text-sm mb-4">{visible.length} product{visible.length !== 1 ? 's' : ''}</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {visible.map((p, i) => (
              <Reveal key={p.id} delay={Math.min(i, 8) * 60}>
                <ProductCard product={p} onAdd={onAdd} />
              </Reveal>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
