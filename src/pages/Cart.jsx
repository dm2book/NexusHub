import { Link, useNavigate } from 'react-router-dom';
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { categoryVisual, money } from '../lib/catalog.js';
import { EmptyState } from '../components/ui.jsx';

export default function Cart() {
  const { items, setQty, remove, subtotal, currency } = useCart();
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div className="section py-16">
        <h1 className="text-3xl text-white mb-8">Your cart</h1>
        <EmptyState icon={ShoppingBag} title="Your cart is empty"
          hint="Browse the shop and add some digital goods."
          action={<Link to="/shop" className="btn-primary">Browse shop</Link>} />
      </div>
    );
  }

  return (
    <div className="section py-12">
      <h1 className="text-3xl text-white mb-8">Your cart</h1>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {items.map((it) => {
            const { icon: Icon, grad } = categoryVisual(it.category);
            return (
              <div key={it.id} className="card p-4 flex items-center gap-4">
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>
                  <Icon size={22} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/product/${it.id}`} className="text-white hover:text-indigo-200 transition">{it.name}</Link>
                  <div className="text-slate-500 text-sm">{money(it.price, it.currency)} each</div>
                </div>
                <div className="flex items-center glass rounded-lg">
                  <button onClick={() => setQty(it.id, it.qty - 1)} className="p-2 text-slate-300 hover:text-white"><Minus size={14} /></button>
                  <span className="w-8 text-center text-white text-sm">{it.qty}</span>
                  <button onClick={() => setQty(it.id, it.qty + 1)} className="p-2 text-slate-300 hover:text-white"><Plus size={14} /></button>
                </div>
                <div className="w-24 text-right text-white font-medium">{money(it.price * it.qty, it.currency)}</div>
                <button onClick={() => remove(it.id)} className="p-2 text-slate-500 hover:text-red-400"><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>

        <div className="card p-6 h-fit">
          <h3 className="text-white mb-5">Order summary</h3>
          <div className="flex justify-between text-sm text-slate-400 mb-2">
            <span>Subtotal</span><span className="text-white">{money(subtotal, currency)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-400 mb-4">
            <span>Delivery</span><span className="text-emerald-300">Instant · Free</span>
          </div>
          <div className="flex justify-between text-lg border-t border-white/5 pt-4 mb-6">
            <span className="text-slate-300">Total</span>
            <span className="text-white font-semibold">{money(subtotal, currency)}</span>
          </div>
          <button onClick={() => navigate('/checkout')} className="btn-primary w-full py-3">
            Checkout <ArrowRight size={18} />
          </button>
          <Link to="/shop" className="block text-center text-sm text-slate-400 hover:text-white mt-4">Continue shopping</Link>
        </div>
      </div>
    </div>
  );
}
