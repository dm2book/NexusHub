/**
 * The shop's public Trustpilot profile, served from `/api/config` so it is set
 * once as an env var and never hard-coded into the bundle.
 *
 * Shared + de-duplicated like the category logos: three surfaces render this
 * link (homepage, reviews page, footer) and none of them should cost an extra
 * request. `''` is a first-class value — it means "no profile yet", and every
 * caller must render nothing rather than a link that 404s. Sending a buyer who
 * went to check the reviews to an error page is worse than showing no link.
 */
import { useEffect, useState } from 'react';
import { api } from './api.js';

let cache = null;      // string once known (may legitimately be '')
let inflight = null;

function load() {
  if (cache !== null) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api.get('/api/config')
      .then((c) => { cache = String(c?.trustpilotUrl || '').trim(); return cache; })
      .catch(() => { cache = ''; return cache; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** @returns {string} the profile URL, or '' while loading / when unset. */
export function useTrustpilot() {
  const [url, setUrl] = useState(cache || '');
  useEffect(() => {
    let alive = true;
    load().then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, []);
  return url;
}
