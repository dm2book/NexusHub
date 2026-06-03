import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const CartContext = createContext(null);
export const useCart = () => useContext(CartContext);

const KEY = 'fm_cart';

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  });

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(items)); }, [items]);

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
