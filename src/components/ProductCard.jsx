import { Link } from 'react-router-dom';
import { ShoppingCart, Zap } from 'lucide-react';
import { categoryVisual, money } from '../lib/catalog.js';

export default function ProductCard({ product, onAdd }) {
  const { icon: Icon, grad, label } = categoryVisual(product.category);
  const out = product.stock != null && product.stock <= 0;

  return (
    <div className="group relative card overflow-hidden hover:border-primary/40 transition-all duration-300 hover:-translate-y-1">
      {/* visual header */}
      <Link to={`/product/${product.id}`} className="block">
        <div className={`relative h-36 bg-gradient-to-br ${grad} overflow-hidden`}>
          <div className="absolute inset-0 bg-grid opacity-30" />
          <Icon className="absolute right-4 top-4 text-white/80" size={28} />
          <Icon className="absolute -right-6 -bottom-8 text-white/10 group-hover:scale-110 transition-transform duration-500" size={130} />
          {product.featured && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-black/40 text-amber-300 px-2 py-1 rounded-full backdrop-blur">
              <Zap size={11} /> Featured
            </span>
          )}
        </div>
      </Link>

      <div className="p-5">
        <span className="text-[11px] uppercase tracking-wider text-indigo-400 font-rajdhani">{label}</span>
        <Link to={`/product/${product.id}`}>
          <h3 className="text-white text-lg mt-1 leading-snug hover:text-indigo-200 transition">{product.name}</h3>
        </Link>
        {product.description && (
          <p className="text-slate-400 text-sm mt-1.5 line-clamp-2">{product.description}</p>
        )}
        <div className="flex items-center justify-between mt-5">
          <div>
            <div className="text-xl text-white font-semibold">{money(product.price, product.currency)}</div>
            {out && <div className="text-xs text-red-400">Out of stock</div>}
          </div>
          <button
            onClick={() => onAdd?.(product)}
            disabled={out}
            className="btn-primary text-sm px-3.5"
            title="Add to cart">
            <ShoppingCart size={16} /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
