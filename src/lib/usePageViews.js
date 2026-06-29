import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api.js';

// Persistent anonymous visitor id (no PII) — used only to count unique visitors.
function sessionId() {
  try {
    let id = localStorage.getItem('fm_sid');
    if (!id) {
      id = 'v_' + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('fm_sid', id);
    }
    return id;
  } catch { return null; }
}

/** Fire an anonymous page-view beacon on every route change (best-effort). */
export function usePageViews() {
  const { pathname } = useLocation();
  useEffect(() => {
    const sid = sessionId();
    if (!sid) return;
    const body = JSON.stringify({ sid, path: pathname, ref: document.referrer || undefined });
    // Prefer sendBeacon (survives navigation); fall back to a keepalive POST.
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(`${api.base}/api/track`, new Blob([body], { type: 'application/json' }))) return;
    } catch { /* fall through */ }
    fetch(`${api.base}/api/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'include' }).catch(() => {});
  }, [pathname]);
}
