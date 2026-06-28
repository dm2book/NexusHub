import { useEffect, useState } from 'react';
import { api } from './api.js';

let cache = null;

/**
 * Real customer reviews — verified-buyer reviews and Discord /vouch posts.
 * No sample fallback: an empty store returns [] and callers show an empty state.
 */
export function useReviews() {
  const [reviews, setReviews] = useState(cache || []);
  useEffect(() => {
    let live = true;
    api.get('/api/reviews')
      .then((r) => {
        const list = (r?.reviews || []).filter((x) => x.body);
        if (live) { cache = list; setReviews(list); }
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return reviews;
}
