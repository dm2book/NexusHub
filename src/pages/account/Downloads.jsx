import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Copy, Inbox } from 'lucide-react';
import { api } from '../../lib/api.js';
import { dateShort } from '../../lib/format.js';
import { PageLoader, EmptyState } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function Downloads() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [reveal, setReveal] = useState({});

  useEffect(() => { api.get('/api/account/downloads').then((r) => setItems(r.deliveries)).catch(() => setItems([])); }, []);
  if (!items) return <PageLoader />;

  const get = async (d) => {
    try {
      const { delivery } = await api.get(`/api/account/deliveries/${d.id}`);
      setReveal((r) => ({ ...r, [d.id]: delivery.content }));
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <h1 className="text-2xl text-white mb-6">Downloads & deliveries</h1>
      {items.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing here yet"
          hint="Digital codes and files from your completed orders will appear here." />
      ) : (
        <div className="card divide-y divide-white/5">
          {items.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-5 py-4">
              <div className="min-w-0">
                <div className="text-white text-sm">{d.filename || `${d.type} delivery`}</div>
                <Link to={`/account/orders/${d.orderId}`} className="text-indigo-400 text-xs font-mono">{d.orderNumber}</Link>
                <span className="text-slate-500 text-xs ml-2">{dateShort(d.createdAt)}</span>
                {reveal[d.id] && <div className="mt-1"><code className="text-emerald-300 text-sm break-all">{reveal[d.id]}</code></div>}
              </div>
              {reveal[d.id] ? (
                <button onClick={() => { navigator.clipboard?.writeText(reveal[d.id]); toast.success('Copied'); }}
                  className="btn-ghost text-sm"><Copy size={14} /> Copy</button>
              ) : (
                <button onClick={() => get(d)} className="btn-primary text-sm"><Download size={14} /> Reveal</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
