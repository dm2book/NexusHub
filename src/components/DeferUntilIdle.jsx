import { useEffect, useState } from 'react';

/**
 * Render children once the browser has nothing better to do.
 *
 * For things that are real but not urgent: the chat bubble and the ⌘K palette
 * are both opened by a deliberate action, yet they were mounted during the same
 * frame the page first appeared — competing for the main thread with the render
 * a visitor is actually waiting for.
 *
 * `requestIdleCallback` waits for a genuinely quiet moment rather than a fixed
 * delay, so on a fast phone it is nearly immediate and on a slow one it stays
 * out of the way for longer. Safari has no such thing, hence the timeout.
 *
 * The timeout option matters: without it a page that never goes idle — one with
 * a poll or an animation running — would never mount these at all.
 *
 * `fallback` is what stands in until then. Nothing, for a floating bubble; for
 * something in the flow of the page, the space it is about to take, so what
 * sits below it does not jump when it arrives.
 */
export default function DeferUntilIdle({ children, timeout = 2000, fallback = null }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const go = () => { if (!cancelled) setReady(true); };
    const ric = window.requestIdleCallback;
    if (ric) {
      const id = ric(go, { timeout });
      return () => { cancelled = true; window.cancelIdleCallback?.(id); };
    }
    const t = setTimeout(go, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [timeout]);

  return ready ? children : fallback;
}
