import { useRef } from 'react';
import { Star } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';

/* "1 star" and "{n} stars" are separate keys because the plural is a different
   word in every language this shop speaks (ster/sterren, Stern/Sterne). */
const starCount = (t, n) => (n === 1 ? t('stars.one', '1 star') : t('stars.n', '{n} stars', { n }));

/**
 * Choosing a rating, for a keyboard and a screen reader as well as a finger.
 *
 * Each review form drew its own row of five buttons labelled "1 stars" to
 * "5 stars" — in English on every page — and none of them said which one was
 * chosen, so a screen reader heard five identical buttons and never the answer
 * to "how many did I give?". This is the radio group they stood in for, built
 * the way the WAI-ARIA rating example is: one named group, one star checked,
 * the arrow keys move the choice (wrapping at the ends), and Tab enters and
 * leaves the whole row in one step instead of five.
 *
 * The look stays with the caller — `buttonClass(on)` and `renderStar(on)` —
 * so the track page keeps its emoji row and the account pages their icons.
 */
export default function StarPicker({ value, onChange, label, className = '', buttonClass, renderStar }) {
  const { t } = useI18n();
  const buttons = useRef([]);
  // A value outside 1–5 would leave no star in the Tab order at all.
  const current = value >= 1 && value <= 5 ? value : 1;

  const move = (n) => {
    const next = ((n + 4) % 5) + 1;
    onChange(next);
    buttons.current[next - 1]?.focus();
  };
  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) { e.preventDefault(); move(current + step); }
    else if (e.key === 'Home') { e.preventDefault(); move(1); }
    else if (e.key === 'End') { e.preventDefault(); move(5); }
  };

  return (
    <div role="radiogroup" aria-label={label || t('stars.pick', 'Your rating')} className={className} onKeyDown={onKeyDown}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= current;
        return (
          <button key={n} ref={(el) => { buttons.current[n - 1] = el; }} type="button"
            role="radio" aria-checked={n === current} tabIndex={n === current ? 0 : -1}
            aria-label={starCount(t, n)} onClick={() => onChange(n)}
            className={buttonClass ? buttonClass(on) : undefined}>
            {renderStar ? renderStar(on)
              : <Star size={22} className={on ? 'text-amber-400' : 'text-slate-600'} fill={on ? 'currentColor' : 'none'} />}
          </button>
        );
      })}
    </div>
  );
}
