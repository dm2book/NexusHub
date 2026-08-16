import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';
import { hasAnswered, setConsent, onConsentChange } from '../lib/consent.js';

/**
 * The cookie choice.
 *
 * Three things make this valid where the previous banner was not:
 *
 *  1. **Refusing is one tap, same as accepting.** Two buttons, same size, same
 *     prominence. A banner with only "Accept" — or with refusal hidden behind a
 *     settings screen — is not a free choice, and consent that is not free is
 *     not consent.
 *  2. **Nothing non-essential is stored until an answer arrives.** The gate is
 *     in lib/consent.js and enforced by usePageViews and the referral capture;
 *     this component only records the answer. A banner that does not stop the
 *     writing documents the violation rather than preventing it.
 *  3. **It is honest about what is exempt.** Staying signed in, the cart and the
 *     chosen language are strictly necessary and are not up for negotiation —
 *     so they are named as such rather than bundled into "we value your privacy".
 *
 * Deliberately NOT a modal. Blocking the whole page until someone answers is a
 * dark pattern in the other direction, and a visitor who just wants to read the
 * refund policy should be able to.
 */
export default function CookieConsent() {
  const { t } = useI18n();
  const [answered, setAnswered] = useState(true); // assume yes → never flashes
  useEffect(() => {
    setAnswered(hasAnswered());
    return onConsentChange(() => setAnswered(hasAnswered()));
  }, []);

  if (answered) return null;

  const decide = (yes) => setConsent({ analytics: yes, marketing: yes });

  return (
    <div role="dialog" aria-live="polite"
      aria-label={t('cookie.title', 'Cookies on ForgeMarket')}
      className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:inset-x-auto sm:left-4 sm:bottom-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
          <Cookie size={18} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{t('cookie.title', 'Cookies on ForgeMarket')}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            {t('cookie.body', 'We always store what the shop needs to work: staying signed in, your cart and your language. We would also like to measure which pages get visited. That part is up to you, and the shop works either way.')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {/* Equal weight on purpose — see the note above. */}
            <button onClick={() => decide(true)} className="btn-primary flex-1 min-w-[130px] justify-center py-2.5 text-sm">
              {t('cookie.accept', 'Accept')}
            </button>
            <button onClick={() => decide(false)} className="btn-ghost flex-1 min-w-[130px] justify-center py-2.5 text-sm">
              {t('cookie.reject', 'Only what is necessary')}
            </button>
          </div>
          <Link to="/cookies" className="mt-2 inline-block py-1 text-[12.5px] text-violet-700 underline underline-offset-2 hover:text-violet-800">
            {t('cookie.more', 'What we store exactly')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * "Change my choice", for the footer.
 *
 * Withdrawing consent has to be as easy as giving it, which means it cannot
 * live only in a banner that never comes back once answered.
 */
export function CookiePreferencesLink({ className = '' }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={() => import('../lib/consent.js').then((m) => m.resetConsent())}
      className={className}>
      {t('cookie.change', 'Cookie preferences')}
    </button>
  );
}
