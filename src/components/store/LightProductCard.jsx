import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Zap } from 'lucide-react';
import { categoryVisual, money } from '../../lib/catalog.js';
import { useI18n } from '../../lib/i18n.jsx';
import { iconFor } from '../../lib/sampleCatalog.js';
import { navigateWithTransition } from '../../lib/viewTransition.js';
import { flyToCart } from '../../lib/flyToCart.js';

// Per-category glow colour behind the artwork (falls back to brand violet).
const GLOW = {
  robux: '#22c55e', 'v-bucks': '#3b82f6', valorant: '#ef4444', giftcard: '#f59e0b',
  steam: '#64748b', playstation: '#2563eb', xbox: '#16a34a', 'discord-nitro': '#5865F2',
  itunes: '#ec4899', cod: '#84cc16', apex: '#dc2626', genshin: '#a855f7',
  brawl: '#f59e0b', clash: '#f97316', subscriptions: '#8b5cf6', amazon: '#f59e0b',
};
const glowFor = (cat) => GLOW[cat] || '#7c5cff';

/** Light-theme product card matching the storefront design. */
export default function LightProductCard({ product, onAdd }) {
  const { t } = useI18n();
  const v = categoryVisual(product.category);
  const Icon = v.icon;
  const [imgBroken, setImgBroken] = useState(false);
  // A broken product image falls back to the category logo, never a broken icon.
  const img = (!imgBroken && product.image) ? product.image : iconFor(product.category);
  const navigate = useNavigate();
  const to = `/product/${product.id}`;
  const onSale = product.compareAtPrice > product.price;
  const discountPct = onSale ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;

  // Open the product with a shared-element morph: the clicked card media becomes
  // the destination hero. Plain navigation on modifier/middle clicks.
  const openWithMorph = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    const media = e.currentTarget.querySelector('[data-morph]') || e.currentTarget;
    navigateWithTransition(navigate, to, media);
  };

  return (
    <div className="group bg-white rounded-2xl border border-slate-200/70 shadow-sm fm-lift p-4 flex flex-col">
      <a href={to} onClick={openWithMorph}
        className="fm-card-media fm-logo-plinth relative rounded-xl h-[150px] grid place-items-center mb-3"
        style={{ '--card-glow': `radial-gradient(circle, ${glowFor(product.category)}45, transparent 70%)` }}>
        <div className="absolute top-2.5 left-2.5 z-10 flex flex-col items-start gap-1">
          {onSale && (
            <span className="text-[10px] font-black text-white bg-rose-500 rounded-full px-2 py-0.5 shadow-sm">-{discountPct}%</span>
          )}
          {product.featured && (
            <span className="text-[10px] font-bold text-amber-600 bg-amber-100 rounded-full px-2 py-0.5">★ Featured</span>
          )}
        </div>
        {product.stockLeft > 0 && (
          <span className="absolute top-2.5 right-2.5 z-10 text-[10px] font-bold text-red-600 bg-red-100 rounded-full px-2 py-0.5 animate-pulse">
            {product.stockLeft === 1 ? t('card.lastOne', 'Last one!') : t('card.onlyLeft', 'Only {n} left', { n: product.stockLeft })}
          </span>
        )}
        {product.sold > 20 && (
          <span className="absolute bottom-2.5 left-2.5 z-10 text-[10px] font-semibold text-orange-600 bg-orange-50 rounded-full px-2 py-0.5">🔥 High demand</span>
        )}
        <span className="absolute bottom-2.5 right-2.5 z-10 inline-flex items-center gap-0.5 text-[10px] font-bold text-violet-700 bg-white/85 backdrop-blur rounded-full px-2 py-0.5 shadow-sm">
          <Zap size={10} className="fill-current" /> {t('card.instant', 'Instant')}
        </span>
        {img ? (
          <img data-morph src={img} alt={product.name} onError={() => setImgBroken(true)}
            className="fm-logo w-[92px] h-[92px] group-hover:scale-105 transition-transform" />
        ) : (
          <div data-morph className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${v.grad} grid place-items-center`}>
            <Icon size={34} className="text-white" />
          </div>
        )}
      </a>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-500">{v.label}</div>
      <Link to={to} className="font-bold text-[15px] text-slate-900 mt-0.5 hover:text-violet-600 line-clamp-2">{product.name}</Link>
      {product.description && <p className="text-[12.5px] text-slate-400 mt-1 line-clamp-2 flex-1">{product.description}</p>}
      <div className="text-[12px] text-slate-400 mt-3">
        {t('home.from', 'From')} <span className="font-extrabold text-violet-600 text-[18px]">{money(product.price, product.currency)}</span>
        {onSale && (
          <span className="ml-2 text-slate-400 line-through font-semibold">{money(product.compareAtPrice, product.currency)}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Link to={`/product/${product.id}`} className="flex-1 text-center text-sm font-semibold rounded-lg h-9 grid place-items-center hover:brightness-105 transition"
          style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)', color: '#fff' }}>{t('product.buyNow', 'Buy Now')}</Link>
        <button aria-label="Add to cart"
          onClick={(e) => {
            flyToCart(e.currentTarget.closest('.group')?.querySelector('[data-morph]'));
            onAdd?.(product);
          }}
          className="w-9 h-9 rounded-lg border border-slate-200 grid place-items-center text-slate-500 hover:bg-slate-50 hover:text-violet-600 active:scale-90 transition-transform">
          <ShoppingCart size={16} />
        </button>
      </div>
    </div>
  );
}
