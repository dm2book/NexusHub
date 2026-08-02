import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck, Loader2, ShoppingBag, ExternalLink, Copy, CheckCircle2, Wallet } from 'lucide-react';
import { api } from '../lib/api.js';
import { fileToDataUrl } from '../lib/imageUpload.js';
import { useI18n } from '../lib/i18n.jsx';
import { useCart } from '../context/CartContext.jsx';
import PayFacts from '../components/store/PayFacts.jsx';
import MollieMethods from '../components/store/MollieMethods.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { money } from '../lib/catalog.js';
import { EmptyState } from '../components/ui.jsx';
import { usePageMeta } from '../lib/useMeta.js';
import { matchBundle } from '../lib/bundles.js';
import { useStickyBarLift } from '../lib/useStickyBarLift.js';
import { rememberOrder, recallOrder, forgetOrder } from '../lib/lastOrder.js';

const METHOD_ICON = { tikkie: '🟢', revolut: '⚫', paypal: '🔵' };

// No URL building here: the created order carries every method already resolved
// for its own total, so the checkout and the status page can never disagree.

export default function Checkout() {
  usePageMeta('Checkout', 'Complete your order — guest checkout, no account needed.');
  useStickyBarLift(); // keep the chat bubble off the sticky pay bar
  const { t, lang } = useI18n();
  const { items, subtotal, currency, clear } = useCart();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  // EU distance-selling: digital goods keep a 14-day withdrawal right unless the
  // buyer explicitly asks for immediate delivery and acknowledges losing it.
  // Without this every code sold is refundable on demand.
  const [consent, setConsent] = useState(false);
  // Resolved once so the sentence stored against the order is byte-for-byte the
  // one this buyer actually read — including which language they read it in.
  const consentSentence = t('checkout.consent',
    'I want my order delivered immediately and I understand I lose my 14-day right of withdrawal once it has been delivered.');
  // A disabled button that does nothing when tapped reads as a broken shop.
  const jumpToConsent = () => {
    const el = document.getElementById('fm-consent');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.querySelector('input')?.focus({ preventScroll: true });
  };
  const [provider, setProvider] = useState('none');     // mollie | stripe | demo | manual | none
  const [methods, setMethods] = useState([]);
  const [mollieOffered, setMollieOffered] = useState([]); // ['ideal','bancontact',…]
  const [mollieMethod, setMollieMethod] = useState('');   // '' = choose on Mollie's page
  const [note, setNote] = useState('');
  const [methodId, setMethodId] = useState('');
  // Restored from the cache before first paint, so returning from a banking app
  // shows the reference immediately rather than flashing an empty checkout.
  const [placed, setPlaced] = useState(() => recallOrder(
    new URLSearchParams(window.location.search).get('order')));
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState(null);           // { code, kind, percent, value, label }
  const [creditBalance, setCreditBalance] = useState(0); // store credit (cents)
  const [useCredit, setUseCredit] = useState(false);
  const [bundles, setBundles] = useState([]);
  const [deliveryFields, setDeliveryFields] = useState({});   // productId → label (e.g. "Roblox username")
  const [deliveryChoices, setDeliveryChoices] = useState({}); // productId → offers a code/account choice
  const [deliveryDetail, setDeliveryDetail] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('code'); // 'code' | 'account' (buyer's pick)

  // Same rule as the cart, from one place — they used to disagree.
  const matchedBundle = matchBundle(items, bundles);
  const bundleDiscount = matchedBundle?.discount || 0;

  const couponDiscount = coupon
    ? (coupon.percent ? Math.round(subtotal * coupon.percent / 100) : Math.min(subtotal, coupon.value || 0))
    : 0;
  /* Forge+ takes a standing percentage off every order server-side. Leaving it
     out here meant the summary quoted more than the buyer was charged. */
  const memberPercent = user?.memberPercent || 0;
  const memberDiscount = memberPercent ? Math.round(subtotal * memberPercent / 100) : 0;
  const discount = Math.min(subtotal, couponDiscount + memberDiscount + bundleDiscount);
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

  // A shared or bookmarked pay link must work on a device that has never seen
  // this order. The number alone is enough: /api/track is the same public
  // lookup the order email points at.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('order');
    if (!wanted || placed) return;
    let alive = true;
    api.get(`/api/track/${encodeURIComponent(wanted)}`)
      // The track endpoint answers flat, and only a still-unpaid order should
      // reopen a pay screen — one on a delivered order invites paying twice.
      .then((o) => { if (alive && o?.status === 'pending') setPlaced(o); })
      .catch(() => { /* unknown or settled — fall through to the normal checkout */ });
    return () => { alive = false; };
  }, [placed]);

  useEffect(() => { if (user?.email) setEmail(user.email); }, [user]);
  useEffect(() => {
    if (!user) { setCreditBalance(0); return; }
    api.get('/api/account/wallet').then((w) => setCreditBalance(w.balance || 0)).catch(() => {});
  }, [user]);
  useEffect(() => { api.get('/api/bundles').then((r) => setBundles(r.bundles || [])).catch(() => {}); }, []);
  useEffect(() => {
    api.get('/api/products').then((r) => {
      const m = {}, choices = {};
      (r.products || []).forEach((p) => {
        if (p.deliveryField) m[p.id] = p.deliveryField;
        if (p.deliveryChoice) choices[p.id] = true;
      });
      setDeliveryFields(m); setDeliveryChoices(choices);
    }).catch(() => {});
  }, []);

  // Delivery target labels for cart items (e.g. a Robux top-up asks for the
  // buyer's Roblox username).
  const deliveryLabels = [...new Set(items.map((i) => deliveryFields[i.id]).filter(Boolean))];
  // A product offers a CHOICE (code vs account) or REQUIRES account delivery.
  const offersChoice = items.some((i) => deliveryChoices[i.id]);
  const requiresAccount = items.some((i) => deliveryFields[i.id] && !deliveryChoices[i.id]);
  // Effective method: forced to account for pure top-up products, otherwise the
  // buyer's pick (defaults to a gift code).
  const method = requiresAccount ? 'account' : (offersChoice ? deliveryMethod : 'code');
  const needsTarget = method === 'account' && deliveryLabels.length > 0;
  useEffect(() => {
    api.get('/api/config').then((c) => {
      setProvider(c.paymentProvider);
      setMethods(c.paymentMethods || []);
      setNote(c.paymentNote || '');
      setMollieOffered(c.mollieMethods || []);
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
        billing: { full_name: fullName, city, email,
          deliveryMethod: method,
          ...(needsTarget ? { deliveryDetails: deliveryDetail, deliveryLabel: deliveryLabels.join(' / ') } : {}) },
        currency,
        coupon: coupon?.code,
        useCredit: creditToApply || undefined,
        paymentMethod: methodId || undefined,
        // Sent, not just checked in the browser: the server records it against
        // the order, which is what a chargeback dispute actually needs. The
        // sentence travels with it because the wording is what was agreed to.
        consent: true,
        consentText: consentSentence,
      });

      if (provider === 'mollie') {
        // The payment is created BEFORE the cart is cleared: if Mollie refuses,
        // the buyer still has their cart and can try again instead of staring at
        // an empty checkout after a failure that was not theirs.
        const r = await api.post(`/api/orders/${order.id}/mollie`, {
          email, method: mollieMethod || undefined, locale: lang === 'en' ? 'en' : 'nl',
        });
        if (r.checkoutUrl) {
          // Cached first: iOS discards a backgrounded tab, and coming back from a
          // banking app must not land on "Nothing to check out".
          rememberOrder(order);
          clear();
          window.location.href = r.checkoutUrl;
          return;
        }
        // No URL means the order was already settled — send them to the status
        // page rather than opening a second payment.
        clear();
        navigate(user ? `/account/orders/${order.id}` : `/track?number=${order.number}`);
        return;
      }
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
        // The pay screen used to live only in component state, so it survived
        // nothing: measured on a phone, a reload wiped the amount AND the
        // reference and left "Nothing to check out". That matters more here
        // than anywhere else on the site — this flow REQUIRES leaving for a
        // banking app, and iOS routinely discards the backgrounded tab. The
        // reference is the whole reconciliation mechanism for a manual shop.
        //
        // Two belts: the order number goes in the URL (so Back, forward and a
        // shared link all work, the pattern CheckoutSuccess already uses), and
        // the order is cached so the screen redraws instantly without a fetch.
        clear();
        rememberOrder(order);
        setPlaced(order);
        navigate(`/checkout?order=${encodeURIComponent(order.number)}`, { replace: true });
        return;
      }
      clear(); toast.success(`${t('checkout.orderWord', 'Order')} ${order.number} ${t('checkout.placed', 'placed!')}`);
      navigate(user ? `/account/orders/${order.id}` : `/track?number=${order.number}`);
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  // ── Manual payment instructions (after order placed) ──
  if (placed) {
    // Use the server order's authoritative total — the cart was just cleared, so
    // the live cart-derived `amountEur` would read €0.00 here.
    const payEur = ((placed.total ?? 0) / 100).toFixed(2);
    // From the order the server just created, not recomputed from the cart.
    const pm = (placed.payMethods || []).find((x) => x.id === methodId) || (placed.payMethods || [])[0] || null;
    return (
      <div className="section py-12 max-w-xl">
        <div className="card p-8 text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4 bg-amber-500/15 border border-amber-500/30 text-2xl">⏳</div>
          <h1 className="text-2xl text-white">{t('checkout.almostThere', 'Almost there — complete your payment')}</h1>
          <p className="text-slate-400 mt-2">{t('checkout.orderWord', 'Order')} <span className="font-mono text-white">{placed.number}</span> {t('checkout.reserved', 'is reserved. Pay the amount below and we’ll confirm it (usually within minutes).')}</p>

          {/* The amount used to be plain text — the one number people retype,
              and it could not be copied. Both facts are now one tap each. */}
          <div className="mt-6 text-left">
            <PayFacts amount={`€${payEur}`} reference={placed.number} />
          </div>

          {methods.length > 1 && (
            <div className="flex gap-2 justify-center mt-5">
              {methods.map((x) => (
                <button key={x.id} onClick={() => setMethodId(x.id)}
                  className={`chip ${methodId === x.id ? 'chip-active' : ''}`}>{METHOD_ICON[x.id] || '💳'} {x.label}</button>
              ))}
            </div>
          )}

          {pm && (
            <div className="mt-5">
              {pm.url
                ? <a href={pm.url} target="_blank" rel="noreferrer" className="btn-primary w-full py-3.5 text-base"><ExternalLink size={18} /> {t('checkout.payWith', 'Pay')} €{payEur} {t('checkout.with', 'with')} {pm.label}</a>
                : <div className="glass rounded-xl p-4 text-white">{t('checkout.payTo', 'Send')} €{payEur} {t('checkout.payToWho', 'to')} {pm.target}</div>}
              {pm.prefilled && (
                <p className="text-emerald-300 text-xs mt-2">
                  ✓ {t('checkout.filledIn', 'The amount is already in the link — you only have to confirm.')}
                </p>
              )}
              <p className="text-slate-500 text-xs mt-3">{note || t('checkout.noteDefault', 'After paying, your order is confirmed within minutes during open hours.')}</p>
            </div>
          )}

          <PaymentProofForm orderId={placed.id} email={email} method={methodId} />

          {/* The status page is the one link a buyer needs afterwards, and it
              works without an account. Say that it is also in their inbox, so
              closing this tab never feels like losing the order. */}
          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-left">
            <div className="text-white text-sm font-semibold">{t('checkout.followTitle', 'Follow your order — no account needed')}</div>
            <p className="text-slate-400 text-[13px] mt-1">
              {t('checkout.followSub', 'This link updates by itself the moment we confirm your payment. We also emailed it to')} <span className="text-slate-200">{email}</span>.
            </p>
            <Link to={user ? `/account/orders/${placed.id}` : `/track?number=${placed.number}`}
              className="btn-primary w-full mt-3 py-3"><CheckCircle2 size={18} /> {t('footer.track', 'Track order')}</Link>
          </div>
          <div className="flex gap-3 mt-3">
            <Link to="/shop" className="btn-ghost flex-1 py-3">{t('checkout.keepShopping', 'Keep shopping')}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section py-12 pb-28 lg:pb-12">
      <h1 className="text-3xl text-white mb-6">{t('checkout.title', 'Checkout')}</h1>

      {/* Progress indicator */}
      <CheckoutSteps current={1} />

      <form onSubmit={placeOrder} className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h3 className="text-white mb-5">{t('checkout.contact', 'Contact & billing')}</h3>
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="co-email">{t('checkout.email', 'Email (delivery + receipt)')}</label>
                <input id="co-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  className="input" placeholder="you@example.com" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label" htmlFor="co-name">{t('checkout.name', 'Full name')}</label>
                  <input id="co-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name"
                    className="input" placeholder={t('checkout.optional', 'Optional')} />
                </div>
                <div>
                  <label className="label" htmlFor="co-city">{t('checkout.city', 'City')}</label>
                  <input id="co-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2"
                    className="input" placeholder={t('checkout.optional', 'Optional')} />
                </div>
              </div>
              {offersChoice && !requiresAccount && (
                <div>
                  {/* This caption heads a pair of BUTTONS, not a field, so a
                      <label> would point at nothing. A named radiogroup is what a
                      screen reader can actually announce and move between. */}
                  <div className="label" id="co-delivery-label">{t('checkout.deliveryChoose', 'How do you want it delivered?')}</div>
                  <div role="radiogroup" aria-labelledby="co-delivery-label" className="grid sm:grid-cols-2 gap-2.5">
                    <button type="button" role="radio" aria-checked={method === 'code'} onClick={() => setDeliveryMethod('code')}
                      className={`rounded-xl border p-3.5 text-left transition ${method === 'code' ? 'border-primary bg-primary/10' : 'border-white/10 hover:border-white/25'}`}>
                      <div className="text-white font-medium text-sm">📧 {t('checkout.deliveryCode', 'Gift code')}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{t('checkout.deliveryCodeSub', 'Emailed to you to redeem yourself')}</div>
                    </button>
                    <button type="button" role="radio" aria-checked={method === 'account'} onClick={() => setDeliveryMethod('account')}
                      className={`rounded-xl border p-3.5 text-left transition ${method === 'account' ? 'border-primary bg-primary/10' : 'border-white/10 hover:border-white/25'}`}>
                      <div className="text-white font-medium text-sm">⚡ {t('checkout.deliveryAccount', 'Direct to my account')}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{t('checkout.deliveryAccountSub', 'We top up your account for you')}</div>
                    </button>
                  </div>
                </div>
              )}
              {needsTarget && (
                <div>
                  <label className="label" htmlFor="co-target">{deliveryLabels.join(' / ')} <span className="text-indigo-400">*</span></label>
                  <input id="co-target" required value={deliveryDetail} onChange={(e) => setDeliveryDetail(e.target.value)}
                    autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
                    className="input" placeholder={t('checkout.deliveryPh', 'Where should we deliver? e.g. your in-game username')} />
                  <p className="text-slate-500 text-xs mt-1">{t('checkout.deliveryHint', 'We deliver this order to this target — double-check it.')}</p>
                </div>
              )}
            </div>
            {!user && (
              <p className="text-slate-500 text-sm mt-4">
                {t('checkout.tip', 'Tip:')} <Link to="/login" className="text-indigo-400">{t('checkout.tipSignIn', 'sign in')}</Link> {t('checkout.tipRest', 'to see this order in your dashboard.')}
              </p>
            )}
          </div>

          <div className="card p-6">
            <h3 className="text-white mb-3 flex items-center gap-2"><Lock size={16} className="text-indigo-300" /> {t('checkout.method', 'Payment method')}</h3>
            {provider === 'mollie' ? (
              <MollieMethods amount={grandTotal} value={mollieMethod}
                onChange={setMollieMethod} offered={mollieOffered} />
            ) : provider === 'manual' ? (
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
                  ? <>{t('checkout.stripe1', 'You’ll be redirected to')} <span className="text-white">Stripe</span> {t('checkout.stripe2', 'to complete your payment.')}</>
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
              aria-label={t('checkout.couponPh', 'Discount code')} enterKeyHint="done"
              autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off"
              placeholder={t('checkout.couponPh', 'Discount code')} className="input py-2 text-base" />
            <button type="button" onClick={applyCoupon} className="btn-ghost px-4 min-h-[44px] text-sm">{t('checkout.apply', 'Apply')}</button>
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
            {memberDiscount > 0 && <div className="flex justify-between text-sm text-violet-300"><span>{t('checkout.memberOff', 'Forge+ member — {n}% off', { n: memberPercent })}</span><span>−{money(memberDiscount, currency)}</span></div>}
            {coupon && <div className="flex justify-between text-sm text-emerald-300"><span>{t('checkout.coupon', 'Coupon')} ({coupon.code}{coupon.percent ? ` · ${coupon.percent}%` : ''})</span><span>−{money(couponDiscount, currency)}</span></div>}
            {creditToApply > 0 && <div className="flex justify-between text-sm text-indigo-300"><span>{t('checkout.credit', 'Store credit')}</span><span>−{money(creditToApply, currency)}</span></div>}
            <div className="flex justify-between text-lg pt-1"><span className="text-slate-300">{t('cart.total', 'Total')}</span><span className="text-white font-semibold">{money(grandTotal, currency)}</span></div>
          </div>
          <label id="fm-consent" className="flex items-start gap-2.5 mb-3 text-[12.5px] text-slate-400 cursor-pointer scroll-mt-24">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 shrink-0 w-4 h-4 accent-violet-600" />
            <span>{consentSentence}</span>
          </label>
          <button disabled={busy || !consent} className="btn-primary w-full py-3">
            {busy ? <Loader2 size={18} className="animate-spin" />
              : provider === 'mollie' ? <>{t('checkout.payNow', 'Pay {amount} securely', { amount: money(grandTotal, currency) })}</>
              : provider === 'stripe' ? <>{t('checkout.payCard', 'Pay with card')}</>
              : provider === 'manual' ? <>{t('checkout.placePay', 'Place order & pay')}</>
              : <>{t('checkout.placeOrder', 'Place order')}</>}
          </button>
          {!consent && !busy && (
            <p className="text-amber-300 text-[12.5px] mt-2 text-center">
              {t('checkout.consentFirst', 'Tick the box above to continue — it is required by EU law before we can deliver straight away.')}
            </p>
          )}
          {/* Purchase protection */}
          <div className="mt-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
            <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium"><ShieldCheck size={15} /> {t('checkout.protection', 'Buyer protection')}</div>
            <ul className="mt-1.5 space-y-1 text-xs text-slate-400">
              <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-400 shrink-0" /> {t('checkout.p1', 'Money-back guarantee if undelivered')}</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-400 shrink-0" /> {t('checkout.p2', 'Sent as soon as your payment is confirmed')}</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 size={11} className="text-emerald-400 shrink-0" /> {t('checkout.p3', 'Fraud-screened & encrypted checkout')}</li>
            </ul>
          </div>
        </div>

        {/* Sticky pay bar — on a phone the real button is far below the fold. */}
        {/* The bar is the only thing a phone shows on arrival, and its button is
            dead until the consent box — 293px further down, measured — is ticked.
            The explanation therefore has to live INSIDE the bar, and tapping the
            disabled button has to take you to the box rather than doing nothing. */}
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500">{t('cart.total', 'Total')}</div>
              <div className="text-lg fm-num text-violet-600 leading-tight">{money(grandTotal, currency)}</div>
            </div>
            {!consent && !busy ? (
              <button type="button" onClick={jumpToConsent}
                className="btn-primary flex-1 py-3 fm-tap">
                {t('checkout.reviewFirst', 'Confirm delivery to continue')}
              </button>
            ) : (
              <button type="submit" disabled={busy} className="btn-primary flex-1 py-3 fm-tap">
                {busy ? <Loader2 size={18} className="animate-spin" />
                  : provider === 'mollie' ? <>{t('checkout.payNowShort', 'Pay securely')}</>
                  : provider === 'stripe' ? <>{t('checkout.payCard', 'Pay with card')}</>
                  : provider === 'manual' ? <>{t('checkout.placePay', 'Place order & pay')}</>
                  : <>{t('checkout.placeOrder', 'Place order')}</>}
              </button>
            )}
          </div>
          {!consent && !busy && (
            <p className="text-slate-500 text-[11.5px] mt-1.5 leading-snug">
              {t('checkout.consentFirstShort', 'One tick needed: EU law requires your go-ahead before we deliver straight away.')}
            </p>
          )}
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
  const [shotBusy, setShotBusy] = useState(false);
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
        {shot.startsWith('data:') ? (
          <div className="input flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm text-slate-300">
              <img src={shot} alt="" className="w-8 h-8 rounded object-cover" /> {t('proof.attached', 'Screenshot attached')}
            </span>
            <button type="button" onClick={() => setShot('')} className="text-slate-500 hover:text-red-400 text-sm">✕</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input value={shot} onChange={(e) => setShot(e.target.value)} className="input flex-1"
              placeholder={t('proof.shotPh', 'Screenshot link (optional)')} />
            {/* Buyers pay on a phone — the receipt is already in their camera roll. */}
            <label className={`btn-ghost text-sm whitespace-nowrap cursor-pointer ${shotBusy ? 'opacity-60 pointer-events-none' : ''}`}>
              {shotBusy ? '…' : t('proof.upload', 'Upload')}
              <input type="file" accept="image/*" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]; e.target.value = '';
                  if (!f) return;
                  setShotBusy(true);
                  try { setShot(await fileToDataUrl(f, { max: 900, maxBytes: 900_000 })); }
                  catch (er) { setErr(er.message); }
                  finally { setShotBusy(false); }
                }} />
            </label>
          </div>
        )}
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
          <div key={s} className="flex items-center flex-1 last:flex-none min-w-0">
            <div className="flex items-center gap-2">
              <span className={`w-7 h-7 rounded-full grid place-items-center text-xs font-semibold shrink-0 ${
                done ? 'bg-emerald-500 text-white' : active ? 'bg-primary text-white' : 'bg-white/10 text-slate-400'}`}>
                {done ? '✓' : i + 1}
              </span>
              {/* On phones only the ACTIVE step keeps its label — four full labels
                  plus connectors don't fit 390px and pushed the page sideways. */}
              <span className={`text-sm whitespace-nowrap ${active ? 'text-white font-medium' : done ? 'text-slate-300 hidden sm:inline' : 'text-slate-500 hidden sm:inline'}`}>{s}</span>
            </div>
            {i < steps.length - 1 && <div className={`flex-1 h-px mx-2 sm:mx-3 ${done ? 'bg-emerald-500/50' : 'bg-white/10'}`} />}
          </div>
        );
      })}
    </div>
  );
}
