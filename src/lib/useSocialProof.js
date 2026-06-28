import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Real social-proof data. There is NO sample fallback by design — when the store
 * has had no real activity these return empty/null and the UI simply hides the
 * relevant block. We never fabricate a purchase or a statistic.
 */
let feedCache = null;
let statsCache = null;

/** Live purchases feed: [{ name, city, item, category, deliverySeconds, secondsAgo }]. */
export function useLiveFeed({ poll = 60_000 } = {}) {
  const [feed, setFeed] = useState(feedCache || []);
  useEffect(() => {
    let live = true;
    const load = () => api.get('/api/social/feed')
      .then((r) => { if (live && Array.isArray(r?.feed)) { feedCache = r.feed; setFeed(r.feed); } })
      .catch(() => {});
    load();
    const t = poll ? setInterval(load, poll) : null;
    return () => { live = false; if (t) clearInterval(t); };
  }, [poll]);
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

/** "delivered in 34 seconds" / "in 2 min". */
export function deliveryPhrase(seconds) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

/** "12s ago" / "4m ago" / "2h ago" / "3d ago". */
export function timeAgo(seconds) {
  const s = Math.max(1, Math.round(seconds || 0));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
