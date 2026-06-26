import { Link, useLocation } from 'react-router-dom';
import { Search, ShoppingCart, Zap, ArrowRight, Shield } from 'lucide-react';
import { useCart } from '../../context/CartContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const NAV = [
  { label: 'Home', to: '/' },
  { label: 'All Products', to: '/shop' },
  { label: 'Reviews', to: '/reviews' },
  { label: 'How it works', to: '/how-it-works' },
  { label: 'Support', to: '/contact' },
];

/** Shared light storefront top-nav (used on the home page and every store page). */
export default function StoreNav() {
  const { count } = useCart();
  const { user, isStaff } = useAuth();
  const { pathname } = useLocation();
  const active = (to) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/70">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 h-[68px] flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/30"
            style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
            <Zap size={18} fill="white" />
          </span>
          <span className="text-xl font-extrabold tracking-tight text-slate-900">ForgeMarket</span>
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

        <Link to="/shop" className="hidden md:flex items-center gap-2 bg-slate-100 rounded-xl px-3.5 h-10 w-[240px] text-slate-400 hover:bg-slate-200/70 transition">
          <Search size={16} />
          <span className="text-sm">Search for products...</span>
          <kbd className="ml-auto text-[11px] bg-white border border-slate-200 rounded px-1.5 py-0.5">⌘K</kbd>
        </Link>

        <Link to="/cart" className="relative w-10 h-10 rounded-xl hover:bg-slate-100 grid place-items-center text-slate-700">
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
        {user ? (
          <Link to="/account" className="hidden sm:inline-flex text-[15px] font-medium text-slate-600 hover:text-slate-900">Account</Link>
        ) : (
          <Link to="/login" className="hidden sm:inline-flex text-[15px] font-medium text-slate-600 hover:text-slate-900">Log in</Link>
        )}
        {!user && (
          <Link to="/login" className="inline-flex items-center gap-1.5 text-white text-[15px] font-semibold rounded-xl px-4 h-10 shadow-lg shadow-violet-500/30 hover:brightness-105 transition"
            style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
            Sign Up <ArrowRight size={16} />
          </Link>
        )}
      </div>
    </header>
  );
}
