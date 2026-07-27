import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Adds `.is-in` to every `.fm-reveal` element as it scrolls into view.
 *
 * Two things used to stop this being a scroll reveal at all:
 *
 *  - A 1600ms timer revealed EVERY element on the page whether it had been
 *    scrolled to or not. It was meant as a safety net for content above the
 *    fold, but it fired for everything, so the effect was really "fade the
 *    whole page in over 1.6 seconds". The observer already handles above-the-
 *    fold content — it fires immediately for anything in view — so the net now
 *    only catches elements that are on screen and somehow still hidden.
 *
 *  - The element list was captured once, on mount. Products arrive from a fetch
 *    a moment later, so every card rendered after that first tick was observed
 *    by nobody. A MutationObserver now picks up what the page adds, which is
 *    exactly the content worth animating.
 *
 * Elements are revealed once and then unobserved: re-animating on scroll-back
 * is nausea, not delight.
 */
export function useReveal() {
  const { pathname } = useLocation();

  useEffect(() => {
    const showAll = () =>
      document.querySelectorAll('.fm-reveal').forEach((el) => el.classList.add('is-in'));

    // Honour the OS setting here as well as in CSS: with reduced motion on,
    // nothing may be left at opacity 0 waiting for an observer.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        || typeof IntersectionObserver === 'undefined') {
      showAll();
      return;
    }

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });

    const watch = (root) => {
      if (!(root instanceof Element)) return;
      if (root.matches('.fm-reveal') && !root.classList.contains('is-in')) io.observe(root);
      root.querySelectorAll('.fm-reveal:not(.is-in)').forEach((el) => io.observe(el));
    };
    watch(document.body);

    // Cards, rails and search results all mount after the first paint.
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach(watch);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Last resort, well after the observer has had its say: if something is on
    // screen and still hidden — a zero-height container, a browser quirk — show
    // it rather than leave a hole in the page. Anything genuinely below the
    // fold is left alone, so scrolling still reveals it.
    const net = setTimeout(() => {
      document.querySelectorAll('.fm-reveal:not(.is-in)').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');
      });
    }, 2500);

    return () => { io.disconnect(); mo.disconnect(); clearTimeout(net); };
  }, [pathname]);
}
