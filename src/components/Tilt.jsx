import { useRef } from 'react';

/**
 * Pointer-driven 3D tilt with a moving glare. Wraps any content; sets CSS
 * variables on hover so the transform stays on the GPU. Respects reduced-motion
 * via CSS. Keep `max` small for a classy effect.
 */
export default function Tilt({ children, max = 10, className = '' }) {
  const ref = useRef(null);

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(px - 0.5) * max * 2}deg`);
    el.style.setProperty('--rx', `${(0.5 - py) * max * 2}deg`);
    el.style.setProperty('--s', '1.03');
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
  };
  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--s', '1');
  };

  return (
    <div className={`tilt ${className}`} onMouseMove={onMove} onMouseLeave={reset}>
      <div ref={ref} className="tilt-inner relative h-full">
        {children}
        <span className="tilt-glare" />
      </div>
    </div>
  );
}
