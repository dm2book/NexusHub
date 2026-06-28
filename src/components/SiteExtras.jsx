import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useLiveFeed, deliveryPhrase, timeAgo } from '../lib/useSocialProof.js';

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

/**
 * Rotating live social-proof popups — REAL delivered orders only (privacy-safe:
 * first name + city). Renders nothing until the store has real activity; we never
 * fabricate a purchase. Data comes from /api/social/feed.
 */
export function SocialProof() {
  const feed = useLiveFeed();
  const [idx, setIdx] = useState(-1);
  useEffect(() => {
    if (!feed?.length) return undefined;
    if (localStorage.getItem('fm_cookies') == null) return undefined; // wait until consent shown once
    let i = 0, hideT;
    const show = () => {
      setIdx(i % feed.length); i += 1;
      hideT = setTimeout(() => setIdx(-1), 5500);
    };
    const first = setTimeout(show, 6000);
    const loop = setInterval(show, 13000);
    return () => { clearTimeout(first); clearTimeout(hideT); clearInterval(loop); };
  }, [feed]);

  if (idx < 0 || !feed?.length) return null;
  const r = feed[idx] || feed[0];
  const who = r.city ? `${r.name} from ${r.city}` : r.name;
  const delivered = deliveryPhrase(r.deliverySeconds);
  return (
    <div key={r.id} className="fixed bottom-4 left-4 z-[60] card p-3 pr-5 border border-white/10 shadow-2xl flex items-center gap-3 animate-fade-up max-w-xs">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/30 to-teal-500/10 flex items-center justify-center text-lg">🛒</div>
      <div>
        <div className="text-sm text-white"><span className="font-semibold">{who}</span> got <span className="text-emerald-300">{r.item}</span></div>
        <div className="text-[11px] text-slate-500">
          {delivered ? `Delivered in ${delivered} · ` : ''}{timeAgo(r.secondsAgo)} · ✅ verified purchase
        </div>
      </div>
    </div>
  );
}

/** Back-to-top button that appears after scrolling. */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const f = () => setShow(window.scrollY > 600);
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  if (!show) return null;
  return (
    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      className="fixed bottom-24 right-5 z-40 w-11 h-11 rounded-full glass border border-white/10 text-white hover:border-primary/50 transition flex items-center justify-center">↑</button>
  );
}
