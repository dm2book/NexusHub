import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, PackageX, LayoutGrid } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { categoryVisual, normalizeSearch } from '../lib/catalog.js';
import { withFallback, iconFor } from '../lib/sampleCatalog.js';
import { useCategoryLogos, logoFor } from '../lib/useCategoryLogos.js';
import LightProductCard from '../components/store/LightProductCard.jsx';
import { SkeletonCard } from '../components/ui.jsx';
import BundlesShowcase from '../components/store/BundlesShowcase.jsx';
import { usePageMeta } from '../lib/useMeta.js';
import { useI18n } from '../lib/i18n.jsx';
import { useTrending } from '../lib/useTrending.js';
import { Flame } from 'lucide-react';

const SORTS = {
  popular: { key: 'shop.sortPopular', label: 'Popular', fn: (a, b) => (b.featured === true) - (a.featured === true) },
  price_asc: { key: 'shop.sortPriceAsc', label: 'Price: Low → High', fn: (a, b) => a.price - b.price },
  price_desc: { key: 'shop.sortPriceDesc', label: 'Price: High → Low', fn: (a, b) => b.price - a.price },
  name: { key: 'shop.sortName', label: 'Name A–Z', fn: (a, b) => a.name.localeCompare(b.name) },
};

export default function Shop() {
  const { add } = useCart();
  const toast = useToast();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [sort, setSort] = useState('popular');
  const categoryLogos = useCategoryLogos(); // owner-set logos (Admin → Categories)
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
    const q = normalizeSearch(search);
    if (q) {
      // Match on name / category / description, ignoring case + punctuation
      // (so "vbucks" finds "V-Bucks").
      list = list.filter((p) => normalizeSearch(p.name).includes(q)
        || normalizeSearch(p.category).includes(q)
        || normalizeSearch(p.description).includes(q));
    }
    return list.sort(SORTS[sort].fn);
  }, [products, category, search, sort]);

  const setCategory = (c) => {
    const next = new URLSearchParams(params);
    if (c) next.set('category', c); else next.delete('category');
    setParams(next);
  };

  const trending = useTrending();
  const onAdd = (p) => { add(p); toast.success(`${p.name} ${t('cart.addedToCart', 'added to cart')}`); };
  const showTrending = !category && !search.trim() && trending?.length > 0;

  return (
    <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-6 flex gap-6 items-start">
      {/* Category sidebar */}
      <aside className="hidden lg:block w-[248px] shrink-0 sticky top-[84px]">
        <div className="bg-white rounded-2xl border border-slate-200/70 p-3 shadow-sm">
          <p className="text-[11px] font-bold tracking-wider text-slate-400 px-2 py-2">{t('shop.browseCategories', 'BROWSE CATEGORIES')}</p>
          <nav className="space-y-0.5 max-h-[70vh] overflow-y-auto">
            <button onClick={() => setCategory('')}
              className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-[14.5px] font-medium transition ${!category ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-50'}`}>
              <span className="w-7 h-7 grid place-items-center"><LayoutGrid size={18} className="text-violet-600" /></span>
              {t('shop.all', 'All Products')}
            </button>
            {categories.map((c) => {
              const v = categoryVisual(c); const img = logoFor(categoryLogos, c); const Icon = v.icon;
              return (
                <button key={c} onClick={() => setCategory(c)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-[14.5px] font-medium transition ${category === c ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <span className="w-7 h-7 grid place-items-center shrink-0">
                    {img ? <img src={img} alt="" className="w-7 h-7 object-contain" />
                      : <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${v.grad} grid place-items-center`}><Icon size={15} className="text-white" /></span>}
                  </span>
                  <span className="truncate">{v.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        <div className="fm-hero-brand rounded-2xl p-7 mb-6 text-white shadow-lg shadow-violet-500/20"
          style={{ backgroundImage: 'linear-gradient(120deg,#7c5cff,#a855f7)' }}>
          {(() => {
            // Prefer the logo the owner set for this category, then their own
            // product artwork, then the built-in category icon. With no category
            // selected the whole catalogue gets its own piece of art.
            const img = category
              ? (categoryLogos[category] || visible.find((p) => p.image)?.image || iconFor(category))
              : '/products/icons/chest.svg';
            return (
              <img src={img} alt="" aria-hidden
                className="fm-hero-art right-8 inset-y-0 my-auto w-28 h-28 object-contain drop-shadow-2xl fm-float hidden sm:block" />
            );
          })()}
          <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: '#fff' }}>
            {category ? categoryVisual(category).label : t('shop.all', 'All Products')}
          </h1>
          <p className="text-white/85 mt-1.5">{t('shop.tagline', 'Digital goods, delivered to your inbox & dashboard.')}</p>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="text-[11.5px] font-semibold bg-white/15 border border-white/25 rounded-full px-2.5 py-1">⚡ {t('product.instant', 'Instant delivery')}</span>
            <span className="text-[11.5px] font-semibold bg-white/15 border border-white/25 rounded-full px-2.5 py-1">🛡 {t('product.protected', 'Buyer protected')}</span>
            {products !== null && (
              <span className="text-[11.5px] font-semibold bg-white/15 border border-white/25 rounded-full px-2.5 py-1">
                {visible.length} {t('shop.items', 'items')}
              </span>
            )}
          </div>
        </div>

        {/* Trending row */}
        {showTrending && (
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-3">
              <Flame size={18} className="text-orange-500" />
              <h2 className="font-extrabold text-lg text-slate-900">{t('shop.trending', 'Trending now')}</h2>
            </div>
            <div className="fm-rail flex gap-4 overflow-x-auto pb-2 snap-x">
              {trending.slice(0, 8).map((p) => (
                <div key={p.id} className="snap-start shrink-0 w-[210px]">
                  <LightProductCard product={p} onAdd={onAdd} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bundle offers (hides itself when there are none) */}
        {(!category || category === 'all') && !search && <BundlesShowcase />}

        {/* controls */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between mb-5">
          <div className="text-slate-500 text-sm">
            {products === null ? t('shop.loading', 'Loading…') : `${visible.length} product${visible.length !== 1 ? 's' : ''}`}
          </div>
          <div className="flex gap-3">
            <div className="relative flex-1 sm:w-60">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('shop.search', 'Search products…')}
                className="w-full rounded-xl bg-white border border-slate-200 pl-9 pr-3 h-10 text-sm text-slate-700 outline-none focus:border-violet-400" />
            </div>
            <div className="relative">
              <SlidersHorizontal size={15} className="absolute left-3 top-3 text-slate-400 pointer-events-none" />
              <select value={sort} onChange={(e) => setSort(e.target.value)}
                className="appearance-none cursor-pointer rounded-xl bg-white border border-slate-200 pl-9 pr-8 h-10 text-sm text-slate-700 outline-none focus:border-violet-400">
                {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{t(v.key, v.label)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* grid */}
        {products === null ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/70 p-14 text-center">
            <PackageX className="mx-auto text-slate-300 mb-3" size={40} />
            <p className="font-semibold text-slate-700">{products.length === 0 ? t('shop.none', 'No products yet') : t('shop.noMatches', 'No matches')}</p>
            <p className="text-slate-400 text-sm mt-1">
              {products.length === 0 ? t('shop.noneSub', 'Products will appear here once added.') : t('shop.noMatchesSub', 'Try a different category or search term.')}
            </p>
          </div>
        ) : (
          <div key={`${category}-${sort}-${search}`} className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 fm-grid-in">
            {visible.map((p) => <LightProductCard key={p.id} product={p} onAdd={onAdd} />)}
          </div>
        )}
      </main>
    </div>
  );
}
