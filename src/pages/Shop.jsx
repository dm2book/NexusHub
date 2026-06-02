import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Loader2, PackageX } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageLoader, EmptyState } from '../components/ui.jsx';

const money = (cents, cur = 'EUR') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format((cents || 0) / 100);

export default function Shop() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [products, setProducts] = useState(null);
  const [buying, setBuying] = useState(null);

  useEffect(() => {
    api.get('/api/products').then((r) => setProducts(r.products)).catch(() => setProducts([]));
  }, []);

  const buy = async (p) => {
    if (!user) { navigate('/login', { state: { from: '/shop' } }); return; }
    setBuying(p.id);
    try {
      const { order } = await api.post('/api/orders', {
        email: user.email, items: [{ productId: p.id, quantity: 1 }],
      });
      toast.success(`Order ${order.number} placed!`);
      navigate(`/account/orders/${order.id}`);
    } catch (err) { toast.error(err.message); }
    finally { setBuying(null); }
  };

  if (!products) return <PageLoader />;

  return (
    <div className="max-w-7xl mx-auto px-5 py-12">
      <h1 className="text-3xl text-white mb-2">Shop</h1>
      <p className="text-slate-400 mb-8">Digital goods, delivered instantly.</p>

      {products.length === 0 ? (
        <EmptyState icon={PackageX} title="No products yet"
          hint="Products added by staff or synced from suppliers will appear here." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {products.map((p) => (
            <div key={p.id} className="card p-5 flex flex-col hover:border-primary/40 transition">
              {p.category && (
                <span className="text-[11px] uppercase tracking-wider text-indigo-400 font-rajdhani">{p.category}</span>
              )}
              <h3 className="text-white text-lg mt-1">{p.name}</h3>
              {p.description && <p className="text-slate-400 text-sm mt-1 flex-1">{p.description}</p>}
              <div className="flex items-center justify-between mt-5">
                <span className="text-xl text-white font-semibold">{money(p.price, p.currency)}</span>
                <button onClick={() => buy(p)} disabled={buying === p.id} className="btn-primary text-sm">
                  {buying === p.id ? <Loader2 size={16} className="animate-spin" />
                    : <><ShoppingBag size={16} /> Buy</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
