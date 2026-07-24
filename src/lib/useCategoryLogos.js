/**
 * Owner-set per-category logos (managed in Admin → Categories) with a shared,
 * de-duplicated fetch: many components render category art, but the map is
 * fetched once per page load and reused.
 */
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { iconFor } from './sampleCatalog.js';

let cache = null;      // last known map
let inflight = null;   // shared promise so N components trigger 1 request

function load() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api.get('/api/config')
      .then((c) => { cache = c?.categoryLogos || {}; return cache; })
      .catch(() => { cache = {}; return cache; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** @returns {Record<string,string>} slug → image (empty until loaded). */
export function useCategoryLogos() {
  const [logos, setLogos] = useState(cache || {});
  useEffect(() => {
    let alive = true;
    load().then((m) => { if (alive) setLogos(m); });
    return () => { alive = false; };
  }, []);
  return logos;
}

/** Owner logo for a category, falling back to the built-in icon. */
export const logoFor = (logos, slug) => (slug && logos?.[slug]) || iconFor(slug);

/** Let the admin push a fresh map without a reload. */
export function primeCategoryLogos(map) { cache = map && typeof map === 'object' ? map : {}; }
