import { useEffect, useState } from 'react';
import { api } from './api.js';
import { withFallback } from './sampleCatalog.js';

let cache = null;

/**
 * Trending products (most-sold recently).
 *
 * An empty answer from a working shop falls back to the featured showcase —
 * that is the demo shelf, and it is fine. A FAILED request does not: it returns
 * nothing, so the rail disappears. During the production outage this rail was
 * the one place still painting a full row of buyable-looking products behind an
 * "we cannot load the shop" notice, which is the exact contradiction the rest of
 * this change removes.
 */
export function useTrending() {
  const [items, setItems] = useState(cache);
  useEffect(() => {
    let live = true;
    api.get('/api/products/trending')
      .then((r) => {
        let list = r?.products || [];
        if (!list.length) list = withFallback([]).filter((p) => p.featured).slice(0, 8);
        if (live) { cache = list; setItems(list); }
      })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  return items;
}
