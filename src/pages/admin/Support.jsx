import { useEffect, useState } from 'react';
import { LifeBuoy, RefreshCw, Send } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const TS_COLOR = { open: 'text-emerald-300', pending: 'text-amber-300', resolved: 'text-slate-400', closed: 'text-slate-500' };

export default function AdminSupport() {
  const [tab, setTab] = useState('tickets');
  return (
    <div>
      <h1 className="text-2xl text-white mb-6">Support</h1>
      <div className="flex gap-2 mb-6">
        {[['tickets', 'Tickets', LifeBuoy], ['refunds', 'Refund requests', RefreshCw]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 ${tab === id ? 'bg-primary text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === 'tickets' ? <Tickets /> : <Refunds />}
    </div>
  );
}

function Tickets() {
  const toast = useToast();
  const [tickets, setTickets] = useState(null);
  const [active, setActive] = useState(null);
  const [reply, setReply] = useState('');

  const load = () => api.get('/api/admin/support/tickets').then((r) => setTickets(r.tickets)).catch(() => setTickets([]));
  useEffect(() => { load(); }, []);
  const openTicket = async (t) => { const r = await api.get(`/api/admin/support/tickets/${t.id}`); setActive(r.ticket); };

  if (!tickets) return <PageLoader />;

  const send = async () => {
    if (!reply.trim()) return;
    try { const r = await api.post(`/api/admin/support/tickets/${active.id}/reply`, { body: reply });
      setActive(r.ticket); setReply(''); load(); }
    catch (err) { toast.error(err.message); }
  };
  const setStatus = async (status) => {
    try { const r = await api.post(`/api/admin/support/tickets/${active.id}/status`, { status });
      setActive(r.ticket); load(); toast.success(`Marked ${status}`); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <>
      {tickets.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">No tickets yet.</div>
      ) : (
        <div className="card divide-y divide-white/5">
          {tickets.map((t) => (
            <button key={t.id} onClick={() => openTicket(t)} className="w-full text-left flex items-center justify-between px-5 py-4 hover:bg-white/5">
              <div>
                <div className="text-white text-sm">{t.subject}</div>
                <div className="text-slate-500 text-xs font-mono">{t.number} · {date(t.updated_at)}</div>
              </div>
              <span className={`text-xs uppercase tracking-wider ${TS_COLOR[t.status]}`}>{t.status}</span>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!active} onClose={() => setActive(null)} title={active?.subject} size="lg"
        footer={active && (
          <div className="flex gap-2 w-full">
            {['pending', 'resolved', 'closed'].map((s) => (
              <button key={s} onClick={() => setStatus(s)} className="btn-ghost text-xs flex-1 capitalize">{s}</button>
            ))}
          </div>
        )}>
        {active && (
          <div>
            <div className="text-slate-500 text-xs font-mono mb-4">{active.number} · {active.category} · {active.status}</div>
            <div className="space-y-3 max-h-72 overflow-auto mb-4">
              {active.messages.map((m) => (
                <div key={m.id} className={`rounded-xl p-3 ${m.author_kind === 'staff' ? 'bg-primary/10 border border-primary/20' : 'bg-space-black'}`}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs uppercase tracking-wider text-indigo-300">
                      {m.author_kind === 'staff' ? 'Staff' : m.author_kind === 'system' ? 'System' : 'Customer'}
                    </span>
                    <span className="text-xs text-slate-500">{date(m.created_at)}</span>
                  </div>
                  <p className="text-slate-200 text-sm whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} className="input" placeholder="Reply to customer…" />
              <button onClick={send} className="btn-primary px-4"><Send size={16} /></button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Refunds() {
  const toast = useToast();
  const [refunds, setRefunds] = useState(null);

  const load = () => api.get('/api/admin/support/refunds').then((r) => setRefunds(r.refunds)).catch(() => setRefunds([]));
  useEffect(() => { load(); }, []);
  if (!refunds) return <PageLoader />;

  const decide = async (r, status, processOrder = false) => {
    try { await api.post(`/api/admin/support/refunds/${r.id}/decide`, { status, processOrder });
      toast.success(`Refund ${status}`); load(); }
    catch (err) { toast.error(err.message); }
  };

  if (refunds.length === 0) return <div className="card p-10 text-center text-slate-400">No refund requests.</div>;

  return (
    <div className="card divide-y divide-white/5">
      {refunds.map((r) => (
        <div key={r.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-white text-sm font-mono">{r.order_number}</div>
            <div className="text-slate-500 text-xs">{r.customer} · {date(r.created_at)} · {money(r.amount)}</div>
            {r.reason && <div className="text-slate-400 text-xs mt-1 max-w-md">“{r.reason}”</div>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-md ${r.status === 'requested' ? 'bg-amber-500/15 text-amber-300' : r.status === 'rejected' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{r.status}</span>
            {r.status === 'requested' && (
              <>
                <button onClick={() => decide(r, 'approved', true)} className="btn-ghost text-xs">Approve + refund</button>
                <button onClick={() => decide(r, 'rejected')} className="btn-danger text-xs">Reject</button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
