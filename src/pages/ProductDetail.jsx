import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Minus, Plus, ShoppingCart, Zap, ShieldCheck, Clock, BadgeCheck,
  Star, RefreshCw, Headphones, ChevronDown, Heart, Truck, Info,
} from 'lucide-react';
import { deliveryInfo } from '../lib/deliveryInfo.js';
import { api } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { categoryVisual, money, carriesOwnBackground, productDescription } from '../lib/catalog.js';
import { iconFor } from '../lib/sampleCatalog.js';
import { SAMPLE_PRODUCTS } from '../lib/sampleCatalog.js';
import { PageLoader } from '../components/ui.jsx';
import LightProductCard from '../components/store/LightProductCard.jsx';
import { useReviews } from '../lib/useReviews.js';
import { useStats } from '../lib/useStats.js';
import { useWishlist } from '../lib/wishlist.js';
import { usePageMeta, useJsonLd } from '../lib/useMeta.js';
import { useI18n } from '../lib/i18n.jsx';
import { recordProductView, useRecentlyViewed } from '../lib/recentlyViewed.js';
import { reportStep } from '../lib/attribution.js';
import { flyToCart } from '../lib/flyToCart.js';
import Tilt from '../components/Tilt.jsx';
import { DeliveryFacts, TrustRow } from '../components/store/ProductDelivery.jsx';

// Built per product, not per site: what a buyer asks about a Robux top-up that
// needs their username is not what they ask about a Steam code. Answers a
// manual-payment shop can actually stand behind — the previous copy claimed
// payment was confirmed "within minutes" around the clock and that delivery was
// automatic for most orders, and neither is true while a person confirms by hand.
const productFaq = (product, t) => {
  const out = [];

  out.push([
    t('pdq.speedQ', 'How fast will I get it?'),
    product.instant
      ? t('pdq.speedAInstant', 'This one is in stock, so it is sent automatically the moment your payment is confirmed. Payments are matched by a person, which is fastest during the day — order late at night and it is handled first thing in the morning.')
      : t('pdq.speedAHand', 'We buy this in for you once your payment is confirmed, and deliver it by hand. During the day that is normally a few hours; order late at night and it goes out first thing in the morning.'),
  ]);

  out.push([
    t('pdq.payQ', 'How do I pay?'),
    t('pdq.payA', 'You place the order first, then transfer the exact amount shown using your order number as the reference — Tikkie or a bank transfer. Nothing is charged automatically and no card details are stored on this site.'),
  ]);

  // Only asked when it applies. A gift-code product should not raise the
  // question of handing over an account at all.
  if (product.deliveryField) {
    out.push([
      t('pdq.accountQ', 'Do you need my account details?'),
      product.deliveryChoice
        ? t('pdq.accountAChoice', 'Only your {n} — and only if you choose the direct top-up. Pick a gift code at checkout instead and you give us nothing but an email address. We never ask for your password either way.', { n: product.deliveryField })
        : t('pdq.accountA', 'Only your {n}, which you enter at checkout so we can top it up. We never ask for your password, and we never need to log in as you.', { n: product.deliveryField }),
    ]);
  }

  out.push([
    t('pdq.accountNeedQ', 'Do I need an account with you?'),
    t('pdq.accountNeedA', 'No. You can order as a guest and follow the order with the link in your confirmation email. An account only adds order history and store credit.'),
  ]);

  out.push([
    t('pdq.wrongQ', 'What if it does not arrive?'),
    t('pdq.wrongA', 'Reply to your order email or open a ticket in Discord — a real person answers. If we cannot deliver your order you get your money back in full, and until it is delivered you can still cancel it.'),
  ]);

  return out;
};

/**
 * The product the server already put in this page, if it is this product.
 *
 * /product/:id is rendered by the API (see server/src/routes/seo.js), which has
 * to load the product anyway to write the title, the og:image and the JSON-LD.
 * It now inlines the same object /api/products/:id returns, so the first React
 * render has something to draw instead of a spinner.
 *
 * Read out of `window` once, at module load, and dropped the moment the visitor
 * asks for a different product: without that, every product page after the
 * first would flash the one they originally landed on. It is never the last
 * word — the effect below refetches immediately, because this HTML is
 * edge-cached for five minutes and a price must not be.
 */
let BOOT = null;
if (typeof window !== 'undefined') {
  BOOT = window.__FM_BOOT__?.product || null;
  delete window.__FM_BOOT__;
}
function bootProduct(id) {
  if (!BOOT) return null;
  if (BOOT.id !== id) { BOOT = null; return null; }
  return BOOT;
}

export default function ProductDetail() {
  const { id } = useParams();
  const { add, prelaunch } = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const reviews = useReviews();
  const stats = useStats();
  const { t, lang } = useI18n();
  const { has, toggle } = useWishlist();
  const [product, setProduct] = useState(() => bootProduct(id));
  const [qty, setQty] = useState(1);
  const [notFound, setNotFound] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [recs, setRecs] = useState({ crossSell: [], upsell: [] });
  const [mysteryPool, setMysteryPool] = useState(null);
  const [priceHist, setPriceHist] = useState([]);
  const [heroBroken, setHeroBroken] = useState(false); // product image failed to load
  usePageMeta(product?.name || 'Product', product?.description || 'Digital top-ups and gift cards, delivered with your order number as the reference.');
  // Product structured data → rich results (price, rating) in Google.
  useJsonLd('product', product && {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || 'Digital top-ups and gift cards, delivered with your order number as the reference.',
    sku: product.sku || product.id,
    category: product.category,
    ...(product.image ? { image: product.image } : {}),
    brand: { '@type': 'Brand', name: 'ForgeMarket' },
    // No aggregateRating. It used to be filled from useStats(), which is the
    // SITE-WIDE rating — so every product claimed the shop's average, including
    // products nobody has ever reviewed. Google requires a rating on a Product
    // to be about that product; misrepresenting it risks a manual action, and
    // rich-result stars are worth far more than borrowed ones. Add this back
    // once reviews carry a product_id and the number is genuinely per product.
    offers: {
      '@type': 'Offer',
      price: ((product.price || 0) / 100).toFixed(2),
      priceCurrency: product.currency || 'EUR',
      /* The same rule the server writes into this page's head, off the same
         field. It used to read `product.stock`, a column nothing enforces,
         nothing decrements and nothing displays — so this block claimed InStock
         for products with no code in stock at all, next to a server-rendered
         block that said PreOrder. `instant` is true only when the product
         auto-delivers AND a code is on the shelf right now, which is the one
         case where "in stock" is a promise the shop can keep. */
      availability: product.instant
        ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    },
  }, { serverFor: product?.id });

  useEffect(() => {
    /* Keep a server-inlined product on screen while it revalidates.
       Blanking it here would throw away the whole point: the HTML is edge-cached
       for five minutes, so the fetch below is what makes the price current — but
       the visitor should be reading the product while that happens, not watching
       a spinner. On a client-side navigation there is no inlined product and
       this clears as before. */
    setProduct(bootProduct(id)); setQty(1); setNotFound(false);
    setRecs({ crossSell: [], upsell: [] }); setHeroBroken(false);
    api.get(`/api/products/${id}`)
      .then((r) => setProduct(r.product))
      .catch((err) => {
        /* A 404 and an outage are different answers and deserve different
           words. Both used to land on "not found", which tells someone their
           link is wrong when in fact the shop is down — and sends them away
           instead of back in five minutes.

           The sample lookup is allowed on a 404 only. A brand-new deployment
           with an empty catalogue shows the built-in showcase, and clicking a
           tile there has to arrive somewhere: the shop answered, it simply has
           no such product. An outage is the opposite case — the shop did not
           answer, so we know nothing about this id, and matching it against the
           showcase would put a price and a Buy button on a page during the one
           moment we cannot tell whether either is true. */
        if (err?.status !== 404) { setUnavailable(true); return; }
        const sample = SAMPLE_PRODUCTS.find((p) => p.id === id);
        if (sample) setProduct(sample); else setNotFound(true);
      });
    // The whole catalogue used to be fetched here — 49 KB of JSON on a page that
    // shows one product — purely to compute four same-category "related" items as
    // a fallback. The recommendations endpoint one line down already does exactly
    // that server-side, including the same-category fallback, and returns six
    // products instead of seventy-two.
    api.get(`/api/products/${id}/recommendations`).then(setRecs).catch(() => {});
  }, [id]);

  /* These three used to depend on the product OBJECT, which was fine while the
     object arrived exactly once. It now arrives twice — the server's copy on
     first render, then the revalidating fetch — and a new object identity for
     the same product fired every one of them again: two /price-history calls,
     two /mystery calls, two recorded views of one visit. Depending on the id is
     what was always meant; the object was standing in for it. */
  // Record this visit in the customer's own recently-viewed history.
  const recentlyViewed = useRecentlyViewed();
  useEffect(() => {
    if (!product || product.sample) return;
    recordProductView(product);
    /* The second funnel step, for visitors who arrived from an advert. Silent
       for everyone else — reportStep sends nothing without a stored visit, so
       this costs the other 99% of traffic no request. Sample products are
       excluded for the same reason they are excluded above: they are the
       offline placeholder catalogue, not something anyone can buy. */
    reportStep('product_view', product.id);
  },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [product?.id, product?.sample]);

  // Mystery box: load the reward pool + odds to show "what's inside".
  useEffect(() => {
    if (product?.kind !== 'mystery') { setMysteryPool(null); return; }
    api.get(`/api/products/${product.id}/mystery`).then((r) => setMysteryPool(r.rewards || [])).catch(() => setMysteryPool([]));
  }, [product?.id, product?.kind]);

  // Price history for the chart.
  useEffect(() => {
    if (!product?.id || product.sample) { setPriceHist([]); return; }
    api.get(`/api/products/${product.id}/price-history`).then((r) => setPriceHist(r.history || [])).catch(() => setPriceHist([]));
  }, [product?.id, product?.sample]);

  if (unavailable) {
    return (
      <div className="section py-24 text-center">
        <h1 className="text-2xl text-white mb-2">
          {t('product.unavailable', 'We cannot load this product right now')}
        </h1>
        <p className="text-slate-400 max-w-md mx-auto">
          {t('product.unavailableSub',
            'This is on our side. The link is fine — please try again in a few minutes.')}
        </p>
        <button type="button" onClick={() => window.location.reload()}
          className="btn-primary mt-5 inline-flex min-h-[44px]">
          {t('shop.retry', 'Try again')}
        </button>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="section py-24 text-center">
        <h1 className="text-2xl text-white mb-2">{t('product.notFound', 'Product not found')}</h1>
        <Link to="/shop" className="btn-primary mt-4 inline-flex">{t('product.back', 'Back to shop')}</Link>
      </div>
    );
  }
  if (!product) return <PageLoader />;

  const { icon: Icon, grad, label } = categoryVisual(product.category);
  const desc = productDescription(product, lang);
  const crossSell = (recs.crossSell || []).slice(0, 4);
  const upsell = recs.upsell?.[0] || null;
  /* Other sizes of the same thing, for the pack switcher.
     This used to be `related`, computed from a fetch of the WHOLE catalogue that
     was removed as an obvious waste — 49 KB of JSON to pick four items the
     recommendations endpoint already returns. The fetch went; two references to
     `related` did not, and a ReferenceError in render does not degrade, it
     blanks the page. Every product page on the site rendered an empty body.
     Recommendations may cross categories (they include co-purchases), so the
     switcher takes only the same-category ones — which is exactly what the old
     variable held. */
  const packSiblings = (recs.crossSell || []).filter((p) => p.category === product?.category);
  const wished = has(product.id);

  const addToCart = () => {
    flyToCart(document.querySelector('[data-pd-media]'));
    // `add` refuses before launch and says so by returning false — a button that
    // silently does nothing is worse than one that explains itself.
    if (!add(product, qty)) {
      toast(t('launch.cartClosed', 'ForgeMarket opens on launch day — you can browse everything until then.'));
      return;
    }
    toast.success(`${qty}× ${product.name} ${t('cart.addedToCart', 'added to cart')}`);
  };
  // Straight to checkout — the cart is a dead screen on the highest-intent click.
  const buyNow = () => { if (add(product, qty)) navigate('/checkout'); };

  return (
    <div className="section pt-10 pb-28 lg:pb-10">
      <Link to="/shop" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-6">
        <ArrowLeft size={16} /> {t('product.back', 'Back to shop')}
      </Link>

      <div className="grid lg:grid-cols-2 gap-10">
        {/* visual — shared-element morph target, with pointer-driven 3D tilt */}
        <Tilt max={6} className="h-80 lg:h-[420px]">
        <div style={{ viewTransitionName: 'product-hero' }}
          className={`shine-host group relative rounded-3xl h-full overflow-hidden animate-fade-in ${
            carriesOwnBackground(product.image) && !heroBroken ? 'bg-slate-100' : `bg-gradient-to-br ${grad}`
          } ${product.featured ? 'ring-featured' : ''}`}>
          {product.image && !heroBroken ? (
            carriesOwnBackground(product.image) ? (
              /* Artwork with its own background: a hint of its colour behind it,
                 and the whole image on top so nothing is cropped.

                 A hint, not a wall. The same blurred-copy trick that makes a
                 150px tile take its artwork's colour becomes a 420px panel of
                 saturated mush at hero size — a gold coin render turned the
                 whole left half of the page orange. Low opacity over a neutral
                 base keeps the association with the artwork's colour without
                 the page having to shout it, and the category gradient is
                 dropped here too: two colour sources arguing under one picture
                 is what made it muddy. */
              <>
                <img src={product.image} alt="" aria-hidden="true" decoding="async"
                  className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-30" />
                <img data-pd-media src={product.image} alt={product.name} onError={() => setHeroBroken(true)}
                  fetchpriority="high" decoding="async"
                  className="absolute inset-0 w-full h-full object-contain p-8 drop-shadow-2xl transition-transform duration-700 group-hover:scale-105" />
              </>
            ) : (
              <img data-pd-media src={product.image} alt={product.name} onError={() => setHeroBroken(true)}
                fetchpriority="high" decoding="async"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
            )
          ) : iconFor(product.category) ? (
            // Image missing/broken → show the category logo centred on the gradient
            // (never the ugly broken-image icon).
            <>
              <div className="absolute inset-0 bg-grid opacity-25" />
              <img src={iconFor(product.category)} alt={product.name}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[46%] max-w-[220px] object-contain drop-shadow-2xl group-hover:scale-105 transition-transform duration-700" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 bg-grid opacity-30" />
              <Icon className="absolute right-8 top-8 text-white/90" size={44} />
              <Icon className="absolute -right-10 -bottom-12 text-white/10" size={260} />
            </>
          )}
          {product.featured && (
            <span className="absolute left-5 top-5 inline-flex items-center gap-1 text-xs font-bold uppercase bg-black/40 text-amber-300 px-3 py-1.5 rounded-full backdrop-blur">
              <Zap size={13} /> {t('product.featured', 'Featured')}
            </span>
          )}
        </div>
        </Tilt>

        {/* details */}
        <div className="animate-fade-up">
          <span className="text-xs uppercase tracking-wider text-indigo-400 font-rajdhani">{label}</span>
          <h1 className="text-3xl sm:text-4xl text-white mt-2">{product.name}</h1>

          {/* rating + stock */}
          <div className="flex items-center gap-3 mt-3 text-sm">
            {/* These stars used to be stats.rating — the SHOP's average, sitting
                under this product's name where every reader takes it as this
                product's score. Reviews carry no product_id yet, so the honest
                move is to label the shop rating as the shop's and link it. */}
            {stats.reviews > 0 ? (
              <Link to="/reviews" className="inline-flex items-center gap-1.5 text-slate-600 hover:text-violet-700 transition">
                <span className="flex items-center gap-0.5 text-amber-500">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={14} fill={i < Math.round(stats.rating || 0) ? 'currentColor' : 'none'} />
                  ))}
                </span>
                <span>{t('pd.shopRating', '{r} across the shop · {n} reviews', {
                  r: stats.rating, n: stats.reviews.toLocaleString('en-US') })}</span>
              </Link>
            ) : (
              <span className="text-slate-500">{t('pd.noReviewsYet', 'No reviews yet — the shop is new')}</span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-4">
            <span className="text-3xl font-semibold gradient-text gradient-anim">{money(product.price, product.currency)}</span>
            {product.compareAtPrice > product.price && (
              <>
                <span className="text-xl text-slate-500 line-through">{money(product.compareAtPrice, product.currency)}</span>
                <span className="text-xs font-black text-white bg-rose-500 rounded-full px-2.5 py-1">
                  -{Math.round((1 - product.price / product.compareAtPrice) * 100)}% {t('product.off', 'OFF')}
                </span>
              </>
            )}
          </div>

          {/* Stock, the real estimate, and what we will ask you for — the three
              things a buyer weighs before transferring money to a stranger.
              Above the pack switcher on purpose: each pack is its own route, so
              this always describes the product on screen, and delivery is the
              question people have BEFORE they pick a size. */}
          <DeliveryFacts product={product} t={t} />

          {/* Pack switcher — jump between sizes of the same category in one tap */}
          {packSiblings.length > 0 && (
            <div className="mt-5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                {t('product.chooseAmount', 'Choose your amount')}
              </div>
              <div className="flex flex-wrap gap-2">
                {[product, ...packSiblings]
                  .sort((a, b) => a.price - b.price)
                  .map((p) => {
                    const current = p.id === product.id;
                    return current ? (
                      <span key={p.id}
                        className="px-3.5 py-2 rounded-xl text-sm font-bold text-white shadow-lg shadow-violet-500/30"
                        style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
                        {p.name} · {money(p.price, p.currency)}
                      </span>
                    ) : (
                      <Link key={p.id} to={`/product/${p.id}`}
                        className="px-3.5 py-2 rounded-xl text-sm font-semibold glass text-slate-300 border border-white/10 hover:border-violet-400/60 hover:text-white transition">
                        {p.name} · {money(p.price, p.currency)}
                      </Link>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Upsell: nudge to a bigger pack */}
          {upsell && (
            <Link to={`/product/${upsell.id}`} className="group mt-4 flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 hover:border-violet-300 transition">
              <span className="text-[11px] font-bold uppercase tracking-wide text-violet-600 bg-white rounded-md px-1.5 py-0.5">{t('product.upgrade', 'Upgrade')}</span>
              <span className="text-sm text-slate-600 flex-1">{t('product.getMore', 'Get more with')} <b className="text-slate-900">{upsell.name}</b> — {money(upsell.price, upsell.currency)}</span>
              <ChevronDown size={16} className="-rotate-90 text-violet-500 fm-nudge" />
            </Link>
          )}

          {desc && <p className="text-slate-400 mt-5 leading-relaxed">{desc}</p>}

          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center glass rounded-xl">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={t('product.qtyLess', 'One fewer')}
                  className="p-3.5 text-slate-300 hover:text-white"><Minus size={16} /></button>
                <span className="w-10 text-center text-white">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} aria-label={t('product.qtyMore', 'One more')}
                  className="p-3.5 text-slate-300 hover:text-white"><Plus size={16} /></button>
              </div>
              <span className="text-slate-500 text-sm font-rajdhani uppercase tracking-wide">{t('product.qty', 'Quantity')}</span>
            </div>
            {/* Before launch the shop cannot take this order, and a button that
                looks ready and then refuses is worse than no button. The
                wishlist stays: saving something for the day is exactly what a
                visitor is here to do. */}
            <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
              {prelaunch ? (
                <div className="col-span-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-center">
                  <span className="text-sm font-semibold text-violet-700">
                    {t('launch.ctaClosed', 'Opens on launch day')}
                  </span>
                </div>
              ) : (
                <>
                  <button onClick={addToCart} className="btn-ghost py-3"><ShoppingCart size={18} /> {t('product.addToCart', 'Add to cart')}</button>
                  <button onClick={buyNow} className="btn-primary py-3">{t('product.buyNow', 'Buy now')}</button>
                </>
              )}
              <button onClick={() => toggle(product)} aria-label="Wishlist"
                className={`btn-ghost px-3.5 ${wished ? 'text-pink-500' : ''}`}>
                <Heart size={18} fill={wished ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>

          {/* Trust indicators, read last before the tap. The old block here
              repeated the delivery promise that DeliveryFacts now states once,
              properly, above the button — two versions of the same claim in one
              column is how they drift apart. These four are policy and mechanism
              only, all true on day one. */}
          <TrustRow t={t} />
        </div>
      </div>

      {/* Moved above the mystery pool and the price chart: "how does this
          actually reach me?" is the question a buyer has BEFORE deciding,
          and it was sitting three screens down, under a graph. */}
      {/* How this is delivered — category-specific, the #1 pre-purchase question */}
      {(() => {
        const d = deliveryInfo(product.category, lang);
        return (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 mt-14 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-10 h-10 rounded-xl grid place-items-center text-white shrink-0"
                style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
                <Truck size={18} />
              </span>
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">{t('product.howDelivered', 'How this is delivered')}</h2>
                <p className="text-slate-500 text-sm">{d.method}</p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-6 mt-5">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-violet-600 mb-3">{t('product.steps', 'Steps')}</div>
                <ol className="space-y-2.5">
                  {d.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                      <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold grid place-items-center shrink-0 mt-0.5">{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-600 mb-3">{t('product.goodToKnow', 'Good to know')}</div>
                <ul className="space-y-2.5">
                  {d.notes.map((n, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-slate-600">
                      <Info size={15} className="text-amber-500 shrink-0 mt-0.5" />
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Mystery box — possible prizes (the odds stay a mystery on purpose) */}
      {product.kind === 'mystery' && mysteryPool && mysteryPool.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-2xl p-6 sm:p-8 mt-14 shadow-sm">
          <div className="flex items-center gap-3 mb-1">
            <span className="w-10 h-10 rounded-xl grid place-items-center text-white shrink-0"
              style={{ backgroundImage: 'linear-gradient(135deg,#f59e0b,#f43f5e)' }}>🎁</span>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">{t('mystery.whatsInside', 'What’s inside')}</h2>
              <p className="text-slate-500 text-sm">{t('mystery.sub', 'Every box wins a real prize — could be any of these. Prizes pay out as store credit, instantly. The odds? That’s the mystery. 🤫')}</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5 mt-4">
            {mysteryPool.map((r, i) => (
              <div key={i} className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
                <span className="text-amber-500 shrink-0">🎁</span>
                <span className="text-sm font-semibold text-slate-800">{r.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price history */}
      {priceHist.length >= 2 && (() => {
        const prices = priceHist.map((h) => h.price);
        const min = Math.min(...prices), max = Math.max(...prices), span = Math.max(1, max - min);
        const W = 640, H = 120, pad = 6;
        const pts = priceHist.map((h, i) => {
          const x = pad + (i / (priceHist.length - 1)) * (W - 2 * pad);
          const y = pad + (1 - (h.price - min) / span) * (H - 2 * pad);
          return [x, y];
        });
        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
        const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`;
        const now = prices[prices.length - 1], lowest = min;
        return (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 mt-14 shadow-sm">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-xl font-extrabold text-slate-900">{t('price.history', 'Price history')}</h2>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-slate-500">{t('price.now', 'Now')}: <b className="text-slate-900">{money(now, product.currency)}</b></span>
                <span className="text-emerald-600">{t('price.lowest', 'Lowest')}: <b>{money(lowest, product.currency)}</b></span>
              </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
              <defs>
                <linearGradient id="ph-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#ph-fill)" />
              <path d={line} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.5" fill="#7c3aed" />
            </svg>
            {now <= lowest && (
              <p className="text-emerald-600 text-sm font-semibold mt-2">🔥 {t('price.atLowest', 'This is the lowest price we’ve offered!')}</p>
            )}
          </div>
        );
      })()}

      {/* Reviews + FAQ */}
      <div className="grid lg:grid-cols-2 gap-10 mt-16">
        <section>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-2xl font-extrabold text-slate-900">{t('pd.shopReviews', 'What buyers say about the shop')}</h2>
            <Link to="/reviews" className="text-violet-600 text-sm font-semibold hover:underline">{t('product.reviewsAll', 'All reviews →')}</Link>
          </div>
          {stats.reviews > 0 && (
            <div className="fm-hero-brand flex items-center gap-4 mb-5 rounded-2xl p-5 text-white shadow-lg shadow-violet-500/20"
              style={{ backgroundImage: 'linear-gradient(120deg,#7c5cff,#a855f7)' }}>
              <div className="text-5xl font-extrabold leading-none drop-shadow">{stats.rating}</div>
              <div>
                <div className="flex text-amber-300">{Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={16} fill={i < Math.round(stats.rating || 0) ? 'currentColor' : 'none'} />
                ))}</div>
                <div className="text-white/85 text-sm mt-1">
                  {stats.reviews.toLocaleString('en-US')} {t('product.verifiedCount', 'verified reviews')}
                </div>
              </div>
              <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[11px] font-bold bg-white/15 border border-white/25 rounded-full px-2.5 py-1">
                <BadgeCheck size={12} /> {t('product.realBuyers', 'Real buyers only')}
              </span>
            </div>
          )}
          <div className="space-y-3">
            {reviews.length === 0 && (
              <div className="card p-4 text-slate-400 text-sm">{t('product.noReviews', 'No reviews yet — be the first after your purchase.')}</div>
            )}
            {reviews.slice(0, 3).map((r) => (
              <div key={r.id} className="card p-4 fm-lift">
                <div className="flex text-amber-400 mb-1.5">{Array.from({ length: r.stars || 5 }).map((_, i) => <Star key={i} size={13} fill="currentColor" />)}</div>
                <p className="text-slate-200 text-sm">“{r.body}”</p>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-500">
                  <BadgeCheck size={12} className="text-emerald-500" /> {r.author}
                  {r.verified ? <span className="text-emerald-600 font-semibold">· {t('product.verifiedBuyer', 'Verified buyer')}</span> : (r.product ? ` · ${r.product}` : ` · ${t('product.verifiedShort', 'Verified')}`)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-extrabold text-slate-900 mb-5">{t('product.faqTitle', 'Frequently asked')}</h2>
          <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm divide-y divide-slate-100 overflow-hidden">
            {productFaq(product, t).map(([q, a]) => (
              <details key={q} className="group">
                <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 py-3.5 min-h-[56px] hover:bg-slate-50 transition">
                  <span className="font-semibold text-slate-900 text-[14.5px]">{q}</span>
                  <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 -mt-1 text-sm text-slate-600 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>

      {crossSell.length > 0 && (
        <div className="mt-16">
          <h2 className="text-2xl font-extrabold text-slate-900 mb-6">{recs.crossSell?.length ? t('product.boughtTogether', 'Frequently bought together') : t('product.alsoLike', 'You might also like')}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 fm-grid-in">
            {crossSell.map((p) => <LightProductCard key={p.id} product={p} onAdd={(x) => { add(x); toast.success(`${x.name} ${t('cart.added', 'added')}`); }} />)}
          </div>
        </div>
      )}

      {/* Recently viewed — the visitor's own history (excludes this product) */}
      {recentlyViewed.filter((p) => p.id !== product.id).length > 0 && (
        <div className="mt-14">
          <h2 className="text-xl font-extrabold text-slate-900 mb-5">{t('product.recentlyViewed', 'Recently viewed')}</h2>
          <div className="fm-rail flex gap-4 overflow-x-auto pb-2 snap-x">
            {recentlyViewed.filter((p) => p.id !== product.id).slice(0, 6).map((p) => (
              <div key={p.id} className="snap-start shrink-0 w-[210px]">
                <LightProductCard product={p} onAdd={(x) => { add(x); toast.success(`${x.name} ${t('cart.added', 'added')}`); }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky mobile buy bar — price + CTA always in reach on phones */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 flex items-center gap-3"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <div className="min-w-0">
          <div className="text-[11px] text-slate-400 truncate">{product.name}</div>
          <div className="text-lg font-extrabold text-violet-600 leading-tight">{money(product.price * qty, product.currency)}</div>
        </div>
        {prelaunch ? (
          <span className="flex-1 py-3 text-center text-sm font-semibold text-violet-700 bg-violet-50 rounded-xl border border-violet-200">
            {t('launch.ctaClosed', 'Opens on launch day')}
          </span>
        ) : (
          <button onClick={addToCart} className="btn-primary flex-1 py-3 fm-tap"><ShoppingCart size={17} /> {t('product.addToCart', 'Add to cart')}</button>
        )}
      </div>
    </div>
  );
}
