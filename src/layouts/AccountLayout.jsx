import { useState } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Zap, LayoutDashboard, ShoppingBag, Download, LifeBuoy,
  Wallet, Bell, User, LogOut, Shield, Menu, Gift, Star,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const NAV = [
  { to: '/account', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/account/orders', icon: ShoppingBag, label: 'Orders' },
  { to: '/account/wallet', icon: Wallet, label: 'Wallet' },
  { to: '/account/referrals', icon: Gift, label: 'Referrals' },
  { to: '/account/rewards', icon: Star, label: 'Rewards' },
  { to: '/account/downloads', icon: Download, label: 'Downloads' },
  { to: '/account/notifications', icon: Bell, label: 'Notifications' },
  { to: '/account/tickets', icon: LifeBuoy, label: 'Support' },
  { to: '/account/profile', icon: User, label: 'Profile' },
];

export default function AccountLayout() {
  const { user, isStaff, logout } = useAuth();
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
        {NAV.map(({ to, icon: Icon, label, end }) => (
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
            <Shield size={18} /> Admin Console
          </Link>
        )}
        <button onClick={() => { onNavigate(); logout().then(() => navigate('/')); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5">
          <LogOut size={18} /> Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="w-64 shrink-0 border-r border-white/5 bg-elevated/50 hidden md:flex flex-col">
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
        <header className="relative h-16 border-b border-white/5 flex items-center justify-between px-4 sm:px-6 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <button onClick={() => setOpen(true)} className="md:hidden p-2 -ml-2 rounded-lg text-slate-200 hover:bg-white/5">
              <Menu size={20} />
            </button>
            <span className="text-slate-400 text-sm">My Account</span>
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
