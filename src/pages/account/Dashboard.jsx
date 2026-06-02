import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, Package, Download, LifeBuoy, Bell } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, dateShort } from '../../lib/format.js';
import { PageLoader, StatusBadge, EmptyState } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => { api.get('/api/account/dashboard').then(setData).catch(() => {}); }, []);
  if (!data) return <PageLoader />;

  const cards = [
    { icon: ShoppingBag, label: 'Orders', value: data.stats.orders, to: '/account/orders' },
    { icon: Package, label: 'Purchases', value: data.stats.purchases, to: '/account/orders' },
    { icon: Download, label: 'Downloads', value: data.stats.downloads, to: '/account/downloads' },
    { icon: LifeBuoy, label: 'Open Tickets', value: data.stats.openTickets, to: '/account/tickets' },
    { icon: Bell, label: 'Unread', value: data.stats.unreadNotifications, to: '/account/notifications' },
  ];

  return (
    <div>
      <h1 className="text-2xl text-white mb-1">Welcome back{user?.displayName ? `, ${user.displayName}` : ''}</h1>
      <p className="text-slate-400 mb-8">Here’s an overview of your account.</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        {cards.map(({ icon: Icon, label, value, to }) => (
          <Link key={label} to={to} className="card p-5 hover:border-primary/40 transition">
            <Icon size={20} className="text-primary mb-3" />
            <div className="text-2xl text-white font-semibold">{value}</div>
            <div className="text-slate-400 text-sm">{label}</div>
          </Link>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg text-white">Recent orders</h2>
        <Link to="/account/orders" className="text-sm text-indigo-400 hover:text-indigo-300">View all</Link>
      </div>
      {data.recentOrders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No orders yet"
          action={<Link to="/shop" className="btn-primary">Browse shop</Link>} />
      ) : (
        <div className="card divide-y divide-white/5">
          {data.recentOrders.map((o) => (
            <Link key={o.id} to={`/account/orders/${o.id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-white/5 transition">
              <div>
                <div className="text-white font-mono text-sm">{o.number}</div>
                <div className="text-slate-500 text-xs">{dateShort(o.date)} · {o.product}</div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-white text-sm">{money(o.amount, o.currency)}</span>
                <StatusBadge status={o.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
