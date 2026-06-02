import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Eye, Truck, CheckCircle2, RotateCcw, Mail, AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, dateShort } from '../../lib/format.js';
import { PageLoader, StatusBadge, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const FILTERS = ['', 'pending', 'payment_received', 'processing', 'awaiting_fulfillment',
  'completed', 'refunded', 'cancelled'];

export default function AdminOrders() {
  const toast = useToast();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(null); // { order } for Complete Order modal
  const [contact, setContact] = useState(null); // { order } for Contact modal
  const [contactForm, setContactForm] = useState({ subject: '', message: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (search) q.set('search', search);
    api.get(`/api/admin/orders?${q}`).then(setData).catch((e) => toast.error(e.message));
  }, [status, search]);

  useEffect(() => { load(); }, [load]);

  const act = async (order, action, body) => {
    setBusy(true);
    try {
      await api.post(`/api/admin/orders/${order.id}/${action}`, body);
      toast.success(`Order ${order.number}: ${action.replace('-', ' ')} done.`);
      setConfirm(null); setContact(null);
      load();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  if (!data) return <PageLoader />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl text-white">Orders</h1>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-3 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Search number or email…" className="input pl-9 w-72" />
        </div>
      </div>

      <div className="flex gap-2 mb-5 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f || 'all'} onClick={() => setStatus(f)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${status === f
              ? 'bg-primary text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`}>
            {f ? (STATUS_LABEL[f]) : 'All'}
          </button>
        ))}
      </div>

      {data.orders.length === 0 ? (
        <EmptyState icon={Search} title="No orders found" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="text-left text-slate-400 border-b border-white/5">
              <tr>
                <th className="px-4 py-3 font-medium">Order ID</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.orders.map((o) => (
                <tr key={o.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/admin/orders/${o.id}`)}
                      className="text-indigo-400 font-mono hover:text-indigo-300">{o.number}</button>
                    {o.fraudStatus && o.fraudStatus !== 'ok' && (
                      <span title={`Fraud: ${o.fraudStatus} (${o.fraudScore})`}
                        className="ml-2 inline-flex"><AlertTriangle size={13} className="text-amber-400" /></span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{o.customer}</td>
                  <td className="px-4 py-3 text-slate-300">{o.product}</td>
                  <td className="px-4 py-3 text-white">{money(o.amount, o.currency)}</td>
                  <td className="px-4 py-3 text-slate-400">{dateShort(o.date)}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn title="View" icon={Eye} onClick={() => navigate(`/admin/orders/${o.id}`)} />
                      {hasPermission('orders.fulfill') && !['completed', 'refunded', 'cancelled'].includes(o.status) && (
                        <IconBtn title="Fulfill" icon={Truck} onClick={() => act(o, 'fulfill')} />
                      )}
                      {hasPermission('orders.complete') && o.status !== 'completed' && o.status !== 'refunded' && (
                        <IconBtn title="Mark Complete" icon={CheckCircle2} color="text-emerald-400"
                          onClick={() => setConfirm(o)} />
                      )}
                      {hasPermission('orders.refund') && ['completed', 'payment_received', 'processing', 'awaiting_fulfillment'].includes(o.status) && (
                        <IconBtn title="Refund" icon={RotateCcw} color="text-fuchsia-400"
                          onClick={() => act(o, 'refund')} />
                      )}
                      {hasPermission('orders.contact') && (
                        <IconBtn title="Contact customer" icon={Mail}
                          onClick={() => { setContact(o); setContactForm({ subject: `About your order ${o.number}`, message: '' }); }} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Complete Order — large CTA + confirmation modal */}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Complete this order?">
        {confirm && (
          <>
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                <CheckCircle2 size={20} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-slate-200">
                  You’re about to mark <span className="font-mono text-white">{confirm.number}</span> as
                  <span className="text-emerald-300"> Completed</span>.
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  The customer will be notified by email and in their dashboard. This confirms delivery.
                </p>
              </div>
            </div>
            <button disabled={busy} onClick={() => act(confirm, 'complete')}
              className="btn-primary w-full text-lg py-4">
              <CheckCircle2 size={22} /> Complete Order
            </button>
            <button onClick={() => setConfirm(null)} className="btn-ghost w-full mt-3">Cancel</button>
          </>
        )}
      </Modal>

      {/* Contact customer */}
      <Modal open={!!contact} onClose={() => setContact(null)} title="Contact customer"
        footer={contact && <>
          <button onClick={() => setContact(null)} className="btn-ghost">Cancel</button>
          <button disabled={busy || !contactForm.message} className="btn-primary"
            onClick={() => act(contact, 'contact', contactForm)}>Send</button>
        </>}>
        {contact && (
          <div className="space-y-4">
            <p className="text-slate-400 text-sm">To: {contact.customer}</p>
            <div><label className="label">Subject</label>
              <input className="input" value={contactForm.subject}
                onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })} /></div>
            <div><label className="label">Message</label>
              <textarea rows={4} className="input" value={contactForm.message}
                onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })} /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

const STATUS_LABEL = {
  pending: 'Pending', payment_received: 'Payment Received', processing: 'Processing',
  awaiting_fulfillment: 'Awaiting Fulfillment', completed: 'Completed',
  refunded: 'Refunded', cancelled: 'Cancelled',
};

function IconBtn({ icon: Icon, title, onClick, color = 'text-slate-300' }) {
  return (
    <button title={title} onClick={onClick}
      className={`p-2 rounded-lg hover:bg-white/10 ${color}`}>
      <Icon size={16} />
    </button>
  );
}
