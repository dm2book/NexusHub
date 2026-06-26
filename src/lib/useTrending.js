import { useEffect, useState } from 'react';
import { api } from './api.js';
import { withFallback } from './sampleCatalog.js';

let cache = null;

/** Trending products (most-sold recently) with a featured/sample fallback. */
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
      .catch(() => { const fb = withFallback([]).filter((p) => p.featured).slice(0, 8); cache = fb; setItems(fb); });
    return () => { live = false; };
  }, []);
  return items;
}
