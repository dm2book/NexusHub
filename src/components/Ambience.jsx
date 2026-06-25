import { useEffect } from 'react';

/**
 * Site-wide ambience: a slow animated mesh-gradient field + film grain behind all
 * content, plus a soft spotlight that follows the cursor. All layers are
 * pointer-events:none and GPU-friendly; disabled for touch / reduced-motion via CSS.
 */
export default function Ambience() {
  useEffect(() => {
    if (window.matchMedia?.('(hover: none)').matches) return;
    let raf = 0;
    const onMove = (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--cx', `${e.clientX}px`);
        document.documentElement.style.setProperty('--cy', `${e.clientY}px`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      <div className="mesh-bg" aria-hidden="true">
        <span className="b1" /><span className="b2" /><span className="b3" /><span className="b4" />
      </div>
      <div className="grain" aria-hidden="true" />
      <div className="cursor-glow" aria-hidden="true" />
    </>
  );
}
