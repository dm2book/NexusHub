import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Check, X, ExternalLink, AlertTriangle, Copy, Inbox } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

const FLAG_LABEL = {
  duplicate_transaction_id: 'Duplicate transaction ID',
  multiple_submissions: 'Multiple submissions',
};

export default function AdminPayments() {
  const toast = useToast();
  const [proofs, setProofs] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get('/api/admin/orders/payment/queue').then((r) => setProofs(r.proofs)).catch(() => setProofs([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const confirm = async (p) => {
    setBusy(p.id);
    try { await api.post(`/api/admin/orders/payment/proofs/${p.id}/confirm`); toast.success(`Payment confirmed for ${p.orderNumber}.`); load(); }
    catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };
  const reject = async (p) => {
    const reason = window.prompt(`Reject payment for ${p.orderNumber}? Optional reason for the customer:`, '');
    if (reason === null) return;
    setBusy(p.id);
    try { await api.post(`/api/admin/orders/payment/proofs/${p.id}/reject`, { reason }); toast.success('Payment rejected — customer notified.'); load(); }
    catch (err) { toast.error(err.message); } finally { setBusy(null); }
  };
  const copy = (t) => { navigator.clipboard?.writeText(t); toast.success('Copied'); };

  if (!proofs) return <PageLoader />;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl text-white flex items-center gap-2"><ShieldCheck size={20} className="text-emerald-400" /> Payment verification</h1>
        <span className="text-sm text-slate-400">{proofs.length} awaiting review</span>
      </div>
      <p className="text-slate-400 text-sm mb-6">Customers submit a transaction ID / screenshot after paying via Tikkie, Revolut or PayPal. Verify the money landed, then confirm — the order moves to fulfillment automatically.</p>

      {proofs.length === 0 ? (
        <div className="card p-14 text-center">
          <Inbox className="mx-auto text-slate-600 mb-3" size={40} />
          <p className="text-slate-300 font-medium">Queue is empty</p>
          <p className="text-slate-500 text-sm mt-1">New payment proofs from customers appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {proofs.map((p) => (
            <div key={p.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={`/admin/orders/${p.orderId}`} className="text-white font-mono hover:text-indigo-200">{p.orderNumber}</Link>
                    <span className="text-lg text-white font-semibold">{money(p.amount, p.currency)}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-white/5 text-slate-300 capitalize">{p.method || 'manual'}</span>
                    {p.fraudFlags?.map((f) => (
                      <span key={f} className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 inline-flex items-center gap-1">
                        <AlertTriangle size={11} /> {FLAG_LABEL[f] || f}
                      </span>
                    ))}
                  </div>
                  <div className="text-slate-400 text-sm mt-1">{p.email} · submitted {date(p.createdAt)}</div>
                  {p.transactionId && (
                    <button onClick={() => copy(p.transactionId)} className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate-200 bg-space-black rounded-lg px-3 py-1.5 font-mono hover:bg-white/5">
                      <Copy size={13} /> {p.transactionId}
                    </button>
                  )}
                  {p.note && <p className="text-slate-400 text-sm mt-2 italic">“{p.note}”</p>}
                  {p.screenshotUrl && (
                    <a href={p.screenshotUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200">
                      <ExternalLink size={13} /> View payment screenshot
                    </a>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button disabled={busy === p.id} onClick={() => reject(p)} className="btn-ghost text-sm text-red-300 hover:bg-red-500/10">
                    <X size={16} /> Reject
                  </button>
                  <button disabled={busy === p.id} onClick={() => confirm(p)} className="btn-primary text-sm">
                    <Check size={16} /> Confirm payment
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
