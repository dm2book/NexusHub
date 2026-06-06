import { Wallet, ShieldCheck, PackageCheck, Star, Quote } from 'lucide-react';
import Reveal from './Reveal';

/* ── Stats ──────────────────────────────────────────────────────────────── */
const STATS = [
  { v: '120k+', l: 'Orders delivered' },
  { v: '< 30s', l: 'Avg. delivery' },
  { v: '4.9/5', l: 'Customer rating' },
  { v: '24/7', l: 'Live support' },
];
export function Stats() {
  return (
    <section className="container-x py-16">
      <Reveal className="grid grid-cols-2 md:grid-cols-4 gap-4" stagger={0.08}>
        {STATS.map((s) => (
          <div key={s.l} className="glass rounded-2xl py-7 text-center">
            <div className="text-3xl sm:text-4xl font-display gradient-text">{s.v}</div>
            <div className="text-slate-400 text-sm mt-1">{s.l}</div>
          </div>
        ))}
      </Reveal>
    </section>
  );
}

/* ── How it works ───────────────────────────────────────────────────────── */
const STEPS = [
  { icon: Wallet, t: 'Pick your top-up', d: 'Choose from game currency, gift cards and subscriptions.' },
  { icon: ShieldCheck, t: 'Pay securely', d: 'Buyer-protected checkout, fraud-screened on every order.' },
  { icon: PackageCheck, t: 'Get it instantly', d: 'Your code lands in your dashboard and inbox in seconds.' },
];
export function HowItWorks() {
  return (
    <section className="container-x py-20">
      <div className="text-center mb-12">
        <span className="eyebrow">How it works</span>
        <h2 className="text-3xl sm:text-5xl mt-4">Three steps to delivery</h2>
      </div>
      <Reveal className="grid md:grid-cols-3 gap-5" stagger={0.1}>
        {STEPS.map((s, i) => (
          <div key={s.t} className="relative card p-7">
            <span className="absolute top-5 right-6 font-display text-6xl text-white/5">{i + 1}</span>
            <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-4"><s.icon size={22} className="text-primary" /></div>
            <h3 className="text-white text-lg mb-1.5">{s.t}</h3>
            <p className="text-slate-400 text-sm">{s.d}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}

/* ── Reviews ────────────────────────────────────────────────────────────── */
const REVIEWS = [
  { n: 'Liam', tag: 'Robux', t: 'Code landed in seconds. Cleanest store I’ve used — feels legit.' },
  { n: 'Noa', tag: 'V-Bucks', t: 'Tracked my order live and got instant delivery. 10/10.' },
  { n: 'Sam', tag: 'Valorant', t: 'Support replied in minutes on Discord. Will 100% buy again.' },
  { n: 'Mika', tag: 'Genshin', t: 'Best prices I found and delivery was actually instant.' },
  { n: 'Dani', tag: 'CoD', t: 'Felt sketchy buying online before — this one is the real deal.' },
  { n: 'Eli', tag: 'Apex', t: 'Smooth checkout, fair price, code worked first try.' },
];
export function Reviews() {
  return (
    <section id="reviews" className="container-x py-20">
      <div className="text-center mb-12">
        <span className="eyebrow">Loved by gamers</span>
        <h2 className="text-3xl sm:text-5xl mt-4">Trusted by thousands</h2>
      </div>
      <Reveal className="grid md:grid-cols-3 gap-5" stagger={0.07}>
        {REVIEWS.map((r) => (
          <div key={r.n} className="card p-6">
            <Quote size={22} className="text-primary/60 mb-3" />
            <p className="text-slate-200">{r.t}</p>
            <div className="flex items-center justify-between mt-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-white text-sm font-semibold">{r.n[0]}</div>
                <div>
                  <div className="text-white text-sm">{r.n} <span className="text-emerald-400 text-xs">✓ verified</span></div>
                  <div className="text-slate-500 text-xs">{r.tag}</div>
                </div>
              </div>
              <div className="flex gap-0.5 text-amber-400">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={13} fill="currentColor" />)}</div>
            </div>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
