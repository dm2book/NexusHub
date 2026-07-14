import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from './AuthContext.jsx';

const CartContext = createContext(null);
export const useCart = () => useContext(CartContext);

const KEY = 'fm_cart';

export function CartProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  });

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(items)); }, [items]);

  // On login, pull the server-saved cart so it follows the shopper across
  // devices; only restore when the local cart is empty (never clobber a cart
  // they're actively building).
  const restoredFor = useRef(null);
  useEffect(() => {
    if (!user?.id || restoredFor.current === user.id) return;
    restoredFor.current = user.id;
    api.get('/api/account/cart').then((r) => {
      if (Array.isArray(r.items) && r.items.length && items.length === 0) setItems(r.items);
    }).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror the cart to the server (debounced) so an abandoned cart can be
  // recovered. Only while signed in; guests stay purely local.
  useEffect(() => {
    if (!user?.id) return;
    const t = setTimeout(() => { api.put('/api/account/cart', { items }).catch(() => {}); }, 900);
    return () => clearTimeout(t);
  }, [items, user?.id]);

  const add = (product, qty = 1) => {
    setItems((cur) => {
      const found = cur.find((i) => i.id === product.id);
      if (found) return cur.map((i) => (i.id === product.id ? { ...i, qty: i.qty + qty } : i));
      return [...cur, {
        id: product.id, name: product.name, price: product.price,
        currency: product.currency || 'EUR', category: product.category, qty,
      }];
    });
  };
  const setQty = (id, qty) =>
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, qty: Math.max(1, qty) } : i)));
  const remove = (id) => setItems((cur) => cur.filter((i) => i.id !== id));
  const clear = () => setItems([]);

  const count = useMemo(() => items.reduce((n, i) => n + i.qty, 0), [items]);
  const subtotal = useMemo(() => items.reduce((n, i) => n + i.price * i.qty, 0), [items]);
  const currency = items[0]?.currency || 'EUR';

  return (
    <CartContext.Provider value={{ items, add, setQty, remove, clear, count, subtotal, currency }}>
      {children}
    </CartContext.Provider>
  );
}
