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

export default function Shop({ landingCategory = null, landingTitle = null, landingSub = null } = {}) {
  const { add } = useCart();
  const toast = useToast();
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [sort, setSort] = useState('popular');
  /* Measured at 390px: rendering the whole catalogue made this page 15,455px —
     18 screens — and fired 65 image requests before the buyer had scrolled once.
     A phone pays for every one of those. 24 fills roughly three screens, which
     is more than enough to judge the shop, and the rest is one tap away.
     A button rather than infinite scroll on purpose: infinite scroll makes the
     footer — where the seller identity and the refund policy live — unreachable. */
  const PAGE = 24;
  const [shown, setShown] = useState(PAGE);
  const categoryLogos = useCategoryLogos(); // owner-set logos (Admin → Categories)
  // A landing route (/robux, /giftcards…) pins the category; the sidebar and the
  // rail still work, they just start from here. One component, one catalogue —
  // a second copy of the shop per keyword is how those pages go stale.
  const category = landingCategory ?? (params.get('category') || '');
  // No arguments: usePageMeta falls back to this route's own copy in
  // content/seo.js — the same copy the prerendered HTML already carries, for
  // /shop and for every landing route alike. Passing a hardcoded "Shop" here
  // replaced a written title with a one-word one the moment React mounted,
  // quietly undoing the prerender for anyone who looked at the tab.
  usePageMeta();

  useEffect(() => {
    api.get('/api/products')
      .then((r) => setProducts(withFallback(r.products)))
      .catch(() => setProducts(withFallback([])));
  }, []);

  const categories = useMemo(
    () => [...new Set((products || []).map((p) => p.category).filter(Boolean))], [products]);

  useEffect(() => { setShown(PAGE); }, [category, sort, search]);

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
            {/* A landing page states its own subject — "Robux kopen" rather
                than the category label — because that heading is the page's
                single strongest on-page signal and the one a visitor reads
                first to know they are in the right place. */}
            {landingTitle || (category ? categoryVisual(category).label : t('shop.all', 'All Products'))}
          </h1>
          {/* A landing page says what IT is about. The generic shop line under
              a "Robux kopen" heading is the on-page equivalent of a title tag
              that does not match its content. */}
          <p className="text-white/85 mt-1.5">
            {landingSub || t('shop.tagline', 'Digital goods, delivered to your inbox & dashboard.')}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="text-[11.5px] font-semibold bg-white/15 border border-white/25 rounded-full px-2.5 py-1">🛡 {t('shop.badgeProtected', 'Money back if undelivered')}</span>
            <span className="text-[11.5px] font-semibold bg-white/15 border border-white/25 rounded-full px-2.5 py-1">🛡 {t('product.protected', 'Buyer protected')}</span>
            {products !== null && (
              <span className="text-[11.5px] font-semibold bg-white/15 border border-white/25 rounded-full px-2.5 py-1">
                {visible.length} {t('shop.items', 'items')}
              </span>
            )}
          </div>
        </div>

        {/* Category filter, phones only — the sidebar above is `hidden lg:block`,
            so until now a phone had no way to filter the catalogue at all. Same
            state and same setCategory as the sidebar, so the two cannot drift.
            A horizontal rail rather than a dropdown: the icons are the point,
            and it keeps the current choice visible while you browse. */}
        <div className="lg:hidden -mx-4 px-4 mb-6">
          <div className="fm-rail flex gap-2 overflow-x-auto pb-1 snap-x">
            <button onClick={() => setCategory('')}
              className={`snap-start shrink-0 inline-flex items-center gap-2 h-11 px-3.5 rounded-xl border text-[14px] font-semibold transition fm-press ${
                !category ? 'chip-active' : 'bg-white text-slate-600 border-slate-200'}`}>
              <LayoutGrid size={16} className={category ? 'text-violet-600' : ''}
                style={category ? undefined : { color: '#fff' }} />
              {t('shop.all', 'All Products')}
            </button>
            {categories.map((c) => {
              const v = categoryVisual(c); const img = logoFor(categoryLogos, c); const Icon = v.icon;
              const on = category === c;
              return (
                <button key={c} onClick={() => setCategory(c)}
                  className={`snap-start shrink-0 inline-flex items-center gap-2 h-11 pl-2 pr-3.5 rounded-xl border text-[14px] font-semibold transition fm-press ${
                    on ? 'chip-active' : 'bg-white text-slate-600 border-slate-200'}`}>
                  {img ? <img src={img} alt="" className="w-7 h-7 object-contain" />
                    : <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${v.grad} grid place-items-center`}><Icon size={14} className="text-white" /></span>}
                  <span className="whitespace-nowrap">{v.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Trending row.
            The space is held open while the fetch is in flight: this block sits
            above the whole catalogue, so appearing late shoved every product
            down the page. Measured on /shop as the second-largest layout shift
            after the bundles row, which had the same problem. `trending` is
            null until the request settles and an array afterwards, so "still
            loading" and "nothing to show" are genuinely distinguishable — no
            gap is reserved for a row that will never arrive. */}
        {!category && !search.trim() && trending === null && (
          <div className="mb-7 h-[300px] sm:h-[326px]" aria-hidden />
        )}
        {showTrending && (
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-3">
              <Flame size={18} className="text-orange-500" />
              <h2 className="font-extrabold text-lg text-slate-900">{t('shop.trending', 'Trending now')}</h2>
            </div>
            <div className="fm-rail flex gap-4 overflow-x-auto pb-2 snap-x">
              {trending.slice(0, 8).map((p, i) => (
                <div key={p.id} className="snap-start shrink-0 w-[210px] flex fm-reveal">
                  {/* The first few are why the page looks loaded; they are not
                      lazy. Everything past the fold still is. */}
                  <LightProductCard product={p} onAdd={onAdd} priority={i < 4} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bundle offers (hides itself when there are none) */}
        {(!category || category === 'all') && !search && <BundlesShowcase />}

        {/* controls */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between mb-5">
          <div className="text-slate-600 text-sm">
            {products === null ? t('shop.loading', 'Loading…') : `${visible.length} ${t('shop.items', 'products')}`}
          </div>
          <div className="flex gap-3">
            <div className="relative flex-1 sm:w-60">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('shop.search', 'Search products…')}
                type="search" aria-label={t('shop.search', 'Search products…')} enterKeyHint="search"
                autoCorrect="off" autoCapitalize="off" spellCheck={false}
                className="w-full rounded-xl bg-white border border-slate-200 pl-9 pr-3 h-11 sm:h-10 text-base sm:text-sm text-slate-700 outline-none focus:border-violet-400" />
            </div>
            <div className="relative">
              <SlidersHorizontal size={15} className="absolute left-3 top-3 text-slate-400 pointer-events-none" />
              <select value={sort} onChange={(e) => setSort(e.target.value)}
                aria-label={t('shop.sortBy', 'Sort products by')}
                className="appearance-none cursor-pointer rounded-xl bg-white border border-slate-200 pl-9 pr-8 h-11 sm:h-10 text-base sm:text-sm text-slate-700 outline-none focus:border-violet-400">
                {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{t(v.key, v.label)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* grid */}
        {products === null ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
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
          <div key={`${category}-${sort}-${search}`} className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 fm-grid-in">
            {visible.slice(0, shown).map((p, i) => (
              // Stagger capped at 8 so a 74-product grid does not end with a
              // card waiting two seconds for its turn.
              <div key={p.id} className="flex fm-reveal fm-card-slot" style={{ transitionDelay: `${Math.min(i, 8) * 45}ms` }}>
                <LightProductCard product={p} onAdd={onAdd} priority={i < 8} />
              </div>
            ))}
          </div>
        )}
        {visible.length > shown && (
          <div className="mt-6 flex flex-col items-center gap-2">
            <button onClick={() => setShown((n) => n + PAGE)}
              className="w-full sm:w-auto min-h-[48px] px-8 rounded-xl border border-slate-200 bg-white font-semibold text-slate-700 hover:border-violet-300 hover:text-violet-700 transition fm-press">
              {t('shop.loadMore', 'Show more products')}
            </button>
            <span className="text-[13px] text-slate-400">
              {t('shop.showing', '{n} of {total}', { n: shown, total: visible.length })}
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
