import { Link, useLocation } from 'react-router-dom';
import { Home, LayoutGrid, Heart, ShoppingCart, PackageSearch } from 'lucide-react';
import { useCart } from '../../context/CartContext.jsx';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * App-style bottom tab bar for the storefront on phones. Hidden on ≥lg screens
 * and on pages that pin their own bottom UI (product buy bar, checkout CTA) so
 * the two never overlap. Safe-area padding for iPhones with a home indicator.
 */
/** Pages with their own fixed bottom UI, where the tab bar would collide. */
const hasMobileTabBar = (pathname) => !/^\/(product\/|checkout)/.test(String(pathname || ''));

export default function MobileTabBar() {
  const { pathname } = useLocation();
  const { count } = useCart();
  const { t } = useI18n();

  if (!hasMobileTabBar(pathname)) return null;

  const TABS = [
    { to: '/', icon: Home, label: t('tab.home', 'Home'), exact: true },
    { to: '/shop', icon: LayoutGrid, label: t('tab.shop', 'Shop') },
    { to: '/track', icon: PackageSearch, label: t('tab.track', 'Track') },
    { to: '/wishlist', icon: Heart, label: t('tab.saved', 'Saved') },
    { to: '/cart', icon: ShoppingCart, label: t('tab.cart', 'Cart'), badge: count },
  ];
  const active = (tab) => (tab.exact ? pathname === tab.to : pathname.startsWith(tab.to));

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200/80 shadow-[0_-8px_24px_-12px_rgba(15,23,42,.15)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="grid grid-cols-5 h-[62px]">
        {TABS.map((tab) => {
          const on = active(tab);
          // Inactive tabs are slate-500, not slate-400: on white the lighter
          // grey measures 2.85:1, under the 4.5:1 that small text needs. This
          // bar is on every phone screen, so it was the most-seen failure on
          // the site.
          const Icon = tab.icon;
          return (
            <Link key={tab.to} to={tab.to}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold transition
                ${on ? 'text-violet-600' : 'text-slate-500 hover:text-slate-700'}`}>
              <span className="relative">
                <Icon size={21} strokeWidth={on ? 2.4 : 2} />
                {tab.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-0.5 rounded-full bg-violet-600 text-white text-[10px] font-bold grid place-items-center">
                    {tab.badge}
                  </span>
                )}
              </span>
              {tab.label}
              {on && <span className="absolute top-0 w-8 h-0.5 rounded-full bg-violet-600" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
