import { useEffect, useRef } from 'react';

/**
 * One-shot canvas confetti burst — no dependencies. Fires once on mount, fades
 * out, then stops. Respects reduced-motion. Fixed, full-screen, click-through.
 */
export default function Confetti({ count = 160, duration = 2600 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    let raf, running = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; };
    resize();
    window.addEventListener('resize', resize);

    const colors = ['#6366f1', '#a855f7', '#ec4899', '#22d3ee', '#ffd95e', '#10b981'];
    const W = () => canvas.width, H = () => canvas.height;
    const parts = Array.from({ length: count }, () => ({
      x: W() / 2 + (Math.random() - 0.5) * W() * 0.3,
      y: H() * 0.25 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: (Math.random() * -10 - 4) * dpr,
      g: (0.22 + Math.random() * 0.1) * dpr,
      s: (4 + Math.random() * 6) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0],
    }));

    const start = performance.now();
    const tick = (t) => {
      if (!running) return;
      const elapsed = t - start;
      const alpha = Math.max(0, 1 - elapsed / duration);
      ctx.clearRect(0, 0, W(), H());
      for (const p of parts) {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vx *= 0.99;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      }
      if (elapsed < duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [count, duration]);

  return <canvas ref={ref} aria-hidden="true"
    style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 55 }} />;
}
