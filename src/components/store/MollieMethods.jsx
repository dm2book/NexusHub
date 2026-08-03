import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Pick a payment method before leaving for Mollie.
 *
 * The list comes from Mollie for THIS amount, not from a hard-coded array: iDEAL
 * has a ceiling, Bancontact is Belgian, and Apple Pay only shows up on a device
 * that can actually use it. Offering a method the buyer then cannot select is a
 * dead end at the very last step of the funnel.
 *
 * Picking here is optional — "let me choose on the next screen" is a real answer
 * and Mollie's own page handles it. But a buyer who taps iDEAL here skips a
 * screen, and on a phone that is one fewer chance to drop out.
 */
const FALLBACK_LABEL = {
  ideal: 'iDEAL',
  bancontact: 'Bancontact',
  applepay: 'Apple Pay',
  creditcard: 'Credit card',
  paypal: 'PayPal',
};

// No stand-in icons. Mollie serves each brand's official logo and those load the
// moment the live list arrives; an emoji in the meantime is worse than nothing —
// a credit-card glyph next to "Apple Pay" reads as a shop that got it wrong.

export default function MollieMethods({ amount, value, onChange, offered = [] }) {
  const { t, lang } = useI18n();
  const [methods, setMethods] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/api/mollie/methods?amount=${amount}&locale=${lang === 'en' ? 'en' : 'nl'}`)
      .then((r) => { if (alive) { setMethods(r.methods || []); setLoaded(true); } })
      // A failed lookup must not block checkout: the buyer simply picks on
      // Mollie's own page instead, which is the default path anyway.
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [amount, lang]);

  // Before the live list arrives, show what the shop accepts so the payment card
  // is never an empty box — these are labels, not a promise that each one fits
  // this amount, and they are replaced the moment Mollie answers.
  const shown = loaded && methods.length
    ? methods
    : offered.map((id) => ({ id, label: FALLBACK_LABEL[id] || id, image: null }));

  if (!shown.length) return null;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {shown.map((m) => (
          <button type="button" key={m.id} onClick={() => onChange(value === m.id ? '' : m.id)}
            aria-pressed={value === m.id}
            className={`rounded-xl border p-3 text-left transition min-h-[64px] flex items-center gap-2.5 ${
              value === m.id ? 'border-primary bg-primary/10' : 'border-white/10 hover:border-white/25'}`}>
            {m.image && <img src={m.image} alt="" className="w-8 h-8 object-contain shrink-0" loading="lazy" />}
            <span className="text-white text-sm font-medium leading-tight">{m.label}</span>
          </button>
        ))}
      </div>
      <p className="text-slate-500 text-xs mt-3">
        {value
          ? t('checkout.mollieChosen', 'You go straight to this method — no extra screen.')
          : t('checkout.mollieAny', 'Optional: pick a method here, or choose one on the secure payment page.')}
      </p>
    </div>
  );
}
