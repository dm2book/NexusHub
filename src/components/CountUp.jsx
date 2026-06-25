import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from 0 → target the first time it scrolls into view.
 * `prefix`/`suffix` wrap the value; `decimals` controls precision. Non-numeric
 * values (e.g. "24/7") are rendered as-is.
 */
export default function CountUp({ value, duration = 1400, className = '' }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(null);

  // Parse "50k+", "< 30s", "4.9/5", "24/7" → { prefix, num, suffix }
  const m = String(value).match(/^(\D*)([\d.]+)(.*)$/);
  const isNum = !!m;
  const num = isNum ? parseFloat(m[2]) : 0;
  const decimals = isNum && m[2].includes('.') ? 1 : 0;

  useEffect(() => {
    if (!isNum) { setDisplay(value); return; }
    const el = ref.current;
    if (!el) return;
    let raf;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t) => {
        const k = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        setDisplay(`${m[1]}${(num * eased).toFixed(decimals)}${m[3]}`);
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);

  return <span ref={ref} className={className}>{display ?? (isNum ? `${m[1]}0${m[3]}` : value)}</span>;
}
