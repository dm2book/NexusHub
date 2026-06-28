import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from 0 → target the first time it scrolls into view.
 * `prefix`/`suffix` wrap the value; `decimals` controls precision. Non-numeric
 * values (e.g. "24/7") are rendered as-is.
 */
export default function CountUp({ value, duration = 1400, className = '' }) {
  const ref = useRef(null);
  const started = useRef(false);
  const [display, setDisplay] = useState(null);

  // Parse "50k+", "52,340+", "< 30s", "4.9/5", "24/7" → { prefix, num, suffix }
  const m = String(value).match(/^(\D*)([\d.,]+)(.*)$/);
  const isNum = !!m;
  const num = isNum ? parseFloat(m[2].replace(/,/g, '')) : 0;
  const decimals = isNum && m[2].includes('.') ? 1 : 0;
  const grouped = isNum && m[2].includes(',');
  const fmt = (n) => {
    const v = n.toFixed(decimals);
    return grouped ? Number(v).toLocaleString('en-US') : v;
  };

  useEffect(() => {
    if (!isNum) { setDisplay(value); return; }
    // If the number already revealed once, snap to the new target (handles the
    // value arriving/changing after the count-up has already played — e.g. real
    // stats replacing the initial zeros).
    if (started.current) { setDisplay(`${m[1]}${fmt(num)}${m[3]}`); return; }
    const el = ref.current;
    if (!el) return;
    let raf;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      started.current = true;
      const start = performance.now();
      const tick = (t) => {
        const k = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        setDisplay(`${m[1]}${fmt(num * eased)}${m[3]}`);
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);

  return <span ref={ref} className={className}>{display ?? (isNum ? `${m[1]}${fmt(0)}${m[3]}` : value)}</span>;
}
