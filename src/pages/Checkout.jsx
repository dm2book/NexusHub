import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck, Loader2, ShoppingBag } from 'lucide-react';
import { api } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { money } from '../lib/catalog.js';
import { EmptyState } from '../components/ui.jsx';

export default function Checkout() {
  const { items, subtotal, currency, clear } = useCart();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user?.email) setEmail(user.email); }, [user]);

  if (items.length === 0) {
    return (
      <div className="section py-16">
        <h1 className="text-3xl text-white mb-8">Checkout</h1>
        <EmptyState icon={ShoppingBag} title="Nothing to check out"
          action={<Link to="/shop" className="btn-primary">Browse shop</Link>} />
      </div>
    );
  }

  const placeOrder = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { order } = await api.post('/api/orders', {
        email,
        items: items.map((i) => ({ productId: i.id, quantity: i.qty })),
        billing: { full_name: fullName, email },
        currency,
      });
      clear();
      toast.success(`Order ${order.number} placed!`);
      navigate(user ? `/account/orders/${order.id}` : `/track?number=${order.number}`);
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="section py-12">
      <h1 className="text-3xl text-white mb-8">Checkout</h1>
      <form onSubmit={placeOrder} className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h3 className="text-white mb-5">Contact & billing</h3>
            <div className="space-y-4">
              <div>
                <label className="label">Email (delivery + receipt)</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="input" placeholder="you@example.com" />
              </div>
              <div>
                <label className="label">Full name</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" placeholder="Optional" />
              </div>
            </div>
            {!user && (
              <p className="text-slate-500 text-sm mt-4">
                Tip: <Link to="/login" className="text-indigo-400">sign in</Link> to see this order in your dashboard.
              </p>
            )}
          </div>

          <div className="card p-6">
            <h3 className="text-white mb-2 flex items-center gap-2"><Lock size={16} className="text-indigo-300" /> Payment</h3>
            <p className="text-slate-400 text-sm">
              This demo places a real order in <span className="text-white">pending</span> status. Connect a payment
              provider (e.g. Stripe) to capture funds — the order then advances automatically.
            </p>
          </div>
        </div>

        <div className="card p-6 h-fit">
          <h3 className="text-white mb-5">Summary</h3>
          <div className="space-y-2.5 mb-4">
            {items.map((i) => (
              <div key={i.id} className="flex justify-between text-sm">
                <span className="text-slate-300 truncate pr-2">{i.qty}× {i.name}</span>
                <span className="text-white shrink-0">{money(i.price * i.qty, i.currency)}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-lg border-t border-white/5 pt-4 mb-6">
            <span className="text-slate-300">Total</span>
            <span className="text-white font-semibold">{money(subtotal, currency)}</span>
          </div>
          <button disabled={busy} className="btn-primary w-full py-3">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <>Place order</>}
          </button>
          <div className="flex items-center justify-center gap-2 mt-4 text-xs text-slate-500">
            <ShieldCheck size={14} /> Fraud-screened & encrypted
          </div>
        </div>
      </form>
    </div>
  );
}
