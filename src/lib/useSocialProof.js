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
/**
 * ONE poller for the whole page, and only while it can do something useful.
 *
 * Three components read this feed — the activity ticker, the recently-delivered
 * strip and SiteExtras — and each used to run its own `setInterval`. Three
 * requests a minute, per open tab, for one shared answer. Seen in the
 * production logs at one a minute per component, indefinitely, on a shop that
 * had not sold anything yet.
 *
 * So the timer lives here, once, and subscribers are notified from it. It also
 * stops in the two cases where polling is pointless:
 *
 *   hidden tab   a tab in the background is not showing a ticker to anybody.
 *                Left open overnight it was still asking every minute.
 *   empty feed   the feed only changes when an order completes. Before the shop
 *                opens that never happens, so after a few empty answers the
 *                interval backs off rather than asking the same question of the
 *                database 1,440 times a day.
 *
 * The back-off resets the moment an answer is non-empty, so a shop that starts
 * selling returns to a live ticker without a reload.
 */
const BASE_POLL = 60_000;
const MAX_POLL = 10 * 60_000;

const subscribers = new Set();
let timer = null;
let interval = BASE_POLL;
let emptyRuns = 0;
let inFlight = null;

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

function fetchFeed() {
  // One request even if three components mount in the same frame.
  if (inFlight) return inFlight;
  inFlight = api.get('/api/social/feed')
    .then((r) => {
      if (!Array.isArray(r?.feed)) return;
      feedCache = r.feed;
      emptyRuns = r.feed.length ? 0 : emptyRuns + 1;
      // Back off geometrically while there is nothing to show; snap back the
      // instant there is.
      interval = r.feed.length ? BASE_POLL
        : Math.min(MAX_POLL, BASE_POLL * 2 ** Math.min(4, emptyRuns));
      for (const fn of subscribers) fn(r.feed);
    })
    .catch(() => { /* a ticker is not worth an error */ })
    .finally(() => { inFlight = null; reschedule(); });
  return inFlight;
}

function reschedule() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!subscribers.size || hidden()) return;
  timer = setTimeout(fetchFeed, interval);
}

function onVisibility() {
  if (hidden()) { if (timer) { clearTimeout(timer); timer = null; } return; }
  // Coming back: refresh once, then resume the normal rhythm.
  fetchFeed();
}

export function useLiveFeed({ delay = 1500 } = {}) {
  const [feed, setFeed] = useState(feedCache || []);
  useEffect(() => {
    subscribers.add(setFeed);
    if (subscribers.size === 1 && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    // The first fetch is still deliberately late (see above); a second
    // subscriber arriving later does not start another one.
    const first = setTimeout(() => { if (!hidden()) fetchFeed(); else reschedule(); }, delay);
    return () => {
      clearTimeout(first);
      subscribers.delete(setFeed);
      if (!subscribers.size) {
        if (timer) { clearTimeout(timer); timer = null; }
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibility);
        }
      }
    };
  }, [delay]);
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
