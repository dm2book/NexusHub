import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, dateShort } from '../../lib/format.js';
import { PageLoader, StatusBadge, EmptyState } from '../../components/ui.jsx';

// Customer-facing buckets over the internal order statuses.
const BUCKET = {
  pending: ['pending', 'payment_received'],
  processing: ['processing', 'awaiting_fulfillment'],
  delivered: ['completed'],
  refunded: ['refunded', 'cancelled'],
};
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'processing', label: 'Processing' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'refunded', label: 'Refunded' },
];
const bucketOf = (status) => Object.keys(BUCKET).find((b) => BUCKET[b].includes(status)) || 'pending';

export default function Orders() {
  const [orders, setOrders] = useState(null);
  const [tab, setTab] = useState('all');

  useEffect(() => { api.get('/api/account/orders').then((r) => setOrders(r.orders)).catch(() => setOrders([])); }, []);

  const counts = useMemo(() => {
    const c = { all: orders?.length || 0, pending: 0, processing: 0, delivered: 0, refunded: 0 };
    for (const o of orders || []) c[bucketOf(o.status)] += 1;
    return c;
  }, [orders]);

  if (!orders) return <PageLoader />;
  const filtered = tab === 'all' ? orders : orders.filter((o) => bucketOf(o.status) === tab);

  return (
    <div>
      <h1 className="text-2xl text-white mb-5">Your orders</h1>

      {/* Status tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-sm transition border ${
              tab === t.id ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'}`}>
            {t.label} <span className={`ml-1 text-xs ${tab === t.id ? 'text-indigo-200' : 'text-slate-500'}`}>{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No orders yet"
          action={<Link to="/shop" className="btn-primary">Browse shop</Link>} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={ShoppingBag} title={`No ${tab} orders`} />
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 sm:hidden">
            {filtered.map((o) => (
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
                {filtered.map((o) => (
                  <tr key={o.id} className="hover:bg-white/5 transition">
                    <td className="px-5 py-4">
                      <Link to={`/account/orders/${o.id}`} className="text-indigo-400 font-mono hover:text-indigo-300">{o.number}</Link>
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
