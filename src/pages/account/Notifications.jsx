import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { PageLoader, EmptyState } from '../../components/ui.jsx';

export default function Notifications() {
  const [items, setItems] = useState(null);

  const load = () => api.get('/api/account/notifications').then((r) => setItems(r.notifications)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  if (!items) return <PageLoader />;

  const markAll = async () => { await api.post('/api/account/notifications/read-all'); load(); };
  const open = async (n) => { if (!n.read_at) await api.post(`/api/account/notifications/${n.id}/read`); };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl text-white">Notifications</h1>
        <button onClick={markAll} className="btn-ghost text-sm"><CheckCheck size={16} /> Mark all read</button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications" />
      ) : (
        <div className="card divide-y divide-white/5">
          {items.map((n) => {
            const Inner = (
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 w-2 h-2 rounded-full ${n.read_at ? 'bg-slate-600' : 'bg-primary'}`} />
                <div className="flex-1">
                  <div className="text-white text-sm">{n.title}</div>
                  {n.body && <div className="text-slate-400 text-sm">{n.body}</div>}
                  <div className="text-slate-500 text-xs mt-1">{date(n.created_at)}</div>
                </div>
              </div>
            );
            return n.link ? (
              <Link key={n.id} to={n.link} onClick={() => open(n)} className="block px-5 py-4 hover:bg-white/5">{Inner}</Link>
            ) : (
              <div key={n.id} className="px-5 py-4">{Inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
