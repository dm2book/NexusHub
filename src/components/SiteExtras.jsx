import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/** Dismissible promo strip above the header (set SITE_ANNOUNCEMENT on the server). */
export function AnnouncementBar() {
  const [text, setText] = useState('');
  const [closed, setClosed] = useState(() => sessionStorage.getItem('fm_ann_closed') === '1');
  useEffect(() => { api.get('/api/config').then((c) => setText(c.announcement || '')).catch(() => {}); }, []);
  if (!text || closed) return null;
  return (
    <div className="relative text-center text-sm text-white py-2 px-8"
         style={{ background: 'linear-gradient(90deg,#6366f1,#a855f7,#ec4899)' }}>
      <span className="font-medium">{text}</span>
      <button onClick={() => { sessionStorage.setItem('fm_ann_closed', '1'); setClosed(true); }}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white">✕</button>
    </div>
  );
}

/** GDPR cookie consent (EU/NL). Stores acceptance in localStorage. */
export function CookieConsent() {
  const [ok, setOk] = useState(() => localStorage.getItem('fm_cookies') === '1');
  if (ok) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[70] max-w-sm card p-4 border border-white/10 shadow-2xl">
      <p className="text-sm text-slate-300">
        We use essential cookies to keep you signed in and remember your cart. By using
        ForgeMarket you agree to our <a href="/privacy" className="text-indigo-400">privacy policy</a>.
      </p>
      <div className="flex gap-2 mt-3">
        <button onClick={() => { localStorage.setItem('fm_cookies', '1'); setOk(true); }} className="btn-primary text-sm flex-1">Accept</button>
        <a href="/privacy" className="btn-ghost text-sm">Learn more</a>
      </div>
    </div>
  );
}
