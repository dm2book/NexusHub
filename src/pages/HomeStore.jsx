import { useEffect, useState, useRef, useMemo, lazy, Suspense } from 'react';
import DeferUntilIdle from '../components/DeferUntilIdle.jsx';
import ScrollProgress from '../components/store/ScrollProgress.jsx';
import { Link } from 'react-router-dom';
import { Search, ShoppingCart, Zap, ShieldCheck, Headphones, Tag, Star, ArrowRight, Plus, LayoutGrid, Users, CheckCircle2, Clock, MessageCircle, ChevronRight, Sparkles, Shield, Menu, X, BadgeCheck, User as UserIcon, UserPlus, CloudOff } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { usePageMeta, useJsonLd } from '../lib/useMeta.js';
import { useI18n } from '../lib/i18n.jsx';
import { LangSwitch } from '../components/store/StoreNav.jsx';
import { flyToCart } from '../lib/flyToCart.js';
import { api } from '../lib/api.js';
import { withEarly } from '../lib/earlyFetch.js';
import { getConfig } from '../lib/useConfig.js';
import { useStats } from '../lib/useStats.js';
import { useReviews } from '../lib/useReviews.js';
import { useReveal } from '../lib/useReveal.js';
import { useParallax } from '../lib/useParallax.js';
import RecentlyDelivered from '../components/store/RecentlyDelivered.jsx';
const CommandPalette = lazy(() => import('../components/store/CommandPalette.jsx'));
import MobileTabBar from '../components/store/MobileTabBar.jsx';
import AnnouncementBar from '../components/store/AnnouncementBar.jsx';
import StoreFooter from '../components/store/StoreFooter.jsx';
import SellerIdentity from '../components/store/SellerIdentity.jsx';
import { money } from '../lib/catalog.js';
import { withFallback, SAMPLE_PRODUCTS, iconPath, CATALOG_UNAVAILABLE } from '../lib/sampleCatalog.js';
import { useCategoryLogos } from '../lib/useCategoryLogos.js';
import { useTrustpilot } from '../lib/useTrustpilot.js';
import { SUPPORT_EMAIL } from '../lib/support.js';
import { openForgeChat } from '../lib/forgeChat.js';
import { allowed, onConsentChange } from '../lib/consent.js';
import CookieConsent from '../components/CookieConsent.jsx';
const ChatWidget = lazy(() => import('../components/ChatWidget.jsx'));

const ICON = iconPath;

/* ── Left sidebar categories (matches the reference order) ─────────────── */
const CATEGORIES = [
  { label: 'All Products', slug: '', node: <LayoutGrid size={18} className="text-violet-600" /> },
  { label: 'Gift Cards', slug: 'giftcard', img: 'giftcard' },
  { label: 'Robux', slug: 'robux', img: 'robux' },
  { label: 'V-Bucks', slug: 'v-bucks', img: 'v-bucks' },
  { label: 'Valorant Points', slug: 'valorant', img: 'valorant' },
  { label: 'CoD Points', slug: 'cod', img: 'cod' },
  { label: 'EA FC / FIFA', slug: 'eafc', img: 'eafc' },
  { label: 'Brawl Stars', slug: 'brawl', img: 'brawl' },
  { label: 'Clash of Clans', slug: 'clash', img: 'clash' },
  { label: 'Discord Nitro', slug: 'discord-nitro', img: 'discord-nitro' },
];

/* ── The three things this shop sells ─────────────────────────────────────
   Not a marketing framing: these are real category slugs, and each pillar
   renders only the ones the live catalogue actually has stock in. A pillar with
   nothing behind it disappears rather than showing an empty shelf.

   Ordered by how a buyer arrives: most people come for a specific game currency,
   gift cards are the gift/no-account case, subscriptions are the recurring one. */
const PILLARS = [
  {
    key: 'currency',
    title: 'Game currency',
    sub: 'Robux, V-Bucks, Valorant Points and the rest — topped up on your account or sent as a code.',
    slugs: ['robux', 'v-bucks', 'valorant', 'cod', 'eafc', 'apex', 'genshin', 'brawl',
            'clash', 'pubg', 'freefire', 'league', 'mlbb', 'gta', 'minecraft'],
  },
  {
    key: 'giftcards',
    title: 'Gift cards',
    sub: 'Steam, PlayStation, Xbox, Netflix and more. A code by email — no account of yours needed.',
    slugs: ['giftcard', 'steam', 'playstation', 'xbox', 'nintendo', 'googleplay', 'paysafecard'],
  },
  {
    key: 'subscriptions',
    title: 'Subscriptions',
    sub: 'Discord Nitro, Game Pass, Spotify. Bought as a code you redeem yourself, so nothing renews behind your back.',
    slugs: ['discord-nitro', 'gamepass', 'spotify', 'psplus', 'netflix', 'youtube', 'eaplay', 'disneyplus'],
  },
];

/* Display names for the category slugs above. Anything missing falls back to a
   title-cased slug, so a new category still renders rather than breaking. */
const SLUG_LABEL = {
  robux: 'Robux', 'v-bucks': 'V-Bucks', valorant: 'Valorant Points', cod: 'CoD Points',
  eafc: 'EA FC', apex: 'Apex Coins', genshin: 'Genshin', brawl: 'Brawl Stars',
  clash: 'Clash of Clans', pubg: 'PUBG', freefire: 'Free Fire', league: 'League of Legends',
  mlbb: 'Mobile Legends', gta: 'GTA', minecraft: 'Minecraft',
  giftcard: 'Gift cards', steam: 'Steam', playstation: 'PlayStation', xbox: 'Xbox',
  nintendo: 'Nintendo', googleplay: 'Google Play', paysafecard: 'paysafecard',
  'discord-nitro': 'Discord Nitro', gamepass: 'Xbox Game Pass', spotify: 'Spotify',
  psplus: 'PS Plus', netflix: 'Netflix', youtube: 'YouTube Premium',
  eaplay: 'EA Play', disneyplus: 'Disney+',
};
const labelFor = (slug) => SLUG_LABEL[slug]
  || slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const NAV = [
  { key: 'nav.home', label: 'Home', to: '/' },
  { key: 'nav.products', label: 'All Products', to: '/shop' },
  { key: 'nav.reviews', label: 'Reviews', to: '/reviews' },
  { key: 'nav.howShort', label: 'How it works', to: '/how-it-works' },
  { key: 'nav.support', label: 'Support', to: '/contact' },
];

const TRUST = [
  { icon: Zap, key: 'tStock', title: 'In stock, sent automatically', sub: 'Everything else by hand, usually a few hours', color: 'text-violet-600 bg-violet-100' },
  { icon: ShieldCheck, key: 'tMoneyBack', title: 'Money back if we cannot deliver', sub: 'Refunded, no argument', color: 'text-emerald-600 bg-emerald-100' },
  { icon: MessageCircle, key: 'tHuman', title: 'A real person on Discord', sub: 'Run from the Netherlands', color: 'text-blue-600 bg-blue-100' },
  { icon: Tag, key: 'tNoFees', title: 'The price you see', sub: 'No hidden fees at checkout', color: 'text-amber-600 bg-amber-100' },
];

// Shown only at ≥1536px, and it used to carry a second, wronger copy of these
// same four claims. One source now — declared AFTER TRUST, not before: as a
// const alias above it, this hit the temporal dead zone and blanked the page.
const HERO_FEATURES = TRUST;

// Real counts only — append "+" once the number is large enough to round.
const fmtCount = (n) => `${Number(n || 0).toLocaleString('en-US')}${Number(n || 0) >= 100 ? '+' : ''}`;
export default function HomeStore() {
  const { count, add } = useCart();
  const { user, isStaff } = useAuth();
  const { t: tr } = useI18n();
  const stats = useStats();
  const reviews = useReviews();
  const categoryLogos = useCategoryLogos(); // owner-set logos (Admin → Categories)
  const trustpilot = useTrustpilot();       // '' until TRUSTPILOT_URL is set
  useReveal();
  /* The homepage carries its own copy of the header rather than rendering
     <StoreNav />, so it needs its own scroll state — the two have already
     drifted in other ways and this is the cheap half of the fix. */
  const [navScrolled, setNavScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 8);
    onScroll();
    const raf = requestAnimationFrame(onScroll);   // catches scroll restoration
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); };
  }, []);
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    // Marketing attribution: an identifier stored to credit a referrer later, so
    // it waits for permission like anything else non-essential.
    const store = () => {
      if (ref && allowed('marketing')) localStorage.setItem('fm_ref', ref.toUpperCase().slice(0, 40));
    };
    store();
    // Someone who lands on a referral link and only then accepts is still on
    // this page — capture it now rather than losing the referrer's credit.
    return onConsentChange(store);
  }, []);
  // The tab title and the Google result. It carried the same interchangeable
  // slogan the hero used to, in the one place a searcher sees before clicking.
  usePageMeta('ForgeMarket — game currency, gift cards and subscriptions',
    'Robux, V-Bucks, Steam, Discord Nitro and more, from a small shop run in the Netherlands. In stock is sent automatically, everything else by hand — money back if we cannot deliver.');
  // Organization + site-search structured data for rich Google results.
  useJsonLd('org', {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'OnlineStore',
        name: 'ForgeMarket',
        url: window.location.origin,
        // Machine-readable text Google can quote verbatim, so it has to match
        // what the visible site says: in stock goes out automatically, the rest
        // is delivered by hand.
        description: 'Game top-ups and gift cards: Robux, V-Bucks, Valorant, Steam and more. In stock is sent automatically; everything else is delivered by hand, usually within a few hours.',
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
  // The homepage renders its own header, which had no mobile menu at all —
  // How it works, Reviews, Drops and Support were unreachable from '/'.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { getConfig().then((c) => setAnnouncement(c.announcement || '')); }, []);
  // Real reviews only — an empty testimonial card costs more trust than it earns.
  const hasReviews = reviews.length > 0;


  // Real catalog → tiles show the true "From" price; add-to-cart adds the
  // cheapest REAL product in that category (no fabricated items/prices).
  const [products, setProducts] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    // Handed over by the shell when it started this during HTML parse.
    withEarly('products', () => api.get('/api/products'))
      .then((r) => { setProducts(withFallback(r.products)); setUnavailable(false); })
      /* Not SAMPLE_PRODUCTS. A failed request used to fill the homepage with the
         built-in showcase, so an outage looked exactly like a healthy shop —
         categories, tiles, prices — while every call behind it returned 500.
         The pillars below already drop a category with nothing behind it, so an
         empty list degrades on its own; what was missing was telling anyone. */
      .catch(() => { setProducts([]); setUnavailable(true); });
  }, []);
  /* Each pillar resolved against the live catalogue: a category appears only if
     it has active products, with its real cheapest price and real pack count. A
     pillar with nothing behind it is dropped entirely rather than rendering an
     empty shelf — the shop starts small and should look small-and-real rather
     than big-and-hollow. */
  const pillars = useMemo(() => PILLARS.map((pillar) => {
    const cats = pillar.slugs.map((slug) => {
      const items = products.filter((p) => p.category === slug && p.active !== false);
      if (!items.length) return null;
      const cheapest = items.reduce((a, b) => (a.price <= b.price ? a : b));
      return { slug, label: labelFor(slug), cheapest,
               from: cheapest.price, currency: cheapest.currency || 'EUR', count: items.length };
    }).filter(Boolean);
    return cats.length ? { ...pillar, cats } : null;
  }).filter(Boolean), [products]);
  const addToCart = (c) => add(c.cheapest);

  return (
    <div className="min-h-screen overflow-x-clip bg-[#f6f7fb] text-slate-900 fm-page" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
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
      <header className={`fm-nav sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/70 ${navScrolled ? 'is-scrolled' : ''}`}>
        <div className="max-w-[1400px] 2xl:max-w-[1560px] mx-auto px-4 lg:px-8 h-[68px] flex items-center gap-3 sm:gap-4 xl:gap-6">
          <button onClick={() => setMenuOpen((v) => !v)} aria-label={tr('nav.menu', 'Menu')} aria-expanded={menuOpen}
            className="lg:hidden w-11 h-11 shrink-0 -ml-1.5 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {/* Named explicitly: the wordmark is hidden below xl, so on a phone this
            link is a lone icon and a screen reader announces nothing at all. */}
          <Link to="/" aria-label="ForgeMarket" className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/30"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              <Zap size={18} fill="white" />
            </span>
            {/* Hidden until there is room for the WHOLE word. This nav, unlike
                StoreNav, keeps a Sign Up button visible at every width, so the
                wordmark is what gives way. It used to return at 400px and then
                truncate — "F…" beside the mark reads as a broken page rather
                than a deliberate one, so it waits for 640px instead. */}
            <span className="hidden xl:inline fm-head text-xl truncate">ForgeMarket</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-5 xl:gap-7 text-[15px] font-medium text-slate-600 min-w-0 overflow-hidden">
            {NAV.map((n, i) => (
              <Link key={n.label} to={n.to}
                className={`relative py-1 whitespace-nowrap hover:text-slate-900 transition ${i === 0 ? 'text-violet-600' : ''}`}>
                {tr(n.key, n.label)}
                {i === 0 && <span className="absolute -bottom-[22px] left-0 right-0 h-0.5 bg-violet-600 rounded-full" />}
              </Link>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Real global search — opens the ⌘K command palette */}
          <button onClick={() => window.dispatchEvent(new CustomEvent('forge:cmdk'))}
            className="hidden md:flex items-center gap-2 bg-slate-100 rounded-xl px-3.5 h-10 w-[190px] xl:w-[260px] text-slate-400 hover:bg-slate-200/70 transition">
            <Search size={16} />
            <span className="text-sm truncate whitespace-nowrap">{tr('nav.search', 'Search for products...')}</span>
            <kbd className="ml-auto text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-400">⌘K</kbd>
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent('forge:cmdk'))} aria-label="Search"
            className="md:hidden w-11 h-11 shrink-0 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
            <Search size={20} />
          </button>

          <LangSwitch className="hidden sm:inline-flex" />

          <Link to="/cart" data-cart-target aria-label={tr('nav.cart', 'Shopping cart')}
            className="relative w-11 h-11 shrink-0 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
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
            /* Same fix as StoreNav: this was hidden below sm while the Admin
               button beside it was not, so a signed-in owner on a phone could
               reach the admin panel but not their own account. */
            <Link to="/account" aria-label={tr('nav.account', 'Account')}
              className="inline-flex items-center gap-1.5 text-[15px] font-medium text-slate-600 hover:text-slate-900 rounded-xl w-11 h-11 sm:w-auto sm:h-auto justify-center sm:justify-start shrink-0">
              <UserIcon size={19} className="sm:hidden" />
              <span className="hidden sm:inline">{tr('nav.account', 'Account')}</span>
            </Link>
          ) : (
            <Link to="/login" className="hidden xl:inline-flex shrink-0 text-[15px] font-medium text-slate-600 hover:text-slate-900">{tr('nav.login', 'Log in')}</Link>
          )}
          {/* max-w + truncate is the backstop that makes this row unable to
              overflow in ANY language. "Sign Up" is 7 characters and fitted;
              "Account maken" is 13 and did not, so the button was clipped by the
              sticky header at 320, 360, 414, 430, 640, 700, 768, 820 and 1024px
              — measured. Capping it means a longer translation gets shortened
              instead of pushing the primary call to action off the screen. */}
          {!user && (
            <Link to="/login" aria-label={tr('nav.signup', 'Sign Up')}
              className="inline-flex items-center justify-center xs:justify-start gap-1.5 text-white text-[15px] font-semibold rounded-xl w-10 xs:w-auto px-0 xs:px-3.5 sm:px-4 h-10 shrink-0 min-w-0 max-w-[46vw] shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              {/* Below 400px there is room for roughly 72px here, and a button
                  reading "Accou…" is worse than no words at all. Same pattern the
                  account link already uses: the icon always fits, the word
                  appears when there is space for it. */}
              <UserPlus size={19} className="xs:hidden shrink-0" />
              <span className="hidden xs:inline truncate">{tr('nav.signup', 'Sign Up')}</span>
              <span className="hidden sm:inline-flex shrink-0"><ArrowRight size={16} /></span>
            </Link>
          )}
        </div>
        {/* Mobile menu — the pages below were otherwise unreachable from '/'. */}
        {menuOpen && (
          <div className="lg:hidden border-t border-slate-200/70 bg-white px-4 py-3 fm-page">
            <nav className="space-y-0.5">
              {NAV.map((n) => (
                <Link key={n.label} to={n.to} onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between px-2.5 py-3 rounded-xl text-[15px] font-medium text-slate-700 hover:bg-slate-50">
                  {tr(n.key, n.label)} <ChevronRight size={16} className="text-slate-300" />
                </Link>
              ))}
            </nav>
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-[11px] font-bold tracking-wider text-slate-400 px-2.5 pb-1.5">
                {tr('shop.browseCategories', 'BROWSE CATEGORIES')}
              </p>
              <div className="grid grid-cols-2 gap-1">
                {CATEGORIES.filter((c) => c.slug).map((c) => (
                  <Link key={c.slug} to={`/shop?category=${c.slug}`} onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-[14px] font-medium text-slate-600 hover:bg-slate-50">
                    <img src={categoryLogos[c.slug] || ICON(c.img)} alt="" className="w-6 h-6 object-contain shrink-0" />
                    <span className="truncate">{c.label}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
              <LangSwitch />
              <Link to={user ? '/account' : '/login'} onClick={() => setMenuOpen(false)}
                className="ml-auto text-[15px] font-medium text-slate-600">
                {user ? tr('nav.account', 'Account') : tr('nav.login', 'Log in')}
              </Link>
            </div>
          </div>
        )}
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
              <button type="button" onClick={() => openForgeChat()}
                className="bg-slate-100 rounded-xl rounded-tl-sm px-3 py-2 text-[13px] text-slate-600 text-left hover:bg-slate-200 transition">
                {tr('home.botHi', 'Hi! 👋 How can I help you today?')}
              </button>
            </div>
            {/* This used to be a link to the contact page. A card that shows an
                avatar, a greeting and a green "Online" dot is a chat as far as
                anyone tapping it is concerned — so now it opens the real one. */}
            <button type="button" onClick={() => openForgeChat()}
              className="mt-3 w-full flex items-center justify-center gap-2 text-white font-semibold text-sm rounded-xl h-10 transition hover:brightness-105"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              <MessageCircle size={16} /> {tr('home.chat', 'Chat with us')}
            </button>
          </div>
        </aside>

        {/* The assistant itself. The homepage is not inside SiteLayout, so
            without this the card had nothing to open. */}
        <DeferUntilIdle><Suspense fallback={null}><ChatWidget /></Suspense></DeferUntilIdle>
      <ScrollProgress />

        {/* Main */}
        {/* The homepage is its own route, outside StoreLayout, so it never
            inherited the light-theme remaps and its card text failed AA on
            white. The hero inside keeps its dark palette via the .fm-stage
            exceptions in index.css. */}
        <main className="theme-light flex-1 min-w-0 space-y-6">
          {/* Say it out loud when the shop cannot be reached.

              Above the hero on purpose: the hero is static copy and renders
              perfectly during an outage, which is exactly why the page looked
              healthy while nothing behind it worked. */}
          {unavailable && (
            <div className="rounded-2xl border border-amber-300/70 bg-amber-50 px-5 py-4 flex items-start gap-3">
              <CloudOff size={20} className="text-amber-600 shrink-0 mt-0.5" aria-hidden />
              <div className="text-sm">
                {/* `tr`, not `t` — this component renames the hook's output.
                    Writing `t` here compiled fine and threw ReferenceError at
                    render, blanking the entire homepage. Caught by loading the
                    page against a failing API rather than by reading the diff. */}
                <p className="font-semibold text-slate-800">
                  {tr('shop.unavailable', CATALOG_UNAVAILABLE.title.en)}
                </p>
                <p className="text-slate-600 mt-0.5">
                  {tr('shop.unavailableSub', CATALOG_UNAVAILABLE.hint.en)}
                </p>
              </div>
            </div>
          )}
          {/* Hero */}
          {/* The one place on the shop that is allowed to be theatre. Dark
              stage, a single coloured beam, oversized ghost type — the rest of
              the site stays light, because a price on a dark background is one
              more thing for a nervous buyer to squint at. */}
          <section className="fm-stage relative overflow-hidden rounded-3xl px-5 sm:px-10 py-9 sm:py-14">
            <span className="fm-beam" aria-hidden />
            {/* Decoration, drawn by CSS rather than typed here.
                As a text node it was the LARGEST CONTENTFUL PAINT on the
                homepage — 260px of outlined letters, measured beating both the
                real heading and its subtitle. The browser was therefore rating
                the page's loading speed on a watermark nobody reads. Moving the
                letters into a ::before takes it out of the running without
                changing a pixel. */}
            <span className="fm-ghostword" aria-hidden />
            {/* On xl the feature cards get their own column instead of floating
                over the artwork, which used to bury the right-hand logos. */}
            <div className="grid lg:grid-cols-[1.05fr_1fr] 2xl:grid-cols-[1.1fr_1fr_206px] gap-8 2xl:gap-6 items-center">
              <div className="relative fm-stagger" style={{ '--fm-stagger': '90ms' }}>
                <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-violet-100 bg-white/10 border border-white/15 backdrop-blur rounded-full px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-300 animate-pulse" /> {tr('home.badge', 'Buyer protected · Real human support')}
                </span>
                {/* "Everything You Need, All in One Place" said nothing about
                    what is sold or why to trust it — the biggest text on the
                    page carrying zero information. It now names the three things
                    this shop actually stocks, and the second line is the part a
                    stranger taking a bank transfer is really weighing. */}
                <h1 className="fm-head fm-streak text-white text-[30px] xs:text-[34px] sm:text-[50px] leading-[1.06] mt-4 tracking-[-.02em]">
                  {tr('home.h1a', 'Game currency, gift cards')}<br />
                  <span className="fm-gradient-text">{tr('home.h1b', 'and subscriptions.')}</span>
                </h1>
                <p className="text-slate-300/90 text-[15px] sm:text-[16px] mt-4 max-w-lg leading-relaxed">
                  {tr('home.sub', 'Robux, V-Bucks, Steam, Discord Nitro and more. In stock goes out automatically; everything else by hand, usually within a few hours.')}
                </p>
                {/* The three pillars as real entry points, not decoration: each
                    one deep-links into the shop already filtered. */}
                <div className="flex flex-wrap gap-2 mt-4">
                  {pillars.map((p) => (
                    <Link key={p.key} to={`/shop?category=${p.cats[0].slug}`}
                      className="fm-press text-[13px] font-semibold text-white/95 bg-white/10 hover:bg-white/[.16] border border-white/15 rounded-full px-3.5 py-2 transition">
                      {tr(`home.pillar.${p.key}`, p.title)}
                    </Link>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-5">
                  <Link to="/shop" className="fm-press inline-flex items-center gap-2 text-white font-semibold rounded-xl px-6 h-12 shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
                    style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
                    {tr('home.shopNowBig', 'Shop Now')} <ArrowRight size={18} />
                  </Link>
                  <Link to="/shop" className="fm-press inline-flex items-center gap-2 font-semibold rounded-xl px-6 h-12 border border-white/25 text-white hover:bg-white/10 transition">
                    {tr('home.viewAll', 'View All Products')}
                  </Link>
                </div>
                {stats.reviews > 0 ? (
                  <div className="flex items-center gap-3 mt-7">
                    <div className="flex -space-x-2.5">
                      {['#f472b6', '#60a5fa', '#34d399', '#fbbf24'].map((c, i) => (
                        <span key={i} className="w-9 h-9 rounded-full border-2 border-white/25" style={{ background: c }} />
                      ))}
                    </div>
                    <div className="text-sm text-white"><b className="fm-head">{fmtCount(stats.reviews)}</b> <span className="text-slate-400">{tr('home.happy', 'Happy Customers')}</span></div>
                  </div>
                ) : (
                  /* Before the first review lands this space was simply empty —
                     exactly where a first-time visitor decides whether to trust
                     the shop. These three answer the questions a stranger taking
                     a bank transfer actually gets asked, and all three are true
                     on day one, which is more than a review count can say. */
                  <ul className="flex flex-col gap-2 mt-7 text-[13.5px] text-slate-200/95">
                    {[
                      tr('home.trustWho', 'Run from the Netherlands by one person — name and contact on every page'),
                      tr('home.trustPay', 'You pay after ordering, with your order number as reference. Nothing is charged automatically'),
                      tr('home.trustBack', 'Money back in full if we cannot deliver'),
                    ].map((line) => (
                      <li key={line} className="flex items-start gap-2.5">
                        <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 3D render */}
              <HeroRender />

              {/* feature cards — their own column once the layout is wide enough */}
              <div className="hidden 2xl:flex flex-col gap-2.5">
                {HERO_FEATURES.map((f) => (
                  <div key={f.title} className="flex items-center gap-3 bg-white/[.07] backdrop-blur border border-white/12 rounded-2xl px-3.5 py-2.5 transition hover:bg-white/[.11] hover:-translate-y-0.5">
                    <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${f.color}`}><f.icon size={17} /></span>
                    <div className="leading-tight min-w-0">
                      <div className="text-[13px] font-semibold text-white">{tr(`home.f.${f.key}`, f.title)}</div>
                      <div className="text-[11px] text-slate-400">{tr(`home.f.${f.key}Sub`, f.sub)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* How it works — a manual-payment store has to answer "what happens
              after I pay?" before it asks for money. */}
          <section className="fm-reveal fm-reveal-children">
            <div className="flex items-center justify-between mb-4">
              <h2 className="fm-head text-2xl">{tr('home.howTitle', 'How it works')}</h2>
              <Link to="/how-it-works" className="text-sm font-semibold text-violet-600 hover:text-violet-700 inline-flex items-center gap-1">
                {tr('home.howMore', 'More detail')} <ChevronRight size={15} />
              </Link>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { n: '1', icon: LayoutGrid, title: tr('home.h1t', 'Pick your top-up'),
                  sub: tr('home.h1s', 'Choose the amount you want. No account needed — you can check out as a guest.') },
                { n: '2', icon: Tag, title: tr('home.h2t', 'Pay with the reference shown'),
                  sub: tr('home.h2s', 'You get the exact amount and a payment reference right after checkout. Copy both into your bank app.') },
                { n: '3', icon: Zap, title: tr('home.h3t', 'Get your code'),
                  sub: tr('home.h3s', 'In stock? Sent automatically once your payment is confirmed. Otherwise delivered by hand, usually within a few hours.') },
              ].map((c) => (
                <div key={c.n} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 grid place-items-center fm-num text-sm">{c.n}</span>
                    <c.icon size={17} className="text-violet-500" />
                  </div>
                  <div className="font-bold text-slate-900">{c.title}</div>
                  <p className="text-sm text-slate-500 mt-1 leading-relaxed">{c.sub}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── Popular products ──────────────────────────────────────────
              Three pillars, each resolved from the live catalogue. Grouping by
              what the shop actually sells beats one undifferentiated rail: a
              buyer arriving for Nitro should not have to scroll past Robux. */}
          {pillars.map((pillar) => (
            <section key={pillar.key} className="fm-reveal fm-reveal-children">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1.5 sm:gap-4 mb-3">
                <div className="min-w-0">
                  <h2 className="fm-head text-2xl">{tr(`home.pillar.${pillar.key}`, pillar.title)}</h2>
                  <p className="text-[13.5px] text-slate-600 mt-1 max-w-2xl leading-relaxed">
                    {tr(`home.pillar.${pillar.key}Sub`, pillar.sub)}
                  </p>
                </div>
                <Link to={`/shop?category=${pillar.cats[0].slug}`}
                  className="shrink-0 self-start sm:self-auto text-violet-700 font-semibold text-sm inline-flex items-center gap-1 hover:gap-2 transition-all">
                  {tr('home.viewAll', 'View All Products')} <ArrowRight size={15} />
                </Link>
              </div>
              <div className="fm-rail flex gap-4 overflow-x-auto pb-2 scroll-smooth snap-x">
                {pillar.cats.map((c) => (
                  <div key={c.slug} className="snap-start shrink-0 w-[212px] bg-white rounded-2xl border border-slate-200/70 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all p-4">
                    <div className="fm-logo-plinth rounded-xl h-[132px] grid place-items-center mb-3">
                      <img src={categoryLogos[c.slug] || ICON(c.slug)} alt="" aria-hidden="true"
                        loading="lazy" decoding="async" className="fm-logo w-[84px] h-[84px]" />
                    </div>
                    <h3 className="font-bold text-[15px] text-slate-900">{c.label}</h3>
                    <p className="text-[12.5px] text-slate-500 mt-0.5">
                      {tr('home.packs', '{n} packs available', { n: c.count })}
                    </p>
                    <div className="text-[12px] text-slate-500 mt-2">
                      {tr('home.from', 'From')} <span className="fm-num text-violet-700 text-[17px]">{money(c.from, c.currency)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Link to={`/shop?category=${c.slug}`}
                        className="flex-1 text-center text-white text-sm font-semibold rounded-lg h-11 grid place-items-center hover:brightness-105 transition"
                        style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
                        {tr('home.browseCat', 'Browse')}
                      </Link>
                      <button aria-label={tr('home.addCheapest', 'Add the cheapest {n} pack to your cart', { n: c.label })}
                        onClick={(e) => { flyToCart(e.currentTarget.closest('.snap-start')?.querySelector('img')); addToCart(c); }}
                        className="w-11 h-11 shrink-0 rounded-lg border border-slate-200 grid place-items-center text-slate-600 hover:bg-slate-50 hover:text-violet-700 active:scale-90 transition-transform">
                        <ShoppingCart size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {/* ── Why ForgeMarket ───────────────────────────────────────────
              Four reasons, each one a fact a buyer can check today rather than a
              value the shop claims to hold. The identity block underneath is the
              one that answers "who is actually taking my money". */}
          <section className="fm-reveal fm-reveal-children">
            <h2 className="fm-head text-2xl mb-1">{tr('home.whyTitle', 'Why ForgeMarket')}</h2>
            <p className="text-[13.5px] text-slate-600 mb-4 max-w-2xl leading-relaxed">
              {tr('home.whySub', 'Four things you can verify before you spend anything.')}
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { icon: Tag, color: 'text-violet-700 bg-violet-100',
                  t: tr('home.why1t', 'You pay after you order'),
                  s: tr('home.why1s', 'You place the order first and then transfer the exact amount shown, with your order number as the reference. Nothing is charged automatically and no card details are stored here.') },
                { icon: ShieldCheck, color: 'text-emerald-700 bg-emerald-100',
                  t: tr('home.why2t', 'Money back if we cannot deliver'),
                  s: tr('home.why2s', 'Not a goodwill gesture — it is the policy, in writing on the refund page. Until your order is delivered you can still cancel it by replying to your order email.') },
                { icon: MessageCircle, color: 'text-blue-700 bg-blue-100',
                  t: tr('home.why3t', 'A real person answers'),
                  s: tr('home.why3s', 'Every ticket and every email goes to the person who runs the shop, from the Netherlands. That means honest hours: fast during the day, next morning if you write at night.') },
                { icon: BadgeCheck, color: 'text-amber-700 bg-amber-100',
                  t: tr('home.why4t', 'Reviews tied to real orders'),
                  s: tr('home.why4s', 'A review only carries the verified badge if it is attached to a delivered order. Community vouches from Discord are shown separately and never get that badge.') },
              ].map((c) => (
                <div key={c.t} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 flex gap-4">
                  <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ${c.color}`}><c.icon size={20} /></span>
                  <div>
                    <div className="font-bold text-slate-900">{c.t}</div>
                    <p className="text-sm text-slate-500 mt-1 leading-relaxed">{c.s}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <SellerIdentity />
            </div>
          </section>

          {/* ── Reviews ───────────────────────────────────────────────────
              Real ones when they exist. Before that, the honest version: say
              there are none yet and point at the two places a buyer can check
              instead. Inventing social proof here is the one thing that would
              undo everything above it. */}
          <section className="fm-reveal">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1.5 sm:gap-4 mb-3">
              <div>
                <h2 className="fm-head text-2xl">{tr('home.reviewsTitle', 'What buyers say')}</h2>
                {stats.reviews > 0 && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex text-amber-500">
                      {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={15} fill="currentColor" />)}
                    </div>
                    {stats.rating != null && <span className="fm-head text-slate-900">{stats.rating}</span>}
                    <span className="text-[13px] text-slate-500">
                      {tr('home.basedOn', 'Based on {n} reviews', { n: stats.reviews.toLocaleString('en-US') })}
                    </span>
                  </div>
                )}
              </div>
              <Link to="/reviews" className="shrink-0 text-violet-700 font-semibold text-sm inline-flex items-center gap-1 hover:gap-2 transition-all">
                {tr('footer.reviews', 'Reviews')} <ArrowRight size={15} />
              </Link>
            </div>

            {hasReviews ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {reviews.slice(0, 3).map((r) => (
                  <div key={r.id} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5">
                    <div className="flex text-amber-500 mb-2">
                      {Array.from({ length: r.stars || 5 }).map((_, i) => <Star key={i} size={13} fill="currentColor" />)}
                    </div>
                    <p className="text-[14px] text-slate-700 leading-relaxed">&ldquo;{r.body}&rdquo;</p>
                    <p className="text-[12px] text-slate-500 mt-2">
                      – {r.author}{r.product ? ` · ${r.product}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-6 sm:p-7">
                <div className="font-bold text-slate-900">{tr('home.noReviewsT', 'No reviews yet — the shop is new')}</div>
                <p className="text-sm text-slate-500 mt-1.5 leading-relaxed max-w-2xl">
                  {tr('home.noReviewsS', 'Rather than borrow someone else’s, there is nothing here until a real buyer leaves one. A review can only be written from a delivered order, so this page fills up at the pace the shop actually sells.')}
                </p>
                <div className="flex flex-wrap gap-2.5 mt-4">
                  <Link to="/discord" className="fm-press inline-flex items-center gap-2 text-white text-sm font-semibold rounded-xl px-4 h-11 shadow-lg shadow-violet-500/25 hover:brightness-105 transition"
                    style={{ backgroundImage: 'linear-gradient(135deg,#5865F2,#7c5cff)' }}>
                    <MessageCircle size={16} /> {tr('home.askBuyers', 'Ask in Discord before you buy')}
                  </Link>
                  {trustpilot && (
                    <a href={trustpilot} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-semibold rounded-xl px-4 h-11 border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition">
                      ⭐ {tr('home.whoTrustpilot', 'Check us on Trustpilot')}
                    </a>
                  )}
                  <Link to="/trust" className="inline-flex items-center gap-2 text-sm font-semibold rounded-xl px-4 h-11 border border-slate-200 text-slate-700 hover:bg-slate-50 transition">
                    <ShieldCheck size={16} /> {tr('footer.trust', 'Trust Center')}
                  </Link>
                </div>
              </div>
            )}
          </section>

          {/* ── FAQ ───────────────────────────────────────────────────────
              The four questions a manual-payment shop gets asked before the
              first order. Native <details> so it works without JavaScript, is
              keyboard-operable for free, and each answer is findable by search. */}
          <section className="fm-reveal">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1.5 sm:gap-4 mb-3">
              <h2 className="fm-head text-2xl">{tr('home.faqTitle', 'Questions people ask first')}</h2>
              <Link to="/faq" className="shrink-0 text-violet-700 font-semibold text-sm inline-flex items-center gap-1 hover:gap-2 transition-all">
                {tr('home.faqAll', 'All questions')} <ArrowRight size={15} />
              </Link>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm divide-y divide-slate-100 overflow-hidden">
              {[
                [tr('home.faq1q', 'How fast do I get it?'),
                 tr('home.faq1a', 'If the code is already in stock it is sent automatically the moment your payment is confirmed. Everything else is bought in and delivered by hand, normally within a few hours during the day. The product page tells you which of the two applies before you buy.')],
                [tr('home.faq2q', 'How do I pay?'),
                 tr('home.faq2a', 'You order first, then pay the exact amount shown with your order number as the reference — Tikkie or a bank transfer. Payments are matched by a person, so confirmation is fastest during the day.')],
                [tr('home.faq3q', 'Do I need an account?'),
                 tr('home.faq3a', 'No. You can order as a guest and follow your order with the link in your confirmation email. An account only adds order history and store credit.')],
                [tr('home.faq4q', 'What if something goes wrong?'),
                 tr('home.faq4a', 'Reply to your order email or open a ticket in Discord. If we cannot deliver your order you get your money back in full — and until it is delivered you can still cancel.')],
              ].map(([q, a]) => (
                <details key={q} className="group">
                  <summary className="flex items-center justify-between gap-4 cursor-pointer list-none px-5 py-4 min-h-[56px] hover:bg-slate-50 transition">
                    <span className="font-semibold text-slate-900 text-[15px]">{q}</span>
                    <ChevronRight size={18} className="shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="px-5 pb-4 -mt-1 text-sm text-slate-600 leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
          </section>
        </main>
      </div>
      {/* ── Footer ────────────────────────────────────────────────────────
          The shared one, not a second hand-maintained copy. It carries the
          seller identity, the legal links and the live system status — all
          things the homepage previously did not show at all. Wrapped in
          theme-light because this page is its own route, outside StoreLayout. */}
      <div className="theme-light"><StoreFooter /></div>
      <RecentlyDelivered />
      <DeferUntilIdle><Suspense fallback={null}><CommandPalette /></Suspense></DeferUntilIdle>
      <MobileTabBar />
      <CookieConsent />
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
          <Sparkles size={i % 2 ? 16 : 12} className="text-violet-300/80 fm-orbit" style={{ animationDelay: `${i * 0.55}s`, '--orbit-dur': `${8 + i}s` }} />
        </div>
      ))}
      {/* center V-Bucks (foreground — drifts least, feels closest) */}
      <div className="fm-px absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10" style={{ '--d': 0.04 }}>
        <span className="fm-hero-item" style={{ '--halo': HALO['v-bucks'] }}>
          <img src={ICON('v-bucks')} alt="" className="w-[150px] h-[150px] object-contain drop-shadow-2xl fm-orbit"
            style={{ '--orbit-dur': '13s' }} />
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
