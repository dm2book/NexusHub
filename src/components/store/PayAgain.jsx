import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';
import { getConfig } from '../../lib/useConfig.js';
import { recallOrder } from '../../lib/lastOrder.js';
import { friendlyError } from '../../lib/friendlyError.js';

/**
 * Start a new Pay. payment for an unpaid order — after a cancelled or expired
 * one — on the return page and the track page alike.
 *
 * Proof of the order is its id plus its number, which both pages have from the
 * URL: a guest who cancelled at the bank and came back in another browser has
 * no saved email, and the button used to answer "This order is not yours".
 * The buyer can pick the method again: cancelling iDEAL to pay by Bancontact
 * was impossible, every retry reused the method of the first attempt.
 */
export default function PayAgain({ orderId, number, onSettled, methods: given }) {
  const { t } = useI18n();
  const [methods, setMethods] = useState(given || []);
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (given?.length) { setMethods(given); return undefined; }
    let alive = true;
    getConfig().then((c) => { if (alive) setMethods(c.paynlMethods || []); });
    return () => { alive = false; };
  }, [given]);
  useEffect(() => { if (!method && methods.length) setMethod(methods[0].id); }, [methods, method]);

  const start = async () => {
    setBusy(true); setError('');
    try {
      const email = recallOrder(number)?.email;
      const r = await api.post(`/api/orders/${encodeURIComponent(orderId)}/paynl`, {
        number, ...(email ? { email } : {}), ...(method ? { method } : {}),
      });
      if (r.checkoutUrl) { window.location.href = r.checkoutUrl; return; }
      if (r.alreadySettled) onSettled?.(r.status);
    } catch (e) {
      setError(friendlyError(e, t) || t('success.retryFailed', 'The payment could not be started. Please try again from your order page.'));
    }
    setBusy(false);
  };

  return (
    <div className="mt-6">
      {methods.length > 1 && (
        <div role="radiogroup" aria-label={t('checkout.payMethod', 'Payment method')} className="flex gap-2 justify-center mb-3">
          {methods.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={method === m.id}
              onClick={() => setMethod(m.id)} className={`chip ${method === m.id ? 'chip-active' : ''}`}>{m.label}</button>
          ))}
        </div>
      )}
      <button type="button" onClick={start} disabled={busy} className="btn-primary mx-auto">
        {busy ? <Loader2 size={18} className="animate-spin" /> : <RotateCcw size={18} />}
        {' '}{t('success.payAgain', 'Pay again')}
      </button>
      {error && <p role="alert" className="text-amber-300 text-[13px] mt-3">{error}</p>}
    </div>
  );
}
