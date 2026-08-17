import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';

/** Premium orbit spinner (two counter-rotating arcs). Size is in px. */
export function Spinner({ size = 20, className = '' }) {
  return <span className={`fm-orbit ${className}`} style={{ fontSize: `${size}px` }} role="status" aria-label="Loading" />;
}

/** Inline three-dot "thinking" pulse — for buttons / inline loading. */
export function Dots({ className = '' }) {
  return <span className={`fm-dots ${className}`} aria-hidden="true"><i /><i /><i /></span>;
}

/**
 * Whole-page loading state.
 *
 * min-h-screen holds the space the real content is about to take. Without it
 * this was ~192px tall, the footer rendered a third of the way up the screen,
 * and the moment the data arrived everything below it jumped down. Measured on
 * a product page at 390px on throttled 4G: a single layout shift of 0.518,
 * against a "good" threshold of 0.1 — the worst number anywhere on the site,
 * caused entirely by a spinner smaller than what replaced it. 0.518 → 0.000.
 *
 * A viewport rather than a pixel value: the point is that the footer stays off
 * screen until there is something above it, and that is a viewport question.
 */
export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-24 text-slate-400 gap-4 fm-page">
      <Spinner size={30} className="text-primary" />
      <span className="text-sm tracking-wide text-slate-500 flex items-center gap-1.5">{label}<Dots className="text-slate-500" /></span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative card w-full ${widths[size]} animate-fade-up shadow-2xl`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

// ── Order status visuals ─────────────────────────────────────────────────
export const STATUS_META = {
  pending: { label: 'Pending', color: 'bg-slate-500/20 text-slate-300' },
  payment_received: { label: 'Payment Received', color: 'bg-blue-500/20 text-blue-300' },
  processing: { label: 'Processing', color: 'bg-indigo-500/20 text-indigo-300' },
  awaiting_fulfillment: { label: 'Awaiting Fulfillment', color: 'bg-amber-500/20 text-amber-300' },
  completed: { label: 'Completed', color: 'bg-emerald-500/20 text-emerald-300' },
  refunded: { label: 'Refunded', color: 'bg-fuchsia-500/20 text-fuchsia-300' },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-300' },
  failed: { label: 'Failed', color: 'bg-red-500/20 text-red-300' },
};

export function StatusBadge({ status }) {
  const { t } = useI18n();
  const meta = STATUS_META[status] || { label: status, color: 'bg-slate-500/20 text-slate-300' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${meta.color}`}>
      {t(`status.${status}`, meta.label)}
    </span>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`fm-skeleton ${className}`} />;
}

/** A few lines of placeholder text (last line shorter). */
export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 rounded-md ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** Product-card placeholder (storefront grids). */
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`card p-4 ${className}`}>
      <Skeleton className="h-32 rounded-xl mb-4" />
      <Skeleton className="h-3.5 w-3/4 rounded-md mb-2" />
      <Skeleton className="h-3 w-1/2 rounded-md mb-4" />
      <Skeleton className="h-9 rounded-xl" />
    </div>
  );
}

/** KPI / stat-card placeholder. */
export function SkeletonStat({ className = '' }) {
  return (
    <div className={`card p-4 ${className}`}>
      <Skeleton className="w-9 h-9 rounded-xl mb-3" />
      <Skeleton className="h-6 w-2/3 rounded-md mb-2" />
      <Skeleton className="h-3 w-1/2 rounded-md" />
    </div>
  );
}

/** Table-row placeholders (admin/account tables). */
export function SkeletonRows({ rows = 6, cols = 5, className = '' }) {
  return (
    <div className={`card divide-y divide-white/5 ${className}`}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-3.5 rounded-md ${c === 0 ? 'w-24' : c === cols - 1 ? 'w-12 ml-auto' : 'flex-1'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Marketing section heading with eyebrow + gradient title. */
export function SectionHeading({ eyebrow, title, subtitle, center = true }) {
  return (
    <div className={`${center ? 'text-center mx-auto' : ''} max-w-2xl mb-12`}>
      {eyebrow && <span className="eyebrow mb-4">{eyebrow}</span>}
      <h2 className="text-3xl sm:text-4xl text-white mt-4 leading-tight">{title}</h2>
      {subtitle && <p className="text-slate-400 mt-4 text-base sm:text-lg">{subtitle}</p>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && <Icon size={40} className="text-slate-600 mb-4" />}
      <p className="text-slate-300 font-medium">{title}</p>
      {hint && <p className="text-slate-500 text-sm mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
