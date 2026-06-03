/** Consistent wrapper for static info/legal pages. */
export default function InfoShell({ eyebrow, title, subtitle, children, narrow = true }) {
  return (
    <div className="section py-16">
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] p-8 sm:p-12 mb-10 text-center">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="orb w-72 h-72 bg-primary/20 -top-24 right-10" />
        <div className="relative">
          {eyebrow && <span className="eyebrow mb-4">{eyebrow}</span>}
          <h1 className="text-3xl sm:text-4xl text-white mt-4">{title}</h1>
          {subtitle && <p className="text-slate-400 mt-3 max-w-2xl mx-auto">{subtitle}</p>}
        </div>
      </div>
      <div className={narrow ? 'max-w-3xl mx-auto' : ''}>{children}</div>
    </div>
  );
}

/** Prose helpers for legal/long-form content. */
export function Prose({ children }) {
  return <div className="space-y-4 text-slate-300 leading-relaxed [&_h2]:text-white [&_h2]:text-xl [&_h2]:font-display [&_h2]:mt-8 [&_h2]:mb-2 [&_p]:text-slate-400 [&_li]:text-slate-400 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">{children}</div>;
}
