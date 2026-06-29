import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingBag, Wallet, Gift, Bell, Clock, Cog, Truck, CheckCircle2, RotateCcw, ArrowRight,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, dateShort } from '../../lib/format.js';
import { StatusBadge, EmptyState, SkeletonStat, SkeletonRows, Skeleton } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => { api.get('/api/account/dashboard').then(setData).catch(() => {}); }, []);
  if (!data) {
    return (
      <div className="fm-page">
        <Skeleton className="h-7 w-72 rounded-lg mb-2" />
        <Skeleton className="h-4 w-80 rounded-md mb-7" />
        <div className="grid md:grid-cols-3 gap-4 mb-6">{Array.from({ length: 3 }).map((_, i) => <SkeletonStat key={i} />)}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-9">{Array.from({ length: 4 }).map((_, i) => <SkeletonStat key={i} />)}</div>
        <SkeletonRows rows={4} cols={3} />
      </div>
    );
  }

  const s = data.stats;
  const buckets = data.ordersByStatus || { pending: 0, processing: 0, delivered: 0, refunded: 0 };
  const statusCards = [
    { icon: Clock, label: 'Pending', value: buckets.pending, tone: 'text-slate-300 bg-white/5', to: '/account/orders' },
    { icon: Cog, label: 'Processing', value: buckets.processing, tone: 'text-indigo-300 bg-indigo-500/10', to: '/account/orders' },
    { icon: CheckCircle2, label: 'Delivered', value: buckets.delivered, tone: 'text-emerald-300 bg-emerald-500/10', to: '/account/orders' },
    { icon: RotateCcw, label: 'Refunded', value: buckets.refunded, tone: 'text-fuchsia-300 bg-fuchsia-500/10', to: '/account/orders' },
  ];

  return (
    <div>
      <h1 className="text-2xl text-white mb-1">Welcome back{user?.displayName ? `, ${user.displayName}` : ''}</h1>
      <p className="text-slate-400 mb-7">Here’s everything happening on your account.</p>

      {/* Highlight cards: wallet + referrals + notifications */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <Link to="/account/wallet" className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg shadow-indigo-900/20 group"
          style={{ backgroundImage: 'linear-gradient(135deg,#4f46e5,#7c3aed 60%,#a21caf)' }}>
          <div className="absolute -right-6 -top-6 w-28 h-28 rounded-full bg-white/10 blur-xl" />
          <div className="flex items-center justify-between"><Wallet size={20} /><ArrowRight size={16} className="opacity-0 group-hover:opacity-100 transition" /></div>
          <div className="text-white/70 text-xs mt-3">Wallet balance</div>
          <div className="text-2xl font-display mt-0.5">{money(s.walletBalance || 0, 'EUR')}</div>
        </Link>
        <Link to="/account/referrals" className="card p-5 hover:border-primary/40 transition group">
          <div className="flex items-center justify-between"><Gift size={20} className="text-pink-400" /><ArrowRight size={16} className="text-slate-500 opacity-0 group-hover:opacity-100 transition" /></div>
          <div className="text-slate-400 text-xs mt-3">Referral earnings</div>
          <div className="text-2xl font-display gradient-text mt-0.5">{money(s.referralEarnings || 0, 'EUR')}</div>
          <div className="text-slate-500 text-xs mt-1">{s.referrals || 0} referral{s.referrals === 1 ? '' : 's'}</div>
        </Link>
        <Link to="/account/notifications" className="card p-5 hover:border-primary/40 transition group">
          <div className="flex items-center justify-between"><Bell size={20} className="text-amber-300" /><ArrowRight size={16} className="text-slate-500 opacity-0 group-hover:opacity-100 transition" /></div>
          <div className="text-slate-400 text-xs mt-3">Unread notifications</div>
          <div className="text-2xl font-display text-white mt-0.5">{s.unreadNotifications || 0}</div>
          <div className="text-slate-500 text-xs mt-1">{s.openTickets || 0} open ticket{s.openTickets === 1 ? '' : 's'}</div>
        </Link>
      </div>

      {/* Orders by status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-9">
        {statusCards.map(({ icon: Icon, label, value, tone, to }) => (
          <Link key={label} to={to} className="card p-5 hover:border-primary/40 transition hover:-translate-y-0.5 duration-200">
            <span className={`w-10 h-10 rounded-xl grid place-items-center mb-3 ${tone}`}><Icon size={18} /></span>
            <div className="text-3xl font-display text-white">{value}</div>
            <div className="text-slate-400 text-sm mt-1">{label}</div>
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
