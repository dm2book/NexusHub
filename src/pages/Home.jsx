import { Link } from 'react-router-dom';
import { Zap, ShieldCheck, Truck, Headphones, ArrowRight } from 'lucide-react';

const FEATURES = [
  { icon: Zap, title: 'Instant Delivery', text: 'Automated fulfillment delivers digital goods in seconds.' },
  { icon: ShieldCheck, title: 'Secure & Trusted', text: 'Fraud screening and audited operations on every order.' },
  { icon: Truck, title: 'Multi-Supplier', text: 'Resilient sourcing across API, CSV and manual suppliers.' },
  { icon: Headphones, title: '24/7 Support', text: 'Open a ticket and track resolution from your dashboard.' },
];

export default function Home() {
  return (
    <div>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-hero-pattern" />
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full blur-3xl opacity-20"
             style={{ background: 'radial-gradient(circle,#6366f1,transparent 70%)' }} />
        <div className="relative max-w-5xl mx-auto px-5 py-28 text-center">
          <span className="inline-block px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-indigo-300 mb-6 font-rajdhani tracking-wide">
            DIGITAL GOODS · DELIVERED INSTANTLY
          </span>
          <h1 className="text-4xl md:text-6xl text-white leading-tight">
            Your marketplace for<br /><span className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">digital goods</span>
          </h1>
          <p className="text-slate-400 text-lg mt-6 max-w-2xl mx-auto">
            Game currency, gift cards, subscriptions and more — automatically fulfilled,
            tracked in real time, and backed by full account management.
          </p>
          <div className="flex items-center justify-center gap-4 mt-10">
            <Link to="/shop" className="btn-primary px-6 py-3">Browse Shop <ArrowRight size={18} /></Link>
            <Link to="/track" className="btn-ghost px-6 py-3">Track an Order</Link>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-5 pb-24 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card p-6 hover:border-primary/40 transition">
            <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center mb-4">
              <Icon size={20} className="text-primary" />
            </div>
            <h3 className="text-white text-base mb-1">{title}</h3>
            <p className="text-slate-400 text-sm">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
