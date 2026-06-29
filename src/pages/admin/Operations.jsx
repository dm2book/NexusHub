import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Eye, CheckCircle2, RotateCcw, Mail, StickyNote, AlertTriangle,
  ArrowUpDown, ArrowUp, ArrowDown, DollarSign, ShoppingCart, Percent, TrendingUp, Package,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, dateShort } from '../../lib/format.js';
import { PageLoader, StatusBadge, EmptyState, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

// Dashboard status buckets → internal statuses.
const BUCKETS = [
  { id: 'all', label: 'All', statuses: [] },
  { id: 'pending', label: 'Pending', statuses: ['pending', 'payment_received'] },
  { id: 'processing', label: 'Processing', statuses: ['processing', 'awaiting_fulfillment'] },
  { id: 'delivered', label: 'Delivered', statuses: ['completed'] },
  { id: 'refunded', label: 'Refunded', statuses: ['refunded'] },
  { id: 'failed', label: 'Failed', statuses: ['failed', 'cancelled'] },
];
const SORTS = [{ id: 'date', label: 'Date' }, { id: 'amount', label: 'Amount' }, { id: 'status', label: 'Status' }];
const REFUNDABLE = ['completed', 'payment_received', 'processing', 'awaiting_fulfillment'];
const CLOSED = ['completed', 'refunded', 'cancelled', 'failed'];

export default function Operations() {
  const toast = useToast();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [stats, setStats] = useState(null);
  const [data, setData] = useState(null);
  const [bucket, setBucket] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date');
  const [dir, setDir] = useState('desc');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);   // complete
  const [refund, setRefund] = useState(null);
  const [contact, setContact] = useState(null);
  const [contactForm, setContactForm] = useState({ subject: '', message: '' });
  const [refundReason, setRefundReason] = useState('');
  const [notesOrder, setNotesOrder] = useState(null);
  const [notes, setNotes] = useState('');

  const loadStats = useCallback(() => {
    api.get('/api/admin/orders/stats?days=30').then(setStats).catch(() => setStats(false));
  }, []);
  const load = useCallback(() => {
    const q = new URLSearchParams();
    const b = BUCKETS.find((x) => x.id === bucket);
    if (b?.statuses.length) q.set('statuses', b.statuses.join(','));
    if (search.trim()) q.set('search', search.trim());
    q.set('sort', sort); q.set('dir', dir); q.set('limit', '200');
    api.get(`/api/admin/orders?${q}`).then(setData).catch((e) => toast.error(e.message));
  }, [bucket, search, sort, dir, toast]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const act = async (order, action, body) => {
    setBusy(true);
    try {
      await api.post(`/api/admin/orders/${order.id}/${action}`, body);
      toast.success(`Order ${order.number}: ${action} done.`);
      setConfirm(null); setRefund(null); setContact(null); setRefundReason('');
      load(); loadStats();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const openNotes = async (o) => {
    setNotesOrder(o); setNotes('');
    try { const r = await api.get(`/api/admin/orders/${o.id}`); setNotes(r.order.notes || ''); }
    catch { /* fresh */ }
  };
  const saveNotes = async () => {
    setBusy(true);
    try { await api.put(`/api/admin/orders/${notesOrder.id}/notes`, { notes }); toast.success('Notes saved.'); setNotesOrder(null); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  const toggleSort = (id) => { if (sort === id) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(id); setDir('desc'); } };

  if (!data) return <PageLoader />;
  const o = stats?.overview;

  return (
    <div>
      <div className="mb-1"><h1 className="text-2xl text-white">Fulfillment operations</h1></div>
      <p className="text-slate-400 text-sm mb-6">Search, filter and action every order — and watch revenue in real time.</p>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Kpi icon={DollarSign} label="Revenue (30d)" value={o ? o.revenueFormatted : '—'} tone="text-emerald-300 bg-emerald-500/10" sub={o ? `${o.paidOrders} paid orders` : ''} />
        <Kpi icon={ShoppingCart} label="Orders (30d)" value={o ? o.totalOrders : '—'} tone="text-indigo-300 bg-indigo-500/10" sub={o ? `${o.completedOrders} delivered` : ''} />
        <Kpi icon={Percent} label="Conversion" value={o ? `${o.conversionRate}%` : '—'} tone="text-violet-300 bg-violet-500/10" sub="paid / total" />
        <Kpi icon={TrendingUp} label="Avg order" value={o ? o.averageOrderValueFormatted : '—'} tone="text-amber-300 bg-amber-500/10" sub={o ? `${o.refundedFormatted} refunded` : ''} />
      </div>

      {/* Top products */}
      {stats?.topProducts?.length > 0 && (
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3"><Package size={15} className="text-primary" /> Top products (30d)</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {stats.topProducts.map((p, i) => (
              <div key={p.product_id || i} className="bg-space-black rounded-xl p-3">
                <div className="text-white text-sm truncate">{p.name}</div>
                <div className="text-slate-500 text-xs mt-0.5">{p.units} sold</div>
                <div className="text-emerald-300 text-sm font-medium mt-1">{p.revenueFormatted}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-3 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order # or email…" className="input pl-9 w-full" />
        </div>
        <div className="flex items-center gap-1.5">
          {SORTS.map((s) => (
            <button key={s.id} onClick={() => toggleSort(s.id)}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm border transition ${
                sort === s.id ? 'border-primary/40 bg-primary/15 text-white' : 'border-white/10 text-slate-400 hover:text-white'}`}>
              {s.label}
              {sort === s.id ? (dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} className="opacity-50" />}
            </button>
          ))}
        </div>
      </div>

      {/* Status buckets */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {BUCKETS.map((b) => (
          <button key={b.id} onClick={() => setBucket(b.id)}
            className={`px-3.5 py-1.5 rounded-lg text-sm transition border ${bucket === b.id
              ? 'bg-primary/20 border-primary/40 text-white' : 'border-white/10 bg-white/5 text-slate-400 hover:text-white'}`}>
            {b.label}
          </button>
        ))}
      </div>

      {data.orders.length === 0 ? (
        <EmptyState icon={Search} title="No orders match these filters" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="text-left text-slate-400 border-b border-white/5">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.orders.map((ord) => (
                <tr key={ord.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/admin/orders/${ord.id}`)} className="text-indigo-400 font-mono hover:text-indigo-300">{ord.number}</button>
                    {ord.fraudStatus && ord.fraudStatus !== 'ok' && (
                      <span title={`Fraud: ${ord.fraudStatus} (${ord.fraudScore})`} className="ml-2 inline-flex align-middle"><AlertTriangle size={13} className="text-amber-400" /></span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300 truncate max-w-[200px]">{ord.customer}</td>
                  <td className="px-4 py-3 text-slate-300 truncate max-w-[200px]">{ord.product}</td>
                  <td className="px-4 py-3 text-white">{money(ord.amount, ord.currency)}</td>
                  <td className="px-4 py-3 text-slate-400">{dateShort(ord.date)}</td>
                  <td className="px-4 py-3"><StatusBadge status={ord.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconBtn title="View" icon={Eye} onClick={() => navigate(`/admin/orders/${ord.id}`)} />
                      {hasPermission('orders.complete') && !CLOSED.includes(ord.status) && (
                        <IconBtn title="Complete order" icon={CheckCircle2} color="text-emerald-400" onClick={() => setConfirm(ord)} />
                      )}
                      {hasPermission('orders.refund') && REFUNDABLE.includes(ord.status) && (
                        <IconBtn title="Refund order" icon={RotateCcw} color="text-fuchsia-400" onClick={() => { setRefund(ord); setRefundReason(''); }} />
                      )}
                      {hasPermission('orders.contact') && (
                        <IconBtn title="Contact customer" icon={Mail} onClick={() => { setContact(ord); setContactForm({ subject: `About your order ${ord.number}`, message: '' }); }} />
                      )}
                      {hasPermission('orders.update') && (
                        <IconBtn title="Internal notes" icon={StickyNote} color="text-amber-300" onClick={() => openNotes(ord)} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-slate-500 text-xs mt-3">{data.orders.length} of {data.total} orders</div>

      {/* Complete */}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Complete this order?">
        {confirm && (
          <>
            <p className="text-slate-300">Mark <span className="font-mono text-white">{confirm.number}</span> as <span className="text-emerald-300">Completed</span>. The customer is notified by email and in their dashboard.</p>
            <button disabled={busy} onClick={() => act(confirm, 'complete')} className="btn-primary w-full text-lg py-4 mt-5"><CheckCircle2 size={22} /> Complete order</button>
            <button onClick={() => setConfirm(null)} className="btn-ghost w-full mt-3">Cancel</button>
          </>
        )}
      </Modal>

      {/* Refund */}
      <Modal open={!!refund} onClose={() => setRefund(null)} title="Refund this order?"
        footer={refund && <>
          <button onClick={() => setRefund(null)} className="btn-ghost">Cancel</button>
          <button disabled={busy} className="btn-primary bg-fuchsia-600 hover:bg-fuchsia-500" onClick={() => act(refund, 'refund', { reason: refundReason })}>
            <RotateCcw size={16} /> Refund {refund && money(refund.amount, refund.currency)}
          </button>
        </>}>
        {refund && (
          <div className="space-y-3">
            <p className="text-slate-300">Refund <span className="font-mono text-white">{refund.number}</span> ({money(refund.amount, refund.currency)}). Any store credit applied to this order is returned automatically.</p>
            <div><label className="label">Reason (optional)</label>
              <input className="input" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="e.g. customer request" /></div>
          </div>
        )}
      </Modal>

      {/* Contact */}
      <Modal open={!!contact} onClose={() => setContact(null)} title="Contact customer"
        footer={contact && <>
          <button onClick={() => setContact(null)} className="btn-ghost">Cancel</button>
          <button disabled={busy || !contactForm.message} className="btn-primary" onClick={() => act(contact, 'contact', contactForm)}><Mail size={16} /> Send</button>
        </>}>
        {contact && (
          <div className="space-y-4">
            <p className="text-slate-400 text-sm">To: {contact.customer}</p>
            <div><label className="label">Subject</label>
              <input className="input" value={contactForm.subject} onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })} /></div>
            <div><label className="label">Message</label>
              <textarea rows={4} className="input" value={contactForm.message} onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })} placeholder="Write a message — sent by email + in-app." /></div>
          </div>
        )}
      </Modal>

      {/* Internal notes */}
      <Modal open={!!notesOrder} onClose={() => setNotesOrder(null)} title="Internal notes"
        footer={notesOrder && <>
          <button onClick={() => setNotesOrder(null)} className="btn-ghost">Cancel</button>
          <button disabled={busy} className="btn-primary" onClick={saveNotes}><StickyNote size={16} /> Save notes</button>
        </>}>
        {notesOrder && (
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">Private notes for <span className="font-mono text-white">{notesOrder.number}</span> — only staff can see these.</p>
            <textarea rows={6} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for the team…" autoFocus />
          </div>
        )}
      </Modal>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="card p-4">
      <span className={`w-9 h-9 rounded-xl grid place-items-center mb-3 ${tone}`}><Icon size={17} /></span>
      <div className="text-2xl font-display text-white leading-none">{value}</div>
      <div className="text-slate-400 text-sm mt-1.5">{label}</div>
      {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

function IconBtn({ icon: Icon, title, onClick, color = 'text-slate-300' }) {
  return <button title={title} onClick={onClick} className={`p-2 rounded-lg hover:bg-white/10 ${color}`}><Icon size={16} /></button>;
}
