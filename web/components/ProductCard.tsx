'use client';
import { useRef } from 'react';
import Image from 'next/image';
import { Star, Zap, ShoppingCart } from 'lucide-react';
import { money, type Product } from '../lib/data';

const BADGE: Record<string, string> = {
  Bestseller: 'bg-amber-400/90 text-amber-950',
  Hot: 'bg-rose-500/90 text-white',
  New: 'bg-emerald-400/90 text-emerald-950',
  Value: 'bg-indigo-400/90 text-indigo-950',
};

/** Animated product card with a subtle 3D tilt + glow on hover. */
export default function ProductCard({ p }: { p: Product }) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${px * 6}deg) rotateX(${-py * 6}deg) translateY(-4px)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = ''; };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className="group card overflow-hidden transition-[transform,border-color] duration-200 hover:border-primary/50 will-change-transform"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <Image src={p.image} alt={p.name} fill sizes="(max-width:768px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105" />
        {p.badge && (
          <span className={`absolute left-3 top-3 text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${BADGE[p.badge]}`}>{p.badge}</span>
        )}
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 text-[11px] font-semibold bg-black/45 backdrop-blur px-2 py-1 rounded-full text-emerald-300">
          <Zap size={11} /> {p.delivery}
        </span>
      </div>
      <div className="p-4">
        <h3 className="text-white text-base leading-snug">{p.name}</h3>
        <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-400">
          <Star size={13} className="text-amber-400 fill-amber-400" />
          <span className="text-slate-200 font-medium">{p.rating.toFixed(1)}</span>
          {p.reviews > 0 && <span>· {p.reviews.toLocaleString()} reviews</span>}
        </div>
        <div className="flex items-center justify-between mt-4">
          <span className="text-xl font-semibold text-white">{money(p.price)}</span>
          <button className="btn-primary text-sm px-3.5 py-2"><ShoppingCart size={15} /> Buy</button>
        </div>
      </div>
    </div>
  );
}
