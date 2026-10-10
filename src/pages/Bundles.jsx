import { Link } from 'react-router-dom';
import { ShoppingCart, Package, CloudOff, Info } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { usePageMeta } from '../lib/useMeta.js';
import { money } from '../lib/catalog.js';
import { CATALOG_UNAVAILABLE } from '../lib/sampleCatalog.js';
import { useBundles, BundleThumb } from '../lib/useBundles.jsx';
import { bundleText, addBundleToCart } from '../lib/bundles.js';

/**
 * Every active bundle, with what is in it and what it costs.
 *
 * This is where the mystery box used to be offered, and it is its opposite: a
 * box sold a chance at a prize, a bundle names exactly what you get. Every
 * figure on a card is the server's — the products at today's prices, the
 * discount it gives and what is left to pay (pricedBundles) — and the same
 * discount is what the cart and the checkout then show, from the server's quote
 * of the actual cart. Nothing here does arithmetic, so the card cannot promise
 * a price the checkout does not charge.
 */
export default function Bundles() {
  /* No arguments: the title and description for /bundles live in
     content/seo.js in all four languages, the same copy the prerendered HTML
     carries for a crawler or a link preview. */
  usePageMeta();
  const { t, lang } = useI18n();
  const { bundles, failed } = useBundles();
  const { add, prelaunch } = useCart();
  const toast = useToast();

  const addBundle = (b) => {
    if (addBundleToCart(b, add) === 'closed') {
      toast(t('launch.cartClosed', 'ForgeMarket opens on launch day — you can browse everything until then.'));
      return;
    }
    toast.success(`${bundleText(b, lang).name} — ${t('bundle.added', 'added, you save')} ${money(b.discount, b.currency)}!`);
  };

  return (
    <div className="max-w-[1100px] mx-auto px-4 lg:px-8 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900">{t('bundles.title', 'Bundles: cheaper together')}</h1>
      <p className="text-slate-600 mt-2 max-w-2xl leading-relaxed">
        {t('bundles.intro', 'Products that belong together, at a lower price as a set. Put the whole set in your cart and the discount comes off by itself — your cart shows it before you pay. Bundle discounts don’t stack: an order gets the biggest one.')}
      </p>

      <div className="mt-8">
        {bundles === null ? (
          /* Two cards' worth of space while the answer is on its way, so the
             footer does not sit under the heading and then drop away. */
          <div className="grid md:grid-cols-2 gap-5" aria-hidden>
            {[0, 1].map((i) => <div key={i} className="h-[380px] rounded-2xl fm-skeleton" />)}
          </div>
        ) : failed ? (
          /* Not "no bundles": the shop did not answer, and saying it has
             nothing would send someone away who should come back later. */
          <div role="status" className="rounded-2xl border border-amber-300/70 bg-amber-50 px-5 py-4 flex items-start gap-3">
            <CloudOff size={20} className="text-amber-600 shrink-0 mt-0.5" aria-hidden />
            <div className="text-sm">
              <p className="font-semibold text-slate-800">{t('shop.unavailable', CATALOG_UNAVAILABLE.title.en)}</p>
              <p className="text-slate-600 mt-0.5">{t('shop.unavailableSub', CATALOG_UNAVAILABLE.hint.en)}</p>
            </div>
          </div>
        ) : bundles.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/70 p-10 text-center">
            <Package className="mx-auto text-slate-300 mb-3" size={40} aria-hidden />
            <p className="font-semibold text-slate-700">{t('bundles.none', 'No bundles right now')}</p>
            <p className="text-slate-500 text-sm mt-1">
              {t('bundles.noneSub', 'When there is one, you will find it here. Everything in the shop is for sale on its own too.')}
            </p>
            <Link to="/shop" className="btn-primary mt-6 inline-flex">{t('cart.browse', 'Browse shop')}</Link>
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-5">
              {bundles.map((b) => {
                const { name, description } = bundleText(b, lang);
                return (
                  <article key={b.id} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-lg font-extrabold text-slate-900">{name}</h2>
                        {description && <p className="text-slate-500 text-sm mt-0.5">{description}</p>}
                      </div>
                      <span className="shrink-0 text-xs font-bold text-white rounded-full px-2.5 py-1"
                        style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>−{b.discountPercent}%</span>
                    </div>

                    {/* What is in it: each product, linked to its own page,
                        at the price it costs on its own. */}
                    <ul className="mt-4 divide-y divide-slate-100">
                      {b.products.map((p, i) => (
                        <li key={`${p.id}-${i}`} className="flex items-center gap-3 py-2.5">
                          <Link to={`/product/${p.id}`} tabIndex={-1} aria-hidden="true"
                            className="w-[72px] h-[56px] rounded-xl bg-slate-100 grid place-items-center overflow-hidden shrink-0">
                            <BundleThumb p={p} />
                          </Link>
                          <Link to={`/product/${p.id}`}
                            className="flex-1 min-w-0 font-semibold text-[15px] text-slate-800 hover:text-violet-700 transition line-clamp-2">
                            {p.name}
                          </Link>
                          <span className="shrink-0 text-sm text-slate-500 tabular-nums">{money(p.price, b.currency)}</span>
                        </li>
                      ))}
                    </ul>

                    <dl className="mt-auto pt-4 border-t border-slate-100 space-y-1.5 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">{t('bundles.separately', 'Bought separately')}</dt>
                        <dd className="text-slate-500 line-through tabular-nums">{money(b.subtotal, b.currency)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-emerald-700 font-semibold">{t('bundles.youSave', 'You save')}</dt>
                        <dd className="text-emerald-700 font-semibold tabular-nums">−{money(b.discount, b.currency)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <dt className="font-bold text-slate-900">{t('bundles.price', 'Bundle price')}</dt>
                        <dd className="text-2xl font-extrabold text-violet-600 tabular-nums">{money(b.total, b.currency)}</dd>
                      </div>
                    </dl>

                    {/* Before launch the cart cannot take it, so the card says
                        when it can rather than offering a button that refuses. */}
                    {prelaunch ? (
                      <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-center">
                        <span className="text-sm font-semibold text-violet-700">{t('launch.ctaClosed', 'Opens on launch day')}</span>
                      </div>
                    ) : (
                      <button type="button" onClick={() => addBundle(b)} className="btn-primary w-full mt-4 py-3">
                        <ShoppingCart size={17} /> {t('bundles.addAll', 'Add bundle to cart')}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
            <p className="flex items-start gap-2 text-sm text-slate-500 mt-6 max-w-2xl">
              <Info size={16} className="shrink-0 mt-0.5 text-slate-400" aria-hidden />
              {t('bundles.delivery', 'Each product in a bundle is delivered the way its own page describes.')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
