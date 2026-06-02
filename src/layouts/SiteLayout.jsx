import { Outlet, Link, useNavigate } from 'react-router-dom';
import { Zap, LayoutDashboard, LogOut, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function SiteLayout() {
  const { user, isStaff, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-space-black/80 border-b border-white/5">
        <nav className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                 style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
              <Zap size={18} className="text-white" />
            </div>
            <span className="font-display text-lg text-white tracking-wide">ForgeMarket</span>
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-slate-300">
            <Link to="/shop" className="hover:text-white">Shop</Link>
            <Link to="/track" className="hover:text-white">Track Order</Link>
          </div>
          <div className="flex items-center gap-3">
            {isStaff && (
              <Link to="/admin" className="btn-ghost text-sm py-2">
                <Shield size={16} /> Admin
              </Link>
            )}
            {user ? (
              <>
                <Link to="/account" className="btn-ghost text-sm py-2">
                  <LayoutDashboard size={16} /> Dashboard
                </Link>
                <button onClick={() => logout().then(() => navigate('/'))}
                  className="btn-ghost text-sm py-2" title="Sign out">
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <Link to="/login" className="btn-primary text-sm py-2">Sign In</Link>
            )}
          </div>
        </nav>
      </header>
      <main className="flex-1"><Outlet /></main>
      <footer className="border-t border-white/5 py-8 text-center text-slate-500 text-sm">
        © {new Date().getFullYear()} ForgeMarket · Digital goods marketplace
      </footer>
    </div>
  );
}
