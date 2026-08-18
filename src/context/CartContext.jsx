import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { useLaunch } from '../lib/useLaunch.js';

const CartContext = createContext(null);
export const useCart = () => useContext(CartContext);

const KEY = 'fm_cart';

export function CartProvider({ children }) {
  const { user } = useAuth();
  const { prelaunch } = useLaunch();
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  });

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(items)); }, [items]);

  // On login, pull the server-saved cart so it follows the shopper across
  // devices; only restore when the local cart is empty (never clobber a cart
  // they're actively building). The functional update reads the CURRENT cart,
  // not the closure from when the request started — an item added while the
  // GET was in flight is never replaced by an old server cart.
  const restoredFor = useRef(null);
  const [syncReady, setSyncReady] = useState(false);
  useEffect(() => {
    if (!user?.id) { setSyncReady(false); return; }
    if (restoredFor.current === user.id) return;
    restoredFor.current = user.id;
    api.get('/api/account/cart').then((r) => {
      if (Array.isArray(r.items) && r.items.length) {
        setItems((cur) => (cur.length ? cur : r.items));
      }
    }).catch(() => {})
      // Only start mirroring AFTER the restore settled — otherwise a slow cold
      // start lets the 900ms mirror PUT an empty local cart over the saved one.
      .finally(() => setSyncReady(true));
  }, [user?.id]);

  // Mirror the cart to the server (debounced) so an abandoned cart can be
  // recovered. Only while signed in and after restore; guests stay purely local.
  useEffect(() => {
    if (!user?.id || !syncReady) return;
    const t = setTimeout(() => { api.put('/api/account/cart', { items }).catch(() => {}); }, 900);
    return () => clearTimeout(t);
  }, [items, user?.id, syncReady]);

  /**
   * Adding to the cart, refused before launch.
   *
   * Guarded here rather than on the buttons: "add to cart" is reachable from the
   * product page, the bundles row, the command palette and the mobile bar, and
   * disabling four buttons means remembering the fifth. One refusal at the point
   * every one of them passes through covers the lot — the same reasoning the
   * server uses for `createOrder`.
   *
   * It returns false rather than throwing, so a caller can tell the difference
   * between "added" and "not yet" and say something useful.
   */
  const add = (product, qty = 1) => {
    if (prelaunch) return false;
    setItems((cur) => {
      const found = cur.find((i) => i.id === product.id);
      if (found) return cur.map((i) => (i.id === product.id ? { ...i, qty: i.qty + qty } : i));
      return [...cur, {
        id: product.id, name: product.name, price: product.price,
        currency: product.currency || 'EUR', category: product.category, qty,
      }];
    });
    return true;
  };
  const setQty = (id, qty) =>
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, qty: Math.max(1, qty) } : i)));
  const remove = (id) => setItems((cur) => cur.filter((i) => i.id !== id));
  const clear = () => setItems([]);

  const count = useMemo(() => items.reduce((n, i) => n + i.qty, 0), [items]);
  const subtotal = useMemo(() => items.reduce((n, i) => n + i.price * i.qty, 0), [items]);
  const currency = items[0]?.currency || 'EUR';

  return (
    <CartContext.Provider value={{ items, add, setQty, remove, clear, count, subtotal, currency, prelaunch }}>
      {children}
    </CartContext.Provider>
  );
}
