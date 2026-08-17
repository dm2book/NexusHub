import { Outlet, useLocation } from 'react-router-dom';
import DeferUntilIdle from '../components/DeferUntilIdle.jsx';
import ScrollProgress from '../components/store/ScrollProgress.jsx';
import { useEffect, lazy, Suspense } from 'react';
import StoreNav from '../components/store/StoreNav.jsx';
import { allowed, onConsentChange } from '../lib/consent.js';
import CookieConsent from '../components/CookieConsent.jsx';
import StoreFooter from '../components/store/StoreFooter.jsx';
import RecentlyDelivered from '../components/store/RecentlyDelivered.jsx';
const CommandPalette = lazy(() => import('../components/store/CommandPalette.jsx'));
import MobileTabBar from '../components/store/MobileTabBar.jsx';
const ChatWidget = lazy(() => import('../components/ChatWidget.jsx'));
import AnnouncementBar from '../components/store/AnnouncementBar.jsx';
import { useReveal } from '../lib/useReveal.js';

/**
 * Light storefront layout: shared nav + footer (their own colors) wrapping the
 * page content in a `.theme-light` scope so legacy `.card`/`.input`/text classes
 * render light. Heavy pages (Shop/Cart/Checkout/Product) also use explicit light
 * markup, so they look right with or without the scoped overrides.
 */
export default function StoreLayout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  // Capture an affiliate referral code from ?ref=CODE for attribution on signup.
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
  useReveal();

  return (
    <div className="min-h-screen flex flex-col bg-[#f6f7fb]">
      <AnnouncementBar />
      <StoreNav />
      <main key={pathname} className="theme-light flex-1 fm-page pb-20 lg:pb-0">
        <Outlet />
      </main>
      {/* theme-light too: the footer is a sibling of <main>, so its slate text
          was never remapped and read at 2.56:1 on white — measured. */}
      <div className="theme-light"><StoreFooter /></div>
      <RecentlyDelivered />
      <DeferUntilIdle><Suspense fallback={null}><CommandPalette /></Suspense></DeferUntilIdle>
      <MobileTabBar />
      {/* Mounted here, in the layout App.jsx actually renders. The previous
          banner lived in SiteLayout, which nothing renders, so it never
          appeared for a single visitor. */}
      <div className="theme-light"><CookieConsent /></div>
      <ScrollProgress />
      {/* The assistant used to exist on the homepage alone. Every page that can
          raise a question — the shop, a product, the cart, checkout, the status
          page — is inside THIS layout, so that is where it has to live. */}
      <DeferUntilIdle><Suspense fallback={null}><ChatWidget /></Suspense></DeferUntilIdle>
    </div>
  );
}
