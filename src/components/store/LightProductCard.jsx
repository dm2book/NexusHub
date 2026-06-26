import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { categoryVisual, money } from '../../lib/catalog.js';
import { iconFor } from '../../lib/sampleCatalog.js';

/** Light-theme product card matching the storefront design. */
export default function LightProductCard({ product, onAdd }) {
  const v = categoryVisual(product.category);
  const Icon = v.icon;
  const img = product.image || iconFor(product.category);

  return (
    <div className="group bg-white rounded-2xl border border-slate-200/70 shadow-sm fm-lift p-4 flex flex-col">
      <Link to={`/product/${product.id}`} className="relative rounded-xl bg-slate-50 h-[150px] grid place-items-center mb-3 overflow-hidden">
        {product.featured && (
          <span className="absolute top-2.5 left-2.5 z-10 text-[10px] font-bold text-amber-600 bg-amber-100 rounded-full px-2 py-0.5">★ Featured</span>
        )}
        {typeof product.stock === 'number' && product.stock > 0 && product.stock <= 10 && (
          <span className="absolute top-2.5 right-2.5 z-10 text-[10px] font-bold text-red-600 bg-red-100 rounded-full px-2 py-0.5 animate-pulse">
            Only {product.stock} left
          </span>
        )}
        {product.sold > 20 && (
          <span className="absolute bottom-2.5 left-2.5 z-10 text-[10px] font-semibold text-orange-600 bg-orange-50 rounded-full px-2 py-0.5">🔥 High demand</span>
        )}
        {img ? (
          <img src={img} alt={product.name} className="w-24 h-24 object-contain drop-shadow-md group-hover:scale-105 transition-transform" />
        ) : (
          <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${v.grad} grid place-items-center`}>
            <Icon size={34} className="text-white" />
          </div>
        )}
      </Link>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-500">{v.label}</div>
      <Link to={`/product/${product.id}`} className="font-bold text-[15px] text-slate-900 mt-0.5 hover:text-violet-600 line-clamp-2">{product.name}</Link>
      {product.description && <p className="text-[12.5px] text-slate-400 mt-1 line-clamp-2 flex-1">{product.description}</p>}
      <div className="text-[12px] text-slate-400 mt-3">From <span className="font-extrabold text-violet-600 text-[18px]">{money(product.price, product.currency)}</span></div>
      <div className="flex items-center gap-2 mt-3">
        <Link to={`/product/${product.id}`} className="flex-1 text-center text-sm font-semibold rounded-lg h-9 grid place-items-center hover:brightness-105 transition"
          style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)', color: '#fff' }}>Buy Now</Link>
        <button onClick={() => onAdd?.(product)} aria-label="Add to cart"
          className="w-9 h-9 rounded-lg border border-slate-200 grid place-items-center text-slate-500 hover:bg-slate-50 hover:text-violet-600">
          <ShoppingCart size={16} />
        </button>
      </div>
    </div>
  );
}
