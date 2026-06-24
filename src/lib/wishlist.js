import { useEffect, useState } from 'react';

/** Tiny localStorage-backed wishlist with cross-component updates. */
const KEY = 'fm_wishlist';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (a) => { localStorage.setItem(KEY, JSON.stringify(a)); window.dispatchEvent(new Event('fm-wishlist')); };

export const getWishlist = () => read();
export const inWishlist = (id) => read().includes(id);
export function toggleWishlist(id) {
  const a = read();
  const i = a.indexOf(id);
  if (i >= 0) a.splice(i, 1); else a.push(id);
  write(a);
  return i < 0;
}

/** Reactive wishlist hook → { ids, count, has, toggle }. */
export function useWishlist() {
  const [ids, setIds] = useState(read);
  useEffect(() => {
    const f = () => setIds(read());
    window.addEventListener('fm-wishlist', f);
    window.addEventListener('storage', f);
    return () => { window.removeEventListener('fm-wishlist', f); window.removeEventListener('storage', f); };
  }, []);
  return { ids, count: ids.length, has: (id) => ids.includes(id), toggle: toggleWishlist };
}
