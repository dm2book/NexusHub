import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './api.js';
import { allowed, onConsentChange } from './consent.js';

/**
 * Persistent anonymous visitor id — used only to count unique visitors.
 *
 * It carries no personal data, but it is still an identifier stored on someone
 * else's device, which is exactly what the law asks permission for. It used to
 * be written on the first page view, before any banner had rendered.
 */
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

/**
 * Fire an anonymous page-view beacon on every route change (best-effort).
 *
 * Silent until the visitor allows analytics. Not "anonymised then sent" —
 * nothing is stored and nothing is sent at all. A refusal leaves no id behind
 * and produces no request, so there is nothing to explain later.
 */
export function usePageViews() {
  const { pathname } = useLocation();
  // Re-render when the choice changes, so someone who accepts is counted from
  // that moment rather than only from their next navigation.
  const [ok, setOk] = useState(() => allowed('analytics'));
  useEffect(() => onConsentChange(() => setOk(allowed('analytics'))), []);

  useEffect(() => {
    if (!ok) return;
    const sid = sessionId();
    if (!sid) return;
    const body = JSON.stringify({ sid, path: pathname, ref: document.referrer || undefined });
    // Prefer sendBeacon (survives navigation); fall back to a keepalive POST.
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(`${api.base}/api/track`, new Blob([body], { type: 'application/json' }))) return;
    } catch { /* fall through */ }
    fetch(`${api.base}/api/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'include' }).catch(() => {});
  }, [pathname, ok]);
}
