import { useEffect, useState } from 'react';
import { api } from './api.js';

// Neutral defaults — never fabricated numbers. Real values arrive from /api/stats;
// until then (and on error) the UI shows zeros / hides empty counters.
const FALLBACK = {
  delivered: 0, customers: 0, products: 0, avgDeliverySeconds: null,
  successRate: null, rating: null, reviews: 0, discordMembers: 0, recent: [],
};

let cache = null;

/** Public trust stats with a graceful fallback so the UI is never empty. */
export function useStats() {
  const [stats, setStats] = useState(cache || FALLBACK);
  useEffect(() => {
    let live = true;
    api.get('/api/stats')
      .then((s) => { if (live && s) { cache = { ...FALLBACK, ...s }; setStats(cache); } })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return stats;
}

export { FALLBACK as STATS_FALLBACK };
