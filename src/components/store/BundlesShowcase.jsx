import { useEffect, useState } from 'react';
import { Package, Plus, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money } from '../../lib/catalog.js';
import { iconFor } from '../../lib/sampleCatalog.js';
import { useCart } from '../../context/CartContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Storefront bundle offers. Each card shows the products, the original price
 * (struck through), the bundle price and the % saved. Adding a bundle drops all
 * its products into the cart — the discount then applies automatically at
 * checkout (the server validates it). Hides itself when there are no bundles.
 */
export default function BundlesShowcase() {
  const { t, lang } = useI18n();
  const [bundles, setBundles] = useState(null);
  const { add } = useCart();
  const toast = useToast();

  useEffect(() => { api.get('/api/bundles').then((r) => setBundles(r.bundles || [])).catch(() => setBundles([])); }, []);
  if (!bundles || bundles.length === 0) return null;

  const addBundle = (b) => {
    b.products.forEach((p) => add({ id: p.id, name: p.name, price: p.price, currency: b.currency, category: p.category, image: p.image || iconFor(p.category) }, 1));
    toast.success(`${b.name} added — you save ${money(b.discount, b.currency)}!`);
  };

  return (
    <div className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-xl grid place-items-center bg-violet-100 text-violet-600"><Package size={17} /></span>
        <h2 className="text-xl font-extrabold text-slate-900">{t('bundle.title', 'Bundle & save')}</h2>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {bundles.map((b) => (
          <div key={b.id} className="relative bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 fm-lift overflow-hidden">
            <span className="absolute top-4 right-4 text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-500 rounded-full px-2.5 py-1">{t('bundle.save', 'Save')} {b.discountPercent}%</span>
            <div className="flex -space-x-3 mb-3">
              {b.products.slice(0, 4).map((p) => (
                <span key={p.id} className="w-12 h-12 rounded-xl bg-slate-50 border-2 border-white grid place-items-center shadow-sm">
                  <img src={p.image || iconFor(p.category)} alt="" className="w-8 h-8 object-contain" />
                </span>
              ))}
            </div>
            <h3 className="font-bold text-slate-900">{b.name}</h3>
            <p className="text-slate-400 text-sm mt-0.5 line-clamp-2">
              {(lang === 'nl' && b.descriptionNl) || b.description || b.products.map((p) => p.name).join(' + ')}
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
