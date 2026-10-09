import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';
import { useLaunch } from '../lib/useLaunch.js';

const CartContext = createContext(null);
export const useCart = () => useContext(CartContext);

const KEY = 'fm_cart';

export function CartProvider({ children }) {
  const { user, isStaff } = useAuth();
  const { prelaunch } = useLaunch();
  /* Staff walk through the gate, exactly as they do on the server.
     `prelaunch` alone is about the clock; whether THIS visitor is stopped by it
     is a different question, and answering only the first one would hide the
     checkout from the one person who needs it before launch — the owner, testing
     the shop they are about to open. Computed once here so every button in the
     storefront asks the same question. */
  const gated = prelaunch && !isStaff;
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
    if (gated) return false;
    setItems((cur) => {
      const found = cur.find((i) => i.id === product.id);
      /* Today's price, not the one saved when the line was first added. The
         product page showed €12.99 and "Buy now" only raised the quantity of a
         line still priced at €9.99, so the checkout quoted €9.99 for both. */
      if (found) {
        return cur.map((i) => (i.id === product.id ? {
          ...i, qty: i.qty + qty,
          price: Number.isFinite(product.price) ? product.price : i.price,
          name: product.name || i.name,
        } : i));
      }
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

  /**
   * The server's price for this cart — what the order will charge.
   *
   * A line keeps the price it was added at, and nothing refreshed it: the cart
   * lives in localStorage with no expiry, so a product repriced since then was
   * quoted at the old price while the order charged the new one. This asks
   * POST /api/checkout/quote, which runs the same pricing as the order, and
   * writes the prices it answers with back into the cart. `changed` lists every
   * line whose price moved, so the page can say so before the buyer pays.
   */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const quote = useCallback(async ({ coupon, useCredit } = {}) => {
    const lines = itemsRef.current;
    if (!lines.length) return null;
    const q = await api.post('/api/checkout/quote', {
      items: lines.map((i) => ({ productId: i.id, quantity: i.qty })),
      ...(coupon ? { coupon } : {}),
      ...(useCredit ? { useCredit } : {}),
    });
    const fresh = new Map((q.lines || []).map((l) => [l.productId, l]));
    const changed = lines
      .filter((i) => fresh.has(i.id) && fresh.get(i.id).unitPrice !== i.price)
      .map((i) => ({ id: i.id, name: fresh.get(i.id).name || i.name, was: i.price, now: fresh.get(i.id).unitPrice }));
    if (changed.length) {
      setItems((cur) => cur.map((i) => {
        const l = fresh.get(i.id);
        return l && l.unitPrice !== i.price ? { ...i, price: l.unitPrice, name: l.name || i.name } : i;
      }));
    }
    return { quote: q, changed };
  }, []);

  const count = useMemo(() => items.reduce((n, i) => n + i.qty, 0), [items]);
  const subtotal = useMemo(() => items.reduce((n, i) => n + i.price * i.qty, 0), [items]);
  const currency = items[0]?.currency || 'EUR';

  return (
    <CartContext.Provider value={{ items, add, setQty, remove, clear, quote, count, subtotal, currency, prelaunch: gated }}>
      {children}
    </CartContext.Provider>
  );
}
