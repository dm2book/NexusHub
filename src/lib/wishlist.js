import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * The wishlist: in the browser for a guest, on the account once signed in.
 *
 * It used to live only in localStorage — gone on another device, and invisible
 * to the shop, which is the one party that could say "the thing you saved just
 * got cheaper". A signed-in shopper's list now lives on the account, and this
 * file keeps a copy in localStorage so every heart on the page answers
 * instantly, before the network does.
 *
 * The browser list is brought onto the account ONCE per account per browser.
 * Merging it on every page load would resurrect a product the shopper removed
 * on their phone the next time they opened their laptop.
 */
const KEY = 'fm_wishlist';
const importedKey = (userId) => `fm_wishlist_imported_${userId}`;

/* Storage can throw (private mode, blocked site data); the list then simply
   lives for this page view. */
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (a) => {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* not persisted */ }
  window.dispatchEvent(new Event('fm-wishlist'));
};
const flag = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; };

export const getWishlist = () => read();
export const inWishlist = (id) => read().includes(id);

/* One sync per account per page load, however many hearts ask for it. */
let syncedFor = null;
let syncing = null;

/** Mirror the account's list into this browser, importing the guest list once. */
export function syncWishlist(userId) {
  if (!userId || syncedFor === userId) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    const local = read();
    const firstTime = !flag(importedKey(userId));
    const r = firstTime && local.length
      ? await api.post('/api/account/wishlist/import', { productIds: local })
      : await api.get('/api/account/wishlist');
    flag(importedKey(userId), '1');
    write((r.items || []).map((i) => i.productId));
    syncedFor = userId;
  })().catch(() => { /* stays on the local copy; the next page load tries again */ })
    .finally(() => { syncing = null; });
  return syncing;
}

/** Toggle one product. Local first, so the heart fills at once; then the account. */
export function toggleWishlist(id, { signedIn = false } = {}) {
  const a = read();
  const i = a.indexOf(id);
  if (i >= 0) a.splice(i, 1); else a.push(id);
  write(a);
  const added = i < 0;
  if (signedIn) {
    (added ? api.post('/api/account/wishlist', { productId: id }) : api.del(`/api/account/wishlist/${id}`))
      .catch(() => { /* the local copy stands; the next sync reconciles */ });
  }
  return added;
}

/** Reactive wishlist hook → { ids, count, has, toggle, signedIn }. */
export function useWishlist() {
  const { user } = useAuth() || {};
  const [ids, setIds] = useState(read);
  useEffect(() => {
    const f = () => setIds(read());
    window.addEventListener('fm-wishlist', f);
    window.addEventListener('storage', f);
    return () => { window.removeEventListener('fm-wishlist', f); window.removeEventListener('storage', f); };
  }, []);
  useEffect(() => {
    if (user?.id) syncWishlist(user.id);
    else syncedFor = null;
  }, [user?.id]);
  return {
    ids, count: ids.length, has: (id) => ids.includes(id),
    toggle: (id) => toggleWishlist(id, { signedIn: !!user }),
    signedIn: !!user,
  };
}
