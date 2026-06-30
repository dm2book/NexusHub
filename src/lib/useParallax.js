import { useEffect } from 'react';

/**
 * Scroll-driven parallax. Sets `--sy` (the page scroll offset, in px) on the
 * referenced element; descendant layers translate by `calc(var(--sy) * var(--d))`
 * so each moves at its own depth. rAF-throttled, passive, compositor-only, and a
 * no-op under reduced-motion.
 */
export function useParallax(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    let raf = 0;
    const apply = () => {
      raf = 0;
      el.style.setProperty('--sy', String(window.scrollY || window.pageYOffset || 0));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
    window.addEventListener('scroll', onScroll, { passive: true });
    apply();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [ref]);
}
