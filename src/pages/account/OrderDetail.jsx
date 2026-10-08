import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, RefreshCw, Download, Copy, Star, BadgeCheck, CreditCard } from 'lucide-react';
import { api } from '../../lib/api.js';
import { money, date } from '../../lib/format.js';
import { PageLoader, StatusBadge, STATUS_META, Modal } from '../../components/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import RefundMethodChoice from '../../components/store/RefundMethodChoice.jsx';
import { useI18n } from '../../lib/i18n.jsx';

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { t } = useI18n();
  const [order, setOrder] = useState(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundMethod, setRefundMethod] = useState('money');
  const [reason, setReason] = useState('');
  const [reveal, setReveal] = useState({});
  const [review, setReview] = useState(undefined);    // undefined=loading, null=none, object=exists
  const [stars, setStars] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [mystery, setMystery] = useState([]);
  const [rerolling, setRerolling] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  /**
   * Finish paying an order that never got paid.
   *
   * Without this the only way back to an abandoned payment is placing the order
   * again, which reserves the stock twice. The server resumes the existing
   * Mollie payment when there is one, so this cannot open a second charge.
   */
  const payNow = async () => {
    setPayBusy(true);
    try {
      const r = await api.post(`/api/orders/${id}/mollie`, {});
      if (r.checkoutUrl) { window.location.href = r.checkoutUrl; return; }
      // Already settled while this tab sat open — show the truth, don't redirect.
      load();
      toast.success(t('acc.order.alreadyPaid', 'This order is already paid.'));
    } catch (e) { toast.error(e.message || t('acc.order.payFailed', 'Could not start the payment.')); }
    finally { setPayBusy(false); }
  };

  const reroll = async (pullId) => {
    setRerolling(pullId);
    try {
      const r = await api.post(`/api/account/orders/${id}/mystery/${pullId}/reroll`);
      setMystery(r.pulls || []);
      toast.success(r.improved ? t('acc.order.rerollUpgraded', 'Nice! Upgraded to {label}.', { label: r.label }) : t('acc.order.rerollKept', 'Rolled {rolled} — you kept your {label}.', { rolled: r.rolled, label: r.label }));
    } catch (e) { toast.error(e.message || t('acc.order.rerollFailed', 'Reroll failed.')); }
    finally { setRerolling(''); }
  };

  const load = useCallback(() => {
    api.get(`/api/account/orders/${id}`).then((r) => setOrder(r.order)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Mystery-box winnings (if any) for the reveal card.
  useEffect(() => {
    api.get(`/api/account/orders/${id}/mystery`).then((r) => setMystery(r.pulls || [])).catch(() => {});
  }, [id]);

  // Whether this (delivered) order has already been reviewed.
  useEffect(() => {
    if (!order || order.status !== 'completed') return;
    api.get(`/api/account/orders/${id}/review`).then((r) => setReview(r.review)).catch(() => setReview(null));
  }, [order, id]);

  const submitReview = async () => {
    if (reviewBody.trim().length < 3) { toast.error(t('acc.order.reviewTooShort', 'Please write a few words.')); return; }
    setReviewBusy(true);
    try {
      await api.post(`/api/account/orders/${id}/review`, { stars, body: reviewBody.trim() });
      toast.success(t('acc.order.reviewThanks', 'Thanks for your review!'));
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
      await api.post(`/api/account/orders/${id}/refund-request`, { reason, method: refundMethod });
      toast.success(t('acc.order.refundSubmitted', 'Refund request submitted.'));
      setRefundOpen(false); setReason('');
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="max-w-4xl">
      <Link to="/account/orders" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-5">
        <ArrowLeft size={16} /> {t('acc.order.back', 'Back to orders')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl text-white font-mono">{order.number}</h1>
          <p className="text-slate-400 text-sm">{date(order.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={order.status} />
          <a href={`${api.base}/api/account/orders/${id}/invoice`} target="_blank" rel="noreferrer"
             className="btn-ghost text-sm"><FileText size={16} /> {t('acc.order.invoice', 'Invoice')}</a>
          {order.status === 'pending' && order.pspProvider === 'mollie' && (
            <button onClick={payNow} disabled={payBusy} className="btn-primary text-sm">
              <CreditCard size={16} /> {payBusy ? t('acc.order.oneMoment', 'One moment…') : t('acc.order.payAmount', 'Pay {amount}', { amount: money(order.total, order.currency) })}
            </button>
          )}
          {(order.status === 'completed') && (
            <button onClick={() => setRefundOpen(true)} className="btn-ghost text-sm">
              <RefreshCw size={16} /> {t('acc.order.requestRefund', 'Request refund')}
            </button>
          )}
        </div>
      </div>

      {/* Mystery-box reveal */}
      {mystery.length > 0 && (
        <div className="rounded-2xl p-5 mb-6 text-white shadow-lg shadow-amber-500/20"
          style={{ backgroundImage: 'linear-gradient(120deg,#f59e0b,#f43f5e)' }}>
          <div className="flex items-center gap-2 font-bold text-lg mb-2">🎁 {mystery.length > 1 ? t('acc.order.mysteryMany', 'Your mystery boxes!') : t('acc.order.mysteryOne', 'Your mystery box!')}</div>
          <div className="space-y-1.5">
            {mystery.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 bg-white/15 rounded-lg px-3 py-2">
                <span className="font-semibold">{m.label}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {m.credit > 0 && <span className="text-sm font-bold bg-white/20 rounded-full px-2.5 py-0.5">{t('acc.order.credit', '+{amount} credit', { amount: money(m.credit) })}</span>}
                  {/* The server only rerolls a completed order that is not held or
                      refunded — the button only shows when it would work. */}
                  {m.rerolledAt ? <span className="text-[11px] text-white/70">{t('acc.order.rerolled', 'rerolled')}</span>
                    : order.status === 'completed' && !order.fraudHold ? (
                    <button onClick={() => reroll(m.id)} disabled={rerolling === m.id}
                      className="text-xs font-bold bg-white text-rose-600 rounded-full px-3 py-1 hover:bg-white/90 transition disabled:opacity-60">
                      {rerolling === m.id ? '…' : `🎲 ${t('acc.order.reroll', 'Reroll')}`}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <p className="text-white/85 text-xs mt-2.5">{t('acc.order.rerollInfo', 'Risk-free reroll: 1× per box, you keep the higher prize. Credit lands in your')} <Link to="/account/wallet" className="underline font-semibold">{t('acc.order.wallet', 'wallet')}</Link> {t('acc.order.automatically', 'automatically.')}</p>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="card p-5">
            <h3 className="text-white mb-4">{t('acc.order.items', 'Items')}</h3>
            <div className="divide-y divide-white/5">
              {order.items.map((it) => (
                <div key={it.id} className="flex justify-between py-3 text-sm">
                  <span className="text-slate-200">{it.name} × {it.quantity}</span>
                  <span className="text-white">{money(it.unit_price * it.quantity, order.currency)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-4 mt-2 border-t border-white/5">
              <span className="text-slate-400">{t('acc.order.total', 'Total')}</span>
              <span className="text-white text-lg font-semibold">{money(order.total, order.currency)}</span>
            </div>
          </div>

          {order.status === 'completed' && review !== undefined && (
            <div className="card p-5">
              <h3 className="text-white mb-1 flex items-center gap-2"><BadgeCheck size={16} className="text-emerald-400" /> {t('acc.order.verifiedReview', 'Verified review')}</h3>
              {review ? (
                <div className="mt-3">
                  <div className="flex text-amber-400 mb-1">{Array.from({ length: review.stars || 5 }).map((_, i) => <Star key={i} size={15} fill="currentColor" />)}</div>
                  <p className="text-slate-300 text-sm">"{review.body}"</p>
                  <p className="text-emerald-400/80 text-xs mt-2">{t('acc.order.reviewPublished', 'Thanks — your review is published as a verified purchase.')}</p>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-slate-400 text-sm mb-3">{t('acc.order.reviewPrompt', 'How was your order? Your review shows up with a Verified buyer badge.')}</p>
                  <div className="flex gap-1 mb-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <button key={i} type="button" onClick={() => setStars(i + 1)} aria-label={t('acc.order.starsAria', '{n} stars', { n: i + 1 })}>
                        <Star size={24} className={i < stars ? 'text-amber-400' : 'text-slate-600'} fill={i < stars ? 'currentColor' : 'none'} />
                      </button>
                    ))}
                  </div>
                  <textarea value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} rows={3} maxLength={600}
                    className="input" placeholder={t('acc.order.reviewPlaceholder', 'Tell other buyers about your experience…')} />
                  <button onClick={submitReview} disabled={reviewBusy} className="btn-primary mt-3 text-sm">
                    {reviewBusy ? t('acc.order.submitting', 'Submitting…') : t('acc.order.submitReview', 'Submit review')}
                  </button>
                </div>
              )}
            </div>
          )}

          {order.deliveries.length > 0 && (
            <div className="card p-5">
              <h3 className="text-white mb-4">{t('acc.order.deliveries', 'Digital deliveries')}</h3>
              <div className="space-y-3">
                {order.deliveries.map((d) => (
                  <div key={d.id} className="bg-space-black rounded-xl p-4 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wider text-indigo-400">{t(`acc.order.dtype.${d.type}`, d.type)}</div>
                      {reveal[d.id] ? (
                        <code className="text-emerald-300 text-sm break-all">{reveal[d.id]}</code>
                      ) : (
                        <span className="text-slate-500 text-sm">•••••••• {t('acc.order.hidden', 'hidden')}</span>
                      )}
                    </div>
                    {reveal[d.id] ? (
                      <button onClick={() => { navigator.clipboard?.writeText(reveal[d.id]); toast.success(t('acc.order.copied', 'Copied')); }}
                        className="btn-ghost text-sm"><Copy size={14} /></button>
                    ) : (
                      <button onClick={() => revealDelivery(d)} className="btn-primary text-sm">
                        <Download size={14} /> {t('acc.order.reveal', 'Reveal')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card p-5 h-fit">
          <h3 className="text-white mb-4">{t('acc.order.timeline', 'Status timeline')}</h3>
          <ol className="relative border-l border-white/10 ml-1 space-y-4">
            {order.history.map((h) => (
              <li key={h.id} className="ml-4">
                <span className="absolute -left-[6px] w-3 h-3 rounded-full bg-primary" />
                <div className="text-white text-sm">{t(`acc.status.${h.to_status}`, STATUS_META[h.to_status]?.label || h.to_status)}</div>
                <div className="text-slate-500 text-xs">{date(h.created_at)}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Modal open={refundOpen} onClose={() => setRefundOpen(false)} title={t('acc.order.refundTitle', 'Request a refund')}
        footer={<>
          <button onClick={() => setRefundOpen(false)} className="btn-ghost">{t('acc.order.cancel', 'Cancel')}</button>
          <button onClick={submitRefund} className="btn-primary">{t('acc.order.submitRequest', 'Submit request')}</button>
        </>}>
        <RefundMethodChoice value={refundMethod} onChange={setRefundMethod} />
        <p className="text-slate-400 text-sm mb-3">{t('acc.order.refundWhy', 'Tell us why you’d like a refund for {number}.', { number: order.number })}</p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4}
          className="input" placeholder={t('acc.order.reasonPlaceholder', 'Reason (optional)')} />
      </Modal>
    </div>
  );
}
