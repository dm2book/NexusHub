import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Zap, Clock } from 'lucide-react';
import { categoryVisual, money, isCustomImage, productDescription } from '../../lib/catalog.js';
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
  const { t, lang } = useI18n();
  const desc = productDescription(product, lang);
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
    <div className="group w-full bg-white rounded-2xl border border-slate-200/70 shadow-sm fm-lift p-3 sm:p-4 flex flex-col">
      <a href={to} onClick={openWithMorph}
        className="fm-card-media fm-logo-plinth relative rounded-xl h-[122px] sm:h-[150px] grid place-items-center mb-3"
        style={{ '--card-glow': `radial-gradient(circle, ${glowFor(product.category)}45, transparent 70%)` }}>
        <div className="absolute top-2.5 left-2.5 z-10 flex flex-col items-start gap-1">
          {onSale && (
            <span className="text-[10px] font-black text-white bg-rose-500 rounded-full px-2 py-0.5 shadow-sm">-{discountPct}%</span>
          )}
          {product.featured && (
            <span className="text-[10px] font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">★ {t('card.featured', 'Featured')}</span>
          )}
        </div>
        {product.stockLeft > 0 && (
          <span className="absolute top-2.5 right-2.5 z-10 text-[10px] font-bold text-red-600 bg-red-100 rounded-full px-2 py-0.5 animate-pulse">
            {product.stockLeft === 1 ? t('card.lastOne', 'Last one!') : t('card.onlyLeft', 'Only {n} left', { n: product.stockLeft })}
          </span>
        )}
        {product.sold > 20 && (
          <span className="absolute bottom-2.5 left-2.5 z-10 text-[10px] font-semibold text-orange-600 bg-orange-50 rounded-full px-2 py-0.5">
            🔥 {t('card.highDemand', 'High demand')}
          </span>
        )}
        {/* This badge used to read "Instant" on every card, unconditionally —
            including hand-delivered products and everything out of stock. The
            server already computes an honest flag (deliveryMode === 'auto' AND
            real codes on the shelf, see instantFor in routes/catalog.js); the
            card simply ignored it. Same two states the assistant uses, so the
            shop tells one story about delivery. */}
        <span className={`absolute bottom-2.5 right-2.5 z-10 inline-flex items-center gap-0.5 text-[10px] font-bold rounded-full px-2 py-0.5 shadow-sm backdrop-blur ${
          product.instant ? 'text-emerald-700 bg-emerald-50/90' : 'text-amber-700 bg-amber-50/90'}`}>
          {product.instant
            ? <><Zap size={10} className="fill-current" /> {t('card.inStock', 'In stock')}</>
            : <><Clock size={10} /> {t('card.byHand', 'By hand')}</>}
        </span>
        {img ? (
          isCustomImage(img) ? (
            // Owner-supplied photo/logo: fill the tile with a soft blurred copy
            // so any baked-in background blends in instead of floating as a box.
            <>
              <img src={img} alt="" aria-hidden="true" loading="lazy" decoding="async"
                className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl opacity-90" />
              {/* data-morph is forced position:relative by .fm-card-media (see index.css),
                  so centre it with the grid + cap its size. Fixed-px max-height —
                  a % one resolves against the auto grid track and is ignored. */}
              <img data-morph src={img} alt={product.name} loading="lazy" decoding="async" onError={() => setImgBroken(true)}
                className="relative z-[1] max-w-[86%] max-h-[118px] object-contain drop-shadow-md group-hover:scale-105 transition-transform duration-500" />
            </>
          ) : (
            <img data-morph src={img} alt={product.name} loading="lazy" decoding="async" onError={() => setImgBroken(true)}
              className="fm-logo w-[92px] h-[92px] group-hover:scale-105 transition-transform" />
          )
        ) : (
          <div data-morph className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${v.grad} grid place-items-center`}>
            <Icon size={34} className="text-white" />
          </div>
        )}
      </a>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">{v.label}</div>
      <Link to={to} className="font-bold text-[15px] text-slate-900 mt-0.5 hover:text-violet-600 line-clamp-2">{product.name}</Link>
      {desc && <p className="text-[12.5px] text-slate-400 mt-1 line-clamp-2">{desc}</p>}
      <div className="text-[12px] text-slate-400 mt-3 pt-0.5 mt-auto">
        {t('home.from', 'From')} <span className="fm-num text-violet-600 text-[18px]">{money(product.price, product.currency)}</span>
        {onSale && (
          <span className="ml-2 text-slate-400 line-through fm-num text-[13px]">{money(product.compareAtPrice, product.currency)}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Link to={`/product/${product.id}`} className="flex-1 text-center text-sm font-semibold rounded-lg h-11 sm:h-10 grid place-items-center hover:brightness-105 transition"
          style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)', color: '#fff' }}>{t('product.buyNow', 'Buy Now')}</Link>
        <button aria-label="Add to cart"
          onClick={(e) => {
            flyToCart(e.currentTarget.closest('.group')?.querySelector('[data-morph]'));
            onAdd?.(product);
          }}
          className="w-11 h-11 sm:w-10 sm:h-10 shrink-0 rounded-lg border border-slate-200 grid place-items-center text-slate-500 hover:bg-slate-50 hover:text-violet-600 active:scale-90 transition-transform">
          <ShoppingCart size={16} />
        </button>
      </div>
    </div>
  );
}
