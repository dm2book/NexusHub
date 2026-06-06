'use client';
import { useRef, useLayoutEffect, type ElementType } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

type Props = {
  children: React.ReactNode;
  className?: string;
  y?: number;
  delay?: number;
  stagger?: number;
  as?: ElementType;
};

/** Fades + lifts content into view on scroll. Staggers children when `stagger`>0. */
export default function Reveal({ children, className = '', y = 28, delay = 0, stagger = 0, as = 'div' }: Props) {
  const ref = useRef<any>(null);
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      const targets = stagger ? el.children : el;
      gsap.fromTo(targets, { y, autoAlpha: 0 }, {
        y: 0, autoAlpha: 1, duration: 0.85, delay, ease: 'power3.out', stagger,
        scrollTrigger: { trigger: el, start: 'top 86%', once: true },
      });
    }, el);
    return () => ctx.revert();
  }, [y, delay, stagger]);

  const Tag = as as any;
  return <Tag ref={ref} className={className}>{children}</Tag>;
}

