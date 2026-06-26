import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useStats } from '../../lib/useStats.js';
import { iconFor } from '../../lib/sampleCatalog.js';

const ago = (s) => (s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`);

/**
 * Floating social-proof ticker — "Someone just got 2,800 V-Bucks · 54s ago".
 * Rotates through recent deliveries; glassmorphic, slides in/out. Pure social
 * proof, so it uses live data when available and a sample feed otherwise.
 */
export default function RecentlyDelivered() {
  const { recent } = useStats();
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!recent?.length) return;
    let i = 0;
    const cycle = () => {
      setIdx(i % recent.length);
      setShow(true);
      const hide = setTimeout(() => setShow(false), 4200);
      i += 1;
      return hide;
    };
    const first = setTimeout(cycle, 2500);
    const id = setInterval(cycle, 6500);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [recent]);

  if (!recent?.length) return null;
  const r = recent[idx];
  const img = iconFor(r.cat);

  return (
    <div className={`fixed left-4 bottom-4 z-30 transition-all duration-500 ${show ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 pointer-events-none'}`}>
      <div className="flex items-center gap-3 bg-white/90 backdrop-blur-xl border border-slate-200/70 shadow-2xl rounded-2xl pl-2.5 pr-4 py-2.5 max-w-[300px]">
        <span className="w-10 h-10 rounded-xl bg-slate-50 grid place-items-center shrink-0">
          {img ? <img src={img} alt="" className="w-7 h-7 object-contain" /> : <CheckCircle2 className="text-emerald-500" size={20} />}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-slate-900 truncate">
            Someone just got {r.item}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1">
            <CheckCircle2 size={11} className="text-emerald-500" /> Delivered · {ago(r.secondsAgo)}
          </div>
        </div>
      </div>
    </div>
  );
}
