import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, PackageX, Bell, BellOff, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { withFallback } from '../lib/sampleCatalog.js';
import { useWishlist } from '../lib/wishlist.js';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import LightProductCard from '../components/store/LightProductCard.jsx';
import { EmptyState, SkeletonCard } from '../components/ui.jsx';
import { usePageMeta } from '../lib/useMeta.js';
import { useI18n } from '../lib/i18n.jsx';

/**
 * Saved products, and — once signed in — what their prices have done since.
 *
 * Three numbers per product, because each answers a different question: what
 * it cost when you saved it (is this a deal for ME), what it cost before its
 * last change (did it just move), and what it costs now. The badge is the one
 * that matters to a shopper: now against when they saved it.
 */
export default function Wishlist() {
  const { add } = useCart();
  const toast = useToast();
  const wl = useWishlist();
  const { t } = useI18n();
  const [products, setProducts] = useState(null);
  const [account, setAccount] = useState(null);          // productId → wishlist row, when signed in
  usePageMeta('Wishlist', 'Your saved items.');

  useEffect(() => {
    api.get('/api/products').then((r) => setProducts(withFallback(r.products))).catch(() => setProducts([])); // a failed load is not an empty wishlist of samples
  }, []);

  const loadAccount = useCallback(() => {
    if (!wl.signedIn) { setAccount(null); return; }
    api.get('/api/account/wishlist')
      .then((r) => setAccount(Object.fromEntries((r.items || []).map((i) => [i.productId, i]))))
      .catch(() => setAccount(null));
  }, [wl.signedIn]);
  // Reloaded when the list changes, so a new heart gets its saved price.
  useEffect(() => { loadAccount(); }, [loadAccount, wl.count]);

  const setAlert = async (productId, enabled, targetPrice = null) => {
    try {
      const r = await api.patch(`/api/account/wishlist/${productId}/alert`, { enabled, targetPrice });
      setAccount(Object.fromEntries((r.items || []).map((i) => [i.productId, i])));
      toast.success(enabled ? t('wish.alertSaved', 'Price alert on — we email you (and DM you on Discord) when it drops.')
        : t('wish.alertRemoved', 'Price alert off.'));
    } catch (e) { toast.error(e.message); }
  };

  const items = (products || []).filter((p) => wl.has(p.id));
  const onAdd = (p) => { add(p); toast.success(`${p.name} ${t('cart.addedToCart', 'added to cart')}`); };

  return (
    <div className="max-w-[1200px] mx-auto px-4 lg:px-8 py-12">
      <h1 className="text-3xl font-extrabold text-slate-900 mb-2 flex items-center gap-2"><Heart className="text-rose-500" /> {t('wish.title', 'Wishlist')}</h1>
      <p className="text-slate-500 mb-8">
        {wl.signedIn
          ? t('wish.subAccount', 'Saved to your account. Turn on a price alert and we tell you when it gets cheaper.')
          : t('wish.sub', 'Items you saved — they live in this browser.')}
        {!wl.signedIn && (
          <> {' '}<Link to="/login" className="text-indigo-600 font-medium">
            {t('wish.guestAlerts', 'Sign in to get price alerts by email and Discord.')}</Link></>
        )}
      </p>
      {products === null ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={PackageX} title={t('wish.empty', 'No saved items yet')}
          hint={t('wish.emptyHint', 'Tap the heart on any product to save it here.')}
          action={<Link to="/shop" className="btn-primary">{t('cart.browse', 'Browse shop')}</Link>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 fm-grid-in">
          {items.map((p) => (
            <div key={p.id} className="flex flex-col gap-2">
              <LightProductCard product={p} onAdd={onAdd} />
              {account?.[p.id] && <PricePanel row={account[p.id]} t={t} onAlert={setAlert} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The three prices, the difference, and the alert — under one saved product. */
function PricePanel({ row, t, onAlert }) {
  const [target, setTarget] = useState(row.alert.targetPrice == null ? '' : (row.alert.targetPrice / 100).toFixed(2));
  const diff = row.diffSinceSaved;
  const saveTarget = () => {
    const cents = target.trim() === '' ? null : Math.round(Number(String(target).replace(',', '.')) * 100);
    if (cents != null && !(cents >= 0)) return;
    if (cents !== row.alert.targetPrice) onAlert(row.productId, true, cents);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-[12.5px]" data-testid="wish-prices">
      <div className="grid grid-cols-3 gap-1 text-center">
        <div>
          <div className="text-slate-400 text-[11px]">{t('wish.savedAt', 'When saved')}</div>
          <div className="text-slate-700">{money(row.savedPrice)}</div>
        </div>
        <div>
          <div className="text-slate-400 text-[11px]">{t('wish.previous', 'Previous')}</div>
          <div className="text-slate-500 line-through decoration-slate-300">
            {row.previousPrice == null ? '—' : money(row.previousPrice)}
          </div>
        </div>
        <div>
          <div className="text-slate-400 text-[11px]">{t('wish.now', 'Now')}</div>
          <div className="text-slate-900 font-semibold">{money(row.currentPrice)}</div>
        </div>
      </div>

      {/* Icon inline with the words, not beside them: in a narrow card the
          sentence wraps and a flex item was left hanging on its own. */}
      <div className={`mt-2 text-center font-medium ${
        diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-slate-500' : 'text-slate-400'}`}>
        {diff < 0 && <TrendingDown size={14} className="inline -mt-0.5 mr-1" />}
        {diff > 0 && <TrendingUp size={14} className="inline -mt-0.5 mr-1" />}
        {diff < 0 ? t('wish.cheaper', '{x} cheaper than when you saved it', { x: money(-diff) })
          : diff > 0 ? t('wish.dearer', '{x} more than when you saved it', { x: money(diff) })
            : t('wish.same', 'Same price as when you saved it')}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => onAlert(row.productId, !row.alert.enabled, row.alert.enabled ? null : row.alert.targetPrice)}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 border ${
            row.alert.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          aria-pressed={row.alert.enabled}>
          {row.alert.enabled ? <Bell size={13} /> : <BellOff size={13} />}
          {row.alert.enabled ? t('wish.alertOn', 'Price alert on') : t('wish.alertOff', 'Alert me when it drops')}
        </button>
      </div>
      {row.alert.enabled && (
        <label className="mt-2 flex items-center gap-2 text-slate-500">
          <span className="whitespace-nowrap">{t('wish.target', 'Only below €')}</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} onBlur={saveTarget}
            inputMode="decimal" placeholder={t('wish.anyDrop', 'any drop')}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
        </label>
      )}
    </div>
  );
}
