import { useSyncExternalStore } from 'react';

/**
 * Recently-viewed products (the visitor's own real history, stored locally —
 * fits the "no fabricated data" rule). Newest first, max 8, deduped.
 */
const KEY = 'fm_recent_products';
const MAX = 8;
const listeners = new Set();

function read() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
let snapshot = null;
const getSnapshot = () => { if (snapshot === null) snapshot = read(); return snapshot; };
const emit = () => { snapshot = read(); listeners.forEach((fn) => fn()); };

export function recordProductView(product) {
  if (!product?.id) return;
  try {
    const entry = {
      id: product.id, name: product.name, price: product.price,
      currency: product.currency || 'EUR', category: product.category || '',
      image: product.image || null, description: product.description || '',
    };
    const next = [entry, ...read().filter((p) => p.id !== product.id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
    emit();
  } catch { /* storage unavailable */ }
}

export function useRecentlyViewed() {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot,
    () => [],
  );
}
