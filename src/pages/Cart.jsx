import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { categoryVisual, money } from '../lib/catalog.js';
import { iconFor } from '../lib/sampleCatalog.js';
import { navigateWithTransition } from '../lib/viewTransition.js';
import LightProductCard from '../components/store/LightProductCard.jsx';
import { usePageMeta } from '../lib/useMeta.js';
import { matchBundle } from '../lib/bundles.js';

export default function Cart() {
  usePageMeta('Your cart', 'Review the items in your cart before checking out.');
  const { items, setQty, remove, subtotal, currency, add } = useCart();
  const { t } = useI18n();
  const navigate = useNavigate();
  // The cart used to show the plain subtotal, so a bundle looked more expensive
  // here than on the card that sold it — and than what the server actually
  // charges. Same rule as checkout, from one place.
  const [bundles, setBundles] = useState([]);
  useEffect(() => { api.get('/api/bundles').then((r) => setBundles(r.bundles || [])).catch(() => {}); }, []);
  const bundle = matchBundle(items, bundles);
  const total = Math.max(0, subtotal - (bundle?.discount || 0));

  if (items.length === 0) {
    return (
      <div className="max-w-[1100px] mx-auto px-4 lg:px-8 py-16">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-8">{t('cart.title', 'Your cart')}</h1>
        <div className="bg-white rounded-2xl border border-slate-200/70 p-14 text-center">
          <ShoppingBag className="mx-auto text-slate-300 mb-3" size={44} />
          <p className="font-semibold text-slate-700">{t('cart.empty', 'Your cart is empty')}</p>
          <p className="text-slate-400 text-sm mt-1">{t('cart.emptySub', 'Browse the shop and add some digital goods.')}</p>
          <Link to="/shop" className="btn-primary mt-6 inline-flex">{t('cart.browse', 'Browse shop')}</Link>
        </div>
        {/* Turn the dead end into a starting point: real trending products. */}
        <EmptyCartTrending onAdd={add} />
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto px-4 lg:px-8 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900 mb-8">{t('cart.title', 'Your cart')}</h1>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {items.map((it) => {
            const v = categoryVisual(it.category); const img = it.image || iconFor(it.category); const Icon = v.icon;
            return (
              <div key={it.id} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-slate-50 grid place-items-center shrink-0">
                  {img ? <img src={img} alt="" className="w-12 h-12 object-contain" />
                    : <span className={`w-12 h-12 rounded-lg bg-gradient-to-br ${v.grad} grid place-items-center`}><Icon size={22} className="text-white" /></span>}
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/product/${it.id}`} className="font-semibold text-slate-900 hover:text-violet-600 transition">{it.name}</Link>
                  <div className="text-slate-400 text-sm">{money(it.price, it.currency)} {t('cart.each', 'each')}</div>
                </div>
                <div className="flex items-center bg-slate-100 rounded-lg">
                  <button onClick={() => setQty(it.id, it.qty - 1)} className="p-2 text-slate-500 hover:text-slate-900"><Minus size={14} /></button>
                  <span className="w-8 text-center text-slate-900 text-sm font-medium">{it.qty}</span>
                  <button onClick={() => setQty(it.id, it.qty + 1)} className="p-2 text-slate-500 hover:text-slate-900"><Plus size={14} /></button>
                </div>
                <div className="w-24 text-right font-semibold text-slate-900">{money(it.price * it.qty, it.currency)}</div>
                <button onClick={() => remove(it.id)} className="p-2 text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>

        <div style={{ viewTransitionName: 'order-summary' }} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-6 h-fit">
          <h3 className="font-bold text-slate-900 mb-5">{t('cart.summary', 'Order summary')}</h3>
          <div className="flex justify-between text-sm text-slate-500 mb-2">
            <span>{t('cart.subtotal', 'Subtotal')}</span><span className="text-slate-900 font-medium">{money(subtotal, currency)}</span>
          </div>
          {bundle && (
            <div className="flex justify-between text-sm mb-2">
              <span className="text-violet-600 font-medium">
                {t('cart.bundleApplied', 'Bundle')} · {bundle.name} (−{bundle.percent}%)
              </span>
              <span className="text-violet-600 font-semibold">−{money(bundle.discount, currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-slate-500 mb-4">
            <span>{t('cart.delivery', 'Delivery')}</span><span className="text-emerald-600 font-medium">{t('cart.deliveryFree', 'Free')}</span>
          </div>
          <div className="flex justify-between text-lg border-t border-slate-100 pt-4 mb-6">
            <span className="text-slate-600">{t('cart.total', 'Total')}</span>
            <span className="text-slate-900 font-bold">{money(total, currency)}</span>
          </div>
          <button onClick={() => navigateWithTransition(navigate, '/checkout')} className="btn-primary w-full py-3">
            {t('cart.checkout', 'Checkout')} <ArrowRight size={18} />
          </button>
          <Link to="/shop" className="block text-center text-sm text-slate-500 hover:text-violet-600 mt-4">{t('cart.continue', 'Continue shopping')}</Link>
        </div>
      </div>

      <CartCrossSell items={items} onAdd={add} />
    </div>
  );
}

/** Trending rail for the empty-cart state (real sales data; hides when empty). */
function EmptyCartTrending({ onAdd }) {
  const toast = useToast();
  const { t } = useI18n();
  const [trending, setTrending] = useState([]);
  useEffect(() => { api.get('/api/products/trending').then((r) => setTrending(r.products || [])).catch(() => {}); }, []);
  if (trending.length === 0) return null;
  return (
    <div className="mt-12">
      <h2 className="text-xl font-extrabold text-slate-900 mb-5">{t('cart.popular', 'Popular right now')}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 fm-grid-in">
        {trending.slice(0, 4).map((p) => <LightProductCard key={p.id} product={p} onAdd={(x) => { onAdd(x); toast.success(`${x.name} ${t('cart.added', 'added')}`); }} />)}
      </div>
    </div>
  );
}

/** "Complete your order" — cross-sell rail driven by the first cart item's
 *  recommendations, falling back to trending; hides items already in the cart. */
function CartCrossSell({ items, onAdd }) {
  const toast = useToast();
  const { t } = useI18n();
  const [recs, setRecs] = useState([]);
  const seed = items[0]?.id;
  useEffect(() => {
    let live = true;
    const fromTrending = () => api.get('/api/products/trending').then((r) => r.products || []);
    const p = seed
      ? api.get(`/api/products/${seed}/recommendations`).then((r) => (r.crossSell?.length ? r.crossSell : fromTrending())).catch(fromTrending)
      : fromTrending();
    Promise.resolve(p).then((list) => { if (live) setRecs(list || []); }).catch(() => {});
    return () => { live = false; };
  }, [seed]);

  const inCart = new Set(items.map((i) => i.id));
  const show = recs.filter((p) => !inCart.has(p.id)).slice(0, 4);
  if (show.length === 0) return null;

  return (
    <div className="mt-12">
      <h2 className="text-xl font-extrabold text-slate-900 mb-5">{t('cart.completeOrder', 'Complete your order')}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 fm-grid-in">
        {show.map((p) => <LightProductCard key={p.id} product={p} onAdd={(x) => { onAdd(x); toast.success(`${x.name} ${t('cart.added', 'added')}`); }} />)}
      </div>
    </div>
  );
}
