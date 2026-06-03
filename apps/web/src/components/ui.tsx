'use client';

import { motion } from 'framer-motion';
import { clsx } from '@/lib/clsx';

export function Card({
  children,
  className,
  hover,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: 'easeOut' }}
      className={clsx('glass p-5', hover && 'glass-hover', className)}
    >
      {children}
    </motion.div>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: 'up' | 'down' | 'brand';
}) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div
        className={clsx(
          'mt-1 text-2xl font-display font-bold tabular',
          accent === 'up' && 'text-up',
          accent === 'down' && 'text-down',
          accent === 'brand' && 'text-brand-300',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500 tabular">{sub}</div>}
    </div>
  );
}

export function ScoreBadge({ label, value, kind }: { label: string; value: number; kind: 'good' | 'bad' | 'neutral' }) {
  const color =
    kind === 'good'
      ? 'text-up bg-up/10 border-up/20'
      : kind === 'bad'
        ? 'text-down bg-down/10 border-down/20'
        : 'text-brand-300 bg-brand/10 border-brand/20';
  return (
    <div className={clsx('rounded-lg border px-2 py-1 text-center', color)}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-sm font-bold tabular">{value}</div>
    </div>
  );
}

export function Pill({ children, kind = 'neutral' }: { children: React.ReactNode; kind?: 'up' | 'down' | 'neutral' | 'warn' }) {
  const cls = {
    up: 'bg-up/10 text-up',
    down: 'bg-down/10 text-down',
    neutral: 'bg-white/5 text-slate-300',
    warn: 'bg-accent-gold/10 text-accent-gold',
  }[kind];
  return <span className={clsx('pill', cls)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('shimmer animate-shimmer rounded-lg', className)} />;
}

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-display text-lg font-bold text-slate-100">{title}</h2>
      {action}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-16 text-center">
      <div className="text-3xl">🪙</div>
      <div className="mt-3 font-display font-semibold text-slate-300">{title}</div>
      {hint && <div className="mt-1 text-sm text-slate-500">{hint}</div>}
    </div>
  );
}
