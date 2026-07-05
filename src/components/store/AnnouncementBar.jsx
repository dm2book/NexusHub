import { useEffect, useState } from 'react';
import { X, Megaphone } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Site-wide promo bar, driven by the SITE_ANNOUNCEMENT env var — perfect for
 * launch offers ("Launch week: code FORGE10 = 10% off"). Dismissible; a NEW
 * announcement text reappears even after an earlier one was dismissed.
 */
export default function AnnouncementBar() {
  const [text, setText] = useState('');
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    api.get('/api/config').then((c) => {
      const msg = (c.announcement || '').trim();
      if (!msg) return;
      setText(msg);
      try { setHidden(localStorage.getItem('fm_annc_dismissed') === msg); } catch { /* private mode */ }
    }).catch(() => {});
  }, []);

  if (!text || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem('fm_annc_dismissed', text); } catch { /* ignore */ }
  };

  return (
    <div className="fm-annc relative overflow-hidden text-white text-[13.5px] font-semibold"
      style={{ backgroundImage: 'linear-gradient(100deg,#6d28d9,#7c5cff 45%,#a855f7)' }}>
      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-2 flex items-center justify-center gap-2 text-center">
        <Megaphone size={15} className="shrink-0 fm-annc-wiggle" />
        <span className="min-w-0">{text}</span>
        <button onClick={dismiss} aria-label="Dismiss"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-white/15 transition">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
