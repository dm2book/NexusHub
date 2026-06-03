'use client';

import { clsx } from '@/lib/clsx';

const COLORS = ['#8b5cf6', '#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#3b82f6'];

export function TokenAvatar({ symbol, src, size = 36 }: { symbol: string; src?: string; size?: number }) {
  const color = COLORS[symbol.charCodeAt(0) % COLORS.length];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={symbol} width={size} height={size} className="rounded-full object-cover" />;
  }
  return (
    <div
      className={clsx('flex items-center justify-center rounded-full font-display font-bold text-white')}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}, ${color}99)`, fontSize: size * 0.36 }}
    >
      {symbol.slice(0, 2).toUpperCase()}
    </div>
  );
}
