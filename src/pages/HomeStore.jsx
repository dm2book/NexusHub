import { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, ShoppingCart, Zap, ShieldCheck, Headphones, Tag, Star, ArrowRight,
  Plus, LayoutGrid, Users, CheckCircle2, Clock, MessageCircle, ChevronRight, Sparkles, Shield,
} from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { usePageMeta, useJsonLd } from '../lib/useMeta.js';
import { useI18n } from '../lib/i18n.jsx';
import { LangSwitch } from '../components/store/StoreNav.jsx';
import { flyToCart } from '../lib/flyToCart.js';
import { api } from '../lib/api.js';
import { useStats } from '../lib/useStats.js';
import { useReviews } from '../lib/useReviews.js';
import { useReveal } from '../lib/useReveal.js';
import { useParallax } from '../lib/useParallax.js';
import CountUp from '../components/CountUp.jsx';
import RecentlyDelivered from '../components/store/RecentlyDelivered.jsx';
import CommandPalette from '../components/store/CommandPalette.jsx';
import MobileTabBar from '../components/store/MobileTabBar.jsx';
import AnnouncementBar from '../components/store/AnnouncementBar.jsx';
import { SystemStatus } from '../components/store/StoreFooter.jsx';
import { money } from '../lib/catalog.js';
import { withFallback, SAMPLE_PRODUCTS, iconPath } from '../lib/sampleCatalog.js';
import { useCategoryLogos } from '../lib/useCategoryLogos.js';

const ICON = iconPath;

/* ── Left sidebar categories (matches the reference order) ─────────────── */
const CATEGORIES = [
  { label: 'All Products', slug: '', node: <LayoutGrid size={18} className="text-violet-600" /> },
  { label: 'Robux', slug: 'robux', img: 'robux' },
  { label: 'V-Bucks', slug: 'v-bucks', img: 'v-bucks' },
  { label: 'Valorant Points', slug: 'valorant', img: 'valorant' },
  { label: 'Gift Cards', slug: 'giftcard', img: 'giftcard' },
  { label: 'Steam Wallet', slug: 'steam', img: 'steam' },
  { label: 'PlayStation Store', slug: 'playstation', img: 'playstation' },
  { label: 'Xbox Gift Card', slug: 'xbox', img: 'xbox' },
  { label: 'Discord Nitro', slug: 'discord-nitro', img: 'discord-nitro' },
  { label: 'iTunes', slug: 'itunes', img: 'itunes' },
];

/* ── Popular category tiles — prices/data are resolved from the REAL catalog
   at runtime (cheapest product per category; add-to-cart adds a real product). */
const POPULAR_TILES = [
  { name: 'Robux', img: 'robux', slug: 'robux' },
  { name: 'V-Bucks', img: 'v-bucks', slug: 'v-bucks' },
  { name: 'Valorant Points', img: 'valorant', slug: 'valorant', popular: true },
  { name: 'Discord Nitro', img: 'discord-nitro', slug: 'discord-nitro' },
  { name: 'Steam Wallet', img: 'steam', slug: 'steam' },
  { name: 'PlayStation Store', img: 'playstation', slug: 'playstation' },
  { name: 'Xbox Gift Card', img: 'xbox', slug: 'xbox' },
  { name: 'CoD Points', img: 'cod', slug: 'cod' },
];

const NAV = [
  { key: 'nav.home', label: 'Home', to: '/' },
  { key: 'nav.products', label: 'All Products', to: '/shop' },
  { key: 'nav.reviews', label: 'Reviews', to: '/reviews' },
  { key: 'nav.how', label: 'How it works', to: '/how-it-works' },
  { key: 'nav.support', label: 'Support', to: '/contact' },
];

const HERO_FEATURES = [
  { icon: Zap, key: 'instant', title: 'Instant Delivery', sub: 'Get your items instantly', color: 'text-violet-600 bg-violet-100' },
  { icon: ShieldCheck, key: 'secure', title: 'Secure Payments', sub: '100% secure & trusted', color: 'text-emerald-600 bg-emerald-100' },
  { icon: Headphones, key: 'support', title: '24/7 Support', sub: "We're here for you", color: 'text-blue-600 bg-blue-100' },
  { icon: Tag, key: 'prices', title: 'Best Prices', sub: 'Competitive prices daily', color: 'text-amber-600 bg-amber-100' },
];

const TRUST = [
  { icon: Zap, key: 'tInstant', title: 'Instant Delivery', sub: 'Fast & reliable delivery', color: 'text-violet-600 bg-violet-100' },
  { icon: ShieldCheck, key: 'tSecure', title: '100% Secure', sub: 'Your data is protected', color: 'text-emerald-600 bg-emerald-100' },
  { icon: Tag, key: 'prices', title: 'Best Prices', sub: 'Competitive prices daily', color: 'text-amber-600 bg-amber-100' },
  { icon: Headphones, key: 'tSupport', title: '24/7 Support', sub: 'Always here to help', color: 'text-blue-600 bg-blue-100' },
];

// Real counts only — append "+" once the number is large enough to round.
const fmtCount = (n) => `${Number(n || 0).toLocaleString('en-US')}${Number(n || 0) >= 100 ? '+' : ''}`;
// Real average delivery time → a short human string, or null when there are no
// completed orders yet (so we never fake an "instant" claim).
const fmtDelivery = (s) => (s == null ? null
  : s < 90 ? `${Math.max(1, Math.round(s))}s`
  : s < 5400 ? `${Math.round(s / 60)} min`
  : `${Math.round(s / 3600)}h`);
// All real (or honest service promises) — no fabricated metrics. The 2nd card
// shows a real fulfilment rate once orders have finished, else a real guarantee;
// the 4th shows the real average delivery time once we have one, else 24/7 support.
const statCards = (s, tr = (_k, en) => en) => [
  // "Happy customers" = people who actually LEFT A REVIEW — not just anyone
  // who ordered. The number only exists once someone wrote one.
  { icon: Users, value: fmtCount(s.reviews), label: tr('home.s.customers', 'Happy Customers'), color: 'text-violet-600 bg-violet-100' },
  s.successRate != null
    ? { icon: CheckCircle2, value: `${s.successRate}%`, label: tr('home.s.fulfilled', 'Fulfilled'), color: 'text-emerald-600 bg-emerald-100' }
    : { icon: ShieldCheck, value: '100%', label: tr('home.s.protected', 'Buyer protected'), color: 'text-emerald-600 bg-emerald-100' },
  { icon: ShoppingCart, value: fmtCount(s.delivered), label: tr('home.s.delivered', 'Orders Delivered'), color: 'text-blue-600 bg-blue-100' },
  s.avgDeliverySeconds != null
    ? { icon: Clock, value: fmtDelivery(s.avgDeliverySeconds), label: tr('home.s.avgDelivery', 'Avg. delivery'), color: 'text-amber-600 bg-amber-100' }
    : { icon: Headphones, value: '24/7', label: tr('home.s.support', 'Customer Support'), color: 'text-amber-600 bg-amber-100' },
];

export default function HomeStore() {
  const { count, add } = useCart();
  const { user, isStaff } = useAuth();
  const { t: tr } = useI18n();
  const stats = useStats();
  const reviews = useReviews();
  const categoryLogos = useCategoryLogos(); // owner-set logos (Admin → Categories)
  useReveal();
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) localStorage.setItem('fm_ref', ref.toUpperCase().slice(0, 40));
  }, []);
  usePageMeta('ForgeMarket — Everything You Need, All in One Place',
    'Buy Robux, V-Bucks, Valorant Points, gift cards and more instantly. Fast delivery, secure payments, 24/7 support.');
  // Organization + site-search structured data for rich Google results.
  useJsonLd('org', {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'OnlineStore',
        name: 'ForgeMarket',
        url: window.location.origin,
        description: 'Premium gaming top-ups: Robux, V-Bucks, gift cards & more with instant delivery.',
      },
      {
        '@type': 'WebSite',
        name: 'ForgeMarket',
        url: window.location.origin,
        potentialAction: {
          '@type': 'SearchAction',
          target: `${window.location.origin}/shop?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  });
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => { api.get('/api/config').then((c) => setAnnouncement(c.announcement || '')).catch(() => {}); }, []);
  const railRef = useRef(null);
  const STATS = statCards(stats, tr);

  const scrollRail = () => railRef.current?.scrollBy({ left: 320, behavior: 'smooth' });

  // Real catalog → tiles show the true "From" price; add-to-cart adds the
  // cheapest REAL product in that category (no fabricated items/prices).
  const [products, setProducts] = useState([]);
  useEffect(() => {
    api.get('/api/products').then((r) => setProducts(withFallback(r.products))).catch(() => setProducts(SAMPLE_PRODUCTS));
  }, []);
  const popular = useMemo(() => POPULAR_TILES.map((t) => {
    const items = products.filter((p) => p.category === t.slug && p.active !== false);
    if (!items.length) return null;
    const cheapest = items.reduce((a, b) => (a.price <= b.price ? a : b));
    return { ...t, cheapest, from: cheapest.price, currency: cheapest.currency || 'EUR', count: items.length };
  }).filter(Boolean), [products]);
  const addToCart = (t) => add(t.cheapest);

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-900 fm-page" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        @keyframes fmFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
        @keyframes fmFloat2 { 0%,100%{transform:translateY(0)} 50%{transform:translateY(10px)} }
        @keyframes fmSpinSlow { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        .fm-float{animation:fmFloat 5s ease-in-out infinite}
        .fm-float2{animation:fmFloat2 6s ease-in-out infinite}
        .fm-rail::-webkit-scrollbar{height:0}
        .fm-head{font-weight:800;letter-spacing:-.02em}
      `}</style>

      <AnnouncementBar />

      {/* ── Top nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/70">
        <div className="max-w-[1400px] 2xl:max-w-[1560px] mx-auto px-4 lg:px-8 h-[68px] flex items-center gap-3 sm:gap-6">
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/30"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              <Zap size={18} fill="white" />
            </span>
            <span className="fm-head text-xl">ForgeMarket</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-7 text-[15px] font-medium text-slate-600">
            {NAV.map((n, i) => (
              <Link key={n.label} to={n.to}
                className={`relative py-1 hover:text-slate-900 transition ${i === 0 ? 'text-violet-600' : ''}`}>
                {tr(n.key, n.label)}
                {i === 0 && <span className="absolute -bottom-[22px] left-0 right-0 h-0.5 bg-violet-600 rounded-full" />}
              </Link>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Real global search — opens the ⌘K command palette */}
          <button onClick={() => window.dispatchEvent(new CustomEvent('forge:cmdk'))}
            className="hidden md:flex items-center gap-2 bg-slate-100 rounded-xl px-3.5 h-10 w-[260px] text-slate-400 hover:bg-slate-200/70 transition">
            <Search size={16} />
            <span className="text-sm">{tr('nav.search', 'Search for products...')}</span>
            <kbd className="ml-auto text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-400">⌘K</kbd>
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent('forge:cmdk'))} aria-label="Search"
            className="md:hidden w-10 h-10 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
            <Search size={20} />
          </button>

          <LangSwitch className="hidden sm:inline-flex" />

          <Link to="/cart" data-cart-target className="relative w-10 h-10 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
            <ShoppingCart size={20} />
            {count > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-violet-600 text-white text-[11px] font-semibold grid place-items-center">{count}</span>
            )}
          </Link>

          {isStaff && (
            <Link to="/admin" className="inline-flex items-center gap-1.5 text-[15px] font-semibold rounded-xl px-3.5 h-10 border border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 transition">
              <Shield size={16} /> <span className="hidden sm:inline">Admin</span>
            </Link>
          )}
          {user ? (
            <Link to="/account" className="hidden sm:inline-flex text-[15px] font-medium text-slate-600 hover:text-slate-900">{tr('nav.account', 'Account')}</Link>
          ) : (
            <Link to="/login" className="hidden sm:inline-flex text-[15px] font-medium text-slate-600 hover:text-slate-900">{tr('nav.login', 'Log in')}</Link>
          )}
          {!user && (
            <Link to="/login" className="inline-flex items-center gap-1.5 text-white text-[15px] font-semibold rounded-xl px-3.5 sm:px-4 h-10 shrink-0 shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              {tr('nav.signup', 'Sign Up')} <span className="hidden sm:inline-flex"><ArrowRight size={16} /></span>
            </Link>
          )}
        </div>
      </header>

      {/* ── Body: sidebar + main ────────────────────────────────── */}
      <div className="max-w-[1400px] 2xl:max-w-[1560px] mx-auto px-4 lg:px-8 py-6 flex gap-6 items-start">
        {/* Sidebar */}
        <aside className="hidden lg:block w-[248px] shrink-0 sticky top-[84px] space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/70 p-3 shadow-sm">
            <p className="text-[11px] font-bold tracking-wider text-slate-400 px-2 py-2">{tr('shop.browseCategories', 'BROWSE CATEGORIES')}</p>
            <nav className="space-y-0.5">
              {CATEGORIES.map((c, i) => (
                <Link key={c.label} to={`/shop${c.slug ? `?category=${c.slug}` : ''}`}
                  className={`flex items-center gap-3 px-2.5 py-2 rounded-xl text-[14.5px] font-medium transition
                    ${i === 0 ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <span className="w-7 h-7 grid place-items-center shrink-0">
                    {c.node || (c.letter
                      ? <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${c.grad} grid place-items-center text-white text-xs font-bold`}>{c.letter}</span>
                      : <img src={categoryLogos[c.slug] || ICON(c.img)} alt="" className="w-7 h-7 object-contain" />)}
                  </span>
                  {c.slug ? c.label : tr('shop.all', c.label)}
                </Link>
              ))}
              <Link to="/shop" className="flex items-center gap-3 px-2.5 py-2 rounded-xl text-[14.5px] font-medium text-slate-500 hover:bg-slate-50">
                <span className="w-7 h-7 grid place-items-center"><Plus size={18} /></span>
                {tr('home.moreCategories', 'More Categories')}
              </Link>
            </nav>
          </div>

          {/* Promo — only shown when a real announcement/offer is configured */}
          {announcement && (
            <div className="rounded-2xl p-5 text-white shadow-lg shadow-violet-500/20"
              style={{ backgroundImage: 'linear-gradient(150deg,#7c5cff,#9333ea)' }}>
              <div className="font-bold text-[15px] flex items-center gap-1.5">{tr('home.offer', 'Offer')} <span>🔥</span></div>
              <p className="text-white/90 text-[13px] mt-1 leading-snug">{announcement}</p>
              <Link to="/shop" className="mt-4 flex items-center justify-center gap-2 bg-white text-violet-700 font-semibold text-sm rounded-xl h-10 hover:bg-violet-50 transition">
                {tr('home.shopNow', 'Shop now')} <ArrowRight size={15} />
              </Link>
            </div>
          )}

          {/* ForgeBot widget */}
          <div className="bg-white rounded-2xl border border-slate-200/70 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-[15px]">ForgeBot</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Online
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2.5 mt-3">
              <span className="w-9 h-9 rounded-xl grid place-items-center text-white shrink-0"
                style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>🤖</span>
              <div className="bg-slate-100 rounded-xl rounded-tl-sm px-3 py-2 text-[13px] text-slate-600">
                {tr('home.botHi', 'Hi! 👋 How can I help you today?')}
              </div>
            </div>
            <Link to="/contact" className="mt-3 flex items-center justify-center gap-2 text-white font-semibold text-sm rounded-xl h-10 transition hover:brightness-105"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              <MessageCircle size={16} /> {tr('home.chat', 'Chat with us')}
            </Link>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 space-y-6">
          {/* Hero */}
          <section className="relative overflow-hidden rounded-3xl bg-white border border-slate-200/70 shadow-sm px-6 sm:px-10 py-9">
            {/* On xl the feature cards get their own column instead of floating
                over the artwork, which used to bury the right-hand logos. */}
            <div className="grid lg:grid-cols-[1.05fr_1fr] 2xl:grid-cols-[1.1fr_1fr_206px] gap-8 2xl:gap-6 items-center">
              <div>
                <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-violet-700 bg-violet-100 rounded-full px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> {tr('home.badge', '#1 Trusted Marketplace')}
                </span>
                <h1 className="fm-head text-[40px] sm:text-[52px] leading-[1.05] mt-5">
                  {tr('home.h1a', 'Everything You Need,')}<br />
                  <span className="fm-gradient-text">{tr('home.h1b', 'All in One Place.')}</span>
                </h1>
                <p className="text-slate-500 text-[16px] mt-5 max-w-lg leading-relaxed">
                  {tr('home.sub', 'Get Robux, V-Bucks, Valorant Points and more instantly. Fast delivery, secure payments, 24/7 support.')}
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-7">
                  <Link to="/shop" className="inline-flex items-center gap-2 text-white font-semibold rounded-xl px-6 h-12 shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
                    style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
                    {tr('home.shopNowBig', 'Shop Now')} <ArrowRight size={18} />
                  </Link>
                  <Link to="/shop" className="inline-flex items-center gap-2 font-semibold rounded-xl px-6 h-12 border border-slate-300 text-slate-700 hover:bg-slate-50 transition">
                    {tr('home.viewAll', 'View All Products')}
                  </Link>
                </div>
                {stats.reviews > 0 && (
                  <div className="flex items-center gap-3 mt-7">
                    <div className="flex -space-x-2.5">
                      {['#f472b6', '#60a5fa', '#34d399', '#fbbf24'].map((c, i) => (
                        <span key={i} className="w-9 h-9 rounded-full border-2 border-white" style={{ background: c }} />
                      ))}
                    </div>
                    <div className="text-sm"><b className="fm-head">{fmtCount(stats.reviews)}</b> <span className="text-slate-500">{tr('home.happy', 'Happy Customers')}</span></div>
                  </div>
                )}
              </div>

              {/* 3D render */}
              <HeroRender />

              {/* feature cards — their own column once the layout is wide enough */}
              <div className="hidden 2xl:flex flex-col gap-2.5">
                {HERO_FEATURES.map((f) => (
                  <div key={f.title} className="flex items-center gap-3 bg-white/95 backdrop-blur border border-slate-200/70 rounded-2xl px-3.5 py-2.5 shadow-md transition hover:shadow-lg hover:-translate-y-0.5">
                    <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${f.color}`}><f.icon size={17} /></span>
                    <div className="leading-tight min-w-0">
                      <div className="text-[13px] font-semibold">{tr(`home.f.${f.key}`, f.title)}</div>
                      <div className="text-[11px] text-slate-400">{tr(`home.f.${f.key}Sub`, f.sub)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Trust bar */}
          <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-slate-100">
            {TRUST.map((t) => (
              <div key={t.title} className="flex items-center gap-3 px-5 py-5">
                <span className={`w-11 h-11 rounded-xl grid place-items-center ${t.color}`}><t.icon size={20} /></span>
                <div><div className="font-semibold text-[15px]">{tr(`home.f.${t.key}`, t.title)}</div><div className="text-[12.5px] text-slate-400">{tr(`home.f.${t.key}Sub`, t.sub)}</div></div>
              </div>
            ))}
          </section>

          {/* Ways to save & win — surface the engagement features */}
          <section className="fm-reveal">
            <h2 className="fm-head text-2xl mb-4">{tr('home.waysTitle', 'Save more & win big')}</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { to: '/account/forge-shop', emoji: '🪙', grad: 'from-amber-400 to-rose-500', title: tr('home.wCoins', 'Forge Coins'), sub: tr('home.wCoinsSub', 'Earn 1 coin per €10 — spend on discount codes & giveaway boosts.') },
                { to: '/shop', emoji: '🎁', grad: 'from-fuchsia-500 to-violet-600', title: tr('home.wMystery', 'Mystery boxes'), sub: tr('home.wMysterySub', 'Every box wins — real prizes, instant store credit, 1 free reroll.') },
                { to: '/drops', emoji: '📅', grad: 'from-violet-500 to-indigo-600', title: tr('home.wDrops', 'Drop calendar'), sub: tr('home.wDropsSub', 'Restocks, launches & flash sales — never miss one.') },
              ].map((c) => (
                <Link key={c.to} to={c.to}
                  className="group bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 hover:border-violet-300 hover:shadow-md transition">
                  <div className={`w-12 h-12 rounded-xl grid place-items-center text-2xl bg-gradient-to-br ${c.grad} shadow-lg mb-3`}>{c.emoji}</div>
                  <div className="font-bold text-slate-900 flex items-center gap-1">{c.title} <ArrowRight size={15} className="text-violet-500 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition" /></div>
                  <p className="text-sm text-slate-500 mt-1">{c.sub}</p>
                </Link>
              ))}
            </div>
          </section>

          {/* Popular products */}
          <section className="fm-reveal">
            <div className="flex items-center justify-between mb-4">
              <h2 className="fm-head text-2xl flex items-center gap-2">{tr('home.popular', 'Popular Products')} <span>🔥</span></h2>
              <Link to="/shop" className="text-violet-600 font-semibold text-sm inline-flex items-center gap-1 hover:gap-2 transition-all">
                {tr('home.viewAll', 'View All Products')} <ArrowRight size={15} />
              </Link>
            </div>
            <div className="relative">
              <div ref={railRef} className="fm-rail flex gap-4 overflow-x-auto pb-2 scroll-smooth snap-x">
                {popular.map((p) => (
                  <div key={p.name} className="snap-start shrink-0 w-[230px] bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all p-4">
                    <div className="fm-logo-plinth rounded-xl h-[150px] grid place-items-center mb-3">
                      {p.popular && <span className="absolute top-2.5 right-2.5 z-10 text-[10px] font-bold text-violet-700 bg-violet-100 rounded-full px-2 py-0.5">Popular</span>}
                      <img src={categoryLogos[p.slug] || ICON(p.img)} alt={p.name} className="fm-logo w-[92px] h-[92px]" />
                    </div>
                    <h3 className="font-bold text-[15px]">{p.name}</h3>
                    <p className="text-[12.5px] text-slate-400 mt-0.5">{tr('home.packs', '{n} packs available', { n: p.count })}</p>
                    <div className="text-[12px] text-slate-400 mt-2">{tr('home.from', 'From')} <span className="fm-num text-violet-600 text-[17px]">{money(p.from, p.currency)}</span></div>
                    <div className="flex items-center gap-2 mt-3">
                      <Link to={`/shop?category=${p.slug}`} className="flex-1 text-center text-white text-sm font-semibold rounded-lg h-9 grid place-items-center hover:brightness-105 transition"
                        style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>{tr('product.buyNow', 'Buy Now')}</Link>
                      <button aria-label={`Add ${p.cheapest.name} to cart`}
                        onClick={(e) => { flyToCart(e.currentTarget.closest('.snap-start')?.querySelector('img')); addToCart(p); }}
                        className="w-9 h-9 rounded-lg border border-slate-200 grid place-items-center text-slate-500 hover:bg-slate-50 hover:text-violet-600 active:scale-90 transition-transform">
                        <ShoppingCart size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={scrollRail} aria-label="Scroll"
                className="hidden sm:grid absolute -right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white border border-slate-200 shadow-lg place-items-center text-slate-600 hover:text-violet-600">
                <ChevronRight size={20} />
              </button>
            </div>
          </section>

          {/* Bottom: stats + reviews + discord */}
          <section className="grid lg:grid-cols-3 gap-5 fm-reveal">
            {/* Stats */}
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 grid grid-cols-2 gap-4 fm-lift">
              {STATS.map((st) => (
                <div key={st.label} className="flex items-center gap-3">
                  <span className={`w-11 h-11 rounded-xl grid place-items-center ${st.color}`}><st.icon size={20} /></span>
                  <div><div className="fm-head text-lg leading-none"><CountUp value={st.value} /></div><div className="text-[12px] text-slate-400 mt-1">{st.label}</div></div>
                </div>
              ))}
            </div>

            {/* Reviews */}
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 fm-lift">
              <div className="font-bold mb-3">{tr('home.reviewsTitle', 'What Our Customers Say')}</div>
              {stats.reviews > 0 && (
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex text-amber-400">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={16} fill="currentColor" />)}</div>
                  {stats.rating != null && <span className="fm-head">{stats.rating} {tr('home.outOf5', 'out of 5')}</span>}
                  <span className="text-[12px] text-slate-400">{tr('home.basedOn', 'Based on {n} reviews', { n: stats.reviews.toLocaleString('en-US') })}</span>
                </div>
              )}
              {reviews.length > 0 ? (
                <div className="space-y-2.5">
                  {reviews.slice(0, 2).map((r) => (
                    <div key={r.id} className="bg-slate-50 rounded-xl p-3">
                      <div className="flex text-amber-400 mb-1">{Array.from({ length: r.stars || 5 }).map((_, i) => <Star key={i} size={12} fill="currentColor" />)}</div>
                      <p className="text-[13px] text-slate-600 line-clamp-3">"{r.body}"</p>
                      <p className="text-[11px] text-slate-400 mt-1">– {r.author}{r.product ? ` · ${r.product}` : ''}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-slate-400">{tr('home.beFirst', 'Be the first to leave a verified review after your purchase.')}</p>
              )}
            </div>

            {/* Discord */}
            <div className="fm-hero-brand rounded-2xl p-6 text-white shadow-lg shadow-indigo-500/20 flex flex-col fm-lift"
              style={{ backgroundImage: 'linear-gradient(150deg,#6366f1,#8b5cf6)' }}>
              <span className="w-12 h-12 rounded-2xl bg-white/15 grid place-items-center mb-4"><MessageCircle size={24} /></span>
              <div className="fm-head text-xl">{tr('home.joinDiscord', 'Join Our Discord')}</div>
              <p className="text-white/85 text-sm mt-2 leading-relaxed flex-1">{tr('home.discordSub', 'Get support, updates and exclusive giveaways!')}</p>
              {stats.discordMembers > 0 && (
                <div className="flex items-center gap-2 mt-3 text-white/90 text-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <b>{stats.discordMembers.toLocaleString('en-US')}</b> {tr('home.membersOnline', 'members online')}
                </div>
              )}
              <Link to="/discord" className="mt-4 inline-flex items-center justify-center gap-2 bg-white text-indigo-600 font-semibold text-sm rounded-xl h-11 hover:bg-indigo-50 transition">
                {tr('home.joinBtn', 'Join Discord')} <ArrowRight size={16} />
              </Link>
            </div>
          </section>

          {/* Footer */}
          <footer className="pt-6 pb-10 text-center text-sm text-slate-400">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-3">
              <Link to="/about" className="hover:text-slate-700">{tr('footer.about', 'About')}</Link>
              <Link to="/faq" className="hover:text-slate-700">{tr('footer.faq', 'FAQ')}</Link>
              <Link to="/payment-methods" className="hover:text-slate-700">{tr('footer.payments', 'Payment Methods')}</Link>
              <Link to="/track" className="hover:text-slate-700">{tr('footer.track', 'Track Order')}</Link>
              <Link to="/refunds" className="hover:text-slate-700">{tr('footer.refunds', 'Refunds')}</Link>
              <Link to="/terms" className="hover:text-slate-700">{tr('footer.terms', 'Terms')}</Link>
              <Link to="/privacy" className="hover:text-slate-700">{tr('footer.privacy', 'Privacy')}</Link>
            </div>
            © {new Date().getFullYear()} ForgeMarket · {tr('footer.rights', 'Instant digital goods')} · <SystemStatus />
          </footer>
        </main>
      </div>
      <RecentlyDelivered />
      <CommandPalette />
      <MobileTabBar />
    </div>
  );
}

/* ── 3D hero composition built from the real product icons ────────────── */
/* Each asset sits in a `.fm-px` parallax layer (`--d` = depth) that drifts on
   scroll, while the inner image keeps its idle float — two independent layers so
   they never fight for `transform`. */
function PxAsset({ icon, depth, float = 'fm-float', size = 'w-24 h-24', pos, delay = '0s', z = '', halo }) {
  return (
    <div className={`fm-px absolute ${pos} ${z}`} style={{ '--d': depth }}>
      <span className="fm-hero-item" style={{ '--halo': halo }}>
        <img src={ICON(icon)} alt="" className={`${size} object-contain drop-shadow-xl ${float}`} style={{ animationDelay: delay }} />
      </span>
    </div>
  );
}

// Brand-tinted halo colour per logo — makes any PNG pop on the hero.
const HALO = {
  'v-bucks': 'rgba(56,132,255,.55)', robux: 'rgba(16,185,129,.5)', steam: 'rgba(56,132,255,.42)',
  valorant: 'rgba(244,63,94,.5)', xbox: 'rgba(16,185,129,.48)', playstation: 'rgba(37,99,235,.52)',
  'discord-nitro': 'rgba(99,102,241,.55)', giftcard: 'rgba(168,85,247,.5)',
};

function HeroRender() {
  const ref = useRef(null);
  useParallax(ref);
  return (
    <div ref={ref} className="relative h-[320px] sm:h-[360px]">
      {/* ambient glow */}
      <div className="fm-px absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] rounded-full blur-3xl" style={{ '--d': 0.03, background: 'radial-gradient(circle, rgba(124,92,255,.4), transparent 66%)' }} />
      {/* podium reflection */}
      <div className="absolute left-1/2 bottom-4 -translate-x-1/2 w-[300px] h-[46px] rounded-[50%]"
        style={{ background: 'radial-gradient(ellipse at center, rgba(168,85,247,.4), transparent 70%)' }} />
      {/* sparkles (deepest layer — drift the most) */}
      {[['12%', '16%'], ['84%', '22%'], ['66%', '6%'], ['20%', '72%'], ['90%', '60%'], ['48%', '90%']].map(([l, t], i) => (
        <div key={i} className="fm-px absolute" style={{ left: l, top: t, '--d': 0.16 + (i % 3) * 0.04 }}>
          <Sparkles size={i % 2 ? 16 : 12} className="text-violet-400/70 fm-float2" style={{ animationDelay: `${i * 0.4}s` }} />
        </div>
      ))}
      {/* center V-Bucks (foreground — drifts least, feels closest) */}
      <div className="fm-px absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10" style={{ '--d': 0.04 }}>
        <span className="fm-hero-item" style={{ '--halo': HALO['v-bucks'] }}>
          <img src={ICON('v-bucks')} alt="" className="w-[150px] h-[150px] object-contain drop-shadow-2xl fm-float" />
        </span>
      </div>
      {/* surrounding cluster (mid layers, varied float + rotation) */}
      <PxAsset icon="robux"         depth={0.10} float="fm-float2" size="w-28 h-28" pos="left-[4%] top-[24%]"    delay=".3s" halo={HALO.robux} />
      <PxAsset icon="steam"         depth={0.12} float="fm-float3" size="w-[84px] h-[84px]" pos="left-[22%] top-[0%]" delay=".6s" halo={HALO.steam} />
      <PxAsset icon="valorant"      depth={0.13} float="fm-float"  size="w-[84px] h-[84px]" pos="left-[8%] bottom-[8%]" delay=".9s" halo={HALO.valorant} />
      <PxAsset icon="xbox"          depth={0.11} float="fm-float2" size="w-[84px] h-[84px]" pos="right-[18%] bottom-[4%]" delay=".2s" halo={HALO.xbox} />
      <PxAsset icon="playstation"   depth={0.09} float="fm-float3" size="w-28 h-28" pos="right-[3%] top-[32%]"  delay=".5s" halo={HALO.playstation} />
      <PxAsset icon="discord-nitro" depth={0.14} float="fm-float"  size="w-[68px] h-[68px]" pos="right-[24%] top-[4%]" delay=".8s" halo={HALO['discord-nitro']} />
    </div>
  );
}
