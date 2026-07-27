import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * The two facts a manual bank transfer can get wrong.
 *
 * Payment here is a person typing into their own banking app, so exactly two
 * things decide whether the money lands matched to an order: the amount, and
 * the reference. Everything else on the pay screen is context. They were
 * previously a small label/value row — and the amount, the number people
 * actually retype, was not even copyable. A wrong cent or a forgotten
 * reference turns into the owner matching payments by hand.
 *
 * So both get the same treatment: big, tappable, one press to copy, with the
 * button state confirming the copy happened rather than a toast that has
 * already faded by the time you switch apps.
 */
function CopyTile({ label, value, mono = false, big = false, onCopied }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      onCopied?.();
      setTimeout(() => setDone(false), 1800);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions). Select the
      // text instead so it can still be copied by hand — never fail silently.
      const r = document.createRange();
      r.selectNodeContents(document.getElementById(`paytile-${label}`));
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  };

  return (
    <button type="button" onClick={copy}
      aria-label={`${label}: ${value}. ${t('pay.tapToCopy', 'Tap to copy')}`}
      className={`group relative w-full text-left rounded-2xl border px-4 py-3.5 min-h-[64px] transition
        ${done ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-white/12 bg-white/[.04] hover:bg-white/[.07] active:scale-[.99]'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
          <div id={`paytile-${label}`}
            className={`text-white leading-tight mt-0.5 break-all ${mono ? 'font-mono' : ''} ${big ? 'text-[26px] font-bold' : 'text-[17px] font-semibold'}`}>
            {value}
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 h-9
          ${done ? 'text-emerald-300' : 'text-slate-300 group-hover:text-white'}`}>
          {done ? <><Check size={15} /> {t('pay.copied', 'Copied')}</> : <><Copy size={14} /> {t('pay.copy', 'Copy')}</>}
        </span>
      </div>
    </button>
  );
}

/**
 * @param amount    formatted, e.g. "€14.38"
 * @param reference the order number
 */
export default function PayFacts({ amount, reference }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2.5">
      <CopyTile label={t('pay.amount', 'Amount')} value={amount} big />
      <CopyTile label={t('pay.reference', 'Reference')} value={reference} mono />
      <p className="text-slate-400 text-[12.5px] leading-snug">
        {t('pay.both', 'Copy both into your banking app. The reference is how we match your payment to this order — without it we have to find it by hand.')}
      </p>
    </div>
  );
}
