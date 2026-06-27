/**
 * Lightweight, production-safe client event tracking. Emits to:
 *  - window.dataLayer / gtag if present (GA, GTM),
 *  - a `forge:track` CustomEvent (so anything can subscribe),
 *  - console.debug in dev.
 * No-op friendly: if no analytics is wired, it simply does nothing harmful.
 */
export function track(event, props = {}) {
  const payload = { event, ts: Date.now(), ...props };
  try {
    if (typeof window !== 'undefined') {
      if (Array.isArray(window.dataLayer)) window.dataLayer.push(payload);
      if (typeof window.gtag === 'function') window.gtag('event', event, props);
      window.dispatchEvent(new CustomEvent('forge:track', { detail: payload }));
      if (import.meta.env?.DEV) console.debug('[track]', event, props);
    }
  } catch { /* never let analytics break the UI */ }
}
