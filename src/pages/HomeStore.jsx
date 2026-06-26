import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, ShoppingCart, Zap, ShieldCheck, Headphones, Tag, Star, ArrowRight,
  Plus, LayoutGrid, Users, CheckCircle2, Clock, MessageCircle, ChevronRight, Sparkles, Shield,
} from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { usePageMeta } from '../lib/useMeta.js';
import { useStats } from '../lib/useStats.js';
import { useReviews } from '../lib/useReviews.js';
import { useReveal } from '../lib/useReveal.js';
import CountUp from '../components/CountUp.jsx';
import RecentlyDelivered from '../components/store/RecentlyDelivered.jsx';

const ICON = (n) => `/products/icons/${n}.png`;

/* ── Left sidebar categories (matches the reference order) ─────────────── */
const CATEGORIES = [
  { label: 'All Products', slug: '', node: <LayoutGrid size={18} className="text-violet-600" /> },
  { label: 'Robux', slug: 'robux', img: 'robux' },
  { label: 'V-Bucks', slug: 'v-bucks', img: 'v-bucks' },
  { label: 'Valorant Points', slug: 'valorant', img: 'valorant' },
  { label: 'Fortnite Accounts', slug: 'v-bucks', letter: 'F', grad: 'from-violet-500 to-fuchsia-500' },
  { label: 'Gift Cards', slug: 'giftcard', img: 'giftcard' },
  { label: 'Steam Wallet', slug: 'steam', img: 'steam' },
  { label: 'PlayStation Store', slug: 'playstation', img: 'playstation' },
  { label: 'Xbox Gift Card', slug: 'xbox', img: 'xbox' },
  { label: 'Discord Nitro', slug: 'discord-nitro', img: 'discord-nitro' },
  { label: 'iTunes', slug: 'itunes', img: 'itunes' },
];

/* ── Popular products (exact cards from the reference) ─────────────────── */
const POPULAR = [
  { name: 'Robux', sub: '100 - 10,000 Robux', from: '€1,99', img: 'robux', slug: 'robux' },
  { name: 'V-Bucks', sub: '1,000 - 13,500 V-Bucks', from: '€4,99', img: 'v-bucks', slug: 'v-bucks' },
  { name: 'Valorant Points', sub: '475 - 11,000 VP', from: '€4,49', img: 'valorant', slug: 'valorant', popular: true },
  { name: 'Fortnite Accounts', sub: 'Various Accounts', from: '€9,99', img: 'v-bucks', slug: 'v-bucks' },
  { name: 'Steam Wallet', sub: '€5 - €100 Wallet', from: '€5,00', img: 'steam', slug: 'steam' },
  { name: 'PlayStation Store', sub: '€10 - €100 Wallet', from: '€10,00', img: 'playstation', slug: 'playstation' },
  { name: 'Xbox Gift Card', sub: '€10 - €100 Card', from: '€10,00', img: 'xbox', slug: 'xbox' },
  { name: 'Discord Nitro', sub: '1 - 12 Months', from: '€4,99', img: 'discord-nitro', slug: 'discord-nitro' },
];

const NAV = [
  { label: 'Home', to: '/' },
  { label: 'All Products', to: '/shop' },
  { label: 'Reviews', to: '/reviews' },
  { label: 'How it works', to: '/how-it-works' },
  { label: 'Support', to: '/contact' },
];

const HERO_FEATURES = [
  { icon: Zap, title: 'Instant Delivery', sub: 'Get your items instantly', color: 'text-violet-600 bg-violet-100' },
  { icon: ShieldCheck, title: 'Secure Payments', sub: '100% secure & trusted', color: 'text-emerald-600 bg-emerald-100' },
  { icon: Headphones, title: '24/7 Support', sub: "We're here for you", color: 'text-blue-600 bg-blue-100' },
  { icon: Tag, title: 'Best Prices', sub: 'Competitive prices daily', color: 'text-amber-600 bg-amber-100' },
];

const TRUST = [
  { icon: Zap, title: 'Instant Delivery', sub: 'Fast & reliable delivery', color: 'text-violet-600 bg-violet-100' },
  { icon: ShieldCheck, title: '100% Secure', sub: 'Your data is protected', color: 'text-emerald-600 bg-emerald-100' },
  { icon: Tag, title: 'Best Prices', sub: 'Competitive prices daily', color: 'text-amber-600 bg-amber-100' },
  { icon: Headphones, title: '24/7 Support', sub: 'Always here to help', color: 'text-blue-600 bg-blue-100' },
];

const statCards = (s) => [
  { icon: Users, value: `${s.customers.toLocaleString('en-US')}+`, label: 'Happy Customers', color: 'text-violet-600 bg-violet-100' },
  { icon: CheckCircle2, value: '99.9%', label: 'Success Rate', color: 'text-emerald-600 bg-emerald-100' },
  { icon: ShoppingCart, value: `${s.delivered.toLocaleString('en-US')}+`, label: 'Orders Delivered', color: 'text-blue-600 bg-blue-100' },
  { icon: Headphones, value: '24/7', label: 'Customer Support', color: 'text-amber-600 bg-amber-100' },
];

const RV = [
  { text: 'Fast delivery and best prices!', name: 'Alex M.' },
  { text: 'Super reliable and great support!', name: 'Sarah K.' },
];

function useCountdown(seconds = 2 * 3600 + 47 * 60 + 19) {
  const [t, setT] = useState(seconds);
  useEffect(() => {
    const id = setInterval(() => setT((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0'));
}

export default function HomeStore() {
  const { count, add } = useCart();
  const { user, isStaff } = useAuth();
  const stats = useStats();
  const reviews = useReviews();
  useReveal();
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) localStorage.setItem('fm_ref', ref.toUpperCase().slice(0, 40));
  }, []);
  usePageMeta('ForgeMarket — Everything You Need, All in One Place',
    'Buy Robux, V-Bucks, Valorant Points, gift cards and more instantly. Fast delivery, secure payments, 24/7 support.');
  const [h, m, s] = useCountdown();
  const railRef = useRef(null);
  const STATS = statCards(stats);

  const scrollRail = () => railRef.current?.scrollBy({ left: 320, behavior: 'smooth' });
  const addToCart = (p) => add({
    id: `pop-${p.slug}`, name: p.name, price: 199, currency: 'EUR',
    category: p.slug, image: ICON(p.img),
  });

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

      {/* ── Top nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/70">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-[68px] flex items-center gap-6">
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
                {n.label}
                {i === 0 && <span className="absolute -bottom-[22px] left-0 right-0 h-0.5 bg-violet-600 rounded-full" />}
              </Link>
            ))}
          </nav>

          <div className="flex-1" />

          <div className="hidden md:flex items-center gap-2 bg-slate-100 rounded-xl px-3.5 h-10 w-[260px] text-slate-400">
            <Search size={16} />
            <input placeholder="Search for products..." className="bg-transparent outline-none text-sm text-slate-700 w-full" />
            <kbd className="text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-400">⌘K</kbd>
          </div>

          <Link to="/cart" className="relative w-10 h-10 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
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
            <Link to="/account" className="hidden sm:inline-flex text-[15px] font-medium text-slate-600 hover:text-slate-900">Account</Link>
          ) : (
            <Link to="/login" className="hidden sm:inline-flex text-[15px] font-medium text-slate-600 hover:text-slate-900">Log in</Link>
          )}
          {!user && (
            <Link to="/login" className="inline-flex items-center gap-1.5 text-white text-[15px] font-semibold rounded-xl px-4 h-10 shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              Sign Up <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </header>

      {/* ── Body: sidebar + main ────────────────────────────────── */}
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-6 flex gap-6 items-start">
        {/* Sidebar */}
        <aside className="hidden lg:block w-[248px] shrink-0 sticky top-[84px] space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/70 p-3 shadow-sm">
            <p className="text-[11px] font-bold tracking-wider text-slate-400 px-2 py-2">BROWSE CATEGORIES</p>
            <nav className="space-y-0.5">
              {CATEGORIES.map((c, i) => (
                <Link key={c.label} to={`/shop${c.slug ? `?category=${c.slug}` : ''}`}
                  className={`flex items-center gap-3 px-2.5 py-2 rounded-xl text-[14.5px] font-medium transition
                    ${i === 0 ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <span className="w-7 h-7 grid place-items-center shrink-0">
                    {c.node || (c.letter
                      ? <span className={`w-7 h-7 rounded-lg bg-gradient-to-br ${c.grad} grid place-items-center text-white text-xs font-bold`}>{c.letter}</span>
                      : <img src={ICON(c.img)} alt="" className="w-7 h-7 object-contain" />)}
                  </span>
                  {c.label}
                </Link>
              ))}
              <Link to="/shop" className="flex items-center gap-3 px-2.5 py-2 rounded-xl text-[14.5px] font-medium text-slate-500 hover:bg-slate-50">
                <span className="w-7 h-7 grid place-items-center"><Plus size={18} /></span>
                More Categories
              </Link>
            </nav>
          </div>

          {/* Limited offer */}
          <div className="rounded-2xl p-5 text-white shadow-lg shadow-violet-500/20"
            style={{ backgroundImage: 'linear-gradient(150deg,#7c5cff,#9333ea)' }}>
            <div className="font-bold text-[15px] flex items-center gap-1.5">Limited Time Offer! <span>🔥</span></div>
            <p className="text-white/85 text-[13px] mt-1 leading-snug">Get <b>10% OFF</b> your first purchase</p>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {[[h, 'Hours'], [m, 'Minutes'], [s, 'Seconds']].map(([v, l]) => (
                <div key={l} className="bg-white/15 rounded-xl py-2 text-center">
                  <div className="font-bold text-lg leading-none tabular-nums">{v}</div>
                  <div className="text-[10px] text-white/75 mt-1">{l}</div>
                </div>
              ))}
            </div>
            <Link to="/shop" className="mt-4 flex items-center justify-center gap-2 bg-white text-violet-700 font-semibold text-sm rounded-xl h-10 hover:bg-violet-50 transition">
              Claim Discount <ArrowRight size={15} />
            </Link>
          </div>

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
                Hi! 👋 How can I help you today?
              </div>
            </div>
            <Link to="/contact" className="mt-3 flex items-center justify-center gap-2 text-white font-semibold text-sm rounded-xl h-10 transition hover:brightness-105"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              <MessageCircle size={16} /> Chat with us
            </Link>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 space-y-6">
          {/* Hero */}
          <section className="relative overflow-hidden rounded-3xl bg-white border border-slate-200/70 shadow-sm px-6 sm:px-10 py-9">
            <div className="grid lg:grid-cols-[1.05fr_1fr] gap-8 items-center">
              <div>
                <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-violet-700 bg-violet-100 rounded-full px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> #1 Trusted Marketplace
                </span>
                <h1 className="fm-head text-[40px] sm:text-[52px] leading-[1.05] mt-5">
                  Everything You Need,<br />
                  <span className="fm-gradient-text">All in One Place.</span>
                </h1>
                <p className="text-slate-500 text-[16px] mt-5 max-w-lg leading-relaxed">
                  Get Robux, V-Bucks, Valorant Points and more instantly. Fast delivery,
                  secure payments, 24/7 support.
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-7">
                  <Link to="/shop" className="inline-flex items-center gap-2 text-white font-semibold rounded-xl px-6 h-12 shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
                    style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
                    Shop Now <ArrowRight size={18} />
                  </Link>
                  <Link to="/shop" className="inline-flex items-center gap-2 font-semibold rounded-xl px-6 h-12 border border-slate-300 text-slate-700 hover:bg-slate-50 transition">
                    View All Products
                  </Link>
                </div>
                <div className="flex items-center gap-3 mt-7">
                  <div className="flex -space-x-2.5">
                    {['#f472b6', '#60a5fa', '#34d399', '#fbbf24'].map((c, i) => (
                      <span key={i} className="w-9 h-9 rounded-full border-2 border-white" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="text-sm"><b className="fm-head">10,000+</b> <span className="text-slate-500">Happy Customers</span></div>
                </div>
              </div>

              {/* 3D render */}
              <HeroRender />
            </div>

            {/* right feature cards (overlay on lg) */}
            <div className="hidden xl:flex flex-col gap-2.5 absolute top-8 right-8 w-[210px]">
              {HERO_FEATURES.map((f) => (
                <div key={f.title} className="flex items-center gap-3 bg-white/95 backdrop-blur border border-slate-200/70 rounded-2xl px-3.5 py-2.5 shadow-md">
                  <span className={`w-9 h-9 rounded-xl grid place-items-center ${f.color}`}><f.icon size={17} /></span>
                  <div className="leading-tight">
                    <div className="text-[13px] font-semibold">{f.title}</div>
                    <div className="text-[11px] text-slate-400">{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Trust bar */}
          <section className="bg-white rounded-2xl border border-slate-200/70 shadow-sm grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-slate-100">
            {TRUST.map((t) => (
              <div key={t.title} className="flex items-center gap-3 px-5 py-5">
                <span className={`w-11 h-11 rounded-xl grid place-items-center ${t.color}`}><t.icon size={20} /></span>
                <div><div className="font-semibold text-[15px]">{t.title}</div><div className="text-[12.5px] text-slate-400">{t.sub}</div></div>
              </div>
            ))}
          </section>

          {/* Popular products */}
          <section className="fm-reveal">
            <div className="flex items-center justify-between mb-4">
              <h2 className="fm-head text-2xl flex items-center gap-2">Popular Products <span>🔥</span></h2>
              <Link to="/shop" className="text-violet-600 font-semibold text-sm inline-flex items-center gap-1 hover:gap-2 transition-all">
                View All Products <ArrowRight size={15} />
              </Link>
            </div>
            <div className="relative">
              <div ref={railRef} className="fm-rail flex gap-4 overflow-x-auto pb-2 scroll-smooth snap-x">
                {POPULAR.map((p) => (
                  <div key={p.name} className="snap-start shrink-0 w-[230px] bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all p-4">
                    <div className="relative rounded-xl bg-slate-50 h-[150px] grid place-items-center mb-3">
                      {p.popular && <span className="absolute top-2.5 right-2.5 text-[10px] font-bold text-violet-700 bg-violet-100 rounded-full px-2 py-0.5">Popular</span>}
                      <img src={ICON(p.img)} alt={p.name} className="w-24 h-24 object-contain drop-shadow-md" />
                    </div>
                    <h3 className="font-bold text-[15px]">{p.name}</h3>
                    <p className="text-[12.5px] text-slate-400 mt-0.5">{p.sub}</p>
                    <div className="text-[12px] text-slate-400 mt-2">From <span className="fm-head text-violet-600 text-[17px]">{p.from}</span></div>
                    <div className="flex items-center gap-2 mt-3">
                      <Link to={`/shop?category=${p.slug}`} className="flex-1 text-center text-white text-sm font-semibold rounded-lg h-9 grid place-items-center hover:brightness-105 transition"
                        style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>Buy Now</Link>
                      <button onClick={() => addToCart(p)} className="w-9 h-9 rounded-lg border border-slate-200 grid place-items-center text-slate-500 hover:bg-slate-50">
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
              <div className="font-bold mb-3">What Our Customers Say</div>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex text-amber-400">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={16} fill="currentColor" />)}</div>
                <span className="fm-head">{stats.rating} out of 5</span>
                <span className="text-[12px] text-slate-400">Based on {stats.reviews.toLocaleString('en-US')} reviews</span>
              </div>
              <div className="space-y-2.5">
                {reviews.slice(0, 2).map((r) => (
                  <div key={r.id} className="bg-slate-50 rounded-xl p-3">
                    <div className="flex text-amber-400 mb-1">{Array.from({ length: r.stars || 5 }).map((_, i) => <Star key={i} size={12} fill="currentColor" />)}</div>
                    <p className="text-[13px] text-slate-600 line-clamp-3">"{r.body}"</p>
                    <p className="text-[11px] text-slate-400 mt-1">– {r.author}{r.product ? ` · ${r.product}` : ''}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Discord */}
            <div className="rounded-2xl p-6 text-white shadow-lg shadow-indigo-500/20 flex flex-col fm-lift"
              style={{ backgroundImage: 'linear-gradient(150deg,#6366f1,#8b5cf6)' }}>
              <span className="w-12 h-12 rounded-2xl bg-white/15 grid place-items-center mb-4"><MessageCircle size={24} /></span>
              <div className="fm-head text-xl">Join Our Discord</div>
              <p className="text-white/85 text-sm mt-2 leading-relaxed flex-1">Get support, updates and exclusive giveaways!</p>
              <div className="flex items-center gap-2 mt-3 text-white/90 text-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <b>{stats.discordMembers.toLocaleString('en-US')}</b> members online
              </div>
              <Link to="/discord" className="mt-4 inline-flex items-center justify-center gap-2 bg-white text-indigo-600 font-semibold text-sm rounded-xl h-11 hover:bg-indigo-50 transition">
                Join Discord <ArrowRight size={16} />
              </Link>
            </div>
          </section>

          {/* Footer */}
          <footer className="pt-6 pb-10 text-center text-sm text-slate-400">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-3">
              <Link to="/about" className="hover:text-slate-700">About</Link>
              <Link to="/faq" className="hover:text-slate-700">FAQ</Link>
              <Link to="/payment-methods" className="hover:text-slate-700">Payment Methods</Link>
              <Link to="/track" className="hover:text-slate-700">Track Order</Link>
              <Link to="/refunds" className="hover:text-slate-700">Refunds</Link>
              <Link to="/terms" className="hover:text-slate-700">Terms</Link>
              <Link to="/privacy" className="hover:text-slate-700">Privacy</Link>
            </div>
            © {new Date().getFullYear()} ForgeMarket · Instant digital goods · <span className="text-emerald-500">● All systems operational</span>
          </footer>
        </main>
      </div>
      <RecentlyDelivered />
    </div>
  );
}

/* ── 3D hero composition built from the real product icons ────────────── */
function HeroRender() {
  return (
    <div className="relative h-[300px] sm:h-[340px]">
      {/* glow */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(124,92,255,.35), transparent 65%)' }} />
      {/* podium */}
      <div className="absolute left-1/2 bottom-6 -translate-x-1/2 w-[260px] h-[40px] rounded-[50%]"
        style={{ background: 'radial-gradient(ellipse at center, rgba(168,85,247,.35), transparent 70%)' }} />
      {/* sparkles */}
      {[['12%', '18%'], ['82%', '24%'], ['68%', '8%'], ['22%', '70%'], ['88%', '62%']].map(([l, t], i) => (
        <Sparkles key={i} size={i % 2 ? 16 : 12} className="absolute text-violet-400/70 fm-float2" style={{ left: l, top: t, animationDelay: `${i * 0.4}s` }} />
      ))}
      {/* center V-Bucks (largest) */}
      <img src={ICON('v-bucks')} alt="" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-36 h-36 object-contain drop-shadow-2xl fm-float z-10" />
      {/* surrounding */}
      <img src={ICON('robux')} alt="" className="absolute left-[6%] top-[26%] w-24 h-24 object-contain drop-shadow-xl fm-float2" style={{ animationDelay: '.3s' }} />
      <img src={ICON('steam')} alt="" className="absolute left-[20%] top-[2%] w-20 h-20 object-contain drop-shadow-xl fm-float" style={{ animationDelay: '.6s' }} />
      <img src={ICON('valorant')} alt="" className="absolute left-[10%] bottom-[10%] w-20 h-20 object-contain drop-shadow-xl fm-float" style={{ animationDelay: '.9s' }} />
      <img src={ICON('xbox')} alt="" className="absolute right-[20%] bottom-[6%] w-20 h-20 object-contain drop-shadow-xl fm-float2" style={{ animationDelay: '.2s' }} />
      <img src={ICON('playstation')} alt="" className="absolute right-[5%] top-[34%] w-24 h-24 object-contain drop-shadow-xl fm-float" style={{ animationDelay: '.5s' }} />
      <img src={ICON('discord-nitro')} alt="" className="absolute right-[26%] top-[6%] w-16 h-16 object-contain drop-shadow-xl fm-float2" style={{ animationDelay: '.8s' }} />
    </div>
  );
}
