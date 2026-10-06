import { useEffect, useState } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Zap, LayoutDashboard, ShoppingBag, Download, LifeBuoy,
  Wallet, Bell, User, LogOut, Shield, Menu, Gift, Star, Coins, Trophy,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useI18n, extendDictionary } from '../lib/i18n.jsx';
import { PageLoader } from '../components/ui.jsx';

/* The account area's own strings, one file per language, fetched only for the
   language being read — the storefront never downloads them. English needs
   none: it is the text written in the components. */
const ACCOUNT_DICTS = {
  nl: () => import('../lib/i18n/account.nl.js'),
  de: () => import('../lib/i18n/account.de.js'),
  fr: () => import('../lib/i18n/account.fr.js'),
};
const loadedAccountDicts = new Set();
function useAccountDictionary(lang) {
  const known = !ACCOUNT_DICTS[lang] || loadedAccountDicts.has(lang);
  const [ready, setReady] = useState(known);
  useEffect(() => {
    if (!ACCOUNT_DICTS[lang] || loadedAccountDicts.has(lang)) { setReady(true); return undefined; }
    let live = true;
    setReady(false);
    ACCOUNT_DICTS[lang]()
      .then((m) => { extendDictionary(lang, m.default || {}); loadedAccountDicts.add(lang); })
      .catch(() => { /* a failed chunk is an English page, not a broken one */ })
      .finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [lang]);
  return ready;
}

const NAV = (t) => [
  { to: '/account', icon: LayoutDashboard, label: t('acc.layout.overview', 'Overview'), end: true },
  { to: '/account/orders', icon: ShoppingBag, label: t('acc.layout.orders', 'Orders') },
  { to: '/account/wallet', icon: Wallet, label: t('acc.layout.wallet', 'Wallet') },
  { to: '/account/forge-shop', icon: Coins, label: t('acc.layout.forgeShop', 'Forge Shop') },
  { to: '/account/referrals', icon: Gift, label: t('acc.layout.referrals', 'Referrals') },
  { to: '/account/rewards', icon: Star, label: t('acc.layout.rewards', 'Rewards') },
  { to: '/account/community', icon: Trophy, label: t('acc.layout.community', 'Community') },
  { to: '/account/downloads', icon: Download, label: t('acc.layout.downloads', 'Downloads') },
  { to: '/account/notifications', icon: Bell, label: t('acc.layout.notifications', 'Notifications') },
  { to: '/account/tickets', icon: LifeBuoy, label: t('acc.layout.support', 'Support') },
  { to: '/account/profile', icon: User, label: t('acc.layout.profile', 'Profile') },
];

export default function AccountLayout() {
  const { user, isStaff, logout } = useAuth();
  const { t, lang } = useI18n();
  /* Wait for the strings rather than flash English and then switch. */
  const dictReady = useAccountDictionary(lang);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const Sidebar = ({ onNavigate = () => {} }) => (
    <>
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2 px-6 h-16 border-b border-white/5 shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
             style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
          <Zap size={16} className="text-white" />
        </div>
        <span className="font-display text-white">ForgeMarket</span>
      </Link>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {NAV(t).map(({ to, icon: Icon, label, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate}
            className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition
              ${isActive ? 'bg-gradient-to-r from-primary/25 to-fuchsia-500/10 text-white ring-1 ring-primary/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <Icon size={18} /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-white/5 space-y-1 shrink-0">
        {isStaff && (
          <Link to="/admin" onClick={onNavigate} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-indigo-300 hover:bg-white/5">
            <Shield size={18} /> {t('acc.layout.admin', 'Admin Console')}
          </Link>
        )}
        <button onClick={() => { onNavigate(); logout().then(() => navigate('/')); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5">
          <LogOut size={18} /> {t('acc.layout.signOut', 'Sign out')}
        </button>
      </div>
    </>
  );

  if (!dictReady) return <PageLoader />;
  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      {/* Pinned and one viewport tall — see AdminLayout for what a stretched
          flex child does to a sidebar on a long page. The account pages are
          shorter today, which is exactly why this would have gone unnoticed
          until one of them grew. */}
      <aside className="w-64 shrink-0 border-r border-white/5 bg-elevated/50
        hidden md:flex flex-col sticky top-0 self-start h-screen">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[82%] bg-elevated border-r border-white/10 flex flex-col animate-fade-in">
            <Sidebar onNavigate={close} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 relative">
        <div className="orb w-96 h-96 bg-primary/10 -top-40 right-0 pointer-events-none" />
        <header className="sticky top-0 z-30 h-16 border-b border-white/5 flex items-center
          justify-between px-4 sm:px-6 bg-space-black/95 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <button onClick={() => setOpen(true)} className="md:hidden p-2 -ml-2 rounded-lg text-slate-200 hover:bg-white/5">
              <Menu size={20} />
            </button>
            <span className="text-slate-400 text-sm">{t('acc.layout.myAccount', 'My Account')}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-300 hidden sm:block">{user?.email}</span>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-white text-sm font-semibold">
              {(user?.displayName || user?.email || '?')[0].toUpperCase()}
            </div>
          </div>
        </header>
        <div key={pathname} className="relative p-4 sm:p-6 max-w-6xl fm-page"><Outlet /></div>
      </div>
    </div>
  );
}
