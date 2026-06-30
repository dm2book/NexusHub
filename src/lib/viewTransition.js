/**
 * Shared-element route transitions via the native View Transitions API.
 * Progressive enhancement: where the API is missing (or reduced-motion is on) we
 * just navigate — no dependency, no layout shift, zero cost.
 */
const supported = () =>
  typeof document !== 'undefined' &&
  typeof document.startViewTransition === 'function' &&
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Navigate with a view transition. `tagEl` (optional) is given a temporary
 * `view-transition-name` so the browser morphs it into the matching element on
 * the destination (which carries the same name).
 */
export function navigateWithTransition(navigate, to, tagEl, tagName = 'product-hero') {
  if (!supported()) { navigate(to); return; }
  if (tagEl) tagEl.style.viewTransitionName = tagName;
  const cleanup = () => { if (tagEl) tagEl.style.viewTransitionName = ''; };
  const vt = document.startViewTransition(() => { navigate(to); });
  vt.finished.finally(cleanup);
}
