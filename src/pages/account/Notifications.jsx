import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Package, Truck, ShieldAlert, Sparkles } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { PageLoader, EmptyState } from '../../components/ui.jsx';

// Map notification `type` → customer-facing category + icon.
const META = {
  order_update: { cat: 'orders', icon: Package, tone: 'text-indigo-300 bg-indigo-500/10' },
  order: { cat: 'orders', icon: Package, tone: 'text-indigo-300 bg-indigo-500/10' },
  delivery: { cat: 'delivery', icon: Truck, tone: 'text-emerald-300 bg-emerald-500/10' },
  code: { cat: 'delivery', icon: Truck, tone: 'text-emerald-300 bg-emerald-500/10' },
  security: { cat: 'security', icon: ShieldAlert, tone: 'text-amber-300 bg-amber-500/10' },
  system: { cat: 'other', icon: Sparkles, tone: 'text-fuchsia-300 bg-fuchsia-500/10' },
};
const metaFor = (type) => META[type] || META.system;

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'orders', label: 'Order updates' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'security', label: 'Security' },
];

export default function Notifications() {
  const [items, setItems] = useState(null);
  const [tab, setTab] = useState('all');

  const load = () => api.get('/api/account/notifications').then((r) => setItems(r.notifications)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { all: items?.length || 0, orders: 0, delivery: 0, security: 0 };
    for (const n of items || []) { const cat = metaFor(n.type).cat; if (c[cat] != null) c[cat] += 1; }
    return c;
  }, [items]);

  if (!items) return <PageLoader />;
  const markAll = async () => { await api.post('/api/account/notifications/read-all'); load(); };
  const open = async (n) => { if (!n.read_at) await api.post(`/api/account/notifications/${n.id}/read`); };
  const filtered = tab === 'all' ? items : items.filter((n) => metaFor(n.type).cat === tab);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl text-white">Notifications</h1>
        <button onClick={markAll} className="btn-ghost text-sm"><CheckCheck size={16} /> Mark all read</button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 mb-5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-sm transition border ${
              tab === t.id ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'}`}>
            {t.label}{t.id !== 'all' && counts[t.id] ? <span className="ml-1 text-xs text-slate-500">{counts[t.id]}</span> : ''}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Bell} title={tab === 'all' ? 'No notifications' : `No ${TABS.find((t) => t.id === tab)?.label.toLowerCase()} notifications`} />
      ) : (
        <div className="card divide-y divide-white/5">
          {filtered.map((n) => {
            const meta = metaFor(n.type);
            const Icon = meta.icon;
            const Inner = (
              <div className="flex items-start gap-3">
                <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${meta.tone}`}><Icon size={16} /></span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm flex items-center gap-2">
                    {n.title}
                    {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                  </div>
                  {n.body && <div className="text-slate-400 text-sm">{n.body}</div>}
                  <div className="text-slate-500 text-xs mt-1">{date(n.created_at)}</div>
                </div>
              </div>
            );
            return n.link
              ? <Link key={n.id} to={n.link} onClick={() => open(n)} className="block px-5 py-4 hover:bg-white/5">{Inner}</Link>
              : <div key={n.id} className="px-5 py-4">{Inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}
