'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Zap, Menu, X, MessageCircle } from 'lucide-react';

const LINKS = [
  { href: '/shop', label: 'Shop' },
  { href: '/#trust', label: 'Why us' },
  { href: '/#community', label: 'Community' },
  { href: '/#faq', label: 'FAQ' },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? 'backdrop-blur-xl bg-ink/80 border-b border-white/[0.06]' : ''}`}>
      <nav className="container-x h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shadow-neon" style={{ backgroundImage: 'linear-gradient(135deg,#6366f1,#a855f7)' }}>
            <Zap size={18} className="text-white" />
          </span>
          <span className="font-display text-lg tracking-wide">ForgeMarket</span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm">
          {LINKS.map((l) => <a key={l.href} href={l.href} className="text-slate-300 hover:text-white transition">{l.label}</a>)}
        </div>
        <div className="flex items-center gap-3">
          <a href="https://discord.gg" target="_blank" rel="noreferrer" className="hidden sm:inline-flex btn-discord text-sm py-2"><MessageCircle size={16} /> Discord</a>
          <Link href="/shop" className="btn-primary text-sm py-2">Shop now</Link>
          <button className="md:hidden p-2.5 rounded-xl hover:bg-white/5" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>
      {open && (
        <div className="md:hidden border-t border-white/[0.06] bg-ink/95 px-5 py-4 space-y-1">
          {LINKS.map((l) => <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block px-3 py-2.5 rounded-lg text-slate-300 hover:bg-white/5">{l.label}</a>)}
          <a href="https://discord.gg" target="_blank" rel="noreferrer" className="block px-3 py-2.5 rounded-lg text-indigo-300 hover:bg-white/5">Join Discord</a>
        </div>
      )}
    </header>
  );
}
