import { useEffect, useState } from 'react';
import { api } from './api.js';

const SAMPLE = [
  { id: 's1', author: 'Alex M.', stars: 5, body: 'Fast delivery and best prices! Got my Robux in seconds.', product: 'Robux', createdAt: null },
  { id: 's2', author: 'Sarah K.', stars: 5, body: 'Super reliable and great support. Will buy again!', product: 'V-Bucks', createdAt: null },
  { id: 's3', author: 'Liam R.', stars: 5, body: 'Tracked my order live and got instant Nitro. 10/10.', product: 'Discord Nitro', createdAt: null },
  { id: 's4', author: 'Noa P.', stars: 5, body: 'Cleanest store I have used. Code arrived immediately.', product: 'Steam Wallet', createdAt: null },
];

let cache = null;

/** Live customer reviews (ingested from Discord /vouch) with a sample fallback. */
export function useReviews() {
  const [reviews, setReviews] = useState(cache || SAMPLE);
  useEffect(() => {
    let live = true;
    api.get('/api/reviews')
      .then((r) => {
        const list = (r?.reviews || []).filter((x) => x.body);
        if (live && list.length) { cache = list; setReviews(list); }
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return reviews;
}

export { SAMPLE as SAMPLE_REVIEWS };
