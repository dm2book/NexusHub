import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useLaunch } from '../../lib/useLaunch.js';
import { visibleUnits } from '../../lib/launchUnits.js';
import { useI18n, localeOf } from '../../lib/i18n.jsx';
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
  const [failure, setFailure] = useState('');

  if (!prelaunch) return null;

  // Read off the same hook call above, not a second one: this sits after an
  // early return, and a hook called conditionally is a hook that will explode
  // the first time the shop is open.
  /* The reader's real locale rather than "Dutch or English": a German visitor
     was shown "24 September" formatted for en-GB. */
  const when = new Date(launchAt).toLocaleDateString(localeOf(lang),
    { day: 'numeric', month: 'long', timeZone: 'UTC' });

  /* Stored against the subscription as proof of what was agreed to, so it has
     to be the sentence this visitor actually read. */
  const consentText = t('launch.consent', 'Email me when ForgeMarket opens.');

  const submit = async (e) => {
    e.preventDefault();
    if (state === 'sending' || !email.trim()) return;
    setState('sending');
    try {
      await api.post('/api/newsletter', { email: email.trim(), consentText, source: 'prelaunch-banner' });
      setState('done');
    } catch (err) {
      /* Two failures, two sentences. A 4xx means the address; a 5xx or a dead
         connection means us. Both used to read "check the address and try
         again", so during the database outage this banner sent people off to
         hunt for a typo in an email they had spelled correctly. */
      setFailure(err?.status >= 500 || err?.status === 0
        ? err.message
        : t('launch.failed', 'That did not go through. Please check the address and try again.'));
      setState('error');
    }
  };

  /* The three largest units that still mean something, not always four — see
     visibleUnits. The DATE is the information; the countdown is the texture. */
  const LABEL = {
    days: t('launch.days', 'days'), hours: t('launch.hours', 'hrs'),
    minutes: t('launch.minutes', 'min'), seconds: t('launch.seconds', 'sec'),
  };
  const shown = visibleUnits(remaining).map((u) => ({ u, n: remaining[u], label: LABEL[u] }));

  const box = 'rounded-xl bg-white/[0.07] ring-1 ring-inset ring-white/12 px-3 py-2 '
    + 'min-w-[3.5rem] text-center backdrop-blur-sm';
  const num = 'block text-xl sm:text-2xl font-extrabold tabular-nums leading-none text-white';
  const cap = 'block text-[10px] uppercase tracking-[.14em] text-white/55 mt-1';

  return (
    <section aria-labelledby="launch-heading" className="fm-launch text-white">
      <div className="relative z-10 max-w-[1400px] mx-auto px-4 lg:px-8 py-5
                      flex flex-col lg:flex-row lg:items-center gap-5 lg:gap-8">
        <div className="min-w-0 lg:flex-1">
          {/* The eyebrow carries the verb, so the heading can be the date. */}
          <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase
                        tracking-[.18em] text-white/55">
            <span className="fm-launch-dot" aria-hidden />
            {t('launch.eyebrow', 'Opening')}
          </p>
          {/* The date, not the ticker. It is the thing a visitor needs to keep,
              and it was set smaller than four digits counting down seconds. */}
          <h2 id="launch-heading" className="font-display text-[1.6rem] sm:text-3xl leading-[1.05]
                                             tracking-tight mt-1.5">
            {when}
          </h2>
          <p className="text-[13px] sm:text-sm text-white/65 mt-1.5 max-w-[34rem]">
            {t('launch.sub', 'Browse everything now — the shop opens for orders on the day.')}
          </p>
        </div>

        {/* Countdown. aria-hidden on the ticking numbers and a quiet live
            summary beside them: a screen reader announcing a new value every
            second is unusable, and the useful information is "four days left". */}
        {shown.length > 0 && (
          <div className="flex items-center gap-2 shrink-0" aria-hidden="true">
            {shown.map((u, i) => (
              <div key={u.u} className={box}>
                <span className={num}>{i === 0 ? u.n : String(u.n).padStart(2, '0')}</span>
                <span className={cap}>{u.label}</span>
              </div>
            ))}
          </div>
        )}
        {remaining && (
          <p className="sr-only" aria-live="polite">
            {t('launch.remaining', '{days} days until ForgeMarket opens', { days: remaining.days })}
          </p>
        )}

        {/* The one thing there is to do here. */}
        <form onSubmit={submit} className="flex items-center gap-2 min-w-0 lg:justify-end lg:shrink-0">
          {state === 'done' ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <Check size={17} aria-hidden /> {t('launch.subscribed', 'We will email you on the day.')}
            </p>
          ) : (
            <>
              <label htmlFor="launch-email" className="sr-only">
                {t('launch.emailLabel', 'Your email address')}
              </label>
              {/* Dark glass rather than a white box. A white input on a
                  saturated slab was the loudest rectangle on the page and the
                  least important thing in the banner. */}
              <input id="launch-email" type="email" required value={email} autoComplete="email"
                onChange={(e) => { setEmail(e.target.value); if (state === 'error') { setState('idle'); setFailure(''); } }}
                placeholder={t('launch.placeholder', 'you@example.com')}
                className="min-w-0 flex-1 lg:w-[15rem] lg:flex-none h-11 rounded-xl px-3.5 text-sm text-white
                           bg-white/[0.07] ring-1 ring-inset ring-white/15 placeholder:text-white/40
                           focus:outline-none focus:ring-2 focus:ring-violet-400/70 transition" />
              <button type="submit" disabled={state === 'sending'}
                className="h-11 shrink-0 rounded-xl px-5 text-sm font-bold text-white
                           disabled:opacity-70 inline-flex items-center gap-2
                           shadow-[0_10px_30px_-8px_rgba(124,92,255,.8)]
                           hover:brightness-110 active:scale-[.98] transition"
                style={{ backgroundImage: 'linear-gradient(135deg,#7c5cff,#d946ef)' }}>
                {state === 'sending' && <Loader2 size={15} className="animate-spin" aria-hidden />}
                {t('launch.notify', 'Notify me')}
              </button>
            </>
          )}
        </form>
      </div>
      {state === 'error' && (
        <p role="alert" className="relative z-10 max-w-[1400px] mx-auto px-4 lg:px-8 pb-4 -mt-1
                                   text-sm text-rose-200">
          {failure || t('launch.failed', 'That did not go through. Please check the address and try again.')}
        </p>
      )}
    </section>
  );
}
