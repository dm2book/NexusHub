import { Link } from 'react-router-dom';
import { Plus, ShoppingCart } from 'lucide-react';
import { money } from '../../lib/catalog.js';
import { useCart } from '../../context/CartContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { useBundles, BundleThumb } from '../../lib/useBundles.jsx';
import { bundleText, addBundleToCart } from '../../lib/bundles.js';

/**
 * "Cheaper together" on a product page: the bundles this product is part of.
 *
 * Shown only when the product really is in an active bundle, and only with the
 * server's figures — the other products at today's prices, the bundle price
 * and the saving, exactly as /bundles shows them. "Add bundle" adds what is
 * missing from one set, not the whole set again: the product being looked at
 * is often already in the cart, and a second one of it is not what anybody
 * pressing this meant.
 *
 * Two at most. A product in more bundles than that is an owner's catalogue
 * decision, and the rest are one tap away on /bundles.
 */
export default function BundleOffer({ product }) {
  const { t, lang } = useI18n();
  const { bundles } = useBundles();
  const { items, add, prelaunch } = useCart();
  const toast = useToast();

  const offers = (bundles || [])
    .filter((b) => b.products?.some((p) => p.id === product.id))
    .slice(0, 2);
  if (!offers.length) return null;

  const addMissing = (b) => {
    const r = addBundleToCart(b, add, items);
    if (r === 'closed') {
      toast(t('launch.cartClosed', 'ForgeMarket opens on launch day — you can browse everything until then.'));
    } else if (r === 'already') {
      toast(t('bundles.inCart', 'This bundle is already in your cart.'));
    } else {
      toast.success(`${bundleText(b, lang).name} — ${t('bundle.added', 'added, you save')} ${money(b.discount, b.currency)}!`);
    }
  };

  return (
    <div className="mt-6 space-y-3" data-testid="bundle-offer">
      {offers.map((b) => {
        /* The other products of the set; this one is the page itself. Counted
           by position, so a bundle that holds this product twice still lists
           the second copy as something to add. */
        const others = [...b.products];
        others.splice(others.findIndex((p) => p.id === product.id), 1);
        return (
          <section key={b.id} aria-labelledby={`bundle-offer-${b.id}`}
            className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id={`bundle-offer-${b.id}`} className="text-[15px] font-extrabold text-slate-900">{t('bundles.together', 'Cheaper together')}</h2>
                <p className="text-[13px] text-slate-600 mt-0.5">{bundleText(b, lang).name}</p>
              </div>
              <span className="shrink-0 text-xs font-bold text-white rounded-full px-2.5 py-1"
                style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>−{b.discountPercent}%</span>
            </div>
            <ul className="mt-3 space-y-2">
              {others.map((p, i) => (
                <li key={`${p.id}-${i}`} className="flex items-center gap-3">
                  <Plus size={14} className="text-violet-500 shrink-0" aria-hidden />
                  <Link to={`/product/${p.id}`} tabIndex={-1} aria-hidden="true"
                    className="w-[72px] h-[56px] rounded-xl bg-white grid place-items-center overflow-hidden shrink-0">
                    <BundleThumb p={p} />
                  </Link>
                  <Link to={`/product/${p.id}`}
                    className="flex-1 min-w-0 text-sm font-semibold text-slate-800 hover:text-violet-700 transition line-clamp-2">
                    {p.name}
                  </Link>
                  <span className="shrink-0 text-sm text-slate-500 tabular-nums">{money(p.price, b.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end justify-between gap-3 mt-3 pt-3 border-t border-violet-200">
              <div>
                <div className="text-[12px] text-slate-500">{t('bundles.price', 'Bundle price')}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-extrabold text-violet-700 tabular-nums">{money(b.total, b.currency)}</span>
                  <s className="text-sm text-slate-500 tabular-nums">{money(b.subtotal, b.currency)}</s>
                </div>
                <div className="text-[13px] font-semibold text-emerald-700">
                  {t('bundles.youSave', 'You save')} {money(b.discount, b.currency)}
                </div>
              </div>
              {!prelaunch && (
                <button type="button" onClick={() => addMissing(b)} className="btn-primary py-2.5 px-4 text-sm">
                  <ShoppingCart size={16} /> {t('bundle.add', 'Add bundle')}
                </button>
              )}
            </div>
            <p className="text-[12px] text-slate-500 mt-2">
              {t('pd.bundleNote', 'The discount comes off by itself once the whole set is in your cart.')}
            </p>
          </section>
        );
      })}
    </div>
  );
}
