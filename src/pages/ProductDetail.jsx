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
import { categoryVisual, money, isCustomImage } from '../lib/catalog.js';
import { iconFor } from '../lib/sampleCatalog.js';
import { SAMPLE_PRODUCTS, withFallback } from '../lib/sampleCatalog.js';
import { PageLoader } from '../components/ui.jsx';
import LightProductCard from '../components/store/LightProductCard.jsx';
import { useReviews } from '../lib/useReviews.js';
import { useStats } from '../lib/useStats.js';
import { useWishlist } from '../lib/wishlist.js';
import { usePageMeta, useJsonLd } from '../lib/useMeta.js';
import { useI18n } from '../lib/i18n.jsx';
import { recordProductView, useRecentlyViewed } from '../lib/recentlyViewed.js';
import { flyToCart } from '../lib/flyToCart.js';
import Tilt from '../components/Tilt.jsx';

const TRUST = [
  { icon: Zap, key: 'instant', title: 'Instant delivery', sub: 'Codes in seconds' },
  { icon: ShieldCheck, key: 'protected', title: 'Buyer protected', sub: 'Money-back guarantee' },
  { icon: BadgeCheck, key: 'verified', title: 'Verified reviews', sub: 'Real purchases only' },
  { icon: Headphones, key: 'support', title: '24/7 support', sub: 'Always here to help' },
];

const FAQ = [
  ['How fast will I get it?', 'Most orders are delivered automatically within seconds of your payment being confirmed — straight to your email and account dashboard.', 'speed'],
  ['How do I pay?', 'Securely via Tikkie, Revolut or PayPal. You submit your transaction reference and we confirm it, usually within minutes.', 'pay'],
  ['Is it safe?', 'Yes — every order is buyer-protected and money-back guaranteed. We use passwordless login and fraud screening on every order.', 'safe'],
  ['What if it doesn’t arrive?', 'Open a ticket from your dashboard or our Discord — we resolve delivery issues fast, and eligible orders are fully refundable.', 'arrive'],
];

export default function ProductDetail() {
  const { id } = useParams();
  const { add } = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const reviews = useReviews();
  const stats = useStats();
  const { t, lang } = useI18n();
  const { has, toggle } = useWishlist();
  const [product, setProduct] = useState(null);
  const [all, setAll] = useState([]);
  const [qty, setQty] = useState(1);
  const [notFound, setNotFound] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [recs, setRecs] = useState({ crossSell: [], upsell: [] });
  const [mysteryPool, setMysteryPool] = useState(null);
  const [priceHist, setPriceHist] = useState([]);
  const [heroBroken, setHeroBroken] = useState(false); // product image failed to load
  usePageMeta(product?.name || 'Product', product?.description || 'Instant digital delivery.');
  // Product structured data → rich results (price, rating) in Google.
  useJsonLd('product', product && {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || 'Instant digital delivery.',
    sku: product.sku || product.id,
    category: product.category,
    ...(product.image ? { image: product.image } : {}),
    brand: { '@type': 'Brand', name: 'ForgeMarket' },
    ...(stats.reviews > 0 ? {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: String(stats.rating),
        reviewCount: stats.reviews,
      },
    } : {}),
    offers: {
      '@type': 'Offer',
      price: ((product.price || 0) / 100).toFixed(2),
      priceCurrency: product.currency || 'EUR',
      availability: typeof product.stock === 'number' && product.stock <= 0
        ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    },
  });

  useEffect(() => {
    setProduct(null); setQty(1); setNotFound(false); setRecs({ crossSell: [], upsell: [] }); setHeroBroken(false);
    api.get(`/api/products/${id}`)
      .then((r) => setProduct(r.product))
      .catch(() => {
        const sample = SAMPLE_PRODUCTS.find((p) => p.id === id);
        if (sample) setProduct(sample); else setNotFound(true);
      });
    api.get('/api/products').then((r) => setAll(withFallback(r.products))).catch(() => setAll(SAMPLE_PRODUCTS));
    api.get(`/api/products/${id}/recommendations`).then(setRecs).catch(() => {});
  }, [id]);

  // Record this visit in the customer's own recently-viewed history.
  const recentlyViewed = useRecentlyViewed();
  useEffect(() => { if (product && !product.sample) recordProductView(product); }, [product]);

  // Mystery box: load the reward pool + odds to show "what's inside".
  useEffect(() => {
    if (product?.kind !== 'mystery') { setMysteryPool(null); return; }
    api.get(`/api/products/${product.id}/mystery`).then((r) => setMysteryPool(r.rewards || [])).catch(() => setMysteryPool([]));
  }, [product]);

  // Price history for the chart.
  useEffect(() => {
    if (!product?.id || product.sample) { setPriceHist([]); return; }
    api.get(`/api/products/${product.id}/price-history`).then((r) => setPriceHist(r.history || [])).catch(() => setPriceHist([]));
  }, [product]);

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
  const related = all.filter((p) => p.id !== product.id && p.category === product.category).slice(0, 4);
  const crossSell = (recs.crossSell?.length ? recs.crossSell : related).slice(0, 4);
  const upsell = recs.upsell?.[0] || null;
  const wished = has(product.id);

  const addToCart = () => {
    flyToCart(document.querySelector('[data-pd-media]'));
    add(product, qty); toast.success(`${qty}× ${product.name} ${t('cart.addedToCart', 'added to cart')}`);
  };
  const buyNow = () => { add(product, qty); navigate('/cart'); };

  return (
    <div className="section pt-10 pb-28 lg:pb-10">
      <Link to="/shop" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-6">
        <ArrowLeft size={16} /> {t('product.back', 'Back to shop')}
      </Link>

      <div className="grid lg:grid-cols-2 gap-10">
        {/* visual — shared-element morph target, with pointer-driven 3D tilt */}
        <Tilt max={6} className="h-80 lg:h-[420px]">
        <div style={{ viewTransitionName: 'product-hero' }}
          className={`shine-host group relative rounded-3xl bg-gradient-to-br ${grad} h-full overflow-hidden animate-fade-in ${product.featured ? 'ring-featured' : ''}`}>
          {product.image && !heroBroken ? (
            isCustomImage(product.image) ? (
              // Owner-supplied artwork: blurred fill behind + the full image on
              // top, so a logo with its own background sits cleanly (no crop).
              <>
                <img src={product.image} alt="" aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-90" />
                <img data-pd-media src={product.image} alt={product.name} onError={() => setHeroBroken(true)}
                  className="absolute inset-0 w-full h-full object-contain p-8 drop-shadow-2xl transition-transform duration-700 group-hover:scale-105" />
              </>
            ) : (
              <img data-pd-media src={product.image} alt={product.name} onError={() => setHeroBroken(true)}
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
            <span className="flex items-center gap-1 text-amber-400">
              {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={14} fill="currentColor" />)}
            </span>
            {stats.reviews > 0
              ? <span className="text-slate-400">{stats.rating} · {stats.reviews.toLocaleString('en-US')} {t('product.reviewsWord', 'reviews')}</span>
              : <span className="text-slate-400">{t('product.new', 'New')}</span>}
            {typeof product.stock === 'number' && product.stock > 0 && product.stock <= 10 && (
              <span className="text-red-500 font-semibold">{t('product.onlyLeft', 'Only {n} left', { n: product.stock })}</span>
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

          {product.stockLeft > 0 && (
            <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-3 py-1">
              🔥 {product.stockLeft === 1 ? t('card.lastOne', 'Last one!') : t('product.almostGone', 'Almost sold out — only {n} left', { n: product.stockLeft })}
            </div>
          )}

          {/* Pack switcher — jump between sizes of the same category in one tap */}
          {related.length > 0 && (
            <div className="mt-5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                {t('product.chooseAmount', 'Choose your amount')}
              </div>
              <div className="flex flex-wrap gap-2">
                {[product, ...related]
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

          {/* delivery estimate */}
          <div className="inline-flex items-center gap-2 mt-3 text-sm text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-1.5">
            <Zap size={14} /> {t('product.delivery', 'Delivery:')} <b>{t('product.asap', 'as fast as possible')}</b>
          </div>

          {/* Upsell: nudge to a bigger pack */}
          {upsell && (
            <Link to={`/product/${upsell.id}`} className="group mt-4 flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5 hover:border-violet-300 transition">
              <span className="text-[11px] font-bold uppercase tracking-wide text-violet-600 bg-white rounded-md px-1.5 py-0.5">{t('product.upgrade', 'Upgrade')}</span>
              <span className="text-sm text-slate-600 flex-1">{t('product.getMore', 'Get more with')} <b className="text-slate-900">{upsell.name}</b> — {money(upsell.price, upsell.currency)}</span>
              <ChevronDown size={16} className="-rotate-90 text-violet-500 fm-nudge" />
            </Link>
          )}

          {product.description && <p className="text-slate-400 mt-5 leading-relaxed">{product.description}</p>}

          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center glass rounded-xl">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="p-3 text-slate-300 hover:text-white"><Minus size={16} /></button>
                <span className="w-10 text-center text-white">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} className="p-3 text-slate-300 hover:text-white"><Plus size={16} /></button>
              </div>
              <span className="text-slate-500 text-sm font-rajdhani uppercase tracking-wide">{t('product.qty', 'Quantity')}</span>
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
              <button onClick={addToCart} className="btn-ghost py-3"><ShoppingCart size={18} /> {t('product.addToCart', 'Add to cart')}</button>
              <button onClick={buyNow} className="btn-primary py-3">{t('product.buyNow', 'Buy now')}</button>
              <button onClick={() => toggle(product)} aria-label="Wishlist"
                className={`btn-ghost px-3.5 ${wished ? 'text-pink-500' : ''}`}>
                <Heart size={18} fill={wished ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>

          {/* trust badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8">
            {TRUST.map(({ icon: I, title, sub, key }) => (
              <div key={title} className="glass rounded-xl p-3 text-center">
                <I size={18} className="text-indigo-300 mx-auto mb-1.5" />
                <div className="text-xs text-white font-medium">{t(`product.${key}`, title)}</div>
                <div className="text-[11px] text-slate-500">{t(`product.${key}Sub`, sub)}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-6 text-sm text-emerald-300">
            <BadgeCheck size={16} /> {t('product.autoDeliver', 'Delivered to your dashboard automatically after payment')}
          </div>
        </div>
      </div>

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

      {/* Reviews + FAQ */}
      <div className="grid lg:grid-cols-2 gap-10 mt-16">
        <section>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-2xl font-extrabold text-slate-900">{t('product.buyersSay', 'What buyers say')}</h2>
            <Link to="/reviews" className="text-violet-600 text-sm font-semibold hover:underline">{t('product.reviewsAll', 'All reviews →')}</Link>
          </div>
          {stats.reviews > 0 && (
            <div className="fm-hero-brand flex items-center gap-4 mb-5 rounded-2xl p-5 text-white shadow-lg shadow-violet-500/20"
              style={{ backgroundImage: 'linear-gradient(120deg,#7c5cff,#a855f7)' }}>
              <div className="text-5xl font-extrabold leading-none drop-shadow">{stats.rating}</div>
              <div>
                <div className="flex text-amber-300">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={16} fill="currentColor" />)}</div>
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
          <div className="space-y-3">
            {FAQ.map(([q, a, key], i) => (
              <button key={q} onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                className="card w-full text-left p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white font-medium text-sm">{t(`faq.${key}q`, q)}</span>
                  <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </div>
                {openFaq === i && <p className="text-slate-400 text-sm mt-2.5 leading-relaxed">{t(`faq.${key}a`, a)}</p>}
              </button>
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
        <button onClick={addToCart} className="btn-primary flex-1 py-3 fm-tap"><ShoppingCart size={17} /> {t('product.addToCart', 'Add to cart')}</button>
      </div>
    </div>
  );
}
