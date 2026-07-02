import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Home, ShoppingBag, Search, LifeBuoy } from 'lucide-react';

const POPULAR = [
  ['Robux', '/shop?category=robux'], ['V-Bucks', '/shop?category=v-bucks'],
  ['Valorant', '/shop?category=valorant'], ['Discord Nitro', '/shop?category=discord-nitro'],
  ['Steam Wallet', '/shop?category=steam'], ['Track order', '/track'],
];

export default function NotFound() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const search = (e) => {
    e.preventDefault();
    navigate(q.trim() ? `/shop?search=${encodeURIComponent(q.trim())}` : '/shop');
  };

  return (
    <div className="section py-28 text-center relative overflow-hidden min-h-screen">
      <div className="orb w-96 h-96 bg-primary/20 -top-20 left-1/3" />
      <div className="relative max-w-lg mx-auto fm-page">
        <div className="font-display text-7xl sm:text-9xl gradient-text">404</div>
        <h1 className="text-2xl text-white mt-4">Page not found</h1>
        <p className="text-slate-400 mt-2">The page you’re looking for drifted off into the void — but the shop didn’t.</p>

        {/* Search straight into the catalog */}
        <form onSubmit={search} className="flex gap-2 mt-7 max-w-sm mx-auto">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-3.5 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
              placeholder="Search products…" className="input pl-10" />
          </div>
          <button type="submit" className="btn-primary px-5">Search</button>
        </form>

        {/* Popular destinations */}
        <div className="flex flex-wrap justify-center gap-2 mt-5">
          {POPULAR.map(([label, to]) => (
            <Link key={label} to={to} className="chip hover:border-primary/50 hover:text-white">{label}</Link>
          ))}
        </div>

        <div className="flex justify-center gap-3 mt-8">
          <Link to="/" className="btn-primary"><Home size={18} /> Home</Link>
          <Link to="/shop" className="btn-ghost"><ShoppingBag size={18} /> Shop</Link>
          <Link to="/contact" className="btn-ghost"><LifeBuoy size={18} /> Support</Link>
        </div>
      </div>
    </div>
  );
}
