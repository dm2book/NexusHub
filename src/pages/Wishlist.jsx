import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, PackageX } from 'lucide-react';
import { api } from '../lib/api.js';
import { withFallback } from '../lib/sampleCatalog.js';
import { useWishlist } from '../lib/wishlist.js';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import LightProductCard from '../components/store/LightProductCard.jsx';
import { EmptyState, SkeletonCard } from '../components/ui.jsx';
import { usePageMeta } from '../lib/useMeta.js';
import { useI18n } from '../lib/i18n.jsx';

export default function Wishlist() {
  const { add } = useCart();
  const toast = useToast();
  const wl = useWishlist();
  const { t } = useI18n();
  const [products, setProducts] = useState(null);
  usePageMeta('Wishlist', 'Your saved items.');

  useEffect(() => {
    api.get('/api/products').then((r) => setProducts(withFallback(r.products))).catch(() => setProducts(withFallback([])));
  }, []);

  const items = (products || []).filter((p) => wl.has(p.id));
  const onAdd = (p) => { add(p); toast.success(`${p.name} ${t('cart.addedToCart', 'added to cart')}`); };

  return (
    <div className="max-w-[1200px] mx-auto px-4 lg:px-8 py-12">
      <h1 className="text-3xl font-extrabold text-slate-900 mb-2 flex items-center gap-2"><Heart className="text-rose-500" /> {t('wish.title', 'Wishlist')}</h1>
      <p className="text-slate-500 mb-8">{t('wish.sub', 'Items you saved — they live in this browser.')}</p>
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
          {items.map((p) => <LightProductCard key={p.id} product={p} onAdd={onAdd} />)}
        </div>
      )}
    </div>
  );
}
