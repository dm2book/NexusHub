import { Link } from 'react-router-dom';
import { Home, ShoppingBag } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="section py-32 text-center relative overflow-hidden">
      <div className="orb w-96 h-96 bg-primary/20 -top-20 left-1/3" />
      <div className="relative">
        <div className="font-display text-7xl sm:text-9xl gradient-text">404</div>
        <h1 className="text-2xl text-white mt-4">Page not found</h1>
        <p className="text-slate-400 mt-2 max-w-md mx-auto">The page you’re looking for drifted off into the void.</p>
        <div className="flex justify-center gap-3 mt-8">
          <Link to="/" className="btn-primary"><Home size={18} /> Home</Link>
          <Link to="/shop" className="btn-ghost"><ShoppingBag size={18} /> Shop</Link>
        </div>
      </div>
    </div>
  );
}
