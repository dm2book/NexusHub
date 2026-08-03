import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LayoutDashboard, Search, Loader2, AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useCart } from '../context/CartContext.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import Confetti from '../components/Confetti.jsx';
import { feedback } from '../lib/feedback.js';

/** Order statuses that mean the money genuinely arrived. */
const SETTLED = ['payment_received', 'processing', 'awaiting_fulfillment', 'completed'];

export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const { clear } = useCart();
  const { user } = useAuth();
  const { t } = useI18n();
  const orderId = params.get('order');
  const number = params.get('n');

  // 'checking' until the order itself says otherwise. This page used to open
  // with "Payment received 🎉" for anyone who reached the URL — including a
  // buyer who cancelled at the bank. A redirect proves nothing; the order does.
  const [state, setState] = useState(orderId ? 'checking' : 'unknown');

  useEffect(() => { clear(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!orderId) return;
    let alive = true;
    let tries = 0;
    let timer = null;

    // iDEAL out of a banking app regularly confirms a second or two after the
    // browser is already back, so a single check would show "confirming" to
    // someone who has in fact paid. Ask a few times, widening the gap, then stop
    // and point at the status page — which the webhook updates by itself.
    const tick = async () => {
      tries += 1;
      try {
        const r = await api.post(`/api/orders/${encodeURIComponent(orderId)}/mollie/sync`,
          { number: number || undefined });
        if (!alive) return;
        if (SETTLED.includes(r.status)) { setState('paid'); feedback('success'); return; }
        if (['cancelled', 'failed'].includes(r.status)) { setState('failed'); return; }
      } catch {
        // Not a Mollie order, not ours to read, or the API is unhappy. Either
        // way this page must not assert something it cannot see.
        if (alive) setState('unknown');
        return;
      }
      if (tries >= 5) { setState('slow'); return; }
      timer = setTimeout(tick, tries * 1200);
    };
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [orderId, number]);

  const orderRef = number ? <> <span className="font-mono text-white">{number}</span></> : '';

  const head = {
    checking: {
      icon: <Loader2 size={40} className="animate-spin text-indigo-300" />,
      ring: 'bg-indigo-500/15 border-indigo-500/30',
      orb: 'bg-indigo-500/15',
      title: t('success.checking', 'Confirming your payment…'),
      body: <>{t('success.checkingBody', 'Your order')}{orderRef} {t('success.checkingBody2', 'is placed. We’re waiting for your bank to confirm — that normally takes a few seconds.')}</>,
    },
    paid: {
      icon: null,
      ring: 'bg-emerald-500/15 border-emerald-500/30',
      orb: 'bg-emerald-500/15',
      title: t('success.title', 'Payment received 🎉'),
      body: <>{t('success.thanks', 'Thanks! Your order')}{orderRef} {t('success.body', 'is confirmed and now being prepared. Digital deliveries appear automatically once fulfilled.')}</>,
    },
    slow: {
      icon: <Loader2 size={40} className="animate-spin text-indigo-300" />,
      ring: 'bg-indigo-500/15 border-indigo-500/30',
      orb: 'bg-indigo-500/15',
      title: t('success.slow', 'Still confirming your payment'),
      body: <>{t('success.slowBody', 'Your order')}{orderRef} {t('success.slowBody2', 'is placed and your payment is still being confirmed. The status page below updates by itself — you can safely close this tab, we’ll email you the moment it comes through.')}</>,
    },
    failed: {
      icon: <AlertCircle size={40} className="text-amber-300" />,
      ring: 'bg-amber-500/15 border-amber-500/30',
      orb: 'bg-amber-500/15',
      title: t('success.notPaid', 'Payment not completed'),
      body: <>{t('success.notPaidBody', 'Your order')}{orderRef} {t('success.notPaidBody2', 'was not paid, so you have not been charged. You can start the payment again from your order page, or pick another method.')}</>,
    },
    unknown: {
      icon: <CheckCircle2 size={40} className="text-emerald-300" />,
      ring: 'bg-emerald-500/15 border-emerald-500/30',
      orb: 'bg-emerald-500/15',
      title: t('success.placed', 'Order placed'),
      body: <>{t('success.placedBody', 'Your order')}{orderRef} {t('success.placedBody2', 'is placed. Track it below — the status updates as soon as your payment is confirmed.')}</>,
    },
  }[state];

  return (
    <div className="section py-28 text-center relative overflow-hidden">
      {state === 'paid' && <Confetti />}
      <div className={`orb w-96 h-96 -top-20 left-1/3 ${head.orb}`} />
      <div className="relative max-w-lg mx-auto">
        <div className={`fm-pop w-20 h-20 rounded-3xl mx-auto flex items-center justify-center mb-6 border ${head.ring}`}
          style={{ viewTransitionName: 'order-summary' }}>
          {head.icon || (
            /* Checkmark draws itself in — a small moment of delight on the happiest page. */
            <svg className="fm-check-draw" width="44" height="44" viewBox="0 0 64 64" fill="none" aria-hidden>
              <circle cx="32" cy="32" r="29" stroke="#34d399" strokeWidth="4" strokeLinecap="round" />
              <path d="M20 33 L29 42 L45 24" stroke="#34d399" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <h1 className="text-3xl text-white" aria-live="polite">{head.title}</h1>
        <p className="text-slate-400 mt-3">{head.body}</p>

        <div className="mt-6 mx-auto max-w-sm rounded-2xl border border-indigo-500/25 bg-indigo-500/10 p-4 text-left">
          <div className="text-white text-sm font-semibold">💬 {t('success.discord', 'ForgeMarket Support')}</div>
          <p className="text-slate-400 text-[13px] mt-1">
            {/* Right after paying is exactly when someone wants to know where to
                reach a human if something goes wrong — lead with that, not with
                giveaways. */}
            {t('success.discordSub', 'Questions about this order? Reach us on Discord — plus restock alerts, deals and giveaways.')}
          </p>
          <Link to="/discord" className="inline-flex items-center gap-1.5 mt-2.5 text-sm font-semibold text-white rounded-lg px-3.5 py-2"
            style={{ background: '#5865F2' }}>{t('success.join', 'Join ForgeMarket Support →')}</Link>
        </div>
        <div className="flex justify-center gap-3 mt-8">
          {user && orderId
            ? <Link to={`/account/orders/${orderId}`} className="btn-primary"><LayoutDashboard size={18} /> {t('success.viewOrder', 'View order')}</Link>
            : number
              ? <Link to={`/track?number=${encodeURIComponent(number)}`} className="btn-primary"><Search size={18} /> {t('footer.track', 'Track order')}</Link>
              : <Link to="/shop" className="btn-primary">{t('cart.continue', 'Continue shopping')}</Link>}
          <Link to="/shop" className="btn-ghost">{t('checkout.keepShopping', 'Keep shopping')}</Link>
        </div>
      </div>
    </div>
  );
}
