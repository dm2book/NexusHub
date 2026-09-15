import { useEffect, useRef } from 'react';

/**
 * Tells a horizontal rail where its content runs off the edge.
 *
 * Sets `--fade-l` and `--fade-r` on the element; the stylesheet turns those
 * into a mask. The point is that they are ZERO when there is nothing beyond
 * that edge: a rail whose cards all fit shows no fade and never suggests there
 * is more to see, and the fade on the right disappears the moment you reach
 * the end. A permanent gradient on both sides is decoration that lies.
 *
 * Returns a ref to put on the scrolling element.
 */
export function useRailEdges({ fade = 44 } = {}) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    let raf = 0;
    const apply = () => {
      raf = 0;
      /* A couple of pixels of slack: sub-pixel layout means scrollLeft rarely
         lands exactly on 0 or on the maximum, and without it the fade flickers
         at both ends of every scroll. */
      const max = el.scrollWidth - el.clientWidth;
      const x = el.scrollLeft;
      el.style.setProperty('--fade-l', x > 2 ? `${fade}px` : '0px');
      el.style.setProperty('--fade-r', x < max - 2 ? `${fade}px` : '0px');
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };

    apply();
    el.addEventListener('scroll', schedule, { passive: true });
    /* Cards arrive after the catalogue does, and the window can change width,
       so "is there more" has to be asked again rather than answered once. */
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    for (const child of el.children) ro?.observe(child);
    window.addEventListener('resize', schedule, { passive: true });

    return () => {
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [fade]);
  return ref;
}
