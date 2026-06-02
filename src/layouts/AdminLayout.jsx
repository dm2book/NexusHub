import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import {
  Zap, BarChart3, ShoppingCart, Truck, PackageCheck,
  Mail, ShieldAlert, LogOut, Store,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const NAV = [
  { to: '/admin', icon: BarChart3, label: 'Analytics', end: true, perm: 'analytics.read' },
  { to: '/admin/orders', icon: ShoppingCart, label: 'Orders', perm: 'orders.read' },
  { to: '/admin/fulfillment', icon: PackageCheck, label: 'Fulfillment', perm: 'fulfillment.manage' },
  { to: '/admin/suppliers', icon: Truck, label: 'Suppliers', perm: 'suppliers.read' },
  { to: '/admin/emails', icon: Mail, label: 'Emails', perm: 'emails.manage' },
  { to: '/admin/security', icon: ShieldAlert, label: 'Security', perm: 'audit.read' },
];

export default function AdminLayout() {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const items = NAV.filter((n) => !n.perm || hasPermission(n.perm));

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-white/5 bg-elevated/50 flex flex-col">
        <Link to="/admin" className="flex items-center gap-2 px-5 h-16 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
               style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <div className="font-display text-white text-sm leading-tight">ForgeMarket</div>
            <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-rajdhani">Admin</div>
          </div>
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {items.map(({ to, icon: Icon, label, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition
                ${isActive ? 'bg-primary/15 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/5 space-y-1">
          <Link to="/" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:bg-white/5">
            <Store size={18} /> Storefront
          </Link>
          <button onClick={() => logout().then(() => navigate('/'))}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5">
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-6">
          <span className="text-slate-400 text-sm">Admin Console</span>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2 py-1 rounded-md bg-white/5 text-slate-300">
              {user?.roles?.join(' · ')}
            </span>
            <span className="text-sm text-slate-300 hidden sm:block">{user?.email}</span>
          </div>
        </header>
        <div className="p-6"><Outlet /></div>
      </div>
    </div>
  );
}
