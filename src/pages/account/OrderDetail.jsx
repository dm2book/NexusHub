import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, RefreshCw, Download, Copy, Star, BadgeCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader, StatusBadge, STATUS_META, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reveal, setReveal] = useState({});
  const [review, setReview] = useState(undefined);    // undefined=loading, null=none, object=exists
  const [stars, setStars] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/api/account/orders/${id}`).then((r) => setOrder(r.order)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Whether this (delivered) order has already been reviewed.
  useEffect(() => {
    if (!order || order.status !== 'completed') return;
    api.get(`/api/account/orders/${id}/review`).then((r) => setReview(r.review)).catch(() => setReview(null));
  }, [order, id]);

  const submitReview = async () => {
    if (reviewBody.trim().length < 3) { toast.error('Please write a few words.'); return; }
    setReviewBusy(true);
    try {
      await api.post(`/api/account/orders/${id}/review`, { stars, body: reviewBody.trim() });
      toast.success('Thanks for your review!');
      setReview({ stars, body: reviewBody.trim() });
    } catch (err) { toast.error(err.message); }
    finally { setReviewBusy(false); }
  };

  // Poll status while the order is still in flight (real-time tracking).
  useEffect(() => {
    if (!order || ['completed', 'refunded', 'cancelled'].includes(order.status)) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [order, load]);

  if (!order) return <PageLoader />;

  const revealDelivery = async (d) => {
    try {
      const { delivery } = await api.get(`/api/account/deliveries/${d.id}`);
      setReveal((r) => ({ ...r, [d.id]: delivery.content }));
    } catch (err) { toast.error(err.message); }
  };

  const submitRefund = async () => {
    try {
      await api.post(`/api/account/orders/${id}/refund-request`, { reason });
      toast.success('Refund request submitted.');
      setRefundOpen(false); setReason('');
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="max-w-4xl">
      <Link to="/account/orders" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-5">
        <ArrowLeft size={16} /> Back to orders
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl text-white font-mono">{order.number}</h1>
          <p className="text-slate-400 text-sm">{date(order.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={order.status} />
          <a href={`${api.base}/api/account/orders/${id}/invoice`} target="_blank" rel="noreferrer"
             className="btn-ghost text-sm"><FileText size={16} /> Invoice</a>
          {(order.status === 'completed') && (
            <button onClick={() => setRefundOpen(true)} className="btn-ghost text-sm">
              <RefreshCw size={16} /> Request refund
            </button>
          )}
        </div>
      </div>

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
            <div className="flex justify-between pt-4 mt-2 border-t border-white/5">
              <span className="text-slate-400">Total</span>
              <span className="text-white text-lg font-semibold">{money(order.total, order.currency)}</span>
            </div>
          </div>

          {order.status === 'completed' && review !== undefined && (
            <div className="card p-5">
              <h3 className="text-white mb-1 flex items-center gap-2"><BadgeCheck size={16} className="text-emerald-400" /> Verified review</h3>
              {review ? (
                <div className="mt-3">
                  <div className="flex text-amber-400 mb-1">{Array.from({ length: review.stars || 5 }).map((_, i) => <Star key={i} size={15} fill="currentColor" />)}</div>
                  <p className="text-slate-300 text-sm">"{review.body}"</p>
                  <p className="text-emerald-400/80 text-xs mt-2">Thanks — your review is published as a verified purchase.</p>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-slate-400 text-sm mb-3">How was your order? Your review shows up with a Verified buyer badge.</p>
                  <div className="flex gap-1 mb-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <button key={i} type="button" onClick={() => setStars(i + 1)} aria-label={`${i + 1} stars`}>
                        <Star size={24} className={i < stars ? 'text-amber-400' : 'text-slate-600'} fill={i < stars ? 'currentColor' : 'none'} />
                      </button>
                    ))}
                  </div>
                  <textarea value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} rows={3} maxLength={600}
                    className="input" placeholder="Tell other buyers about your experience…" />
                  <button onClick={submitReview} disabled={reviewBusy} className="btn-primary mt-3 text-sm">
                    {reviewBusy ? 'Submitting…' : 'Submit review'}
                  </button>
                </div>
              )}
            </div>
          )}

          {order.deliveries.length > 0 && (
            <div className="card p-5">
              <h3 className="text-white mb-4">Digital deliveries</h3>
              <div className="space-y-3">
                {order.deliveries.map((d) => (
                  <div key={d.id} className="bg-space-black rounded-xl p-4 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-indigo-400">{d.type}</div>
                      {reveal[d.id] ? (
                        <code className="text-emerald-300 text-sm break-all">{reveal[d.id]}</code>
                      ) : (
                        <span className="text-slate-500 text-sm">•••••••• hidden</span>
                      )}
                    </div>
                    {reveal[d.id] ? (
                      <button onClick={() => { navigator.clipboard?.writeText(reveal[d.id]); toast.success('Copied'); }}
                        className="btn-ghost text-sm"><Copy size={14} /></button>
                    ) : (
                      <button onClick={() => revealDelivery(d)} className="btn-primary text-sm">
                        <Download size={14} /> Reveal
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card p-5 h-fit">
          <h3 className="text-white mb-4">Status timeline</h3>
          <ol className="relative border-l border-white/10 ml-1 space-y-4">
            {order.history.map((h) => (
              <li key={h.id} className="ml-4">
                <span className="absolute -left-[6px] w-3 h-3 rounded-full bg-primary" />
                <div className="text-white text-sm">{STATUS_META[h.to_status]?.label || h.to_status}</div>
                <div className="text-slate-500 text-xs">{date(h.created_at)}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Modal open={refundOpen} onClose={() => setRefundOpen(false)} title="Request a refund"
        footer={<>
          <button onClick={() => setRefundOpen(false)} className="btn-ghost">Cancel</button>
          <button onClick={submitRefund} className="btn-primary">Submit request</button>
        </>}>
        <p className="text-slate-400 text-sm mb-3">Tell us why you’d like a refund for {order.number}.</p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4}
          className="input" placeholder="Reason (optional)" />
      </Modal>
    </div>
  );
}
