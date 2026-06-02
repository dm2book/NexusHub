import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { api } from '../../lib/api.js';
import { date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function TicketDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [ticket, setTicket] = useState(null);
  const [body, setBody] = useState('');

  const load = useCallback(() => {
    api.get(`/api/account/tickets/${id}`).then((r) => setTicket(r.ticket)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!ticket) return <PageLoader />;

  const reply = async () => {
    if (!body.trim()) return;
    try {
      await api.post(`/api/account/tickets/${id}/reply`, { body });
      setBody(''); load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="max-w-3xl">
      <Link to="/account/tickets" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-5">
        <ArrowLeft size={16} /> Back to tickets
      </Link>
      <h1 className="text-2xl text-white">{ticket.subject}</h1>
      <p className="text-slate-500 text-sm font-mono mb-6">{ticket.number} · {ticket.status}</p>

      <div className="space-y-3 mb-6">
        {ticket.messages.map((m) => (
          <div key={m.id} className={`card p-4 ${m.author_kind === 'staff' ? 'border-primary/30' : ''}`}>
            <div className="flex justify-between mb-1">
              <span className="text-xs uppercase tracking-wider text-indigo-400">
                {m.author_kind === 'staff' ? 'Support' : m.author_kind === 'system' ? 'System' : 'You'}
              </span>
              <span className="text-xs text-slate-500">{date(m.created_at)}</span>
            </div>
            <p className="text-slate-200 text-sm whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </div>

      {ticket.status !== 'closed' && (
        <div className="flex gap-3">
          <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)}
            className="input" placeholder="Write a reply…" />
          <button onClick={reply} className="btn-primary px-5"><Send size={16} /></button>
        </div>
      )}
    </div>
  );
}
