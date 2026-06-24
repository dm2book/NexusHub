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

/** Rotating "someone just bought X" social-proof popups (FOMO, pure client-side). */
const NAMES = ['Liam', 'Noa', 'Sam', 'Emma', 'Luca', 'Mила', 'Finn', 'Yara', 'Jay', 'Sara', 'Tom', 'Ravi'];
const BUYS = ['1,000 Robux', '2,800 V-Bucks', 'Valorant Points', 'CoD Points', 'a Steam Wallet code',
  'Genshin Crystals', 'a PlayStation card', 'Brawl Stars Gems', 'Discord Nitro'];
const CITIES = ['Amsterdam', 'Berlin', 'London', 'Paris', 'Madrid', 'Rotterdam', 'Dublin', 'Oslo'];
export function SocialProof() {
  const [pop, setPop] = useState(null);
  useEffect(() => {
    if (localStorage.getItem('fm_cookies') == null) return undefined; // wait until consent shown once
    let t1, t2;
    const show = () => {
      const name = NAMES[Math.floor(Math.random() * NAMES.length)];
      const buy = BUYS[Math.floor(Math.random() * BUYS.length)];
      const city = CITIES[Math.floor(Math.random() * CITIES.length)];
      const mins = 1 + Math.floor(Math.random() * 30);
      setPop({ name, buy, city, mins, id: Date.now() });
      t2 = setTimeout(() => setPop(null), 5500);
    };
    const loop = () => { show(); t1 = setTimeout(loop, 11000 + Math.random() * 9000); };
    t1 = setTimeout(loop, 6000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (!pop) return null;
  return (
    <div key={pop.id} className="fixed bottom-4 left-4 z-[60] card p-3 pr-5 border border-white/10 shadow-2xl flex items-center gap-3 animate-fade-up max-w-xs">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/30 to-teal-500/10 flex items-center justify-center text-lg">🛒</div>
      <div>
        <div className="text-sm text-white"><span className="font-semibold">{pop.name}</span> from {pop.city} just bought <span className="text-emerald-300">{pop.buy}</span></div>
        <div className="text-[11px] text-slate-500">{pop.mins} min ago · ✅ verified purchase</div>
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
