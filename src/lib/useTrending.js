import { useEffect, useState } from 'react';
import { api } from './api.js';

let cache = null;

/**
 * Trending products: Hot, Trending, Popular and New, as the server's trending
 * engine earned them from sales, revenue, conversion and age. Each product
 * carries its `trend` label.
 *
 * An empty answer means nothing qualifies, and the rail hides: there is no
 * hand-picked showcase to fall back to. A FAILED request does the same: it returns
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
        const list = r?.products || [];
        if (live) { cache = list; setItems(list); }
      })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);
  return items;
}
