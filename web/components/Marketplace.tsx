'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { CATEGORIES, type Product } from '../lib/data';
import ProductCard from './ProductCard';
import Reveal from './Reveal';

export default function Marketplace({ products }: { products: Product[] }) {
  const [active, setActive] = useState<string>('all');
  const cats = useMemo(() => {
    const present = new Set(products.map((p) => p.category));
    return CATEGORIES.filter((c) => present.has(c.key));
  }, [products]);
  const visible = active === 'all' ? products : products.filter((p) => p.category === active);

  return (
    <section id="marketplace" className="container-x py-20 sm:py-24">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
        <div>
          <span className="eyebrow">Marketplace</span>
          <h2 className="text-3xl sm:text-5xl mt-4">Top-ups players love</h2>
        </div>
        <Link href="/shop" className="btn-ghost text-sm">View all <ArrowRight size={16} /></Link>
      </div>

      <div className="flex flex-wrap gap-2 mb-8">
        <button onClick={() => setActive('all')} className={`chip ${active === 'all' ? 'bg-primary text-white border-transparent shadow-neon' : 'hover:text-white'}`}>All</button>
        {cats.map((c) => (
          <button key={c.key} onClick={() => setActive(c.key)}
            className={`chip ${active === c.key ? 'bg-primary text-white border-transparent shadow-neon' : 'hover:text-white'}`}>
            {c.label}
          </button>
        ))}
      </div>

      <Reveal className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5" stagger={0.05}>
        {visible.slice(0, 12).map((p) => <ProductCard key={p.id} p={p} />)}
      </Reveal>
    </section>
  );
}
