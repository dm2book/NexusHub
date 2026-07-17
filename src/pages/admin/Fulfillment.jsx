import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageCheck, Send, ExternalLink, Target, Copy } from 'lucide-react';
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
  const copy = (t) => { navigator.clipboard?.writeText(t); toast.success('Copied'); };

  return (
    <div>
      <h1 className="text-2xl text-white mb-2">Manual fulfillment queue</h1>
      <p className="text-slate-400 text-sm mb-6">
        Paid orders that can’t be auto-delivered land here. Buy from the linked listing, then paste the code — the buyer is e-mailed automatically. All actions are logged.
      </p>

      {queue.length === 0 ? (
        <EmptyState icon={PackageCheck} title="Queue is empty" hint="Auto-fulfilled orders never appear here." />
      ) : (
        <div className="space-y-3">
          {queue.map((r) => (
            <div key={r.id} className="card px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={`/admin/orders/${r.order_id}`} className="text-indigo-400 font-mono text-sm">{r.order_number}</Link>
                    <span className="text-white text-sm font-medium">{r.quantity > 1 ? `${r.quantity}× ` : ''}{r.item_name || 'Item'}</span>
                  </div>
                  <div className="text-slate-500 text-xs mt-0.5">{r.customer} · {date(r.created_at)}</div>
                  {r.deliveryDetails && (
                    <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1.5">
                      <Target size={13} className="text-emerald-400 shrink-0" />
                      <span className="text-xs text-slate-300">{r.deliveryLabel || 'Deliver to'}:</span>
                      <button onClick={() => copy(r.deliveryDetails)} className="text-xs text-white font-mono inline-flex items-center gap-1 hover:text-emerald-200">
                        {r.deliveryDetails} <Copy size={11} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {r.supplierUrl && (
                    <a href={r.supplierUrl} target="_blank" rel="noreferrer"
                      className="btn-ghost text-xs text-indigo-300 hover:bg-indigo-500/10 whitespace-nowrap">
                      <ExternalLink size={13} /> Buy from supplier
                    </a>
                  )}
                  <button onClick={() => setActive(r)} className="btn-primary text-sm"><Send size={14} /> Fulfill</button>
                </div>
              </div>
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
            <p className="text-slate-400 text-sm">Delivering <span className="font-mono text-white">{active.order_number}</span> · {active.quantity > 1 ? `${active.quantity}× ` : ''}{active.item_name}</p>
            {(active.supplierUrl || active.deliveryDetails) && (
              <div className="rounded-xl bg-space-black border border-white/10 p-3 space-y-2">
                {active.deliveryDetails && (
                  <div className="flex items-center gap-2 text-sm">
                    <Target size={14} className="text-emerald-400 shrink-0" />
                    <span className="text-slate-400">{active.deliveryLabel || 'Deliver to'}:</span>
                    <button onClick={() => copy(active.deliveryDetails)} className="text-white font-mono inline-flex items-center gap-1 hover:text-emerald-200">{active.deliveryDetails} <Copy size={12} /></button>
                  </div>
                )}
                {active.supplierUrl && (
                  <a href={active.supplierUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200">
                    <ExternalLink size={14} /> Open supplier listing to buy
                  </a>
                )}
              </div>
            )}
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
