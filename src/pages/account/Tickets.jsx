import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { PageLoader, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useI18n } from '../../lib/i18n.jsx';

const STATUS_COLOR = {
  open: 'text-emerald-300', pending: 'text-amber-300',
  resolved: 'text-slate-400', closed: 'text-slate-500',
};

export default function Tickets() {
  const toast = useToast();
  const { t, locale } = useI18n();
  const [tickets, setTickets] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'general', message: '' });

  const load = () => api.get('/api/account/tickets').then((r) => setTickets(r.tickets)).catch(() => setTickets([]));
  useEffect(() => { load(); }, []);
  if (!tickets) return <PageLoader />;

  const create = async () => {
    try {
      await api.post('/api/account/tickets', form);
      toast.success(t('acc.tickets.opened', 'Ticket opened.'));
      setOpen(false); setForm({ subject: '', category: 'general', message: '' });
      load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl text-white">{t('acc.tickets.title', 'Support')}</h1>
        <button onClick={() => setOpen(true)} className="btn-primary text-sm"><Plus size={16} /> {t('acc.tickets.new', 'Open ticket')}</button>
      </div>

      {tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title={t('acc.tickets.empty', 'No tickets')} hint={t('acc.tickets.emptyHint', 'Need help? Open a ticket and we’ll respond.')}
          action={<button onClick={() => setOpen(true)} className="btn-primary">{t('acc.tickets.new', 'Open ticket')}</button>} />
      ) : (
        <div className="card divide-y divide-white/5">
          {tickets.map((tk) => (
            <Link key={tk.id} to={`/account/tickets/${tk.id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-white/5">
              <div>
                <div className="text-white text-sm">{tk.subject}</div>
                <div className="text-slate-500 text-xs font-mono">{tk.number} · {tk.created_at ? new Date(tk.created_at).toLocaleDateString(locale) : '—'}</div>
              </div>
              <span className={`text-xs uppercase tracking-wider ${STATUS_COLOR[tk.status]}`}>{t(`acc.status.${tk.status}`, tk.status)}</span>
            </Link>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('acc.tickets.modalTitle', 'Open a support ticket')}
        footer={<>
          <button onClick={() => setOpen(false)} className="btn-ghost">{t('acc.tickets.cancel', 'Cancel')}</button>
          <button onClick={create} disabled={!form.subject || !form.message} className="btn-primary">{t('acc.tickets.submit', 'Submit')}</button>
        </>}>
        <div className="space-y-4">
          <div><label className="label">{t('acc.tickets.subject', 'Subject')}</label>
            <input className="input" value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
          <div><label className="label">{t('acc.tickets.category', 'Category')}</label>
            <select className="input" value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="general">{t('acc.tickets.cat.general', 'General')}</option>
              <option value="delivery">{t('acc.tickets.cat.delivery', 'Delivery')}</option>
              <option value="refund">{t('acc.tickets.cat.refund', 'Refund')}</option>
              <option value="billing">{t('acc.tickets.cat.billing', 'Billing')}</option>
            </select></div>
          <div><label className="label">{t('acc.tickets.message', 'Message')}</label>
            <textarea rows={4} className="input" value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  );
}
