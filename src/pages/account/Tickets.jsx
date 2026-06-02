import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { dateShort } from '../../lib/format.js';
import { PageLoader, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const STATUS_COLOR = {
  open: 'text-emerald-300', pending: 'text-amber-300',
  resolved: 'text-slate-400', closed: 'text-slate-500',
};

export default function Tickets() {
  const toast = useToast();
  const [tickets, setTickets] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'general', message: '' });

  const load = () => api.get('/api/account/tickets').then((r) => setTickets(r.tickets)).catch(() => setTickets([]));
  useEffect(() => { load(); }, []);
  if (!tickets) return <PageLoader />;

  const create = async () => {
    try {
      await api.post('/api/account/tickets', form);
      toast.success('Ticket opened.');
      setOpen(false); setForm({ subject: '', category: 'general', message: '' });
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl text-white">Support</h1>
        <button onClick={() => setOpen(true)} className="btn-primary text-sm"><Plus size={16} /> Open ticket</button>
      </div>

      {tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="No tickets" hint="Need help? Open a ticket and we’ll respond."
          action={<button onClick={() => setOpen(true)} className="btn-primary">Open ticket</button>} />
      ) : (
        <div className="card divide-y divide-white/5">
          {tickets.map((t) => (
            <Link key={t.id} to={`/account/tickets/${t.id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-white/5">
              <div>
                <div className="text-white text-sm">{t.subject}</div>
                <div className="text-slate-500 text-xs font-mono">{t.number} · {dateShort(t.created_at)}</div>
              </div>
              <span className={`text-xs uppercase tracking-wider ${STATUS_COLOR[t.status]}`}>{t.status}</span>
            </Link>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Open a support ticket"
        footer={<>
          <button onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
          <button onClick={create} disabled={!form.subject || !form.message} className="btn-primary">Submit</button>
        </>}>
        <div className="space-y-4">
          <div><label className="label">Subject</label>
            <input className="input" value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
          <div><label className="label">Category</label>
            <select className="input" value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="general">General</option>
              <option value="delivery">Delivery</option>
              <option value="refund">Refund</option>
              <option value="billing">Billing</option>
            </select></div>
          <div><label className="label">Message</label>
            <textarea rows={4} className="input" value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  );
}
