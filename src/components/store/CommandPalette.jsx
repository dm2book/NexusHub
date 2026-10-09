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
import { useFocusTrap } from '../../lib/useFocusTrap.js';

/**
 * Global search command palette (⌘K / Ctrl+K, or the nav search box).
 * Live product search with keyboard navigation + quick actions — the nav's
 * "⌘K" hint is now a real feature instead of decoration.
 * Open programmatically with: window.dispatchEvent(new CustomEvent('forge:cmdk'))
 *
 * A combobox, for a screen reader. The arrow keys moved a highlight that only
 * sighted users could see: focus stays in the search box while you arrow
 * through the results, so the row has to be announced through
 * aria-activedescendant or the list is silent. Focus is trapped in the dialog
 * while it is open and handed back to whatever opened it — see useFocusTrap.
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
  const panelRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  // Escape lives here now, with the focus that has to come back after it.
  useFocusTrap(open, panelRef, { onEscape: close, initialFocusRef: inputRef });

  // Open triggers: ⌘K / Ctrl+K + custom event from the nav search boxes.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
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
    const acts = ACTIONS.map((a) => ({ ...a, label: t(`palette.${a.id}`, a.label) }))
      .filter((a) => !term || normalizeSearch(a.label).includes(term) || normalizeSearch(a.kw).includes(term));
    return { prods, acts };
  }, [q, products, t]);

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

  const optionId = (i) => `fm-cmdk-opt-${i}`;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[12vh] px-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={close} />
      {/* The dialog is the panel, not the full-screen wrapper: the dimmed
          backdrop is not part of it, and tabIndex lets focus rest on the panel
          itself for the instant before it reaches the search box. */}
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t('palette.dialog', 'Search')} tabIndex={-1}
        style={{ outline: 'none' }}
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden fm-pop">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-100">
          <Search size={18} className="text-slate-400 shrink-0" aria-hidden="true" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded={flat.length > 0} aria-controls="fm-cmdk-list" aria-autocomplete="list"
            aria-activedescendant={flat.length ? optionId(sel) : undefined}
            aria-label={t('palette.dialog', 'Search')}
            placeholder={t('palette.placeholder', 'Search products, or type what you need…')}
            className="flex-1 outline-none text-[15px] text-slate-900 placeholder-slate-400 bg-transparent" />
          <kbd className="text-[11px] bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-slate-400">esc</kbd>
        </div>

        {/* Results. The empty message sits outside the listbox: a listbox may
            only hold options, and "no results" is not one to arrow onto. */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {flat.length === 0 && (
            <div role="status" className="px-4 py-10 text-center text-slate-400 text-sm">
              {t('palette.none', 'No results for “{q}” — try “robux”, “v-bucks”, “nitro”…', { q })}
            </div>
          )}

          <div id="fm-cmdk-list" role="listbox" aria-label={t('palette.results', 'Results')}>
          {results.prods.length > 0 && (
          <div role="group" aria-labelledby="fm-cmdk-products">
          <div id="fm-cmdk-products" className="px-4 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t('palette.products', 'Products')}</div>
          {results.prods.map((p, i) => {
            const img = p.image || iconFor(p.category);
            const idx = i;
            return (
              /* Named explicitly: an option's contents are read as one flat
                 string, and the add-to-cart button inside would have been read
                 into the middle of every product's name. */
              <div key={p.id} id={optionId(idx)} data-idx={idx} role="option" aria-selected={sel === idx}
                aria-label={`${p.name}, ${money(p.price, p.currency)}`}
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
                {/* A pointer shortcut. Out of the Tab order, because inside the
                    combobox the keyboard moves with the arrows and Enter opens
                    the product, where the same button is a proper one. */}
                <button type="button" tabIndex={-1} aria-hidden="true"
                  onClick={(e) => { e.stopPropagation(); add(p); toast.success(t('palette.added', '{name} added to your cart', { name: p.name })); }}
                  title={t('palette.addToCart', 'Add to cart')}
                  className="w-7 h-7 rounded-md grid place-items-center text-slate-400 hover:text-violet-600 hover:bg-white shrink-0">
                  <ShoppingCart size={14} />
                </button>
              </div>
            );
          })}

          </div>
          )}

          {results.acts.length > 0 && (
          <div role="group" aria-labelledby="fm-cmdk-actions">
          <div id="fm-cmdk-actions" className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t('palette.actions', 'Quick actions')}</div>
          {results.acts.map((a, i) => {
            const idx = results.prods.length + i;
            const Icon = a.icon;
            return (
              <div key={a.id} id={optionId(idx)} data-idx={idx} role="option" aria-selected={sel === idx}
                onClick={() => go(flat[idx])} onMouseEnter={() => setSel(idx)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition ${sel === idx ? 'bg-violet-50' : ''}`}>
                <span className="w-9 h-9 rounded-lg bg-slate-50 grid place-items-center shrink-0"><Icon size={16} className="text-slate-500" /></span>
                <span className="flex-1 text-sm font-medium text-slate-800">{a.label}</span>
                <ArrowRight size={14} className="text-slate-300" />
              </div>
            );
          })}
          </div>
          )}
          </div>
        </div>

        {/* Footer hints — decoration for a mouse user, and already said by the
            combobox itself to a screen reader. */}
        <div aria-hidden="true" className="flex items-center gap-4 px-4 h-10 border-t border-slate-100 text-[11px] text-slate-400 bg-slate-50/60">
          <span className="flex items-center gap-1"><kbd className="bg-white border border-slate-200 rounded px-1">↑↓</kbd> {t('palette.navigate', 'navigate')}</span>
          <span className="flex items-center gap-1"><kbd className="bg-white border border-slate-200 rounded px-1 inline-flex items-center"><CornerDownLeft size={10} /></kbd> {t('palette.open', 'open')}</span>
          <span className="ml-auto">{t('palette.indexed', '{n} products indexed', { n: products.length })}</span>
        </div>
      </div>
    </div>
  );
}
