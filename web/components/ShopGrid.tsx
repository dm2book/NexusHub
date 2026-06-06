'use client';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CATEGORIES, type Product } from '../lib/data';
import ProductCard from './ProductCard';

const SORTS: Record<string, (a: Product, b: Product) => number> = {
  popular: (a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0) || b.reviews - a.reviews,
  price_asc: (a, b) => a.price - b.price,
  price_desc: (a, b) => b.price - a.price,
  rating: (a, b) => b.rating - a.rating,
};

export default function ShopGrid({ products }: { products: Product[] }) {
  const [active, setActive] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('popular');

  const cats = useMemo(() => {
    const present = new Set(products.map((p) => p.category));
    return CATEGORIES.filter((c) => present.has(c.key));
  }, [products]);

  const visible = useMemo(() => {
    let list = products.slice();
    if (active !== 'all') list = list.filter((p) => p.category === active);
    if (q.trim()) list = list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    return list.sort(SORTS[sort]);
  }, [products, active, q, sort]);

  return (
    <>
      <div className="flex flex-col lg:flex-row gap-4 lg:items-center justify-between mb-7">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setActive('all')} className={`chip ${active === 'all' ? 'bg-primary text-white border-transparent shadow-neon' : 'hover:text-white'}`}>All</button>
          {cats.map((c) => (
            <button key={c.key} onClick={() => setActive(c.key)} className={`chip ${active === c.key ? 'bg-primary text-white border-transparent shadow-neon' : 'hover:text-white'}`}>{c.label}</button>
          ))}
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1 lg:w-72">
            <Search size={16} className="absolute left-3 top-3.5 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…"
              className="w-full rounded-xl bg-ink/80 border border-white/10 pl-9 pr-4 py-2.5 text-white placeholder-slate-500 outline-none focus:border-primary" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)}
            className="rounded-xl bg-ink/80 border border-white/10 px-4 py-2.5 text-white outline-none focus:border-primary cursor-pointer">
            <option value="popular">Popular</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
            <option value="rating">Top rated</option>
          </select>
        </div>
      </div>

      <div className="text-slate-500 text-sm mb-4">{visible.length} products</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {visible.map((p) => <ProductCard key={p.id} p={p} />)}
      </div>
    </>
  );
}
