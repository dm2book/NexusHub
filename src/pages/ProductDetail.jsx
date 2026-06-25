import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Minus, Plus, ShoppingCart, Zap, ShieldCheck, Clock, BadgeCheck,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { categoryVisual, money } from '../lib/catalog.js';
import { SAMPLE_PRODUCTS, withFallback } from '../lib/sampleCatalog.js';
import { PageLoader } from '../components/ui.jsx';
import LightProductCard from '../components/store/LightProductCard.jsx';
import { usePageMeta } from '../lib/useMeta.js';

export default function ProductDetail() {
  const { id } = useParams();
  const { add } = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [all, setAll] = useState([]);
  const [qty, setQty] = useState(1);
  const [notFound, setNotFound] = useState(false);
  usePageMeta(product?.name || 'Product', product?.description || 'Instant digital delivery.');

  useEffect(() => {
    setProduct(null); setQty(1); setNotFound(false);
    api.get(`/api/products/${id}`)
      .then((r) => setProduct(r.product))
      .catch(() => {
        // Fall back to the built-in showcase product if the API has no catalog yet.
        const sample = SAMPLE_PRODUCTS.find((p) => p.id === id);
        if (sample) setProduct(sample); else setNotFound(true);
      });
    api.get('/api/products').then((r) => setAll(withFallback(r.products))).catch(() => setAll(SAMPLE_PRODUCTS));
  }, [id]);

  if (notFound) {
    return (
      <div className="section py-24 text-center">
        <h1 className="text-2xl text-white mb-2">Product not found</h1>
        <Link to="/shop" className="btn-primary mt-4 inline-flex">Back to shop</Link>
      </div>
    );
  }
  if (!product) return <PageLoader />;

  const { icon: Icon, grad, label } = categoryVisual(product.category);
  const related = all.filter((p) => p.id !== product.id && p.category === product.category).slice(0, 4);

  const addToCart = () => { add(product, qty); toast.success(`${qty}× ${product.name} added to cart`); };
  const buyNow = () => { add(product, qty); navigate('/cart'); };

  return (
    <div className="section py-10">
      <Link to="/shop" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-6">
        <ArrowLeft size={16} /> Back to shop
      </Link>

      <div className="grid lg:grid-cols-2 gap-10">
        {/* visual */}
        <div className={`shine-host group relative rounded-3xl bg-gradient-to-br ${grad} h-80 lg:h-[420px] overflow-hidden animate-fade-in ${product.featured ? 'ring-featured' : ''}`}>
          {product.image ? (
            <img src={product.image} alt={product.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
          ) : (
            <>
              <div className="absolute inset-0 bg-grid opacity-30" />
              <Icon className="absolute right-8 top-8 text-white/90" size={44} />
              <Icon className="absolute -right-10 -bottom-12 text-white/10" size={260} />
            </>
          )}
          {product.featured && (
            <span className="absolute left-5 top-5 inline-flex items-center gap-1 text-xs font-bold uppercase bg-black/40 text-amber-300 px-3 py-1.5 rounded-full backdrop-blur">
              <Zap size={13} /> Featured
            </span>
          )}
        </div>

        {/* details */}
        <div className="animate-fade-up">
          <span className="text-xs uppercase tracking-wider text-indigo-400 font-rajdhani">{label}</span>
          <h1 className="text-3xl sm:text-4xl text-white mt-2">{product.name}</h1>
          <div className="text-3xl font-semibold mt-4 gradient-text gradient-anim">{money(product.price, product.currency)}</div>
          {product.description && <p className="text-slate-400 mt-5 leading-relaxed">{product.description}</p>}

          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center glass rounded-xl">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="p-3 text-slate-300 hover:text-white"><Minus size={16} /></button>
                <span className="w-10 text-center text-white">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} className="p-3 text-slate-300 hover:text-white"><Plus size={16} /></button>
              </div>
              <span className="text-slate-500 text-sm font-rajdhani uppercase tracking-wide">Quantity</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={addToCart} className="btn-ghost py-3"><ShoppingCart size={18} /> Add to cart</button>
              <button onClick={buyNow} className="btn-primary py-3">Buy now</button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-8">
            {[[Zap, 'Instant delivery'], [ShieldCheck, 'Secure payment'], [Clock, '24/7 support']].map(([I, t]) => (
              <div key={t} className="glass rounded-xl p-3 text-center">
                <I size={18} className="text-indigo-300 mx-auto mb-1.5" />
                <div className="text-xs text-slate-300">{t}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-6 text-sm text-emerald-300">
            <BadgeCheck size={16} /> Delivered to your dashboard automatically after payment
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <div className="mt-20">
          <h2 className="text-2xl font-extrabold text-slate-900 mb-6">You might also like</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {related.map((p) => <LightProductCard key={p.id} product={p} onAdd={(x) => { add(x); toast.success(`${x.name} added`); }} />)}
          </div>
        </div>
      )}
    </div>
  );
}
