/**
 * Is the shop open yet, and how long until it is?
 *
 * The server sends the launch MOMENT in `/api/config`, not a "we are closed"
 * flag, and that response is cached at the edge for a minute. A flag would go
 * stale — a visitor could be handed a minute-old "not open yet" after the shop
 * had opened, and would keep seeing it until the cache turned over. A timestamp
 * cannot: this compares it against the browser's own clock every second, so the
 * banner disappears and the buttons come back at the right second even on a copy
 * that was cached before launch.
 *
 * The ticker stops itself the moment the shop opens, so a launched shop is not
 * running a setInterval on every page for the rest of its life.
 */
import { useEffect, useRef, useState } from 'react';
import { useConfig } from './useConfig.js';

/** Whole days/hours/minutes/seconds left, or null once there is nothing left. */
export function breakdown(ms) {
  if (ms === null || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    totalMs: ms,
  };
}

export function useLaunch() {
  const cfg = useConfig();
  const at = cfg.launchAt ? Date.parse(cfg.launchAt) : NaN;
  const target = Number.isNaN(at) ? null : at;
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef(null);

  useEffect(() => {
    if (target === null) return undefined;
    if (Date.now() >= target) return undefined;      // already open — no ticker
    timer.current = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= target) clearInterval(timer.current);  // opened: stop ticking
    }, 1000);
    return () => clearInterval(timer.current);
  }, [target]);

  const remaining = target === null ? null : target - now;
  return {
    /** null while the config is still loading, so nothing flashes. */
    prelaunch: target === null ? false : remaining > 0,
    launchAt: target,
    remaining: breakdown(remaining),
    ready: !!cfg.launchAt || cfg.launchAt === null,
  };
}
