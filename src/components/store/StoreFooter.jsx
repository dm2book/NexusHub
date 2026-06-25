import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';

const COLS = [
  { title: 'Shop', links: [['All Products', '/shop'], ['Wishlist', '/wishlist'], ['Track Order', '/track'], ['Payment Methods', '/payment-methods']] },
  { title: 'Company', links: [['About Us', '/about'], ['How it works', '/how-it-works'], ['Reviews', '/reviews'], ['Contact', '/contact']] },
  { title: 'Help & Legal', links: [['FAQ', '/faq'], ['Refund Policy', '/refunds'], ['Terms', '/terms'], ['Privacy', '/privacy']] },
];

/** Shared light storefront footer. */
export default function StoreFooter() {
  return (
    <footer className="border-t border-slate-200/70 bg-white mt-12">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <div>
          <Link to="/" className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/30"
              style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
              <Zap size={18} fill="white" />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-slate-900">ForgeMarket</span>
          </Link>
          <p className="text-slate-500 text-sm mt-4 leading-relaxed">
            The marketplace for digital goods — delivered instantly, tracked in real time.
          </p>
          <Link to="/discord" className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-violet-600 hover:text-violet-700">
            💬 Join our Discord
          </Link>
        </div>
        {COLS.map((c) => (
          <div key={c.title}>
            <div className="text-[12px] font-bold tracking-wider text-slate-400 uppercase mb-3">{c.title}</div>
            <ul className="space-y-2">
              {c.links.map(([label, to]) => (
                <li key={label}><Link to={to} className="text-[14px] text-slate-600 hover:text-violet-600">{label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200/70">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <span>© {new Date().getFullYear()} ForgeMarket · Instant digital goods</span>
          <span className="text-emerald-500">● All systems operational</span>
        </div>
      </div>
    </footer>
  );
}
