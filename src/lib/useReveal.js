import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Adds `.is-in` to every `.fm-reveal` element when it scrolls into view, for
 * staggered scroll-reveal animations. Re-scans on route change.
 */
export function useReveal() {
  const { pathname } = useLocation();
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.fm-reveal:not(.is-in)'));
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    els.forEach((el) => io.observe(el));
    // Safety: reveal anything still hidden after a moment (e.g. above the fold).
    const t = setTimeout(() => els.forEach((el) => el.classList.add('is-in')), 1600);
    return () => { io.disconnect(); clearTimeout(t); };
  }, [pathname]);
}
