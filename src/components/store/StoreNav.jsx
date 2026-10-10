import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, ShoppingCart, Zap, ArrowRight, Shield, Menu, X, User, Heart } from 'lucide-react';
import { useCart } from '../../context/CartContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useI18n, LANGUAGES } from '../../lib/i18n.jsx';
import MobileDrawer from './MobileDrawer.jsx';
import { useWishlist } from '../../lib/wishlist.js';

/**
 * Language chooser.
 *
 * This was a two-way pill: press it and you went from Dutch to English and
 * back. That is the right control for exactly two languages and the wrong one
 * for four — with a toggle there is no way to reach the third. A menu also says
 * what is on offer, which a pill showing only the other option never did.
 *
 * Each language is named in its own language, because someone looking for
 * French does not read "Frans".
 */
export function LangSwitch({ className = '' }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const panel = useRef(null);
  const toggle = useRef(null);
  const [place, setPlace] = useState(null);
  const current = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];

  /**
   * Keep the list on the screen, wherever the button happens to sit.
   *
   * It was `right-0`, which is correct for the switcher in the desktop header
   * — it hangs to the left of a button on the right-hand side. The same
   * component is also the first thing in the mobile drawer's footer, on the
   * LEFT, and there a 164px list hanging leftwards runs off the edge of the
   * phone: measured at 390px wide, the panel started at x = -90 and every one
   * of the four languages began off-screen. You could see a sliver reading
   * "…ands" and had no way to find out what the other three were. On the one
   * control whose entire job is to show you what is on offer.
   *
   * Clamped rather than given an `align` prop: the call site is what was
   * wrong, so a prop is one more thing to get wrong the next time this button
   * is moved. The component asks the viewport instead.
   */
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return undefined; }
    const position = () => {
      const anchor = box.current;
      const list = panel.current;
      if (!anchor || !list) return;
      const a = anchor.getBoundingClientRect();
      const GUTTER = 12;
      const GAP = 6;

      // Horizontal: where `right-0` would put it, pulled back onto the screen.
      const w = list.offsetWidth;
      const wanted = a.right - w;
      const room = Math.max(GUTTER, window.innerWidth - w - GUTTER);
      const left = Math.round(Math.max(GUTTER, Math.min(wanted, room)) - a.left);

      /* Vertical: the phone's fixed tab bar is the real floor, not the bottom
         of the window. Opening downwards from a button sitting just above it
         put Français behind the bar — three of four languages listed, which is
         the same failure as the horizontal one in a different direction. The
         height comes from --fm-bottom-bar, the same number .fm-fab and
         .fm-clears-tabbar use, and CSS zeroes it above lg where there is no
         bar; a hardcoded 73 here would be a third copy. */
      const bar = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--fm-bottom-bar'), 10) || 0;
      const floor = window.innerHeight - bar - GUTTER;
      const h = list.offsetHeight;
      const below = floor - a.bottom - GAP;
      const above = a.top - GUTTER - GAP;
      const up = h > below && above > below;
      const top = Math.round(up ? -(Math.min(h, above) + GAP) : a.height + GAP);

      setPlace({ left, top, maxHeight: Math.max(120, Math.round(up ? above : below)) });
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);

  // Click outside and Escape both close it — a menu that traps you is worse
  // than no menu.
  /* Escape is marked as handled, and focus goes back to the button: inside the
     phone drawer the same key would otherwise also close the drawer around
     this list, and the option that had focus is gone the moment the list is. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={box} className={`relative ${className}`}>
      <button ref={toggle} onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open}
        aria-label={`${t('nav.language', 'Language')}: ${current.label}`}
        className="inline-flex items-center gap-1 h-10 px-2.5 rounded-xl text-[13px] font-bold tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition">
        <span aria-hidden="true">🌐</span> {current.short}
      </button>
      {open && (
        <ul ref={panel} role="listbox" aria-label={t('nav.language', 'Language')}
          style={place == null ? undefined
            : { left: place.left, right: 'auto', top: place.top, maxHeight: place.maxHeight }}
          className="absolute right-0 top-11 z-50 min-w-[164px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1">
          {/* role="none" on the list item: an option has to sit directly in
              its listbox, and a bare <li> puts a listitem between them that
              hides the options from a screen reader's count. */}
          {LANGUAGES.map((l) => (
            <li key={l.code} role="none">
              <button role="option" aria-selected={l.code === lang} lang={l.code}
                onClick={() => { setLang(l.code); setOpen(false); toggle.current?.focus(); }}
                className={`w-full text-left px-3 py-2 text-[14px] transition ${
                  l.code === lang ? 'font-bold text-violet-700 bg-violet-50' : 'text-slate-700 hover:bg-slate-50'}`}>
                <span className="inline-block w-7 text-[11px] font-bold tracking-wide text-slate-400">{l.short}</span>
                {l.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const { count: saved } = useWishlist();
  const { user, isStaff, loading } = useAuth();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuButton = useRef(null);
  const active = (to) => (to === '/' ? pathname === '/' : pathname.startsWith(to));
  useEffect(() => { setOpen(false); }, [pathname]);

  const NAV = [
    { label: t('nav.home', 'Home'), to: '/' },
    { label: t('nav.products', 'All Products'), to: '/shop' },
    /* Bundles took the deals slot Drops held. A seventh link does not fit:
       measured at 1152–1536px in all four languages, it cut "Support" off the
       end of this row at four of six widths. So Drops moved to the footer's
       Shop column, where it is still one click from every page. */
    { label: t('nav.bundles', 'Bundles'), to: '/bundles' },
    { label: t('nav.reviews', 'Reviews'), to: '/reviews' },
    { label: t('nav.howShort', 'How it works'), to: '/how-it-works' },
    { label: t('nav.support', 'Support'), to: '/contact' },
  ];

  return (
    <header className={`fm-nav sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/70 ${scrolled ? 'is-scrolled' : ''}`}>
      {/* Why 1400 and not the xl breakpoint that already existed.
          The wordmark used to appear at xl (1280px), where it does NOT fit:
          measured, the row needs about 120 more pixels than 1280 leaves after
          padding, and the wordmark is 119 of them. So switching it on there
          forced the nav to give up its last word instead — "Suppor" at every
          width from 1280 to 1920, in every language, which is what the German
          and French screenshots were actually showing.
          The container caps at 1400px, so from 1400 up the room is fixed and
          sufficient. Below that the mark alone says the same thing. The
          existing comment already said the wordmark "waits for a width that
          fits it whole"; only the threshold was wrong.

          xl:gap-5, not gap-6. Measured at 1440: the row is 1400px, padding takes
          64 and seven 24px gaps take 168, leaving 1168 — and the children came
          to exactly 1168. The row was full to the pixel, so the wordmark gave
          way by the two pixels it was short and the shop's own name rendered as
          "ForgeMar…" on every desktop width from 1280 to 1920. Four pixels off
          each gap hands back 28. */}
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-[68px] flex items-center gap-3 sm:gap-4 xl:gap-5">
        {/* shrink-0 is load-bearing: this row is over-full at 390px, and without
            it the browser squeezes these 40px buttons down to 20-27px — measured.
            w-11 puts them on the 44px thumb target instead of just under it. */}
        <button ref={menuButton} onClick={() => setOpen((v) => !v)} aria-label={t('nav.menu', 'Menu')}
          aria-expanded={open} aria-controls={open ? 'fm-store-menu' : undefined}
          className="min-[1152px]:hidden w-11 h-11 shrink-0 -ml-1.5 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        {/* The wordmark is allowed to shrink; the mark and the buttons are not.
            Every item in this row used to be shrink-0, so at 390px the row was
            32px wider than the screen and EVERY page scrolled sideways — measured
            on /faq and /about as well as the legal pages. The logo is the one
            thing here that can give way without losing a function. */}
        {/* Named explicitly: the wordmark is hidden below xl, so on a phone this
            link is a lone icon and a screen reader announces nothing at all. */}
          {/* Allowed to shrink below xl, where it is a lone icon and shrinking
              costs nothing — that is what keeps a 390px row from scrolling
              sideways. NOT allowed to shrink at xl and up, where the wordmark
              is actually visible: giving way there means truncating the name of
              the shop, which is the one label on this row that must never be
              the thing that gives. */}
          <Link to="/" aria-label="ForgeMarket" className="flex items-center gap-2.5 min-w-0 min-[1400px]:shrink-0">
          <span className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/30"
            style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
            <Zap size={18} fill="white" />
          </span>
          <span className="hidden min-[1400px]:inline text-xl font-extrabold tracking-tight text-slate-900 truncate">ForgeMarket</span>
        </Link>

        {/* 1152, not the lg breakpoint. At 1024 the desktop nav switched on
            with six items and a search box in a row that had space for five —
            measured, the last link was cut by 34 to 40px depending on the
            language. Below 1152 the menu button beside the logo carries the
            same links, in full, so nothing is lost by waiting; the two
            thresholds move together for that reason. */}
        <nav className="hidden min-[1152px]:flex items-center gap-4 text-[14.5px] font-medium text-slate-600 min-w-0 overflow-hidden">
          {NAV.map((n) => (
            <Link key={n.label} to={n.to} aria-current={active(n.to) ? 'page' : undefined}
              className={`relative py-1 whitespace-nowrap hover:text-slate-900 transition ${active(n.to) ? 'text-violet-600' : ''}`}>
              {n.label}
              {active(n.to) && <span className="absolute -bottom-[22px] left-0 right-0 h-0.5 bg-violet-600 rounded-full" />}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        {/* Real global search: opens the ⌘K command palette */}
        {/* slate-500, not slate-400: this text sits on slate-100, where the
            lighter grey measures 2.34:1 — well under the 4.5:1 that small text
            needs. Same visual weight, actually readable. */}
        <button onClick={() => window.dispatchEvent(new CustomEvent('forge:cmdk'))}
          className="hidden md:flex items-center gap-2 bg-slate-100 rounded-xl px-3.5 h-10 w-[190px] min-[1600px]:w-[232px] text-slate-500 hover:bg-slate-200/70 transition">
          <Search size={16} />
          {/* Two labels, because the box is a fixed 190px below xl and 240px
              above it, and "Search for products..." does not fit in 190 — nor
              does "Rechercher un produit..." in 240. A placeholder chopped
              mid-word beside a magnifying glass reads as a broken box rather
              than a short one, so the narrow width gets a label written for
              it. Same pattern the Sign Up button beside this one already uses:
              the icon always fits, the words appear when there is room. */}
          <span className="text-sm whitespace-nowrap min-[1600px]:hidden">{t('nav.searchShort', 'Search…')}</span>
          <span className="text-sm whitespace-nowrap hidden min-[1600px]:inline truncate">{t('nav.search', 'Search products…')}</span>
          <kbd className="ml-auto text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5">⌘K</kbd>
        </button>
        <button onClick={() => window.dispatchEvent(new CustomEvent('forge:cmdk'))} aria-label={t('nav.search', 'Search products…')}
          className="md:hidden w-11 h-11 shrink-0 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
          <Search size={20} />
        </button>

        <LangSwitch className="hidden sm:inline-flex" />

        {/* The wishlist, beside the cart: a heart pressed on any card shows up
            here at once, with how many are saved. */}
        <Link to="/wishlist" aria-label={t('nav.wishlist', 'Wishlist')}
          className="relative w-11 h-11 shrink-0 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
          <Heart size={20} fill={saved > 0 ? '#ec4899' : 'none'} style={saved > 0 ? { color: '#ec4899' } : undefined} />
          {saved > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[11px] font-semibold grid place-items-center"
              style={{ background: '#ec4899' }} data-testid="nav-wishlist-count">{saved}</span>
          )}
        </Link>

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
          <Link to="/login" className="hidden xl:inline-flex shrink-0 text-[15px] font-medium text-slate-600 hover:text-slate-900">{t('nav.login', 'Log in')}</Link>
        )}
        {/* Same cap as the homepage nav: in Dutch this row ran 103px over at
            1024px, where the desktop links appear and the CTA still has to fit
            beside them. A longer label truncates rather than leaving the
            viewport. */}
        {!loading && !user && (
          /* An outline, not the gradient: an account is not needed to buy (guest
             checkout), so this was the loudest button on the page pulling the
             eye away from the products and from Shop now. */
          <Link to="/login" className="hidden sm:inline-flex items-center gap-1.5 text-[15px] font-semibold rounded-xl px-4 h-10 shrink-0 min-w-0 max-w-[40vw] hover:brightness-105 transition"
            style={{ background: '#fff', color: '#6d28d9', border: '1.5px solid #c4b5fd' }}>
            <span className="truncate">{t('nav.signup', 'Sign Up')}</span>
            <ArrowRight size={16} className="shrink-0" />
          </Link>
        )}
      </div>

      {/* Mobile drawer */}
      <MobileDrawer open={open} onClose={() => setOpen(false)} openerRef={menuButton}
        id="fm-store-menu" label={t('nav.menu', 'Menu')} className="px-4 py-3 space-y-1">
          {NAV.map((n) => (
            <Link key={n.label} to={n.to} aria-current={active(n.to) ? 'page' : undefined}
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
      </MobileDrawer>
    </header>
  );
}
