import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Linear-style route progress bar. On every route change we (re)mount a thin
 * gradient bar that sweeps across and fades — a pure CSS animation
 * (`.fm-route-progress`). Keyed by a counter so the animation replays each nav.
 */
export default function RouteProgress() {
  const { pathname } = useLocation();
  const [tick, setTick] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setTick((t) => t + 1);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 600);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!visible) return null;
  return <div key={tick} className="fm-route-progress" aria-hidden="true" />;
}
