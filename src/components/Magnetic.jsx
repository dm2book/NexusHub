import { useRef } from 'react';

/**
 * Wraps an element so it gently pulls toward the cursor on hover (a classic
 * premium micro-interaction). `strength` = how far it travels (px-ish factor).
 * Renders an inline-block span so it works around buttons/links.
 */
export default function Magnetic({ children, strength = 0.35, className = '' }) {
  const ref = useRef(null);

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) * strength;
    const y = (e.clientY - (r.top + r.height / 2)) * strength;
    el.style.transform = `translate(${x}px, ${y}px)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = 'translate(0,0)'; };

  return (
    <span ref={ref} className={`magnetic inline-block ${className}`}
          onMouseMove={onMove} onMouseLeave={reset}>
      {children}
    </span>
  );
}
