/**
 * The shop's public runtime config, fetched exactly once per page load.
 *
 * `/api/config` is one small, identical, CDN-cached document that nine
 * different surfaces need: the announcement bar, the payment methods, the
 * Trustpilot links, the category logos, the checkout, the track page. Each of
 * them used to fetch it. Two had their own in-flight dedupe, which helped only
 * within their own module and knew nothing about the other seven.
 *
 * Measured in a browser before this existed: FOUR requests to /api/config on a
 * single homepage load, three on the shop and the checkout, two on a product
 * page. Each is a round trip on the critical path of a phone on 4G, for a body
 * every caller already had.
 *
 * One module-level promise fixes all of it: the first caller starts the
 * request, every later caller gets the same promise, and the resolved value is
 * kept for the life of the page. A failure is cached as an empty object rather
 * than retried in a loop — every consumer already treats missing fields as
 * "not configured", so a hiccup degrades instead of hammering.
 */
import { useEffect, useState } from 'react';
import { api } from './api.js';

const EMPTY = {};
let cache = null;
let inflight = null;

/** The config, as a promise. Safe to call from anywhere, any number of times. */
export function getConfig() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api.get('/api/config')
      .then((c) => { cache = c && typeof c === 'object' ? c : EMPTY; return cache; })
      .catch(() => { cache = EMPTY; return cache; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * The config as state.
 *
 * Starts from the cache when it is already known, so a component mounted after
 * the first fetch renders with real values on its first paint instead of
 * flashing empty and then filling in.
 */
export function useConfig() {
  const [cfg, setCfg] = useState(() => cache || EMPTY);
  useEffect(() => {
    let alive = true;
    getConfig().then((c) => { if (alive) setCfg(c); });
    return () => { alive = false; };
  }, []);
  return cfg;
}
