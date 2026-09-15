import { useEffect } from 'react';

/**
 * Pointer-driven 3D tilt, for a single object that should feel like it is
 * sitting in the room rather than printed on the page.
 *
 * Sets `--tx` and `--ty` (two angles) on the referenced element; the stylesheet
 * decides what to do with them, which keeps the maths here and the look there.
 * The pointer is tracked over a LARGER element than the one that tilts — the
 * whole hero stage — because an object that only reacts once the cursor is
 * physically on top of it reads as a hover effect, not as depth.
 *
 * Three things it refuses to do:
 *  - run for someone who asked for less motion;
 *  - run on a touch screen, where there is no pointer to follow and every
 *    listener is a scroll-blocking cost for an effect nobody can see;
 *  - write more than once per frame. One rAF, one layout read, two custom
 *    properties — no layout, no paint, compositor only.
 */
export function usePointerTilt(ref, { max = 9, within = '.fm-stage' } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return undefined;

    const target = el.closest(within) || el.parentElement || el;
    let raf = 0, px = 0, py = 0, resting = true;

    const apply = () => {
      raf = 0;
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height) return;
      /* -1 … 1 from the centre of the stage. At rest both are 0, which is the
         same value the stylesheet falls back to, so the tilt is genuinely
         absent rather than nearly absent. */
      const nx = resting ? 0 : Math.max(-1, Math.min(1, ((px - r.left) / r.width) * 2 - 1));
      const ny = resting ? 0 : Math.max(-1, Math.min(1, ((py - r.top) / r.height) * 2 - 1));
      el.style.setProperty('--tx', `${(nx * max).toFixed(2)}deg`);
      el.style.setProperty('--ty', `${(-ny * max).toFixed(2)}deg`);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const onMove = (e) => { px = e.clientX; py = e.clientY; resting = false; schedule(); };
    const onLeave = () => { resting = true; schedule(); };

    target.addEventListener('pointermove', onMove, { passive: true });
    target.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [ref, max, within]);
}
