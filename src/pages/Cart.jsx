import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
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
import { useStickyBarLift } from '../lib/useStickyBarLift.js';

export default function Cart() {
  usePageMeta('Your cart', 'Review the items in your cart before checking out.');
  useStickyBarLift(); // keep the chat bubble off the sticky checkout bar
  const { items, setQty, remove, subtotal, currency, add } = useCart();
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  // The cart used to show the plain subtotal, so a bundle looked more expensive
  // here than on the card that sold it — and than what the server actually
  // charges. Same rule as checkout, from one place.
  const [bundles, setBundles] = useState([]);
  useEffect(() => { api.get('/api/bundles').then((r) => setBundles(r.bundles || [])).catch(() => {}); }, []);
  const bundle = matchBundle(items, bundles);
  /* The server also takes a standing percentage off for Forge+ members
     (createOrder → memberDiscountPercent). This total left it out, so a member
     saw €4.49 here and was billed €4.27 — the same class of mismatch as the
     bundle bug: the client recomputing a total the server owns. Mirrors the
     server's order: percentage off the SUBTOTAL, then the bundle. */
  const memberPercent = user?.memberPercent || 0;
  const memberDiscount = memberPercent ? Math.round(subtotal * memberPercent / 100) : 0;
  const total = Math.max(0, subtotal - memberDiscount - (bundle?.discount || 0));

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
              /* Thumbnail, name, stepper, line price and remove were one
                 non-wrapping row. At 390px that row measured 472px, so the LINE
                 PRICE — the number the buyer is checking — was pushed off the
                 screen entirely. Below sm the stepper and price move onto their
                 own line under the name; from sm up the original row returns. */
              <div key={it.id} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-3 sm:p-4
                grid grid-cols-[auto_1fr_auto] sm:flex sm:items-center gap-x-3 sm:gap-4 gap-y-3">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-slate-50 grid place-items-center shrink-0 row-span-1">
                  {img ? <img src={img} alt="" className="w-11 h-11 sm:w-12 sm:h-12 object-contain" />
                    : <span className={`w-11 h-11 sm:w-12 sm:h-12 rounded-lg bg-gradient-to-br ${v.grad} grid place-items-center`}><Icon size={22} className="text-white" /></span>}
                </div>
                <div className="min-w-0 sm:flex-1 self-center">
                  <Link to={`/product/${it.id}`} className="font-semibold text-slate-900 hover:text-violet-600 transition line-clamp-2">{it.name}</Link>
                  <div className="text-slate-400 text-sm">{money(it.price, it.currency)} {t('cart.each', 'each')}</div>
                </div>
                <button onClick={() => remove(it.id)} aria-label={t('cart.remove', 'Remove')}
                  className="w-11 h-11 shrink-0 self-start sm:self-center grid place-items-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 sm:order-last"><Trash2 size={17} /></button>
                <div className="col-span-3 sm:col-auto flex items-center justify-between sm:justify-start gap-3 sm:contents">
                  <div className="flex items-center bg-slate-100 rounded-xl">
                    <button onClick={() => setQty(it.id, it.qty - 1)} aria-label={t('cart.less', 'One less')}
                      className="w-11 h-11 grid place-items-center text-slate-500 hover:text-slate-900 rounded-l-xl active:scale-95 transition-transform"><Minus size={16} /></button>
                    <span className="w-8 text-center text-slate-900 text-[15px] font-semibold tabular-nums">{it.qty}</span>
                    <button onClick={() => setQty(it.id, it.qty + 1)} aria-label={t('cart.more', 'One more')}
                      className="w-11 h-11 grid place-items-center text-slate-500 hover:text-slate-900 rounded-r-xl active:scale-95 transition-transform"><Plus size={16} /></button>
                  </div>
                  <div className="sm:w-24 text-right font-bold text-[17px] sm:text-base text-slate-900 tabular-nums">{money(it.price * it.qty, it.currency)}</div>
                </div>
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
          {memberDiscount > 0 && (
            <div className="flex justify-between text-sm mb-2">
              <span className="text-violet-600 font-medium">{t('cart.memberOff', 'Forge+ member — {n}% off', { n: memberPercent })}</span>
              <span className="text-violet-600 font-medium">−{money(memberDiscount, currency)}</span>
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

      {/* Measured with three items on a 390px phone: the Checkout button sat at
          869px in an 844px viewport — off screen, with nothing pinned. The
          checkout page already has a bar like this; the cart, one step earlier
          in the same funnel, did not. Sits above the 63px tab bar, and repeats
          the total so the buyer never has to scroll back to check it. */}
      <div className="lg:hidden fixed inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 flex items-center gap-3"
        style={{ bottom: 'calc(63px + env(safe-area-inset-bottom))' }}>
        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">{t('cart.total', 'Total')}</div>
          <div className="text-[19px] font-extrabold text-slate-900 leading-tight tabular-nums">{money(total, currency)}</div>
        </div>
        <button onClick={() => navigateWithTransition(navigate, '/checkout')}
          className="btn-primary flex-1 h-12 fm-press">
          {t('cart.checkout', 'Checkout')} <ArrowRight size={18} />
        </button>
      </div>
      {/* Clearance so the last card is never hidden behind the bar above. */}
      <div className="lg:hidden h-24" aria-hidden />
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
        {/* The first row is above the fold on a phone and was the cart's LCP
            element — measured at 2.9 s, most of it spent fading in. Marked
            priority so it paints on its first frame like the catalogue's. */}
        {trending.slice(0, 4).map((p, i) => <LightProductCard key={p.id} product={p} priority={i < 2} onAdd={(x) => { onAdd(x); toast.success(`${x.name} ${t('cart.added', 'added')}`); }} />)}
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
