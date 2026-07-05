import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck, Loader2, ShoppingBag, ExternalLink, Copy, CheckCircle2, Wallet } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../lib/i18n.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { money } from '../lib/catalog.js';
import { EmptyState } from '../components/ui.jsx';

const METHOD_ICON = { tikkie: '🟢', revolut: '⚫', paypal: '🔵' };

// Build the best pay link/instruction for a manual method.
function payTarget(m, amountEur) {
  let t = m.target || '';
  if (m.kind === 'email') return { href: null, label: `Send €${amountEur} to ${t} (Friends & Family)` };
  if (!/^https?:\/\//.test(t)) t = `https://${t}`;
  if (m.id === 'paypal' && /paypal\.me/i.test(t)) t = `${t.replace(/\/$/, '')}/${amountEur}EUR`;
  return { href: t, label: t.replace(/^https?:\/\//, '') };
}

export default function Checkout() {
  const { items, subtotal, currency, clear } = useCart();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('none');     // stripe | demo | manual | none
  const [methods, setMethods] = useState([]);
  const [note, setNote] = useState('');
  const [methodId, setMethodId] = useState('');
  const [placed, setPlaced] = useState(null);           // created order (manual flow)
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState(null);           // { code, kind, percent, value, label }
  const [creditBalance, setCreditBalance] = useState(0); // store credit (cents)
  const [useCredit, setUseCredit] = useState(false);
  const [bundles, setBundles] = useState([]);

  // Best matching bundle: all of its products are in the cart.
  const inCart = new Set(items.map((i) => i.id));
  const itemTotal = (id) => items.filter((i) => i.id === id).reduce((s, i) => s + i.price * i.qty, 0);
  const matchedBundle = bundles
    .filter((b) => b.products?.every((p) => inCart.has(p.id)))
    .map((b) => ({ name: b.name, percent: b.discountPercent, discount: Math.round(b.products.reduce((s, p) => s + itemTotal(p.id), 0) * b.discountPercent / 100) }))
    .sort((a, b) => b.discount - a.discount)[0] || null;
  const bundleDiscount = matchedBundle?.discount || 0;

  const couponDiscount = coupon
    ? (coupon.percent ? Math.round(subtotal * coupon.percent / 100) : Math.min(subtotal, coupon.value || 0))
    : 0;
  const discount = Math.min(subtotal, couponDiscount + bundleDiscount);
  const afterDiscount = Math.max(0, subtotal - discount);
  const creditToApply = useCredit ? Math.min(creditBalance, afterDiscount) : 0;
  const grandTotal = Math.max(0, afterDiscount - creditToApply);

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    try {
      const c = await api.get(`/api/coupons/${encodeURIComponent(code)}?subtotal=${subtotal}`);
      setCoupon(c); toast.success(`Code applied — ${c.label || 'discount'}!`);
    } catch (e) { setCoupon(null); toast.error(e.message || 'Invalid or expired code'); }
  };

  useEffect(() => { if (user?.email) setEmail(user.email); }, [user]);
  useEffect(() => {
    if (!user) { setCreditBalance(0); return; }
    api.get('/api/account/wallet').then((w) => setCreditBalance(w.balance || 0)).catch(() => {});
  }, [user]);
  useEffect(() => { api.get('/api/bundles').then((r) => setBundles(r.bundles || [])).catch(() => {}); }, []);
  useEffect(() => {
    api.get('/api/config').then((c) => {
      setProvider(c.paymentProvider);
      setMethods(c.paymentMethods || []);
      setNote(c.paymentNote || '');
      if ((c.paymentMethods || []).length) setMethodId(c.paymentMethods[0].id);
    }).catch(() => {});
  }, []);

  const amountEur = (grandTotal / 100).toFixed(2);

  if (items.length === 0 && !placed) {
    return (
      <div className="section py-16">
        <h1 className="text-3xl text-white mb-8">{t('checkout.title', 'Checkout')}</h1>
        <EmptyState icon={ShoppingBag} title={t('checkout.empty', 'Nothing to check out')}
          action={<Link to="/shop" className="btn-primary">{t('cart.browse', 'Browse shop')}</Link>} />
      </div>
    );
  }

  const placeOrder = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { order } = await api.post('/api/orders', {
        email,
        items: items.map((i) => ({ productId: i.id, quantity: i.qty })),
        billing: { full_name: fullName, city, email },
        currency,
        coupon: coupon?.code,
        useCredit: creditToApply || undefined,
        paymentMethod: methodId || undefined,
      });

      if (provider === 'stripe') {
        const { url } = await api.post(`/api/orders/${order.id}/checkout`, { email });
        clear(); window.location.href = url; return;
      }
      if (provider === 'demo') {
        await api.post(`/api/orders/${order.id}/pay`, { email }).catch(() => {});
        clear(); toast.success(`${t('checkout.orderWord', 'Order')} ${order.number} ${t('checkout.placed', 'placed!')}`);
        navigate(user ? `/account/orders/${order.id}` : `/track?number=${order.number}`);
        return;
      }
      if (provider === 'manual') {
        clear(); setPlaced(order);   // show pay instructions
        return;
      }
      clear(); toast.success(`${t('checkout.orderWord', 'Order')} ${order.number} ${t('checkout.placed', 'placed!')}`);
      navigate(user ? `/account/orders/${order.id}` : `/track?number=${order.number}`);
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  // ── Manual payment instructions (after order placed) ──
  if (placed) {
    const m = methods.find((x) => x.id === methodId) || methods[0];
    const pt = m ? payTarget(m, amountEur) : null;
    return (
      <div className="section py-12 max-w-xl">
        <div className="card p-8 text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4 bg-amber-500/15 border border-amber-500/30 text-2xl">⏳</div>
          <h1 className="text-2xl text-white">{t('checkout.almostThere', 'Almost there — complete your payment')}</h1>
          <p className="text-slate-400 mt-2">{t('checkout.orderWord', 'Order')} <span className="font-mono text-white">{placed.number}</span> {t('checkout.reserved', 'is reserved. Pay the amount below and we’ll confirm it (usually within minutes).')}</p>

          <div className="glass rounded-2xl p-5 mt-6 text-left">
            <div className="flex items-center justify-between"><span className="text-slate-400 text-sm">{t('checkout.amount', 'Amount')}</span><span className="text-2xl text-white font-semibold">€{amountEur}</span></div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-slate-400 text-sm">{t('checkout.reference', 'Reference (put in the note)')}</span>
              <button onClick={() => { navigator.clipboard?.writeText(placed.number); toast.success(t('track.copied', 'Reference copied')); }}
                className="inline-flex items-center gap-1.5 text-white font-mono text-sm"><Copy size={13} /> {placed.number}</button>
            </div>
          </div>

          {methods.length > 1 && (
            <div className="flex gap-2 justify-center mt-5">
              {methods.map((x) => (
                <button key={x.id} onClick={() => setMethodId(x.id)}
                  className={`chip ${methodId === x.id ? 'chip-active' : ''}`}>{METHOD_ICON[x.id] || '💳'} {x.label}</button>
              ))}
            </div>
          )}

          {pt && (
            <div className="mt-5">
              {pt.href
                ? <a href={pt.href} target="_blank" rel="noreferrer" className="btn-primary w-full py-3.5 text-base"><ExternalLink size={18} /> {t('checkout.payWith', 'Pay')} €{amountEur} {t('checkout.with', 'with')} {m.label}</a>
                : <div className="glass rounded-xl p-4 text-white">{pt.label}</div>}
              <p className="text-slate-500 text-xs mt-3">{note || t('checkout.noteDefault', 'After paying, your order is confirmed within minutes during open hours.')}</p>
            </div>
          )}

          <PaymentProofForm orderId={placed.id} email={email} method={methodId} />

          <div className="flex gap-3 mt-5">
            <Link to={user ? `/account/orders/${placed.id}` : `/track?number=${placed.number}`} className="btn-ghost flex-1 py-3"><CheckCircle2 size={18} /> {t('footer.track', 'Track order')}</Link>
            <Link to="/shop" className="btn-ghost flex-1 py-3">{t('checkout.keepShopping', 'Keep shopping')}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section py-12">
      <h1 className="text-3xl text-white mb-6">{t('checkout.title', 'Checkout')}</h1>

      {/* Progress indicator */}
      <CheckoutSteps current={1} />

      <form onSubmit={placeOrder} className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h3 className="text-white mb-5">{t('checkout.contact', 'Contact & billing')}</h3>
            <div className="space-y-4">
              <div>
                <label className="label">{t('checkout.email', 'Email (delivery + receipt)')}</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="input" placeholder="you@example.com" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('checkout.name', 'Full name')}</label>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="input" placeholder={t('checkout.optional', 'Optional')} />
                </div>
                <div>
                  <label className="label">{t('checkout.city', 'City')}</label>
                  <input value={city} onChange={(e) => setCity(e.target.value)} className="input" placeholder={t('checkout.optional', 'Optional')} />
                </div>
              </div>
            </div>
            {!user && (
              <p className="text-slate-500 text-sm mt-4">
                {t('checkout.tip', 'Tip:')} <Link to="/login" className="text-indigo-400">{t('checkout.tipSignIn', 'sign in')}</Link> {t('checkout.tipRest', 'to see this order in your dashboard.')}
              </p>
            )}
          </div>

          <div className="card p-6">
            <h3 className="text-white mb-3 flex items-center gap-2"><Lock size={16} className="text-indigo-300" /> {t('checkout.method', 'Payment method')}</h3>
            {provider === 'manual' ? (
              <>
                <div className="grid sm:grid-cols-3 gap-3">
                  {methods.map((m) => (
                    <button type="button" key={m.id} onClick={() => setMethodId(m.id)}
                      className={`rounded-xl border p-4 text-left transition ${methodId === m.id ? 'border-primary bg-primary/10' : 'border-white/10 hover:border-white/25'}`}>
                      <div className="text-2xl">{METHOD_ICON[m.id] || '💳'}</div>
                      <div className="text-white font-medium mt-1">{m.label}</div>
                      <div className="text-slate-500 text-xs">{t('checkout.payByLink', 'Pay by link')}</div>
                    </button>
                  ))}
                </div>
                <p className="text-slate-400 text-sm mt-4">{t('checkout.manual1', 'Place your order, then pay')} €{amountEur} {t('checkout.manual2', 'via')} {methods.find((x) => x.id === methodId)?.label || t('checkout.chosenMethod', 'your chosen method')} {t('checkout.manual3', 'using your order number as reference. We confirm it manually.')}</p>
              </>
            ) : (
              <p className="text-slate-400 text-sm">
                {provider === 'stripe'
                  ? <>{t('checkout.stripe1', 'You’ll be redirected to')} <span className="text-white">Stripe</span> {t('checkout.stripe2', 'to pay securely by card.')}</>
                  : provider === 'demo'
                    ? <>{t('checkout.demo1', 'Demo mode: your order is marked')} <span className="text-emerald-300">{t('checkout.demoPaid', 'paid')}</span> {t('checkout.demo2', 'instantly.')}</>
                    : <>{t('checkout.noPay1', 'Payment isn’t configured yet — your order will be placed as')} <span className="text-white">{t('status.pending', 'pending')}</span>.</>}
              </p>
            )}
          </div>
        </div>

        <div style={{ viewTransitionName: 'order-summary' }} className="card p-6 h-fit">
          <h3 className="text-white mb-5">{t('checkout.summary', 'Summary')}</h3>
          <div className="space-y-2.5 mb-4">
            {items.map((i) => (
              <div key={i.id} className="flex justify-between text-sm">
                <span className="text-slate-300 truncate pr-2">{i.qty}× {i.name}</span>
                <span className="text-white shrink-0">{money(i.price * i.qty, i.currency)}</span>
              </div>
            ))}
          </div>
          {/* Coupon */}
          <div className="flex gap-2 mb-4">
            <input value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
              placeholder={t('checkout.couponPh', 'Discount code')} className="input py-2 text-sm" />
            <button type="button" onClick={applyCoupon} className="btn-ghost px-4 text-sm">{t('checkout.apply', 'Apply')}</button>
          </div>
          {/* Store credit */}
          {creditBalance > 0 && (
            <label className="flex items-center justify-between gap-2 mb-4 cursor-pointer rounded-xl bg-space-black border border-white/10 px-3.5 py-3">
              <span className="flex items-center gap-2 text-sm text-slate-200">
                <Wallet size={15} className="text-indigo-300" /> {t('checkout.useCredit', 'Use store credit')}
                <span className="text-slate-500 text-xs">({money(creditBalance, currency)} {t('checkout.available', 'available')})</span>
              </span>
              <button type="button" onClick={() => setUseCredit((v) => !v)}
                className={`w-11 h-6 rounded-full transition relative shrink-0 ${useCredit ? 'bg-primary' : 'bg-white/10'}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${useCredit ? 'left-5' : 'left-0.5'}`} />
              </button>
            </label>
          )}
          <div className="border-t border-white/5 pt-4 mb-6 space-y-1.5">
            <div className="flex justify-between text-sm text-slate-400"><span>{t('cart.subtotal', 'Subtotal')}</span><span>{money(subtotal, currency)}</span></div>
            {matchedBundle && <div className="flex justify-between text-sm text-amber-300"><span>Bundle ({matchedBundle.name} · {matchedBundle.percent}%)</span><span>−{money(bundleDiscount, currency)}</span></div>}
            {coupon && <div className="flex justify-between text-sm text-emerald-300"><span>{t('checkout.coupon', 'Coupon')} ({coupon.code}{coupon.percent ? ` · ${coupon.percent}%` : ''})</span><span>−{money(couponDiscount, currency)}</span></div>}
            {creditToApply > 0 && <div className="flex justify-between text-sm text-indigo-300"><span>{t('checkout.credit', 'Store credit')}</span><span>−{money(creditToApply, currency)}</span></div>}
            <div className="flex justify-between text-lg pt-1"><span className="text-slate-300">{t('cart.total', 'Total')}</span><span className="text-white font-semibold">{money(grandTotal, currency)}</span></div>
          </div>
          <button disabled={busy} className="btn-primary w-full py-3">
            {busy ? <Loader2 size={18} className="animate-spin" />
              : provider === 'stripe' ? <>{t('checkout.payCard', 'Pay with card')}</>
              : provider === 'manual' ? <>{t('checkout.placePay', 'Place order & pay')}</>
              : <>{t('checkout.placeOrder', 'Place order')}</>}
          </button>
          {/* Purchase protection */}
          <div className="mt-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
            <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium"><ShieldCheck size={15} /> {t('checkout.protection', 'Buyer protection')}</div>
            <ul className="mt-1.5 space-y-1 text-xs text-slate-400">
              <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-400 shrink-0" /> {t('checkout.p1', 'Money-back guarantee if undelivered')}</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-400 shrink-0" /> {t('checkout.p2', 'Instant, automated delivery')}</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-400 shrink-0" /> {t('checkout.p3', 'Fraud-screened & encrypted checkout')}</li>
            </ul>
          </div>
        </div>
      </form>
    </div>
  );
}

/** After paying via Tikkie/Revolut/PayPal, the customer submits proof which
 *  lands in the admin verification queue. */
function PaymentProofForm({ orderId, email, method }) {
  const { t } = useI18n();
  const [txn, setTxn] = useState('');
  const [shot, setShot] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!txn.trim() && !shot.trim()) { setErr(t('proof.needOne', 'Add a transaction ID or a screenshot link.')); return; }
    setBusy(true);
    try {
      await api.post(`/api/orders/${orderId}/proof`, {
        method, email, transactionId: txn.trim() || undefined, screenshotUrl: shot.trim() || undefined,
      });
      setDone(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="glass rounded-2xl p-5 mt-6 text-left border border-emerald-500/30">
        <div className="flex items-center gap-2 text-emerald-300 font-medium"><CheckCircle2 size={18} /> {t('proof.submitted', 'Payment submitted')}</div>
        <p className="text-slate-300 text-sm mt-1">{t('proof.submittedSub', 'Your payment is in our verification queue. We’ll confirm it (usually within minutes) and your order moves to delivery automatically.')}</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-5 mt-6 text-left">
      <h3 className="text-white font-medium mb-1">{t('proof.title', 'Already paid? Confirm it')}</h3>
      <p className="text-slate-400 text-sm mb-3">{t('proof.sub', 'Paste your payment reference / transaction ID (and optionally a screenshot link). This speeds up verification a lot.')}</p>
      <div className="space-y-2.5">
        <input value={txn} onChange={(e) => setTxn(e.target.value)} className="input" placeholder={t('proof.txnPh', 'Transaction ID / payment reference')} />
        <input value={shot} onChange={(e) => setShot(e.target.value)} className="input" placeholder={t('proof.shotPh', 'Screenshot link (optional) — e.g. imgur / drive')} />
        {err && <p className="text-red-300 text-xs">{err}</p>}
        <button onClick={submit} disabled={busy} className="btn-primary w-full py-3">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <>{t('proof.submit', 'I’ve paid — submit for verification')}</>}
        </button>
      </div>
    </div>
  );
}

/** Cart → Details → Payment → Done progress indicator. */
function CheckoutSteps({ current = 1 }) {
  const { t } = useI18n();
  const steps = [t('steps.cart', 'Cart'), t('steps.details', 'Details'), t('steps.payment', 'Payment'), t('steps.done', 'Done')];
  return (
    <div className="flex items-center mb-8 max-w-2xl">
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <div key={s} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <span className={`w-7 h-7 rounded-full grid place-items-center text-xs font-semibold shrink-0 ${
                done ? 'bg-emerald-500 text-white' : active ? 'bg-primary text-white' : 'bg-white/10 text-slate-400'}`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={`text-sm ${active ? 'text-white font-medium' : done ? 'text-slate-300' : 'text-slate-500'}`}>{s}</span>
            </div>
            {i < steps.length - 1 && <div className={`flex-1 h-px mx-3 ${done ? 'bg-emerald-500/50' : 'bg-white/10'}`} />}
          </div>
        );
      })}
    </div>
  );
}
