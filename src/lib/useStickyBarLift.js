import { useEffect } from 'react';

/**
 * Push the floating chat bubble above whatever sticky bars a page stacks in the
 * bottom-right corner.
 *
 * The bubble was positioned to clear one bar (the mobile tab bar, 73px). Cart
 * stacks its own checkout bar on top of that — measured at 390px: 73px + 63px —
 * and a hit test found the bubble sitting on the right-hand end of the Checkout
 * button. A tap there opened the chat instead of paying, on the two pages where
 * that costs the most.
 *
 * Measured rather than hard-coded, because the first attempt used a plausible
 * number (96px) that was simply wrong for a page with two bars, and a magic
 * number would go stale the next time a bar changes height.
 *
 * A CSS variable rather than a class: the bubble lives elsewhere in the tree and
 * is `position: fixed`, so nothing a page renders can reach it otherwise.
 */
export function useStickyBarLift() {
  useEffect(() => {
    const root = document.documentElement;

    const measure = () => {
      const vh = window.innerHeight;
      let highestTop = vh;
      for (const el of document.querySelectorAll('body *')) {
        // The bubble and its panel are what we are moving — never measure them.
        if (el.classList.contains('fm-fab') || el.classList.contains('fm-fab-panel')) continue;
        if (getComputedStyle(el).position !== 'fixed') continue;
        const r = el.getBoundingClientRect();
        // Wide, tall enough to matter, and living in the bottom half of the
        // screen. Deliberately NOT "touching the bottom edge": Cart stacks its
        // checkout bar ON TOP of the tab bar, so that test measured only the
        // lower one and left the bubble sitting on the button above it.
        if (r.height < 24 || r.width < window.innerWidth * 0.5) continue;
        if (r.top < vh * 0.5) continue;
        if (r.top < highestTop) highestTop = r.top;
      }
      const lift = Math.max(0, Math.round(vh - highestTop));
      if (lift > 0) root.style.setProperty('--fm-fab-lift', `${lift}px`);
      else root.style.removeProperty('--fm-fab-lift');
    };

    // The bars mount with the page, so measure after paint and again on resize
    // (rotation changes which bars are shown and how tall they are).
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 400); // covers bars that appear after a fetch
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--fm-fab-lift');
    };
  }, []);
}
