import { memo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Zap, Clock, Heart } from 'lucide-react';
import { categoryVisual, categoryLabel, money, carriesOwnBackground, productDescription } from '../../lib/catalog.js';
import { useI18n } from '../../lib/i18n.jsx';
import { useCart } from '../../context/CartContext.jsx';
import { iconFor } from '../../lib/sampleCatalog.js';
import ProductMedia from './ProductMedia.jsx';
import { platformOf } from '../../lib/platform.js';
import { navigateWithTransition } from '../../lib/viewTransition.js';
import { flyToCart } from '../../lib/flyToCart.js';
import { useWishlist } from '../../lib/wishlist.js';
import { useToast } from '../../context/ToastContext.jsx';

/* Does this device point (mouse/trackpad)? Then the card's buttons wait for the
   pointer, as on Eneba; on a touch screen there is no hover, so they show. */
const POINTS = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

// Per-category glow colour behind the artwork (falls back to brand violet).
const GLOW = {
  robux: '#22c55e', 'v-bucks': '#3b82f6', valorant: '#ef4444', giftcard: '#f59e0b',
  steam: '#64748b', playstation: '#2563eb', xbox: '#16a34a', 'discord-nitro': '#5865F2',
  itunes: '#ec4899', cod: '#84cc16', apex: '#dc2626', genshin: '#a855f7',
  brawl: '#f59e0b', clash: '#f97316', subscriptions: '#8b5cf6', amazon: '#f59e0b',
};
const glowFor = (cat) => GLOW[cat] || '#7c5cff';

/** Light-theme product card matching the storefront design. */
const TREND = { hot: ['🔥', 'Hot'], trending: ['📈', 'Trending'], popular: ['⭐', 'Popular'], new: ['✨', 'New'] };

function LightProductCard({ product, onAdd, priority = false }) {
  const { t, lang } = useI18n();
  const desc = productDescription(product, lang);
  const v = categoryVisual(product.category);
  const Icon = v.icon;
  // Same answer the cart gives everywhere else: before launch, and not staff.
  const { prelaunch } = useCart();
  /* Which kind of tile: a plinth for a generated badge, a neutral ground for a
     photo. Decided from the artwork the product INTENDS to use — if that art
     fails, ProductMedia swaps in the category icon and the tile stays as it is,
     which is a far smaller wrong than a tile that changes shape on a 404. */
  const photoArt = carriesOwnBackground(product.image || iconFor(product.category));
  const navigate = useNavigate();
  const to = `/product/${product.id}`;
  const { has, toggle } = useWishlist();
  const toast = useToast();
  const wished = has(product.id);
  /* The lift is the card's own CSS (.fm-pcard:hover). The buttons are shown
     with inline styles rather than new classes: the stylesheet is at its size
     budget, and this costs it nothing. */
  const [hover, setHover] = useState(false);
  const showActions = !POINTS || hover;
  const onSale = product.compareAtPrice > product.price;
  const discountPct = onSale ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;
  const platform = platformOf(product);

  // Open the product with a shared-element morph: the clicked card media becomes
  // the destination hero. Plain navigation on modifier/middle clicks.
  const openWithMorph = (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    /* From the picture or from the 'view' button: the morph always starts at the card's artwork. */
    const media = e.currentTarget.closest('.group')?.querySelector('[data-morph]') || e.currentTarget.querySelector('[data-morph]') || e.currentTarget;
    navigateWithTransition(navigate, to, media);
  };

  return (
    <div className="fm-pcard group w-full rounded-2xl p-3 sm:p-4 flex flex-col"
      onMouseEnter={POINTS ? () => setHover(true) : undefined} onMouseLeave={POINTS ? () => setHover(false) : undefined}
      onFocus={POINTS ? () => setHover(true) : undefined} onBlur={POINTS ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHover(false); } : undefined}>
      {/* Two kinds of tile, because there are two kinds of artwork.

          A generated icon is a transparent badge drawn FOR the plinth: it wants
          the soft gradient, the tinted glow and the little shadow disc beneath
          it, and it gets them.

          A photo or a render brings its own background, and takes neither. It
          also has to switch the glow OFF explicitly rather than just not setting
          it: `.fm-card-media::before` falls back to a violet radial when
          `--card-glow` is undefined, so leaving it unset does not remove the
          glow — it picks the default one. That is a violet disc at 55% sitting
          over every product photo in the shop, which is the haze on the artwork.
          `none` is the only way to actually mean none. */}
      {/* The wishlist heart, top right of the picture, as on Eneba. Outside the
          link, so pressing it saves rather than opens the product. */}
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); const added = toggle(product.id); toast?.success?.(added ? t('card.saved', 'Saved to your wishlist') : t('card.removed', 'Removed from your wishlist')); }}
        aria-label={wished ? t('card.unsave', 'Remove from wishlist') : t('card.save', 'Save to wishlist')} aria-pressed={wished}
        className="absolute z-20 grid place-items-center rounded-full bg-white/90 shadow-sm"
        style={{ top: 22, right: 22, width: 34, height: 34, color: wished ? '#ec4899' : '#64748b', transition: 'transform .15s' }}>
        <Heart size={17} fill={wished ? 'currentColor' : 'none'} />
      </button>
      <a href={to} onClick={openWithMorph}
        /* One shape at every width, and it is the shape the artwork needs.

           This box used to be h-[122px] on a phone and h-[150px] from `sm` up.
           That is not a size difference, it is a RATIO difference: 184×122 is
           1.51 — wide and short — where the desktop box is 1.17, nearly square.
           Measured with the shop's real artwork in a phone viewport, that short
           box is the whole mobile complaint:

             · a portrait gift card (0.68) is height-limited to 83×122, a narrow
               strip with wide empty margins — "large portions disappear";
             · a 1280×720 screenshot becomes a 184×103 band, so text set at 86px
               in the source renders about 12px tall — "barely visible";
             · nothing is actually clipped (measured: 0% outside the container),
               which is why chasing overflow and object-position found nothing.

           An aspect ratio rather than a height: it reserves the space before a
           single byte arrives, it is identical on every screen, and it gives
           portrait artwork about 50% more area on a phone without touching the
           desktop proportions the design was built around. */
        className={`fm-card-media relative rounded-xl aspect-[7/6] w-full grid place-items-center mb-3 overflow-hidden ${
          photoArt ? 'border border-slate-200/60' : 'fm-logo-plinth'}`}
        style={photoArt
          ? { '--card-glow': 'none' }
          : { '--card-glow': `radial-gradient(circle, ${glowFor(product.category)}45, transparent 70%)` }}>
        <div className="absolute top-2.5 left-2.5 z-10 flex flex-col items-start gap-1">
          {onSale && (
            <span className="text-[10px] font-black text-white bg-rose-500 rounded-full px-2 py-0.5 shadow-sm">-{discountPct}%</span>
          )}
          {product.featured && (
            <span className="text-[10px] font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">★ {t('card.featured', 'Featured')}</span>
          )}
          {/* Which console or PC this code works on — the most likely wrong
              purchase, said on the card where the choice is made. */}
          {platform && (
            <span className="text-[10px] font-bold text-white rounded-full px-2 py-0.5 shadow-sm" style={{ background: platform.color }}
              data-testid="card-platform">
              {platform.label}
            </span>
          )}
        </div>
        {/* Not animate-pulse. That fades a whole element in and out — it is
            the shape a skeleton loader makes while it waits for data, so the
            one badge on this card carrying a real fact about the shelf was
            the one that looked like it had not loaded yet. It is a solid,
            legible chip now; the number is the urgency. */}
        {product.stockLeft > 0 && (
          <span className="absolute top-2.5 right-2.5 z-10 text-[10px] font-bold text-white bg-rose-600/95 rounded-full px-2 py-0.5 shadow-sm ring-1 ring-inset ring-white/25 backdrop-blur"
            style={{ top: 48 }}>
            {product.stockLeft === 1 ? t('card.lastOne', 'Last one!') : t('card.onlyLeft', 'Only {n} left', { n: product.stockLeft })}
          </span>
        )}
        {/* The label the trending engine earned for it — from sales, revenue,
            conversion and age; nothing on this card is picked by hand. */}
        {TREND[product.trend] && (
          <span className="absolute bottom-2.5 left-2.5 z-10 text-[10px] font-semibold text-orange-600 bg-orange-50 rounded-full px-2 py-0.5">
            {TREND[product.trend][0]} {t(`trend.${product.trend}`, TREND[product.trend][1])}
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
        {/* One element, one request, one decode — see ProductMedia.jsx for what
            the two-layer version was costing. The badges above keep their own
            z-10 and sit over it. */}
        <ProductMedia product={product} priority={priority} className="absolute inset-0" />
      </a>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">{categoryLabel(product.category, t)}</div>
      {/* py-1 -my-1: the title is a second route to the product page beside the
          artwork above it and the 44px button below, and at 23px tall it was a
          pixel under the 24px floor. The padding is pulled back out so the
          grid does not move. */}
      <Link to={to} className="font-bold text-[15px] text-slate-900 mt-0.5 py-1 -my-1 hover:text-violet-600 line-clamp-2">{product.name}</Link>
      {desc && <p className="text-[12.5px] text-slate-400 mt-1 line-clamp-2">{desc}</p>}
      <div className="text-[12px] text-slate-400 mt-3 pt-0.5 mt-auto">
        {t('home.from', 'From')} <span className="fm-num text-violet-600 text-[18px]">{money(product.price, product.currency)}</span>
        {onSale && (
          <span className="ml-2 text-slate-400 line-through fm-num text-[13px]">{money(product.compareAtPrice, product.currency)}</span>
        )}
      </div>
      {/* Two actions, as on Eneba: add to cart, and view the product. With a
          mouse they slide in when the card is pointed at; the space is kept so
          nothing below moves. */}
      <div className="flex flex-col gap-2 mt-3"
        style={{ opacity: showActions ? 1 : 0, transform: showActions ? 'none' : 'translateY(6px)',
          transition: 'opacity .18s ease, transform .18s ease', pointerEvents: showActions ? 'auto' : 'none' }}>
        <button type="button"
          onClick={(e) => {
            flyToCart(e.currentTarget.closest('.group')?.querySelector('[data-morph]'));
            onAdd?.(product);
          }}
          className="fm-cta w-full text-sm font-semibold rounded-lg h-11 sm:h-10 flex items-center justify-center gap-2 active:scale-90 transition-transform">
          <ShoppingCart size={16} /> {t('product.addToCart', 'Add to cart')}
        </button>
        <Link to={to} onClick={openWithMorph}
          className="w-full text-center text-sm font-semibold rounded-lg h-11 sm:h-10 grid place-items-center border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-violet-600">
          {t('card.view', 'View product')}
        </Link>
      </div>
    </div>
  );
}

/* Memoised. The catalogue renders twenty-four of these, and every keystroke in
   the search box, every sort change and every scroll that grows the page used
   to re-render all of them — profiled at a meaningful slice of the catalogue's
   blocking time on a throttled phone. The props are a product object and two
   stable values, so equality by reference is exactly right here. */
export default memo(LightProductCard);
