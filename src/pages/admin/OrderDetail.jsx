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
  const [codes, setCodes] = useState({});
  const [payLink, setPayLink] = useState('');

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

  const deliverCodes = () => {
    const deliveries = [];
    (data?.order.items || []).forEach((it) => {
      (codes[it.id] || '').split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean)
        .forEach((content) => deliveries.push({ orderItemId: it.id, content, type: 'code' }));
    });
    if (!deliveries.length) { toast.error('Enter at least one code first.'); return; }
    act('deliver', { deliveries });
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

          {/* Payment is manual: the shared checkout link cannot carry an amount,
              so the buyer types it and a wrong cent lands on the owner. Paste a
              request made in the bank app and the buyer's live status page shows
              a pay button with the amount already in it. */}
          {order.status === 'pending' && hasPermission('orders.update') && (
            <div className="card p-5 border border-amber-500/20">
              <h3 className="text-white mb-1">Payment link for this order</h3>
              <p className="text-slate-500 text-sm mb-4">
                Make a payment request for <span className="text-white font-semibold">{money(order.total, order.currency)}</span> in
                your bank app and paste the link here. The customer sees it on their status page straight away —
                no amount to type, no reference to forget. You can also do this from your phone with
                <span className="text-slate-300"> /paylink {order.number} &lt;link&gt;</span> in Discord.
              </p>
              {order.payLink ? (
                <div className="flex flex-wrap items-center gap-3">
                  <a href={order.payLink} target="_blank" rel="noreferrer"
                     className="text-emerald-300 text-sm font-mono truncate max-w-[24rem]">{order.payLink}</a>
                  <button onClick={async () => {
                    setBusy(true);
                    try { await api.del(`/api/admin/orders/${id}/pay-link`); toast.success('Link removed.'); load(); }
                    catch (e) { toast.error(e.message); } finally { setBusy(false); }
                  }} disabled={busy} className="btn-ghost text-sm">Remove</button>
                </div>
              ) : (
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try { await api.post(`/api/admin/orders/${id}/pay-link`, { url: payLink.trim() });
                    toast.success('The customer can now pay the exact amount.'); setPayLink(''); load(); }
                  catch (err) { toast.error(err.message); } finally { setBusy(false); }
                }} className="flex flex-col sm:flex-row gap-2">
                  <input value={payLink} onChange={(e) => setPayLink(e.target.value)}
                    placeholder="https://tikkie.me/pay/..." className="input flex-1 text-base" />
                  <button disabled={busy || !payLink.trim()} className="btn-primary px-5">Attach</button>
                </form>
              )}
            </div>
          )}

          {/* The evidence behind a chargeback. Digital codes cannot be handed
              back, so the shop's whole defence is that the buyer expressly asked
              for immediate delivery and accepted losing the 14-day withdrawal
              right. It is recorded per order — shown here so it can actually be
              produced, rather than sitting in a column nobody can reach. */}
          {order.consentAt && (
            <div className="card p-5">
              <h3 className="text-white mb-1">Right of withdrawal</h3>
              <p className="text-slate-500 text-sm mb-3">
                Recorded when the order was placed. Copy this into any dispute.
              </p>
              <div className="rounded-xl bg-slate-900/60 border border-slate-700/60 p-4">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Agreed at</div>
                <div className="text-slate-200 text-sm font-mono mb-3">{new Date(order.consentAt).toLocaleString('nl-NL')}</div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Exact wording shown to the buyer</div>
                <p className="text-slate-300 text-sm leading-relaxed">
                  {order.consentText || <span className="text-slate-500 italic">Recorded before the wording was stored with it.</span>}
                </p>
              </div>
            </div>
          )}

          {hasPermission('orders.complete') && !['completed', 'refunded', 'cancelled'].includes(order.status) && (
            <div className="card p-5 border border-emerald-500/20">
              <h3 className="text-white mb-1">Deliver code(s)</h3>
              <p className="text-slate-500 text-sm mb-4">Enter the code/key for each item. It's e-mailed to the customer and the order is marked <span className="text-emerald-300">completed</span>.</p>
              <div className="space-y-3">
                {order.items.map((it) => (
                  <div key={it.id}>
                    <label className="label">{it.name} × {it.quantity} {it.quantity > 1 && <span className="text-slate-500">— one code per line</span>}</label>
                    <textarea rows={it.quantity > 1 ? 3 : 1} className="input font-mono" placeholder="e.g. ABCD-1234-EFGH-5678"
                      value={codes[it.id] || ''} onChange={(e) => setCodes((c) => ({ ...c, [it.id]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <button disabled={busy} onClick={deliverCodes} className="btn-primary w-full mt-4 py-3">
                Deliver code(s) &amp; complete → e-mail customer
              </button>
            </div>
          )}

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
