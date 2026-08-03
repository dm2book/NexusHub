import { useEffect, useState } from 'react';
import { CheckCircle2, Zap } from 'lucide-react';
import { useLiveFeed, deliveryPhrase, timeAgo } from '../../lib/useSocialProof.js';
import { iconFor } from '../../lib/sampleCatalog.js';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * Floating live social-proof ticker — "John from Amsterdam got 1,700 Robux ·
 * delivered in 34s". Real delivered orders only (privacy-safe: first name + city
 * only). Renders nothing until the store has real activity. Rotates in/out.
 */
export default function RecentlyDelivered() {
  const { t } = useI18n();
  const feed = useLiveFeed();
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!feed?.length) return undefined;
    let i = 0;
    const cycle = () => {
      setIdx(i % feed.length);
      setShow(true);
      setTimeout(() => setShow(false), 4200);
      i += 1;
    };
    const first = setTimeout(cycle, 2500);
    const id = setInterval(cycle, 6500);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [feed]);

  if (!feed?.length) return null;
  const r = feed[idx] || feed[0];
  const img = iconFor(r.category);
  const delivered = deliveryPhrase(r.deliverySeconds);
  const who = r.city ? `${r.name || t('live.someone', 'Someone')} ${t('live.from', 'from')} ${r.city}` : (r.name || t('live.someone', 'Someone'));

  return (
    <div className={`fixed left-4 bottom-4 z-30 transition-all duration-500 ${show ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 pointer-events-none'}`}
      role="status" aria-live="polite">
      <div className="flex items-center gap-3 bg-white/90 backdrop-blur-xl border border-slate-200/70 shadow-2xl rounded-2xl pl-2.5 pr-4 py-2.5 max-w-[320px]">
        <span className="w-10 h-10 rounded-xl bg-slate-50 grid place-items-center shrink-0">
          {img ? <img src={img} alt="" className="w-7 h-7 object-contain" /> : <CheckCircle2 className="text-emerald-500" size={20} />}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-slate-900 truncate">
            <span className="text-violet-600">{who}</span> {t('live.got', 'got')} {r.item}
          </div>
          <div className="text-[11px] text-slate-500 flex items-center gap-1">
            {delivered
              ? <><Zap size={11} className="text-amber-500" /> {t('live.deliveredIn', 'Delivered in')} {delivered} · {timeAgo(r.secondsAgo)}</>
              : <><CheckCircle2 size={11} className="text-emerald-500" /> {t('live.delivered', 'Delivered')} · {timeAgo(r.secondsAgo)}</>}
          </div>
        </div>
      </div>
    </div>
  );
}
