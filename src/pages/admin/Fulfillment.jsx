import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageCheck, Send } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { PageLoader, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function Fulfillment() {
  const toast = useToast();
  const [queue, setQueue] = useState(null);
  const [active, setActive] = useState(null);
  const [form, setForm] = useState({ type: 'code', content: '', note: '' });

  const load = () => api.get('/api/admin/fulfillment/queue').then((r) => setQueue(r.queue)).catch(() => setQueue([]));
  useEffect(() => { load(); }, []);
  if (!queue) return <PageLoader />;

  const complete = async () => {
    try {
      await api.post(`/api/admin/fulfillment/${active.id}/complete`, {
        note: form.note,
        deliveries: form.content ? [{ type: form.type, content: form.content }] : [],
      });
      toast.success('Fulfillment completed.');
      setActive(null); setForm({ type: 'code', content: '', note: '' });
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <h1 className="text-2xl text-white mb-2">Manual fulfillment queue</h1>
      <p className="text-slate-400 text-sm mb-6">
        Orders without a supplier integration land here for manual delivery. All actions are logged.
      </p>

      {queue.length === 0 ? (
        <EmptyState icon={PackageCheck} title="Queue is empty" hint="Auto-fulfilled orders never appear here." />
      ) : (
        <div className="card divide-y divide-white/5">
          {queue.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <Link to={`/admin/orders/${r.order_id}`} className="text-indigo-400 font-mono text-sm">{r.order_number}</Link>
                <div className="text-white text-sm">{r.item_name || 'Item'}</div>
                <div className="text-slate-500 text-xs">{r.customer} · {date(r.created_at)}</div>
              </div>
              <button onClick={() => setActive(r)} className="btn-primary text-sm"><Send size={14} /> Fulfill</button>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!active} onClose={() => setActive(null)} title="Complete manual fulfillment"
        footer={active && <>
          <button onClick={() => setActive(null)} className="btn-ghost">Cancel</button>
          <button onClick={complete} className="btn-primary">Deliver</button>
        </>}>
        {active && (
          <div className="space-y-4">
            <p className="text-slate-400 text-sm">Delivering <span className="font-mono text-white">{active.order_number}</span> · {active.item_name}</p>
            <div><label className="label">Delivery type</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="code">Code</option>
                <option value="license">License</option>
                <option value="message">Message</option>
                <option value="file">File reference</option>
              </select></div>
            <div><label className="label">Content</label>
              <textarea rows={3} className="input font-mono" value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="e.g. XXXX-YYYY-ZZZZ" /></div>
            <div><label className="label">Internal note (optional)</label>
              <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
