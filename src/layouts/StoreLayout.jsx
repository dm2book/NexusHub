import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import StoreNav from '../components/store/StoreNav.jsx';
import StoreFooter from '../components/store/StoreFooter.jsx';
import RecentlyDelivered from '../components/store/RecentlyDelivered.jsx';
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
  useReveal();

  return (
    <div className="min-h-screen flex flex-col bg-[#f6f7fb]">
      <StoreNav />
      <main key={pathname} className="theme-light flex-1 fm-page">
        <Outlet />
      </main>
      <StoreFooter />
      <RecentlyDelivered />
    </div>
  );
}
