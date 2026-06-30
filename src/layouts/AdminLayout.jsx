import { useState } from 'react';
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Zap, BarChart3, ShoppingCart, Truck, PackageCheck, Package,
  Mail, ShieldAlert, LogOut, Store, LifeBuoy, Menu, X, Users, ShieldCheck, Activity, Gauge, Tag,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const NAV = [
  { to: '/admin', icon: BarChart3, label: 'Analytics', end: true, perm: 'analytics.read' },
  { to: '/admin/operations', icon: Gauge, label: 'Operations', perm: 'orders.read' },
  { to: '/admin/orders', icon: ShoppingCart, label: 'Orders', perm: 'orders.read' },
  { to: '/admin/payments', icon: ShieldCheck, label: 'Payments', perm: 'orders.update' },
  { to: '/admin/products', icon: Package, label: 'Products', perm: 'orders.read' },
  { to: '/admin/users', icon: Users, label: 'Users', perm: 'users.read' },
  { to: '/admin/fulfillment', icon: PackageCheck, label: 'Fulfillment', perm: 'fulfillment.manage' },
  { to: '/admin/suppliers', icon: Truck, label: 'Suppliers', perm: 'suppliers.read' },
  { to: '/admin/support', icon: LifeBuoy, label: 'Support', perm: 'tickets.read' },
  { to: '/admin/social', icon: Activity, label: 'Social proof', perm: 'social.moderate' },
  { to: '/admin/monetization', icon: Tag, label: 'Monetization', perm: 'monetization.manage' },
  { to: '/admin/emails', icon: Mail, label: 'Emails', perm: 'emails.manage' },
  { to: '/admin/security', icon: ShieldAlert, label: 'Security', perm: 'audit.read' },
];

export default function AdminLayout() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const items = NAV.filter((n) => !n.perm || hasPermission(n.perm));

  const Sidebar = ({ onNavigate = () => {} }) => (
    <>
      <Link to="/admin" onClick={onNavigate} className="flex items-center gap-2 px-5 h-16 border-b border-white/5 shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
             style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
          <Zap size={16} className="text-white" />
        </div>
        <div>
          <div className="font-display text-white text-sm leading-tight">ForgeMarket</div>
          <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-rajdhani">Admin</div>
        </div>
      </Link>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {items.map(({ to, icon: Icon, label, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate}
            className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition
              ${isActive ? 'bg-gradient-to-r from-primary/25 to-fuchsia-500/10 text-white ring-1 ring-primary/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <Icon size={18} /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-white/5 space-y-1 shrink-0">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:bg-white/5">
          <Store size={18} /> Storefront
        </Link>
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
      <aside className="w-60 shrink-0 border-r border-white/5 bg-elevated/50 hidden lg:flex flex-col">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 max-w-[82%] bg-elevated border-r border-white/10 flex flex-col animate-fade-in">
            <Sidebar onNavigate={close} />
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0 relative">
        <div className="orb w-96 h-96 bg-primary/10 -top-40 right-10 pointer-events-none" />
        <header className="relative h-16 border-b border-white/5 flex items-center justify-between px-4 sm:px-6 backdrop-blur-sm">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setOpen(true)} className="lg:hidden p-2 -ml-2 rounded-lg text-slate-200 hover:bg-white/5">
              <Menu size={20} />
            </button>
            <span className="text-slate-400 text-sm truncate">Admin Console</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2 py-1 rounded-md bg-white/5 text-slate-300 capitalize hidden sm:block">
              {user?.roles?.join(' · ').replace(/_/g, ' ')}
            </span>
            <span className="text-sm text-slate-300 hidden md:block">{user?.email}</span>
          </div>
        </header>
        <div key={pathname} className="relative p-4 sm:p-6 fm-page"><Outlet /></div>
      </div>
    </div>
  );
}
