'use client';
import { Component, type ReactNode } from 'react';
import dynamic from 'next/dynamic';

// three.js is heavy + client-only → load it lazily, never on the server.
const HeroScene = dynamic(() => import('../three/HeroScene'), { ssr: false, loading: () => null });

class WebGLBoundary extends Component<{ children: ReactNode }, { dead: boolean }> {
  state = { dead: false };
  static getDerivedStateFromError() { return { dead: true }; }
  componentDidCatch() { /* keep the CSS gradient fallback */ }
  render() { return this.state.dead ? null : this.props.children; }
}

/** WebGL hero layer. Falls back to nothing (the gradient/orbs shine through) when
 *  WebGL is unavailable or the user prefers reduced motion. */
export default function HeroCanvas() {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  return (
    <div className="absolute inset-0" aria-hidden>
      <WebGLBoundary>
        <HeroScene count={mobile ? 800 : 2400} />
      </WebGLBoundary>
    </div>
  );
}
