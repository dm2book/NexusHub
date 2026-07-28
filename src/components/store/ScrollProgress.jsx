import { useEffect, useRef } from 'react';

/**
 * A hairline that fills as you move down the page.
 *
 * Small thing, disproportionate effect: it tells you the page has a length and
 * that it is responding to you, which is most of what the reference campaign
 * page achieves with its scroll choreography.
 *
 * Written against the DOM rather than React state on purpose — this updates on
 * every scroll frame, and re-rendering the tree sixty times a second to move a
 * bar would cost far more than the bar is worth. `scaleX` only, so it stays on
 * the compositor and never triggers layout.
 *
 * CSS `animation-timeline: scroll()` would do this with no JS at all, but it is
 * still missing on too many of the phones this shop sells to.
 */
export default function ScrollProgress() {
  const ref = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      // A page shorter than the viewport has no progress to show.
      const p = max > 40 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      el.style.transform = `scaleX(${p})`;
      el.style.opacity = p > 0.005 ? '1' : '0';
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // The page grows while you read it — images finish loading, products stream
    // in. Without this the bar is measured against a stale height and stops
    // short of the end, which is exactly what a progress indicator must not do.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onScroll) : null;
    ro?.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div aria-hidden className="fixed top-0 inset-x-0 z-50 h-[3px] pointer-events-none">
      <div ref={ref} className="fm-progress h-full origin-left" style={{ transform: 'scaleX(0)', opacity: 0 }} />
    </div>
  );
}
