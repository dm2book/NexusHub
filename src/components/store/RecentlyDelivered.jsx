import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Zap } from 'lucide-react';
import { useLiveFeed, timeAgo } from '../../lib/useSocialProof.js';
import { iconFor } from '../../lib/sampleCatalog.js';
import { useI18n } from '../../lib/i18n.jsx';
import { durationText } from '../../lib/trustLines.js';

/**
 * Floating live social-proof ticker — "John from Amsterdam got 1,700 Robux ·
 * delivered in 34s". Real delivered orders only (privacy-safe: first name + city
 * only). Renders nothing until the store has real activity.
 *
 * Each sale is shown ONCE per page view, then the ticker rests. It used to loop
 * the list forever, every 6.5 seconds: one sale from this morning popped up
 * again and again for as long as the page was open, which reads as a stream of
 * buyers that is not there. The same sale twice is a notification about
 * nothing new.
 */
export const FRESH_SECONDS = 48 * 3600;

export default function RecentlyDelivered() {
  const { t } = useI18n();
  /* Only what happened in the last 48 hours. "Delivered · 68 days ago" is real,
     but it tells a visitor nobody has bought since — the opposite of the point. */
  const all = useLiveFeed();
  const feed = all?.filter((r) => Number(r.secondsAgo) <= FRESH_SECONDS) || [];
  const shown = useRef(new Set());      // sale ids already announced on this page view
  const [current, setCurrent] = useState(null);
  const [show, setShow] = useState(false);
  const ids = feed.map((r) => r.id).join(',');

  useEffect(() => {
    /* Only sales not yet shown. A new sale arriving from the poller is
       announced once, without replaying the ones before it. */
    const queue = feed.filter((r) => !shown.current.has(r.id));
    if (!queue.length) return undefined;
    let i = 0;
    let loop = null;
    const timers = [];
    const next = () => {
      // Every sale has had its turn: rest, rather than start again from the top.
      if (i >= queue.length) { clearInterval(loop); return; }
      const r = queue[i++];
      shown.current.add(r.id);
      setCurrent(r);
      setShow(true);
      timers.push(setTimeout(() => setShow(false), 4200));
    };
    const first = setTimeout(next, 2500);
    loop = setInterval(next, 6500);
    return () => { clearTimeout(first); clearInterval(loop); timers.forEach(clearTimeout); };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!feed.length || !current) return null;
  const r = current;
  const img = iconFor(r.category);
  // Payment → delivery for this order (server: liveFeed), in the reader's language.
  const delivered = r.deliverySeconds ? durationText(r.deliverySeconds, t) : null;
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
