import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, ShoppingCart, Zap, ArrowRight, Shield, Menu, X, User } from 'lucide-react';
import { useCart } from '../../context/CartContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useI18n } from '../../lib/i18n.jsx';

/** EN ⇄ NL toggle — a compact pill that shows the language you can switch TO. */
export function LangSwitch({ className = '' }) {
  const { lang, setLang } = useI18n();
  return (
    <button onClick={() => setLang(lang === 'nl' ? 'en' : 'nl')}
      title={lang === 'nl' ? 'Switch to English' : 'Schakel naar Nederlands'}
      className={`inline-flex items-center gap-1 h-10 px-2.5 rounded-xl text-[13px] font-bold tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition ${className}`}>
      🌐 {lang === 'nl' ? 'EN' : 'NL'}
    </button>
  );
}

/** Shared light storefront top-nav (used on the home page and every store page). */
export default function StoreNav() {
  /* The header lifting off the page as you scroll is the clearest signal the
     site is responding to you, and it costs one class. Passive listener and a
     boolean, so it does not re-render on every frame. */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    // Scroll restoration on reload does not fire a scroll event, so a page
    // reopened half-way down would keep a flat header. Re-read after a frame.
    const raf = requestAnimationFrame(onScroll);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); };
  }, []);

  const { count } = useCart();
  const { user, isStaff, loading } = useAuth();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const active = (to) => (to === '/' ? pathname === '/' : pathname.startsWith(to));
  useEffect(() => { setOpen(false); }, [pathname]);

  const NAV = [
    { label: t('nav.home', 'Home'), to: '/' },
    { label: t('nav.products', 'All Products'), to: '/shop' },
    { label: t('nav.drops', 'Drops'), to: '/drops' },
    { label: t('nav.reviews', 'Reviews'), to: '/reviews' },
    { label: t('nav.how', 'How it works'), to: '/how-it-works' },
    { label: t('nav.support', 'Support'), to: '/contact' },
  ];

  return (
    <header className={`fm-nav sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/70 ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-[68px] flex items-center gap-6">
        {/* shrink-0 is load-bearing: this row is over-full at 390px, and without
            it the browser squeezes these 40px buttons down to 20-27px — measured.
            w-11 puts them on the 44px thumb target instead of just under it. */}
        <button onClick={() => setOpen((v) => !v)} aria-label={t('nav.menu', 'Menu')}
          className="lg:hidden w-11 h-11 shrink-0 -ml-1.5 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        {/* The wordmark is allowed to shrink; the mark and the buttons are not.
            Every item in this row used to be shrink-0, so at 390px the row was
            32px wider than the screen and EVERY page scrolled sideways — measured
            on /faq and /about as well as the legal pages. The logo is the one
            thing here that can give way without losing a function. */}
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/30"
            style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
            <Zap size={18} fill="white" />
          </span>
          <span className="text-xl font-extrabold tracking-tight text-slate-900 truncate">ForgeMarket</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-7 text-[15px] font-medium text-slate-600">
          {NAV.map((n) => (
            <Link key={n.label} to={n.to}
              className={`relative py-1 hover:text-slate-900 transition ${active(n.to) ? 'text-violet-600' : ''}`}>
              {n.label}
              {active(n.to) && <span className="absolute -bottom-[22px] left-0 right-0 h-0.5 bg-violet-600 rounded-full" />}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        {/* Real global search: opens the ⌘K command palette */}
        <button onClick={() => window.dispatchEvent(new CustomEvent('forge:cmdk'))}
          className="hidden md:flex items-center gap-2 bg-slate-100 rounded-xl px-3.5 h-10 w-[240px] text-slate-400 hover:bg-slate-200/70 transition">
          <Search size={16} />
          <span className="text-sm">{t('nav.search', 'Search for products...')}</span>
          <kbd className="ml-auto text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5">⌘K</kbd>
        </button>
        <button onClick={() => window.dispatchEvent(new CustomEvent('forge:cmdk'))} aria-label={t('nav.search', 'Search for products...')}
          className="md:hidden w-11 h-11 shrink-0 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
          <Search size={20} />
        </button>

        <LangSwitch className="hidden sm:inline-flex" />

        <Link to="/cart" data-cart-target aria-label={t('nav.cart', 'Shopping cart')}
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
        {loading ? (
          <span className="hidden sm:inline-flex w-16 h-4 rounded fm-skeleton" aria-hidden />
        ) : user ? (
          <>
            {/* Below sm this used to be the ONLY account affordance in the
                header, and it was hidden — while the Admin button next to it
                was not. A signed-in owner on a phone therefore saw a route to
                the admin panel and no route to their own account at all. The
                icon is always visible; the word appears when there is room. */}
            <Link to="/account" aria-label={t('nav.account', 'Account')}
              className="inline-flex items-center gap-1.5 text-[15px] font-medium text-slate-600 hover:text-slate-900 rounded-xl w-11 h-11 sm:w-auto sm:h-auto justify-center sm:justify-start">
              <User size={19} className="sm:hidden" />
              <span className="hidden sm:inline">{t('nav.account', 'Account')}</span>
            </Link>
          </>
        ) : (
          <Link to="/login" className="hidden sm:inline-flex text-[15px] font-medium text-slate-600 hover:text-slate-900">{t('nav.login', 'Log in')}</Link>
        )}
        {!loading && !user && (
          <Link to="/login" className="hidden sm:inline-flex items-center gap-1.5 text-white text-[15px] font-semibold rounded-xl px-4 h-10 shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
            style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
            {t('nav.signup', 'Sign Up')} <ArrowRight size={16} />
          </Link>
        )}
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden border-t border-slate-200/70 bg-white px-4 py-3 space-y-1 fm-page">
          {NAV.map((n) => (
            <Link key={n.label} to={n.to}
              className={`block px-3 py-2.5 rounded-xl text-[15px] font-medium ${active(n.to) ? 'bg-violet-50 text-violet-700' : 'text-slate-700 hover:bg-slate-50'}`}>
              {n.label}
            </Link>
          ))}
          <div className="h-px bg-slate-100 my-2" />
          <div className="px-1"><LangSwitch /></div>
          {isStaff && <Link to="/admin" className="block px-3 py-2.5 rounded-xl text-[15px] font-medium text-violet-700 bg-violet-50">🛡 Admin</Link>}
          <Link to={user ? '/account' : '/login'} className="block px-3 py-2.5 rounded-xl text-[15px] font-medium text-slate-700 hover:bg-slate-50">
            {user ? t('nav.account', 'Account') : t('nav.login', 'Log in')}
          </Link>
          {!user && (
            <Link to="/login" className="block text-center text-white font-semibold rounded-xl py-2.5 mt-1"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>{t('nav.signup', 'Sign Up')}</Link>
          )}
        </div>
      )}
    </header>
  );
}
