import { useEffect, useRef, useState } from 'react';

/**
 * Reveals its children with a fade + rise the first time they scroll into view.
 * Lightweight (IntersectionObserver, no deps) and respects reduced-motion via CSS.
 */
export default function Reveal({ children, delay = 0, className = '', as: Tag = 'div' }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`reveal ${shown ? 'in-view' : ''} ${className}`}
         style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}
