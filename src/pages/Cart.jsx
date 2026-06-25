import { Link, useNavigate } from 'react-router-dom';
import { Minus, Plus, Trash2, ShoppingBag, ArrowRight } from 'lucide-react';
import { useCart } from '../context/CartContext.jsx';
import { categoryVisual, money } from '../lib/catalog.js';
import { iconFor } from '../lib/sampleCatalog.js';

export default function Cart() {
  const { items, setQty, remove, subtotal, currency } = useCart();
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div className="max-w-[1100px] mx-auto px-4 lg:px-8 py-16">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-8">Your cart</h1>
        <div className="bg-white rounded-2xl border border-slate-200/70 p-14 text-center">
          <ShoppingBag className="mx-auto text-slate-300 mb-3" size={44} />
          <p className="font-semibold text-slate-700">Your cart is empty</p>
          <p className="text-slate-400 text-sm mt-1">Browse the shop and add some digital goods.</p>
          <Link to="/shop" className="btn-primary mt-6 inline-flex">Browse shop</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto px-4 lg:px-8 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900 mb-8">Your cart</h1>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {items.map((it) => {
            const v = categoryVisual(it.category); const img = it.image || iconFor(it.category); const Icon = v.icon;
            return (
              <div key={it.id} className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-slate-50 grid place-items-center shrink-0">
                  {img ? <img src={img} alt="" className="w-12 h-12 object-contain" />
                    : <span className={`w-12 h-12 rounded-lg bg-gradient-to-br ${v.grad} grid place-items-center`}><Icon size={22} className="text-white" /></span>}
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/product/${it.id}`} className="font-semibold text-slate-900 hover:text-violet-600 transition">{it.name}</Link>
                  <div className="text-slate-400 text-sm">{money(it.price, it.currency)} each</div>
                </div>
                <div className="flex items-center bg-slate-100 rounded-lg">
                  <button onClick={() => setQty(it.id, it.qty - 1)} className="p-2 text-slate-500 hover:text-slate-900"><Minus size={14} /></button>
                  <span className="w-8 text-center text-slate-900 text-sm font-medium">{it.qty}</span>
                  <button onClick={() => setQty(it.id, it.qty + 1)} className="p-2 text-slate-500 hover:text-slate-900"><Plus size={14} /></button>
                </div>
                <div className="w-24 text-right font-semibold text-slate-900">{money(it.price * it.qty, it.currency)}</div>
                <button onClick={() => remove(it.id)} className="p-2 text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-6 h-fit">
          <h3 className="font-bold text-slate-900 mb-5">Order summary</h3>
          <div className="flex justify-between text-sm text-slate-500 mb-2">
            <span>Subtotal</span><span className="text-slate-900 font-medium">{money(subtotal, currency)}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-500 mb-4">
            <span>Delivery</span><span className="text-emerald-600 font-medium">Instant · Free</span>
          </div>
          <div className="flex justify-between text-lg border-t border-slate-100 pt-4 mb-6">
            <span className="text-slate-600">Total</span>
            <span className="text-slate-900 font-bold">{money(subtotal, currency)}</span>
          </div>
          <button onClick={() => navigate('/checkout')} className="btn-primary w-full py-3">
            Checkout <ArrowRight size={18} />
          </button>
          <Link to="/shop" className="block text-center text-sm text-slate-500 hover:text-violet-600 mt-4">Continue shopping</Link>
        </div>
      </div>
    </div>
  );
}
