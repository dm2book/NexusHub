import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, PackageSearch, ShoppingCart, Wallet, Star, LifeBuoy, ArrowRight, CornerDownLeft,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, normalizeSearch } from '../../lib/catalog.js';
import { iconFor, withFallback } from '../../lib/sampleCatalog.js';
import { useCart } from '../../context/CartContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Global search command palette (⌘K / Ctrl+K, or the nav search box).
 * Live product search with keyboard navigation + quick actions — the nav's
 * "⌘K" hint is now a real feature instead of decoration.
 * Open programmatically with: window.dispatchEvent(new CustomEvent('forge:cmdk'))
 */
const ACTIONS = [
  { id: 'a-shop', label: 'Browse all products', to: '/shop', icon: PackageSearch, kw: 'shop products browse all' },
  { id: 'a-track', label: 'Track an order', to: '/track', icon: Search, kw: 'track order status where' },
  { id: 'a-wallet', label: 'My wallet & store credit', to: '/account/wallet', icon: Wallet, kw: 'wallet credit balance gift card redeem' },
  { id: 'a-reviews', label: 'Customer reviews', to: '/reviews', icon: Star, kw: 'reviews rating vouch' },
  { id: 'a-support', label: 'Contact support', to: '/contact', icon: LifeBuoy, kw: 'support help contact ticket' },
];

let productCache = null;
let productCacheAt = 0; // so catalog edits show up without a full reload

export default function CommandPalette() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { add } = useCart();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [products, setProducts] = useState(productCache || []);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Open triggers: ⌘K / Ctrl+K + custom event from the nav search boxes.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('forge:cmdk', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('forge:cmdk', onOpen); };
  }, []);

  // Load the catalog on open, refreshing when the cache is older than a minute
  // so recent catalog edits (new images, prices) show up without a full reload.
  useEffect(() => {
    if (!open) return;
    setQ(''); setSel(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    const fresh = productCache && (Date.now() - productCacheAt < 60_000);
    if (!fresh) {
      api.get('/api/products')
        .then((r) => { productCache = withFallback(r.products); productCacheAt = Date.now(); setProducts(productCache); })
        /* No sample shelf on failure. Search that answers a real query with
           products the shop cannot sell is worse than search that finds
           nothing, and productCache is left unset so the next open retries. */
        .catch(() => { if (!productCache) setProducts([]); });
    }
  }, [open]);

  // Rank: prefix match on name > word match > category/description match.
  // Matching ignores case, spaces and punctuation, so "vbucks" finds "V-Bucks".
  const results = useMemo(() => {
    const term = normalizeSearch(q);
    const score = (p) => {
      if (!term) return p.featured ? 2 : 1;
      const name = normalizeSearch(p.name);
      if (name.startsWith(term)) return 100;
      if ((p.name || '').split(/\s+/).some((w) => normalizeSearch(w).startsWith(term))) return 60;
      if (name.includes(term)) return 40;
      if (normalizeSearch(p.category).includes(term)) return 20;
      if (normalizeSearch(p.description).includes(term)) return 10;
      return 0;
    };
    const prods = products.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s).slice(0, 7).map((x) => x.p);
    const acts = ACTIONS.filter((a) => !term || normalizeSearch(a.label).includes(term) || normalizeSearch(a.kw).includes(term));
    return { prods, acts };
  }, [q, products]);

  const flat = useMemo(() => [
    ...results.prods.map((p) => ({ kind: 'product', p })),
    ...results.acts.map((a) => ({ kind: 'action', a })),
  ], [results]);

  useEffect(() => { setSel(0); }, [q]);

  const go = useCallback((item) => {
    setOpen(false);
    if (!item) return;
    if (item.kind === 'product') navigate(`/product/${item.p.id}`);
    else navigate(item.a.to);
  }, [navigate]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[sel]); }
  };

  // Keep the selected row in view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden fm-pop">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-100">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder', 'Search products, or type what you need…')}
            className="flex-1 outline-none text-[15px] text-slate-900 placeholder-slate-400 bg-transparent" />
          <kbd className="text-[11px] bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-slate-400">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {flat.length === 0 && (
            <div className="px-4 py-10 text-center text-slate-400 text-sm">
              No results for “{q}” — try “robux”, “v-bucks”, “nitro”…
            </div>
          )}

          {results.prods.length > 0 && <div className="px-4 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t('palette.products', 'Products')}</div>}
          {results.prods.map((p, i) => {
            const img = p.image || iconFor(p.category);
            const idx = i;
            return (
              <div key={p.id} data-idx={idx} role="option" aria-selected={sel === idx} tabIndex={-1}
                onClick={() => go(flat[idx])} onMouseEnter={() => setSel(idx)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition ${sel === idx ? 'bg-violet-50' : ''}`}>
                <span className="w-9 h-9 rounded-lg bg-slate-50 grid place-items-center shrink-0">
                  {img ? <img src={img} alt="" className="w-6 h-6 object-contain" /> : <PackageSearch size={16} className="text-slate-400" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900 truncate">{p.name}</span>
                  <span className="block text-xs text-slate-400 capitalize">{(p.category || '').replace(/-/g, ' ')}</span>
                </span>
                <span className="text-sm font-semibold text-violet-600 shrink-0">{money(p.price, p.currency)}</span>
                <button onClick={(e) => { e.stopPropagation(); add(p); toast.success(`${p.name} added`); }}
                  title="Add to cart" aria-label="Add to cart"
                  className="w-7 h-7 rounded-md grid place-items-center text-slate-400 hover:text-violet-600 hover:bg-white shrink-0">
                  <ShoppingCart size={14} />
                </button>
              </div>
            );
          })}

          {results.acts.length > 0 && <div className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t('palette.actions', 'Quick actions')}</div>}
          {results.acts.map((a, i) => {
            const idx = results.prods.length + i;
            const Icon = a.icon;
            return (
              <button key={a.id} data-idx={idx} onClick={() => go(flat[idx])} onMouseEnter={() => setSel(idx)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${sel === idx ? 'bg-violet-50' : ''}`}>
                <span className="w-9 h-9 rounded-lg bg-slate-50 grid place-items-center shrink-0"><Icon size={16} className="text-slate-500" /></span>
                <span className="flex-1 text-sm font-medium text-slate-800">{a.label}</span>
                <ArrowRight size={14} className="text-slate-300" />
              </button>
            );
          })}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 h-10 border-t border-slate-100 text-[11px] text-slate-400 bg-slate-50/60">
          <span className="flex items-center gap-1"><kbd className="bg-white border border-slate-200 rounded px-1">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="bg-white border border-slate-200 rounded px-1 inline-flex items-center"><CornerDownLeft size={10} /></kbd> open</span>
          <span className="ml-auto">{products.length} products indexed</span>
        </div>
      </div>
    </div>
  );
}
