import { useEffect, useRef, useState } from 'react';
import PayFacts from '../components/store/PayFacts.jsx';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search, Loader2, ExternalLink, Copy, Check, CreditCard, Cog, PackageCheck,
  ShoppingBag, Mail, LayoutDashboard, RotateCcw, XCircle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { StatusBadge, STATUS_META } from '../components/ui.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { feedback } from '../lib/feedback.js';
import Confetti from '../components/Confetti.jsx';
import { usePageMeta } from '../lib/useMeta.js';

const METHOD_ICON = { tikkie: '🟢', revolut: '⚫', paypal: '🔵', bunq: '🟡' };
// No URL building here on purpose: the server resolves every method for this
// order, amount included. Three copies of that logic used to disagree.

// Visual progress: 4 customer-facing steps over the internal statuses.
const STEPS = [
  { id: 'placed', key: 'track.s.placed', label: 'Placed', icon: ShoppingBag, statuses: ['pending'] },
  { id: 'paid', key: 'track.s.paid', label: 'Paid', icon: CreditCard, statuses: ['payment_received'] },
  { id: 'processing', key: 'track.s.processing', label: 'Processing', icon: Cog, statuses: ['processing', 'awaiting_fulfillment'] },
  { id: 'delivered', key: 'track.s.delivered', label: 'Delivered', icon: PackageCheck, statuses: ['completed'] },
];
const TERMINAL = ['completed', 'refunded', 'cancelled', 'failed'];
const stepIndex = (status) => {
  const i = STEPS.findIndex((s) => s.statuses.includes(status));
  return status === 'completed' ? STEPS.length - 1 : i;
};

export default function Track() {
  usePageMeta('Track your order', 'Enter your order number to see its status, payment details and delivery.');
  const [params] = useSearchParams();
  const toast = useToast();
  const { t } = useI18n();
  const { user } = useAuth();
  const [number, setNumber] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState({ paymentMethods: [], paymentNote: '' });
  const prevStatus = useRef(null);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => { api.get('/api/config').then(setCfg).catch(() => {}); }, []);

  const lookup = async (num, { silent = false } = {}) => {
    if (!silent) { setBusy(true); setError(''); setResult(null); }
    try {
      const r = await api.get(`/api/track/${encodeURIComponent(num.trim())}`);
      // Celebrate the moment delivery happens while the customer is watching.
      if (prevStatus.current && prevStatus.current !== 'completed' && r.status === 'completed') {
        setCelebrate(true); feedback('success');
      }
      prevStatus.current = r.status;
      setResult(r); setError('');
    } catch (err) { if (!silent) setError(err.message); }
    finally { if (!silent) setBusy(false); }
  };

  // Auto-track when arriving with ?number= (e.g. after guest checkout).
  useEffect(() => {
    const n = params.get('number');
    if (n) { setNumber(n.toUpperCase()); lookup(n); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // LIVE: poll while the order is still in flight — the status flips to Paid /
  // Delivered on screen without the customer refreshing.
  useEffect(() => {
    if (!result || TERMINAL.includes(result.status)) return undefined;
    const t = setInterval(() => lookup(result.number, { silent: true }), 5000);
    return () => clearInterval(t);
  }, [result?.number, result?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const track = (e) => { e.preventDefault(); prevStatus.current = null; lookup(number); };
  const live = result && !TERMINAL.includes(result.status);
  const failed = result && ['refunded', 'cancelled', 'failed'].includes(result.status);
  const idx = result ? stepIndex(result.status) : -1;

  return (
    <div className="max-w-2xl mx-auto px-5 py-16">
      {celebrate && <Confetti />}
      <h1 className="text-3xl text-white mb-2">{t('track.title', 'Track your order')}</h1>
      <p className="text-slate-400 mb-8">{t('track.sub', 'Enter your order number (e.g. FM-2026-XXXXXXXX).')}</p>

      <form onSubmit={track} className="flex gap-3 mb-8">
        <input value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())}
          aria-label={t('track.number', 'Order number')} enterKeyHint="go"
          autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
          placeholder="FM-2026-XXXXXXXX" className="input font-mono" />
        <button disabled={busy || !number} aria-label={t('track.find', 'Find my order')} className="btn-primary px-6">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        </button>
      </form>

      {error && <div className="card p-4 text-red-300 border border-red-500/30">{error}</div>}

      {result && (
        <div className="card p-6 fm-pop">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-slate-400 text-sm flex items-center gap-2">
                {t('track.order', 'Order')}
                {live && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                    </span>
                    {t('track.live', 'Live — updates automatically')}
                  </span>
                )}
              </div>
              <div className="text-white text-lg font-mono">{result.number}</div>
            </div>
            <StatusBadge status={result.status} />
          </div>

          {/* Progress stepper (hidden for refund/cancel/fail — they get a banner) */}
          {!failed && (
            <div className="mb-7">
              <div className="flex items-center">
                {STEPS.map((s, i) => {
                  const done = i < idx || result.status === 'completed';
                  const current = i === idx && result.status !== 'completed';
                  const Icon = done ? Check : s.icon;
                  return (
                    <div key={s.id} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center">
                        <span className={`w-9 h-9 rounded-full grid place-items-center border-2 transition-all ${
                          done ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                            : current ? 'bg-primary/20 border-primary text-indigo-200'
                            : 'bg-white/5 border-white/15 text-slate-500'}`}>
                          {current ? <Icon size={15} className={s.id === 'processing' ? 'animate-spin [animation-duration:2.5s]' : ''} /> : <Icon size={15} />}
                        </span>
                        <span className={`mt-1.5 text-[11px] font-medium ${done ? 'text-emerald-300' : current ? 'text-white' : 'text-slate-500'}`}>{t(s.key, s.label)}</span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={`h-0.5 flex-1 mx-1.5 -mt-5 rounded-full ${i < idx || result.status === 'completed' ? 'bg-emerald-400/70' : 'bg-white/10'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Refunded / cancelled / failed banner */}
          {failed && (
            <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-5 mb-6 flex items-start gap-3">
              {result.status === 'refunded' ? <RotateCcw size={20} className="text-fuchsia-300 shrink-0 mt-0.5" /> : <XCircle size={20} className="text-red-300 shrink-0 mt-0.5" />}
              <div>
                <div className="text-white font-semibold">{t(`status.${result.status}`, STATUS_META[result.status]?.label || result.status)}</div>
                <p className="text-slate-300 text-sm mt-1">
                  {result.status === 'refunded'
                    ? t('track.refundedSub', 'This order was refunded. Any store credit used has been returned to your wallet.')
                    : t('track.closedSub', 'This order was closed. If you think this is a mistake, contact support and we’ll sort it out.')}
                </p>
                <Link to="/contact" className="text-indigo-300 text-sm hover:underline mt-1 inline-block">{t('track.contactSupport', 'Contact support →')}</Link>
              </div>
            </div>
          )}

          {/* Unfinished Mollie payment — pick it straight back up.
              A buyer who bounced off their banking app, ran out of battery or
              simply closed the tab has nowhere to go otherwise, and a new order
              would double the stock reservation. This resumes the same payment. */}
          {result.status === 'pending' && result.payUrl && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 mb-6">
              <div className="text-amber-200 font-semibold mb-3">{t('track.awaiting', '⏳ Awaiting payment')}</div>
              {/* Deliberately not the copy-the-amount-and-reference block used
                  below. Those two facts exist because a manual transfer is typed
                  by hand and can get them wrong; here the payment page already
                  knows both, and telling someone to copy a reference into their
                  banking app would be instructions for a different shop. */}
              <a href={result.payUrl} className="btn-primary w-full py-3.5 text-base justify-center">
                <ExternalLink size={18} /> {t('track.resumePay', 'Continue payment of')} {result.totalFormatted}
              </a>
              <p className="text-slate-300 text-[12.5px] mt-2">
                {t('track.resumePaySub', 'Your payment was started but not finished. Nothing has been charged yet — this takes you back to the secure payment page, and this page updates by itself the moment it goes through.')}
              </p>
            </div>
          )}

          {/* Awaiting payment: pay links + reference */}
          {result.status === 'pending' && !result.payUrl && ((result.payMethods || []).length > 0 || result.payLink) && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 mb-6">
              <div className="text-amber-200 font-semibold mb-3">{t('track.awaiting', '⏳ Awaiting payment')}</div>
              {/* Same two facts as the checkout screen, same treatment: the
                  amount was buried in a corner and could not be copied. */}
              <PayFacts amount={result.totalFormatted} reference={result.number} />
              <p className="text-slate-300 text-[12.5px] mt-2">
                {t('track.payRef2', 'We confirm every payment by hand, usually within minutes — this page updates by itself.')}
              </p>
              {/* A link the owner made with the exact amount already in it beats
                  every generic method: nothing to type, nothing to get wrong. */}
              {result.payLink && (
                <a href={result.payLink} target="_blank" rel="noreferrer"
                   className="btn-primary w-full mt-4 py-3.5 text-base justify-center">
                  <ExternalLink size={18} /> {t('track.payExact', 'Pay')} {result.totalFormatted} —{' '}
                  {t('track.payExactSub', 'amount already filled in')}
                </a>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                {result.payLink && (
                  <span className="w-full text-slate-400 text-xs mb-1">
                    {t('track.payOther', 'Or pay it yourself with the reference above:')}
                  </span>
                )}
                {(result.payMethods || []).map((m) => (
                  m.url
                    ? (
                      <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="btn-primary text-sm">
                        <ExternalLink size={15} /> {METHOD_ICON[m.id] || '💳'} {m.label}
                        {/* Telling the buyer which links already carry the amount
                            is the difference between one tap and a typo. */}
                        {m.prefilled && <span className="text-emerald-200 text-[11px]">· {t('track.filledIn', 'amount filled in')}</span>}
                      </a>
                    )
                    : <span key={m.id} className="btn-ghost text-sm cursor-default">{METHOD_ICON[m.id] || '💳'} {m.label}: {m.target}</span>
                ))}
              </div>
              <p className="text-slate-600 text-xs mt-3">
                {cfg.paymentNote
                  || t('track.payNote', 'Once we confirm your payment your order moves on by itself — this page updates live.')}
              </p>
            </div>
          )}

          {/* Held for a manual check.
              Shown INSTEAD of the reassurance below, because "payment confirmed
              — we're on it" is not true of an order nobody is preparing. What it
              does not say is which signal caught them: that would be a free
              tuning loop for whoever is trying it on. */}
          {result.onHold && !failed && (
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5 mb-6">
              <div className="text-indigo-200 font-semibold">
                🔍 {t('track.onHold', 'We’re checking this order')}
              </div>
              <p className="text-slate-300 text-sm mt-1">
                {/* Translated here rather than shown from `onHoldMessage`. The
                    server sends that sentence for clients that cannot translate
                    (the Discord bot, emails) — rendering it here would hand a
                    Dutch buyer an English one. */}
                {t('track.onHoldSub', 'This order is being checked by a person before it is delivered. Your payment is safe — if we cannot complete the order you get every cent back.')}
              </p>
              <Link to="/contact" className="text-indigo-300 text-sm hover:underline mt-2 inline-block">
                {t('track.contactSupport', 'Contact support →')}
              </Link>
            </div>
          )}

          {/* In-flight reassurance */}
          {!result.onHold && ['payment_received', 'processing', 'awaiting_fulfillment'].includes(result.status) && (
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5 mb-6">
              <div className="text-indigo-200 font-semibold">{t('track.confirmed', '✅ Payment confirmed — we’re on it')}</div>
              <p className="text-slate-300 text-sm mt-1">
                {t('track.confirmedSub', 'Your order is being prepared. Items in stock go out automatically; the rest we deliver by hand, usually within a few hours. Keep this page open — it updates by itself.')}
              </p>
            </div>
          )}

          {/* Delivered: where to find the goods */}
          {result.status === 'completed' && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 mb-6">
              <div className="text-emerald-200 font-semibold">{t('track.delivered', '🎉 Delivered!')}</div>
              <p className="text-slate-300 text-sm mt-1">
                {user
                  ? t('track.deliveredUser', 'Your code(s) were sent to your email and are available in your dashboard. Can’t find the mail? Check spam, or open your order below.')
                  : t('track.deliveredGuest', 'Your code(s) were sent to your email. Can’t find the mail? Check spam, or sign in with the same email to see your order.')}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <Link to={user ? '/account/orders' : '/login'} className="btn-primary text-sm">
                  <LayoutDashboard size={15} /> {user ? t('track.viewDash', 'View in dashboard') : t('track.signInCodes', 'Sign in to view codes')}
                </Link>
                <Link to="/contact" className="btn-ghost text-sm"><Mail size={15} /> {t('track.notArrived', 'Didn’t arrive? Contact us')}</Link>
              </div>
            </div>
          )}

          {result.status === 'completed' && <GuestReview number={result.number} t={t} />}

          {/* Only once money has actually moved. Before that there is nothing to
              give back, and offering a refund on an unpaid order is a confusing
              answer to "I changed my mind" — that one is just: don't pay. */}
          {['payment_received', 'processing', 'awaiting_fulfillment', 'completed'].includes(result.status) && (
            <GuestRefund number={result.number} t={t} />
          )}

          <Timeline history={result.history} t={t} />
        </div>
      )}
    </div>
  );
}

/**
 * Guest review: rate a delivered order right on the track page. Verified
 * server-side (order number + the email it was placed with) and deduped per
 * order, so every review is a real purchase.
 */
function GuestReview({ number, t }) {
  const toast = useToast();
  const [stars, setStars] = useState(5);
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post(`/api/track/${encodeURIComponent(number)}/review`, {
        email: email.trim(), stars, body: body.trim(),
      });
      setDone(true);
      toast.success(r.deduped
        ? t('review.already', 'This order was already reviewed — thanks!')
        : t('review.thanks', 'Thank you! Your review is live. 💜'));
      feedback('success');
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-5 mb-6 text-center">
        <div className="text-violet-200 font-semibold">💜 {t('review.thanksTitle', 'Thanks for your review!')}</div>
        <p className="text-slate-400 text-sm mt-1">{t('review.thanksSub', 'It now appears on our reviews page and helps other buyers.')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-6">
      <div className="text-white font-semibold">{t('review.title', 'How was your order?')}</div>
      <p className="text-slate-500 text-xs mt-0.5">{t('review.sub', 'Leave a verified review — takes 20 seconds.')}</p>
      <div className="flex gap-1.5 mt-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setStars(n)} aria-label={`${n} stars`}
            className={`text-2xl transition-transform hover:scale-110 ${n <= stars ? 'grayscale-0' : 'grayscale opacity-40'}`}>⭐</button>
        ))}
      </div>
      <textarea required minLength={3} maxLength={600} rows={2} value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('review.placeholder', 'Fast delivery? Good price? Tell other buyers…')}
        className="input mt-3 text-sm" />
      <div className="flex flex-col sm:flex-row gap-2 mt-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder={t('review.email', 'Email used for this order (verification)')}
          className="input text-sm flex-1" />
        <button disabled={busy || body.trim().length < 3} className="btn-primary text-sm px-5">
          {busy ? '…' : t('review.submit', 'Post review')}
        </button>
      </div>
    </form>
  );
}

/**
 * Request a refund with just the order number and the email it was placed with.
 *
 * The refund policy promises exactly this: "Open your order page and request a
 * refund there. You only need your order number, no account." Guest checkout is
 * the default here, so without this the promise held for logged-in buyers only
 * — everyone else was pointed at an email address and told to wait.
 *
 * Collapsed by default. It is a real option, not a suggestion, and a refund form
 * sitting open under a delivered order reads as an invitation to use it.
 */
function GuestRefund({ number, t }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post(`/api/track/${encodeURIComponent(number)}/refund-request`, {
        email: email.trim(), reason: reason.trim() || undefined,
      });
      if (r.notPaid) {
        toast.error(t('refundReq.notPaid', 'This order has not been paid, so there is nothing to refund.'));
      } else if (r.alreadyClosed) {
        toast.error(t('refundReq.closed', 'This order is already closed.'));
      } else {
        // Pressing it twice is what someone does when they are not sure it
        // worked. Both answers are a success — the request exists either way.
        setDone(r.alreadyRequested ? 'already' : 'new');
        feedback('success');
      }
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 mb-6">
        <div className="text-emerald-200 font-semibold">
          {done === 'already'
            ? t('refundReq.dupTitle', '✅ We already have your request')
            : t('refundReq.doneTitle', '✅ Refund request received')}
        </div>
        <p className="text-slate-300 text-sm mt-1">
          {t('refundReq.doneSub', 'A person reviews every request. You get an answer by email — usually within a few hours during the day, and within 14 days at the latest.')}
        </p>
        <Link to="/refunds" className="text-indigo-300 text-sm hover:underline mt-2 inline-block">
          {t('refundReq.readPolicy', 'Read the refund policy →')}
        </Link>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mb-6 text-center">
        <button type="button" onClick={() => setOpen(true)}
          className="text-slate-400 text-sm hover:text-slate-200 hover:underline">
          {t('refundReq.open', 'Something wrong? Request a refund')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/5 p-5 mb-6">
      <div className="text-white font-semibold">{t('refundReq.title', 'Request a refund')}</div>
      <p className="text-slate-400 text-xs mt-0.5">
        {t('refundReq.sub', 'No account needed. Confirm the email you ordered with, and tell us briefly what went wrong.')}
      </p>
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder={t('refundReq.email', 'Email used for this order')}
        className="input mt-3 text-sm" />
      <textarea rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder={t('refundReq.reason', 'What went wrong? (optional, but it speeds things up)')}
        className="input mt-2 text-sm" />
      <div className="flex flex-wrap gap-2 mt-3">
        <button disabled={busy || !email.trim()} className="btn-primary text-sm px-5">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
          {t('refundReq.submit', 'Send request')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost text-sm">
          {t('refundReq.cancel', 'Cancel')}
        </button>
      </div>
      <p className="text-slate-600 text-xs mt-3">
        {t('refundReq.legal', 'Sending this does not cancel your order by itself — we review it first. See the refund policy for when a digital code can still be returned.')}
      </p>
    </form>
  );
}

function Timeline({ history, t }) {
  return (
    <ol className="relative border-l border-white/10 ml-2 space-y-5">
      {history.map((h, i) => (
        <li key={i} className="ml-5">
          <span className={`absolute -left-[7px] w-3.5 h-3.5 rounded-full ${i === history.length - 1 ? 'bg-primary' : 'bg-white/20'}`} />
          <div className="text-white text-sm">{t(`status.${h.to}`, STATUS_META[h.to]?.label || h.to)}</div>
          <div className="text-slate-500 text-xs">{new Date(h.at).toLocaleString()}</div>
        </li>
      ))}
    </ol>
  );
}
