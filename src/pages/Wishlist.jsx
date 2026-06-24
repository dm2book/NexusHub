import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, PackageX } from 'lucide-react';
import { api } from '../lib/api.js';
import { withFallback } from '../lib/sampleCatalog.js';
import { useWishlist } from '../lib/wishlist.js';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import ProductCard from '../components/ProductCard.jsx';
import { EmptyState } from '../components/ui.jsx';
import { usePageMeta } from '../lib/useMeta.js';

export default function Wishlist() {
  const { add } = useCart();
  const toast = useToast();
  const wl = useWishlist();
  const [products, setProducts] = useState(null);
  usePageMeta('Wishlist', 'Your saved items.');

  useEffect(() => {
    api.get('/api/products').then((r) => setProducts(withFallback(r.products))).catch(() => setProducts(withFallback([])));
  }, []);

  const items = (products || []).filter((p) => wl.has(p.id));
  const onAdd = (p) => { add(p); toast.success(`${p.name} added to cart`); };

  return (
    <div className="section py-12">
      <h1 className="text-3xl text-white mb-2 flex items-center gap-2"><Heart className="text-rose-400" /> Wishlist</h1>
      <p className="text-slate-400 mb-8">Items you saved — they live in this browser.</p>
      {products === null
        ? <p className="text-slate-500">Loading…</p>
        : items.length === 0
          ? <EmptyState icon={PackageX} title="No saved items yet"
              hint="Tap the heart on any product to save it here."
              action={<Link to="/shop" className="btn-primary">Browse shop</Link>} />
          : <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {items.map((p) => <ProductCard key={p.id} product={p} onAdd={onAdd} />)}
            </div>}
    </div>
  );
}
