'use client';
import { useLayoutEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowRight, MessageCircle, Star, Zap, ShieldCheck } from 'lucide-react';
import { gsap } from 'gsap';
import HeroCanvas from './HeroCanvas';

export default function Hero() {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.set('.hero-anim', { autoAlpha: 1, y: 0 }); return;
    }
    const ctx = gsap.context(() => {
      gsap.fromTo('.hero-anim',
        { y: 30, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.9, ease: 'power3.out', stagger: 0.12, delay: 0.15 });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} className="relative min-h-[100svh] flex items-center overflow-hidden">
      <div className="absolute inset-0 bg-grid opacity-40" />
      <div className="orb w-[560px] h-[560px] bg-primary/30 -top-40 -left-24 animate-float-slow" />
      <div className="orb w-[520px] h-[520px] bg-secondary/25 top-10 right-0 animate-float" />
      <HeroCanvas />
      <div className="absolute inset-0 bg-gradient-to-b from-ink/10 via-ink/30 to-ink pointer-events-none" />

      <div className="container-x relative w-full text-center pt-24 pb-16">
        <span className="hero-anim eyebrow reveal">⚡ Instant delivery · Trusted by 120,000+ gamers</span>
        <h1 className="hero-anim reveal text-5xl sm:text-7xl lg:text-8xl mt-6 leading-[1.02]">
          Level up,<br /><span className="gradient-text">instantly.</span>
        </h1>
        <p className="hero-anim reveal text-slate-300 text-lg sm:text-xl mt-6 max-w-2xl mx-auto">
          The premium marketplace for game currency, top-ups and gift cards — delivered
          in seconds, secured end-to-end, and backed by a thriving Discord community.
        </p>
        <div className="hero-anim reveal flex flex-wrap items-center justify-center gap-4 mt-10">
          <Link href="/shop" className="btn-primary px-7 py-4 text-base">Browse the shop <ArrowRight size={18} /></Link>
          <a href="https://discord.gg/vNcfgDbVd" target="_blank" rel="noreferrer" className="btn-discord px-7 py-4 text-base"><MessageCircle size={18} /> Join Discord</a>
        </div>
        <div className="hero-anim reveal flex flex-wrap items-center justify-center gap-x-8 gap-y-3 mt-12 text-sm text-slate-400">
          <span className="flex items-center gap-2"><Star size={16} className="text-amber-400 fill-amber-400" /> 4.9/5 from 18,400+ reviews</span>
          <span className="flex items-center gap-2"><Zap size={16} className="text-indigo-300" /> Avg. delivery under 30s</span>
          <span className="flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-300" /> Buyer-protected payments</span>
        </div>
      </div>
    </section>
  );
}
