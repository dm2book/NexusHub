import { useEffect, useState } from 'react';
import { api } from './api.js';

const FALLBACK = {
  delivered: 52340, customers: 10200, products: 70, avgDeliverySeconds: 24,
  rating: 4.9, reviews: 2345, discordMembers: 1240,
  recent: [
    { item: '4,500 Robux', cat: 'robux', secondsAgo: 18 },
    { item: '2,800 V-Bucks', cat: 'v-bucks', secondsAgo: 54 },
    { item: 'Discord Nitro — 1 Month', cat: 'discord-nitro', secondsAgo: 92 },
    { item: '3,650 VP — Valorant', cat: 'valorant', secondsAgo: 140 },
    { item: '€25 Steam Wallet', cat: 'steam', secondsAgo: 205 },
  ],
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
