import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, Search, MessageSquare, AlertTriangle } from 'lucide-react';
import LegalDoc from '../../components/LegalDoc.jsx';
import { usePageMeta } from '../../lib/useMeta.js';
import { useI18n } from '../../lib/i18n.jsx';
import { SUPPORT_EMAIL } from '../../lib/support.js';
import { LEGAL, legalComplete, legalAddressLine } from '../../lib/legalIdentity.js';
import { REFUND_DOC } from '../../content/refunds.js';

/**
 * The model withdrawal form.
 *
 * EU and Dutch law require a trader to make this available (Bijlage I deel B bij
 * Richtlijn 2011/83/EU, implemented in Art. 6:230m BW). It is not the only way to
 * withdraw — an email is equally valid, and the page says so — but it has to be
 * there, and it has to be usable rather than a PDF nobody can open on a phone.
 *
 * One tap to copy the whole thing, because the realistic action on a phone is
 * pasting it into an email, not printing it.
 */
function WithdrawalForm({ form, nl }) {
  const [done, setDone] = useState(false);
  // Falls back to the trade name while the identity fields are still empty, so
  // the form is usable rather than showing a hole where the seller should be.
  const seller = legalComplete()
    ? [LEGAL.legalName || LEGAL.tradeName, legalAddressLine(), SUPPORT_EMAIL].filter(Boolean).join(', ')
    : [LEGAL.tradeName, SUPPORT_EMAIL].filter(Boolean).join(', ');
  const text = form.lines.join('\n').replace('{seller}', seller);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      // Clipboard can be blocked (permissions, insecure origin). Select the text
      // so it can still be copied by hand rather than failing silently.
      const el = document.getElementById('withdrawal-form-text');
      if (!el) return;
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  };

  return (
    <section className="mt-12">
      <h2 className="text-white text-xl font-display mb-2">{form.h}</h2>
      <p className="text-slate-400 leading-relaxed mb-4">{form.intro}</p>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
        <pre id="withdrawal-form-text"
          className="px-4 py-4 text-[13px] leading-relaxed text-slate-300 whitespace-pre-wrap font-mono overflow-x-auto">
          {text}
        </pre>
        <div className="border-t border-white/5 px-4 py-3">
          <button type="button" onClick={copy}
            className={`btn-ghost text-sm min-h-[44px] ${done ? 'text-emerald-300' : ''}`}>
            {done ? <><Check size={16} /> {form.copied}</> : <><Copy size={16} /> {form.copy}</>}
          </button>
        </div>
      </div>
      {!legalComplete() && (
        /* A notice, not a whisper. This told a buyer where to send a statutory
           withdrawal form because the seller's address is not published yet —
           and it was the least readable text on the page: pale amber on the
           white card measures 1.31:1, against a 4.5:1 floor.
           `text-amber-300/90` is why. The light theme remaps `.text-amber-300`,
           but Tailwind's opacity modifier makes that a different class name and
           the exact selector silently misses it. Rather than widen that selector
           — `[class*="text-amber-300"]` would also catch every `hover:` variant
           and repaint it permanently — this stops relying on the remap and takes
           the treatment a legal notice should have had anyway. */
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[13px] text-amber-800">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden />
          <span>
            {nl
              ? 'Het adres van de verkoper ontbreekt nog. Stuur het formulier naar het e-mailadres hierboven; wij bevestigen de ontvangst.'
              : 'The seller’s address is not published yet. Send the form to the email address above; we will confirm receipt.'}
          </span>
        </p>
      )}
    </section>
  );
}

export default function Refunds() {
  const { lang, t } = useI18n();
  const nl = lang === 'nl';
  const d = nl ? REFUND_DOC.nl : REFUND_DOC.en;
  usePageMeta(d.title, d.meta);

  return (
    <LegalDoc doc={REFUND_DOC}>
      <WithdrawalForm form={d.form} nl={nl} />
      <div className="mt-10 flex flex-wrap gap-3">
        <Link to="/track" className="btn-primary min-h-[44px]">
          <Search size={17} /> {t('refunds.trackCta', 'Track / manage an order')}
        </Link>
        <Link to="/contact" className="btn-ghost min-h-[44px]">
          <MessageSquare size={17} /> {t('refunds.ticketCta', 'Open a ticket')}
        </Link>
      </div>
    </LegalDoc>
  );
}
