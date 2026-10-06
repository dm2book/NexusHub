import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import LightProductCard from '../components/store/LightProductCard.jsx';
import { PageLoader } from '../components/ui.jsx';
import { useSeoPage, SeoFaq, SeoLinks } from '../components/store/SeoExtras.jsx';
import { SITE } from '../content/seo.js';

/**
 * A generated catalogue page: a game, a gift-card brand, a platform or a gift
 * budget (src/lib/seoCatalog.js). Heading, intro, the products, the FAQ and
 * related pages. The server already wrote the title, description, canonical
 * and schema into the HTML; this keeps the title in the reader's language.
 */
export default function SeoCollection() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '');
  const page = useSeoPage(path);
  const { t } = useI18n();
  const { add } = useCart();
  const toast = useToast();
  const [products, setProducts] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/api/products').then((r) => { if (live) setProducts(r.products || []); }).catch(() => { if (live) setProducts([]); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (page?.copy) {
      document.title = `${page.copy.title} · ${SITE.name}`;
      document.querySelector('meta[name="description"]')?.setAttribute('content', page.copy.description);
    }
  }, [page]);
  const shown = useMemo(() => {
    if (!page?.productIds || !products) return [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return page.productIds.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a.price - b.price);
  }, [page, products]);

  if (page === false) {
    return (
      <div className="section py-20 text-center">
        <h1 className="text-2xl text-white mb-2">{t('product.notFound', 'Product not found')}</h1>
        <Link to="/shop" className="btn-primary mt-4 inline-flex">{t('product.back', 'Back to shop')}</Link>
      </div>
    );
  }
  if (!page || !products) return <PageLoader />;
  return (
    <div className="section py-10">
      <nav className="text-sm text-slate-500 mb-4"><Link to="/" className="hover:text-violet-600">Home</Link> / <Link to="/shop" className="hover:text-violet-600">Shop</Link> / <span className="text-slate-700">{page.copy.h1}</span></nav>
      <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900">{page.copy.h1}</h1>
      <p className="text-slate-600 mt-2 max-w-2xl">{page.copy.intro}</p>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 mt-6" data-testid="seo-products">
        {shown.map((p) => <LightProductCard key={p.id} product={p} onAdd={(x) => { add(x); toast.success(`${x.name} ${t('cart.added', 'added')}`); }} />)}
      </div>
      <SeoFaq page={page} />
      <SeoLinks page={page} />
    </div>
  );
}
