import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Truck, CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader, StatusBadge, STATUS_META, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function AdminOrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/api/admin/orders/${id}`).then(setData).catch((e) => toast.error(e.message));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <PageLoader />;
  const { order, fulfillment, fulfillmentLogs } = data;

  const act = async (action, body) => {
    setBusy(true);
    try { await api.post(`/api/admin/orders/${id}/${action}`, body);
      toast.success('Done.'); setConfirm(false); load(); }
    catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl">
      <Link to="/admin/orders" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-5">
        <ArrowLeft size={16} /> Back to orders
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl text-white font-mono">{order.number}</h1>
          <p className="text-slate-400 text-sm">{order.email} · {date(order.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={order.status} />
          {hasPermission('orders.fulfill') && !['completed', 'refunded', 'cancelled'].includes(order.status) && (
            <button onClick={() => act('fulfill')} disabled={busy} className="btn-ghost text-sm"><Truck size={16} /> Fulfill</button>
          )}
          {hasPermission('orders.refund') && order.status !== 'refunded' && order.status !== 'cancelled' && (
            <button onClick={() => act('refund')} disabled={busy} className="btn-ghost text-sm"><RotateCcw size={16} /> Refund</button>
          )}
        </div>
      </div>

      {order.fraudStatus && order.fraudStatus !== 'ok' && (
        <div className="card border border-amber-500/30 p-4 mb-6 flex items-center gap-3">
          <AlertTriangle size={18} className="text-amber-400" />
          <span className="text-amber-200 text-sm">
            Fraud screening flagged this order ({order.fraudStatus}, score {order.fraudScore}). Review before fulfilling.
          </span>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="card p-5">
            <h3 className="text-white mb-4">Items</h3>
            <div className="divide-y divide-white/5">
              {order.items.map((it) => (
                <div key={it.id} className="flex justify-between py-3 text-sm">
                  <span className="text-slate-200">{it.name} × {it.quantity}</span>
                  <span className="text-white">{money(it.unit_price * it.quantity, order.currency)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-4 border-t border-white/5 mt-2">
              <span className="text-slate-400">Total · {order.paymentStatus}</span>
              <span className="text-white font-semibold">{money(order.total, order.currency)}</span>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-white mb-4">Fulfillment</h3>
            {fulfillment.length === 0 ? (
              <p className="text-slate-500 text-sm">No fulfillment requests yet.</p>
            ) : (
              <div className="space-y-2">
                {fulfillment.map((f) => (
                  <div key={f.id} className="flex items-center justify-between bg-space-black rounded-lg px-4 py-2.5 text-sm">
                    <span className="text-slate-300">{f.mode === 'auto' ? '🤖 Auto' : '✋ Manual'} {f.external_ref ? `· ${f.external_ref}` : ''}</span>
                    <span className={f.status === 'fulfilled' ? 'text-emerald-300' : f.status === 'failed' ? 'text-red-300' : 'text-amber-300'}>
                      {f.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <h4 className="text-slate-400 text-xs uppercase tracking-wider mt-5 mb-2">Fulfillment log</h4>
            <ul className="space-y-1 text-xs text-slate-500 max-h-48 overflow-auto">
              {fulfillmentLogs.map((l) => (
                <li key={l.id}><span className="text-slate-400">{date(l.created_at)}</span> · {l.action} · {l.actor}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-6">
          {hasPermission('orders.complete') && order.status !== 'completed' && order.status !== 'refunded' && (
            <button onClick={() => setConfirm(true)} className="btn-primary w-full py-4 text-base">
              <CheckCircle2 size={20} /> Complete Order
            </button>
          )}
          <div className="card p-5">
            <h3 className="text-white mb-4">Status timeline</h3>
            <ol className="relative border-l border-white/10 ml-1 space-y-4">
              {order.history.map((h) => (
                <li key={h.id} className="ml-4">
                  <span className="absolute -left-[6px] w-3 h-3 rounded-full bg-primary" />
                  <div className="text-white text-sm">{STATUS_META[h.to_status]?.label || h.to_status}</div>
                  <div className="text-slate-500 text-xs">{date(h.created_at)} · {h.changed_by}</div>
                  {h.reason && <div className="text-slate-500 text-xs italic">{h.reason}</div>}
                </li>
              ))}
            </ol>
          </div>
          {order.billing && Object.keys(order.billing).length > 0 && (
            <div className="card p-5">
              <h3 className="text-white mb-2">Billing</h3>
              <pre className="text-slate-400 text-xs whitespace-pre-wrap">{JSON.stringify(order.billing, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Complete this order?">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
            <CheckCircle2 size={20} className="text-emerald-400" />
          </div>
          <p className="text-slate-300 text-sm">
            Mark <span className="font-mono text-white">{order.number}</span> as Completed.
            The customer will be notified.
          </p>
        </div>
        <button disabled={busy} onClick={() => act('complete')} className="btn-primary w-full text-lg py-4">
          <CheckCircle2 size={22} /> Complete Order
        </button>
        <button onClick={() => setConfirm(false)} className="btn-ghost w-full mt-3">Cancel</button>
      </Modal>
    </div>
  );
}
