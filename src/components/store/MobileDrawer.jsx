import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../lib/useFocusTrap.js';

/**
 * The phone menu, as a panel that actually covers the page.
 *
 * Both drawers used to be a block that simply appeared inside the sticky
 * header and pushed nothing aside, which produced three defects at once on a
 * real phone — all three visible in one screenshot:
 *
 *  · The page showed through underneath it. The menu ended after "Log in" and
 *    the homepage's dark hero band carried on below, so it read as a panel
 *    that had failed to finish drawing rather than a menu.
 *  · Its last row ran under the fixed tab bar. Measured on an iPhone SE, the
 *    language button ended 33px below the top of that bar, and elementFromPoint
 *    at its centre returned the "Home" tab — the control was not merely ugly
 *    there, it could not be tapped at all.
 *  · The chat bubble floated on top of the open menu, over the categories.
 *
 * One component rather than the same four fixes twice, because the two drawers
 * had already drifted apart once.
 *
 * And it owns the keyboard while open (see useFocusTrap): focus moves into the
 * menu, Tab cycles through it and the X button that closes it, Escape closes
 * it, and focus returns to that button. It used to stay on the button and Tab
 * walked on through the page hidden underneath.
 *
 * A dialog, but not aria-modal. The X that closes it lives in the header above,
 * outside this element, and aria-modal would hide it from VoiceOver on a phone
 * — where there is no Escape key to fall back on.
 */
export default function MobileDrawer({ open, children, className = '', onClose, openerRef, id, label }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(null);
  useFocusTrap(open, ref, { onEscape: onClose, openerRef, includeOpener: true });

  /**
   * Fill exactly the viewport below the header.
   *
   * Measured rather than assumed: the bar is 68px today, but it carries a
   * promo strip on some routes and a hardcoded `calc(100dvh - 4.5rem)` is a
   * number that goes quietly wrong the first time that changes. 100dvh — not
   * vh — because on iOS Safari vh is the tallest the viewport ever gets, which
   * would put the last row under the browser's own toolbar.
   */
  useLayoutEffect(() => {
    if (!open) { setHeight(null); return undefined; }
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      setHeight(Math.max(120, Math.round(window.innerHeight - el.getBoundingClientRect().top)));
    };
    measure();
    /* Once more after the frame in which the body lock lands. Measured without
       this, the panel came out 11px short on every device — the header is
       sticky, and locking the body settles the page at a slightly different
       offset than the one the first measurement saw. A hairline of the page
       showing under the menu is exactly the defect this component exists to
       remove. */
    const again = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      cancelAnimationFrame(again);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [open]);

  /**
   * Nothing behind it moves, and nothing floats over it.
   *
   * The body lock is what makes it a sheet rather than a tall block: without
   * it a swipe anywhere scrolls the page underneath, and the menu — being
   * inside a sticky header — slides off the top with it. The class is how the
   * chat bubble gets out of the way; it is fixed and positioned globally, so a
   * prop would have to be threaded through three components that have no other
   * reason to know the menu exists.
   */
  useEffect(() => {
    if (!open) return undefined;
    const { body } = document;
    const prev = body.style.overflow;
    body.style.overflow = 'hidden';
    body.classList.add('fm-menu-open');
    return () => { body.style.overflow = prev; body.classList.remove('fm-menu-open'); };
  }, [open]);

  if (!open) return null;

  /* outline: none — focus lands on the panel itself only for the instant
     before the first Tab, and a focus ring around the whole menu reads as a
     rendering fault. Every control inside keeps its own ring. */
  return (
    <div ref={ref} id={id} role="dialog" aria-label={label} tabIndex={-1}
      style={height ? { height, outline: 'none' } : { outline: 'none' }}
      className={`lg:hidden overflow-y-auto overscroll-contain border-t border-slate-200/70 bg-white fm-page fm-clears-tabbar ${className}`}>
      {children}
    </div>
  );
}
