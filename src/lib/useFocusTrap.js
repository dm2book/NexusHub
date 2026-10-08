import { useEffect, useRef } from 'react';

/**
 * Keyboard focus for anything that covers the page: the search palette, the
 * phone menus, a modal.
 *
 * Three promises, the ones a keyboard or screen-reader user relies on and that
 * every one of these panels used to break:
 *
 *  · Focus goes INTO the panel when it opens, and Tab cycles inside it. The
 *    palette and the drawers used to leave focus wherever it was, so Tab walked
 *    on through the page hidden behind them — the drawer even locks the body's
 *    scrolling, so focus moved through links nobody could see.
 *  · Escape closes it.
 *  · Focus goes BACK to the control that opened it. Without this a closed
 *    panel drops focus on <body>, and the next Tab starts again from the top of
 *    the page: forty stops back to where you were.
 *
 * Panels that sit on top of each other (the palette opened from inside the
 * phone menu) form a stack: only the topmost one answers Tab and Escape, so one
 * press of Escape closes one thing.
 *
 * The panel element needs tabIndex={-1} so focus can land on the panel itself
 * when nothing more specific is asked for.
 */

/* What Tab can land on. Disabled controls and tabindex="-1" drop out through
   el.tabIndex; anything not rendered (display:none has no client rects) drops
   out through getClientRects, which is what keeps a `hidden sm:inline` button
   or a closed submenu out of the cycle. */
const TABBABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'summary',
  '[tabindex]', '[contenteditable="true"]',
].join(',');

export function tabbablesIn(root) {
  if (!root) return [];
  return [...root.querySelectorAll(TABBABLE)]
    .filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
}

const stack = [];

/**
 * @param {boolean} active       whether the panel is open
 * @param {{current: HTMLElement}} panelRef  the panel
 * @param {object} [opts]
 * @param {(e: KeyboardEvent) => void} [opts.onEscape]  closes the panel
 * @param {{current: HTMLElement}} [opts.openerRef]  the button that opens it,
 *   and where focus returns. Without it, whatever had focus when the panel
 *   opened is used — fine for a keyboard, but a tap on iOS Safari never focuses
 *   a button, so the drawers pass theirs explicitly.
 * @param {boolean} [opts.includeOpener]  make the opener part of the Tab cycle.
 *   For a drawer whose opener stays on screen as its X button: trapping focus
 *   away from it would hide the one visible way out. Not for an overlay that
 *   covers its opener.
 * @param {{current: HTMLElement}} [opts.initialFocusRef]  where focus lands on
 *   open (the palette's search box); the panel itself otherwise.
 */
export function useFocusTrap(active, panelRef, {
  onEscape, openerRef, includeOpener = false, initialFocusRef,
} = {}) {
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const panel = panelRef.current;
    if (!panel) return undefined;

    const token = {};
    stack.push(token);
    const previous = document.activeElement;
    const opener = () => openerRef?.current
      || (previous && previous !== document.body ? previous : null);

    // Into the panel — unless something inside already took focus (autoFocus).
    if (!panel.contains(document.activeElement)) {
      (initialFocusRef?.current || panel).focus({ preventScroll: true });
    }

    const onKey = (e) => {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        // A control inside that handled Escape itself (the language list in
        // the drawer) marks the event, so the same press does not also close
        // the drawer around it.
        if (!e.defaultPrevented && escape.current) { e.preventDefault(); escape.current(e); }
        return;
      }
      if (e.key !== 'Tab') return;
      // A drawer left open while the window grew past its breakpoint is
      // display:none — trapping Tab in something invisible would make the
      // whole page unreachable by keyboard.
      if (!panel.getClientRects().length) return;
      const o = includeOpener ? openerRef?.current : null;
      const cycle = [
        ...(o && o.isConnected && !panel.contains(o) && o.getClientRects().length ? [o] : []),
        ...tabbablesIn(panel),
      ];
      e.preventDefault();
      if (!cycle.length) return;
      const i = cycle.indexOf(document.activeElement);
      const next = i === -1
        ? cycle[e.shiftKey ? cycle.length - 1 : 0]
        : cycle[(i + (e.shiftKey ? -1 : 1) + cycle.length) % cycle.length];
      next.focus();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      const at = stack.indexOf(token);
      if (at !== -1) stack.splice(at, 1);
      /* Only when focus is still ours to give back: inside the panel, or
         dropped on <body> because the panel just unmounted. Someone who clicked
         elsewhere on purpose keeps the focus they chose. */
      const back = opener();
      const now = document.activeElement;
      if (back && back.isConnected && (!now || now === document.body || panel.contains(now))) {
        back.focus({ preventScroll: true });
      }
    };
  // The refs are stable; re-running on every render would bounce focus.
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
}
