import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Package, Plus, ArrowRight } from 'lucide-react';
import { money } from '../../lib/catalog.js';
import { iconFor } from '../../lib/sampleCatalog.js';
import { useCart } from '../../context/CartContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { useBundles, expectBundles, BUNDLE_ROW_SPACE, BundleThumb } from '../../lib/useBundles.jsx';
import { bundleText, addBundleToCart } from '../../lib/bundles.js';

/**
 * Storefront bundle offers. Each card shows the products, the original price
 * (struck through), the bundle price and the % saved. Adding a bundle drops all
 * its products into the cart — the discount then applies automatically at
 * checkout (the server validates it). Hides itself when there are no bundles.
 *
 * Two shapes. `grid` sits above the catalogue on /shop. `row` is the homepage's
 * shelf: the same offers in a horizontal rail with a link to /bundles, laid out
 * the way the homepage's other shelves are, so it reads as one more of them
 * rather than as an advert dropped between them.
 */
export default function BundlesShowcase({ variant = 'grid' }) {
  const { t, lang } = useI18n();
  const { bundles } = useBundles();
  const { add } = useCart();
  const toast = useToast();

  /**
   * Hold the space while the bundles are being fetched.
   *
   * This block sits ABOVE the product grid, so appearing late shoved the whole
   * catalogue down the page — measured as 0.31 of a layout shift on /shop, the
   * single largest on the site and most of what dragged that page's score to 57.
   *
   * The height is only reserved when we have reason to think something will
   * arrive (expectBundles): a shop with no bundles would otherwise open a gap
   * and then close it, trading one shift for another.
   */
  if (!bundles) {
    if (!expectBundles()) return null;
    return variant === 'row'
      ? <div className={BUNDLE_ROW_SPACE} aria-hidden />
      : <div className="mb-10 h-[248px] sm:h-[236px]" aria-hidden />;
  }
  if (bundles.length === 0) return null;

  /* The cart refuses before launch, and a toast saying "added" over a cart
     that stayed empty is worse than no button. */
  const addBundle = (b) => {
    if (addBundleToCart(b, add) === 'closed') {
      toast(t('launch.cartClosed', 'ForgeMarket opens on launch day — you can browse everything until then.'));
      return;
    }
    toast.success(`${bundleText(b, lang).name} — ${t('bundle.added', 'added, you save')} ${money(b.discount, b.currency)}!`);
  };

  if (variant === 'row') {
    return (
      <section aria-labelledby="fm-bundles-row">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1.5 sm:gap-4 mb-3">
          <div className="min-w-0">
            <h2 id="fm-bundles-row" className="fm-head text-2xl">{t('bundles.together', 'Cheaper together')}</h2>
            <p className="text-[13.5px] text-slate-600 mt-1 max-w-2xl leading-relaxed">
              {t('bundles.rowSub', 'Products that belong together, at a lower price as one set.')}
            </p>
          </div>
          <Link to="/bundles"
            className="shrink-0 self-start sm:self-auto text-violet-700 font-semibold text-sm inline-flex items-center gap-1 hover:gap-2 transition-all fm-hit">
            {t('bundles.all', 'All bundles')} <ArrowRight size={15} />
          </Link>
        </div>
        <div className="fm-rail flex gap-4 overflow-x-auto pb-2 scroll-smooth snap-x">
          {bundles.map((b) => (
            <div key={b.id} className="fm-pcard snap-start shrink-0 w-[300px] sm:w-[400px] rounded-2xl p-4">
              <div className="flex items-center gap-1.5">
                {b.products.slice(0, 3).map((p, i) => (
                  <Fragment key={`${p.id}-${i}`}>
                    {i > 0 && <Plus size={14} className="text-slate-400 shrink-0" aria-hidden />}
                    <Link to={`/product/${p.id}`} aria-label={p.name} tabIndex={-1}
                      className="w-[72px] h-[56px] rounded-xl bg-slate-100 grid place-items-center overflow-hidden shrink-0">
                      <BundleThumb p={p} />
                    </Link>
                  </Fragment>
                ))}
                <span className="ml-auto self-start text-xs font-bold text-white rounded-full px-2.5 py-1"
                  style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>−{b.discountPercent}%</span>
              </div>
              <h3 className="font-bold text-[15px] text-slate-900 mt-3 truncate" title={bundleText(b, lang).name}>
                {bundleText(b, lang).name}
              </h3>
              <p className="text-[12.5px] text-slate-500 mt-0.5 truncate">{b.products.map((p) => p.name).join(' + ')}</p>
              {/* All three figures are the server's: the products at today's
                  prices, the discount it gives, and what is left to pay. */}
              <div className="flex flex-wrap items-baseline gap-x-2 mt-2">
                <span className="fm-num text-violet-700 text-[17px]">{money(b.total, b.currency)}</span>
                <s className="text-[13px] text-slate-500">{money(b.subtotal, b.currency)}</s>
                <span className="ml-auto text-[12.5px] font-semibold text-emerald-700">
                  {t('bundles.youSave', 'You save')} {money(b.discount, b.currency)}
                </span>
              </div>
              <button type="button" onClick={() => addBundle(b)}
                className="fm-cta w-full mt-3 text-sm font-semibold rounded-lg h-11 inline-flex items-center justify-center gap-1.5">
                <Plus size={16} /> {t('bundles.addAll', 'Add bundle to cart')}
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-xl grid place-items-center bg-violet-100 text-violet-600"><Package size={17} /></span>
        <h2 className="text-xl font-extrabold text-slate-900">{t('bundle.title', 'Bundle & save')}</h2>
        <Link to="/bundles" className="ml-auto text-violet-700 font-semibold text-sm inline-flex items-center gap-1 hover:gap-2 transition-all fm-hit">
          {t('bundles.all', 'All bundles')} <ArrowRight size={15} />
        </Link>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {bundles.map((b) => (
          <div key={b.id} className="relative bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 fm-lift overflow-hidden">
            <span className="absolute top-4 right-4 text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-500 rounded-full px-2.5 py-1">{t('bundle.save', 'Save')} {b.discountPercent}%</span>
            <div className="flex -space-x-3 mb-3">
              {b.products.slice(0, 4).map((p, i) => (
                <span key={`${p.id}-${i}`} className="w-12 h-12 rounded-xl bg-slate-50 border-2 border-white grid place-items-center shadow-sm">
                  <img src={p.image || iconFor(p.category)} alt="" className="w-8 h-8 object-contain" />
                </span>
              ))}
            </div>
            {/* The bundle's own words in the language being read. This picked
                the Dutch line only when the page was Dutch and fell back to
                whatever the owner had typed otherwise — so a German page
                showed "Top up both your shooters in one go and save 10%".
                Every bundle now arrives with all four; see bundleCopy.js. */}
            <h3 className="font-bold text-slate-900">{bundleText(b, lang).name}</h3>
            <p className="text-slate-400 text-sm mt-0.5 line-clamp-2">
              {bundleText(b, lang).description}
            </p>
            <div className="flex items-baseline gap-2 mt-3">
              <span className="text-2xl font-extrabold text-violet-600">{money(b.total, b.currency)}</span>
              <span className="text-slate-400 text-sm line-through">{money(b.subtotal, b.currency)}</span>
            </div>
            <button onClick={() => addBundle(b)} className="btn-primary w-full mt-4 py-2.5">
              <Plus size={16} /> {t('bundle.add', 'Add bundle')} <ArrowRight size={15} className="fm-nudge" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
