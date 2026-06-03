import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, dateShort } from '../../lib/format.js';
import { PageLoader, StatusBadge, EmptyState } from '../../components/ui.jsx';

export default function Orders() {
  const [orders, setOrders] = useState(null);
  useEffect(() => { api.get('/api/account/orders').then((r) => setOrders(r.orders)).catch(() => setOrders([])); }, []);
  if (!orders) return <PageLoader />;

  return (
    <div>
      <h1 className="text-2xl text-white mb-6">Your orders</h1>
      {orders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No orders yet"
          action={<Link to="/shop" className="btn-primary">Browse shop</Link>} />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 sm:hidden">
            {orders.map((o) => (
              <Link key={o.id} to={`/account/orders/${o.id}`} className="card p-4 block hover:border-primary/40 transition">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-indigo-400 font-mono text-sm">{o.number}</span>
                  <StatusBadge status={o.status} />
                </div>
                <div className="text-white text-sm mt-2">{o.product}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-slate-500 text-xs">{dateShort(o.date)}</span>
                  <span className="text-white font-medium">{money(o.amount, o.currency)}</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="card overflow-hidden hidden sm:block">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-400 border-b border-white/5">
                <tr>
                  <th className="px-5 py-3 font-medium">Order</th>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-white/5 transition">
                    <td className="px-5 py-4">
                      <Link to={`/account/orders/${o.id}`} className="text-indigo-400 font-mono hover:text-indigo-300">
                        {o.number}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-slate-300">{o.product}</td>
                    <td className="px-5 py-4 text-slate-400">{dateShort(o.date)}</td>
                    <td className="px-5 py-4 text-white">{money(o.amount, o.currency)}</td>
                    <td className="px-5 py-4"><StatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
