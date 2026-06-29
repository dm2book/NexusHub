import { useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';

export function Spinner({ size = 20, className = '' }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />;
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
      <Spinner size={28} className="text-primary" />
      <span className="text-sm">{label}</span>
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
  const meta = STATUS_META[status] || { label: status, color: 'bg-slate-500/20 text-slate-300' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`skeleton rounded-xl ${className}`} />;
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
