import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Real social-proof data. There is NO sample fallback by design — when the store
 * has had no real activity these return empty/null and the UI simply hides the
 * relevant block. We never fabricate a purchase or a statistic.
 */
let feedCache = null;
let statsCache = null;

/**
 * Live purchases feed: [{ name, city, item, category, deliverySeconds, secondsAgo }].
 *
 * Deliberately late. Nothing that reads this feed shows anything before 2.5
 * seconds — the tickers rotate in on their own timers — and the request used to
 * go out in the same wave as the product itself, on a phone connection already
 * carrying the bundle, the fonts and the artwork. So the default waits, and a
 * caller whose first frame is even later (SiteExtras: six seconds) says so.
 */
export function useLiveFeed({ poll = 60_000, delay = 1500 } = {}) {
  const [feed, setFeed] = useState(feedCache || []);
  useEffect(() => {
    let live = true;
    let t = null;
    const load = () => api.get('/api/social/feed')
      .then((r) => { if (live && Array.isArray(r?.feed)) { feedCache = r.feed; setFeed(r.feed); } })
      .catch(() => {});
    const start = () => { load(); if (poll) t = setInterval(load, poll); };
    const first = delay ? setTimeout(start, delay) : (start(), null);
    return () => { live = false; if (first) clearTimeout(first); if (t) clearInterval(t); };
  }, [poll, delay]);
  return feed;
}

/** Real trust statistics, or null until loaded (caller decides what to render). */
export function useTrustStats() {
  const [stats, setStats] = useState(statsCache);
  useEffect(() => {
    let live = true;
    api.get('/api/social/stats')
      .then((s) => { if (live && s) { statsCache = s; setStats(s); } })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return stats;
}

// These run outside React, so read the storefront language directly.
const isNl = () => { try { return localStorage.getItem('fm_lang') === 'nl'; } catch { return false; } };

/** "delivered in 34 seconds" / "in 2 min" (localized). */
export function deliveryPhrase(seconds) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 90) {
    return isNl() ? `${seconds} seconde${seconds === 1 ? '' : 'n'}`
      : `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

/** "12s ago" / "4m ago" / "2h ago" / "3d ago" (localized). */
export function timeAgo(seconds) {
  const s = Math.max(1, Math.round(seconds || 0));
  const ago = (v) => (isNl() ? `${v} geleden` : `${v} ago`);
  if (s < 60) return ago(`${s}s`);
  if (s < 3600) return ago(`${Math.floor(s / 60)}m`);
  if (s < 86400) return ago(`${Math.floor(s / 3600)}${isNl() ? 'u' : 'h'}`);
  return ago(`${Math.floor(s / 86400)}d`);
}
