import { useState } from 'react';
import { Rocket, Check, Loader2 } from 'lucide-react';
import { useLaunch } from '../../lib/useLaunch.js';
import { useI18n } from '../../lib/i18n.jsx';
import { api } from '../../lib/api.js';

/**
 * The pre-launch banner: what is happening, when, and the one thing a visitor
 * can do about it.
 *
 * The date is rendered FROM the configured launch moment rather than written
 * out. A hard-coded "launches September 24" beside an environment variable that
 * says otherwise is the exact failure this codebase keeps finding — a written
 * promise with no code behind it — and moving the date would leave the sentence
 * lying. Change LAUNCH_DATE and this sentence changes with it.
 *
 * It removes itself at the moment of launch without a reload, because the
 * countdown compares the browser's clock to a timestamp rather than trusting a
 * flag the server computed at some point in the past.
 */
export default function LaunchBanner() {
  const { prelaunch, remaining, launchAt } = useLaunch();
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');   // idle | sending | done | error

  if (!prelaunch) return null;

  // Read off the same hook call above, not a second one: this sits after an
  // early return, and a hook called conditionally is a hook that will explode
  // the first time the shop is open.
  const when = new Date(launchAt).toLocaleDateString(lang === 'nl' ? 'nl-NL' : 'en-GB',
    { day: 'numeric', month: 'long', timeZone: 'UTC' });

  const consentText = lang === 'nl'
    ? 'Ik wil een e-mail als ForgeMarket opengaat.'
    : 'Email me when ForgeMarket opens.';

  const submit = async (e) => {
    e.preventDefault();
    if (state === 'sending' || !email.trim()) return;
    setState('sending');
    try {
      await api.post('/api/newsletter', { email: email.trim(), consentText, source: 'prelaunch-banner' });
      setState('done');
    } catch {
      setState('error');
    }
  };

  const box = 'rounded-lg bg-white/15 px-2.5 py-1.5 min-w-[3.25rem] text-center';
  const num = 'block text-lg sm:text-xl font-extrabold tabular-nums leading-none';
  const cap = 'block text-[10px] uppercase tracking-wider opacity-80 mt-0.5';

  return (
    <section aria-labelledby="launch-heading"
      className="text-white" style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#a855f7)' }}>
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-4 flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Rocket size={22} className="shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <h2 id="launch-heading" className="font-display text-lg sm:text-xl leading-tight">
              {t('launch.headline', 'ForgeMarket launches {when}', { when })}
            </h2>
            <p className="text-[13px] sm:text-sm text-white/85 mt-0.5">
              {t('launch.sub', 'Browse everything now — the shop opens for orders on the day.')}
            </p>
          </div>
        </div>

        {/* Countdown. aria-hidden on the ticking numbers and a quiet live
            summary beside them: a screen reader announcing a new value every
            second is unusable, and the useful information is "four days left". */}
        {remaining && (
          <div className="flex items-center gap-2 shrink-0" aria-hidden="true">
            <div className={box}><span className={num}>{remaining.days}</span><span className={cap}>{t('launch.days', 'days')}</span></div>
            <div className={box}><span className={num}>{String(remaining.hours).padStart(2, '0')}</span><span className={cap}>{t('launch.hours', 'hrs')}</span></div>
            <div className={box}><span className={num}>{String(remaining.minutes).padStart(2, '0')}</span><span className={cap}>{t('launch.minutes', 'min')}</span></div>
            <div className={box}><span className={num}>{String(remaining.seconds).padStart(2, '0')}</span><span className={cap}>{t('launch.seconds', 'sec')}</span></div>
          </div>
        )}
        {remaining && (
          <p className="sr-only" aria-live="polite">
            {t('launch.remaining', '{days} days until ForgeMarket opens', { days: remaining.days })}
          </p>
        )}

        {/* The one thing there is to do here. */}
        <form onSubmit={submit} className="flex-1 flex items-center gap-2 min-w-0 lg:justify-end">
          {state === 'done' ? (
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Check size={17} aria-hidden /> {t('launch.subscribed', 'We will email you on the day.')}
            </p>
          ) : (
            <>
              <label htmlFor="launch-email" className="sr-only">
                {t('launch.emailLabel', 'Your email address')}
              </label>
              <input id="launch-email" type="email" required value={email} autoComplete="email"
                onChange={(e) => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
                placeholder={t('launch.placeholder', 'you@example.com')}
                className="min-w-0 flex-1 lg:max-w-[15rem] h-11 rounded-xl px-3 text-slate-900 text-sm
                           placeholder:text-slate-500 bg-white border border-white/40" />
              <button type="submit" disabled={state === 'sending'}
                className="h-11 shrink-0 rounded-xl px-4 bg-white text-violet-700 text-sm font-bold
                           hover:bg-violet-50 disabled:opacity-70 inline-flex items-center gap-2">
                {state === 'sending' && <Loader2 size={15} className="animate-spin" aria-hidden />}
                {t('launch.notify', 'Notify me')}
              </button>
            </>
          )}
        </form>
      </div>
      {state === 'error' && (
        <p role="alert" className="max-w-[1400px] mx-auto px-4 lg:px-8 pb-3 text-sm text-white">
          {t('launch.failed', 'That did not go through. Please check the address and try again.')}
        </p>
      )}
    </section>
  );
}
