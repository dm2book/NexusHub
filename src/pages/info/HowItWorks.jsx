import { Link } from 'react-router-dom';
import { Wallet, CreditCard, PackageCheck, ShieldCheck, Zap, Headphones } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';

const STEPS = [
  [Wallet, 'Browse & pick', 'Choose your game top-up, gift card or subscription from the shop.'],
  [CreditCard, 'Pay your way', 'Check out with Tikkie, Revolut or PayPal — your order number is the reference.'],
  [ShieldCheck, 'We confirm', 'Your payment is verified (usually within minutes during open hours).'],
  [PackageCheck, 'Delivered instantly', 'Codes appear in your dashboard and email — ready to redeem in-game.'],
];

export default function HowItWorks() {
  return (
    <InfoShell eyebrow="Guide" title="How it works" subtitle="From cart to in-game in four simple steps." narrow={false}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12 max-w-5xl mx-auto">
        {STEPS.map(([I, t, d], i) => (
          <div key={t} className="relative card p-6">
            <span className="absolute top-4 right-5 font-display text-5xl text-white/5">{i + 1}</span>
            <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-4"><I size={22} className="text-primary" /></div>
            <h3 className="text-white mb-1.5">{t}</h3>
            <p className="text-slate-400 text-sm">{d}</p>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-3 gap-4 max-w-5xl mx-auto mb-10">
        {[[Zap, 'Instant', 'Most orders delivered in under 30 seconds.'],
          [ShieldCheck, 'Secure', 'Encrypted checkout + automated fraud screening.'],
          [Headphones, '24/7 support', 'Open a ticket in Discord any time.']].map(([I, t, d]) => (
          <div key={t} className="glass rounded-2xl p-5"><I size={20} className="text-indigo-300 mb-2" /><h3 className="text-white text-sm font-medium">{t}</h3><p className="text-slate-400 text-sm mt-1">{d}</p></div>
        ))}
      </div>
      <div className="text-center"><Link to="/shop" className="btn-primary px-7 py-3.5">Start shopping</Link></div>
    </InfoShell>
  );
}
