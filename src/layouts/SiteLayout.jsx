import { useState } from 'react';
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Zap, LayoutDashboard, LogOut, Shield, ShoppingCart, Menu, X, MessageCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import ChatWidget from '../components/ChatWidget.jsx';
import ScrollProgress from '../components/ScrollProgress.jsx';
import Ambience from '../components/Ambience.jsx';

const NAV = [
  { to: '/shop', label: 'Shop' },
  { to: '/discord', label: 'Discord' },
  { to: '/track', label: 'Track Order' },
];

export default function SiteLayout() {
  const { user, isStaff, logout } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Ambience />
      <ScrollProgress />
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-space-black/70 border-b border-white/[0.06]">
        <nav className="section h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-neon"
                 style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
              <Zap size={18} className="text-white" />
            </div>
            <span className="font-display text-lg text-white tracking-wide">ForgeMarket</span>
          </Link>

          <div className="hidden md:flex items-center gap-8 text-sm">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to}
                className={({ isActive }) => `transition hover:text-white ${isActive ? 'text-white' : 'text-slate-400'}`}>
                {n.label}
              </NavLink>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/cart" className="relative p-2.5 rounded-xl hover:bg-white/5 text-slate-300" title="Cart">
              <ShoppingCart size={19} />
              {count > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white text-[11px] font-bold flex items-center justify-center">
                  {count}
                </span>
              )}
            </Link>
            {isStaff && (
              <Link to="/admin" className="hidden sm:inline-flex btn-ghost text-sm py-2"><Shield size={16} /> Admin</Link>
            )}
            {user ? (
              <>
                <Link to="/account" className="hidden sm:inline-flex btn-ghost text-sm py-2">
                  <LayoutDashboard size={16} /> Dashboard
                </Link>
                <button onClick={() => logout().then(() => navigate('/'))} className="hidden sm:inline-flex btn-ghost text-sm py-2" title="Sign out">
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <Link to="/login" className="btn-primary text-sm py-2">Sign In</Link>
            )}
            <button className="md:hidden p-2.5 rounded-xl hover:bg-white/5 text-slate-200" onClick={() => setOpen((v) => !v)}>
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </nav>

        {open && (
          <div className="md:hidden border-t border-white/[0.06] bg-space-black/95 px-5 py-4 space-y-1">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} onClick={() => setOpen(false)}
                className="block px-3 py-2.5 rounded-lg text-slate-300 hover:bg-white/5">{n.label}</Link>
            ))}
            {user && <Link to="/account" onClick={() => setOpen(false)} className="block px-3 py-2.5 rounded-lg text-slate-300 hover:bg-white/5">Dashboard</Link>}
            {isStaff && <Link to="/admin" onClick={() => setOpen(false)} className="block px-3 py-2.5 rounded-lg text-indigo-300 hover:bg-white/5">Admin Console</Link>}
          </div>
        )}
      </header>

      <main className="flex-1"><div key={location.pathname} className="page-enter"><Outlet /></div></main>

      <ChatWidget />

      <footer className="relative border-t border-white/[0.06] mt-20 overflow-hidden">
        <div className="orb w-72 h-72 bg-primary/20 -bottom-32 left-1/4" />
        <div className="section relative py-14 grid gap-10 md:grid-cols-4">
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
                <Zap size={16} className="text-white" />
              </div>
              <span className="font-display text-white">ForgeMarket</span>
            </Link>
            <p className="text-slate-500 text-sm">The marketplace for digital goods — delivered instantly, tracked in real time.</p>
            <a href="/discord" className="inline-flex items-center gap-2 mt-4 text-sm text-indigo-300 hover:text-indigo-200">
              <MessageCircle size={16} /> Join our Discord
            </a>
          </div>
          <FooterCol title="Shop" links={[['All products', '/shop'], ['Track order', '/track'], ['Cart', '/cart']]} />
          <FooterCol title="Company" links={[['About', '/about'], ['Contact', '/contact'], ['FAQ', '/faq'], ['Discord', '/discord']]} />
          <FooterCol title="Legal" links={[['Terms', '/terms'], ['Privacy', '/privacy'], ['Sign in', '/login']]} />
        </div>
        <div className="section border-t border-white/[0.06] py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-slate-500 text-sm">
          <span>© {new Date().getFullYear()} ForgeMarket. All rights reserved.</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> All systems operational</span>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }) {
  return (
    <div>
      <h4 className="text-white font-rajdhani uppercase tracking-wider text-sm mb-4">{title}</h4>
      <ul className="space-y-2.5">
        {links.map(([label, to]) => (
          <li key={label}><Link to={to} className="text-slate-400 hover:text-white text-sm transition">{label}</Link></li>
        ))}
      </ul>
    </div>
  );
}
