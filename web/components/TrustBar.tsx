import { Zap, ShieldCheck, Headphones, RefreshCw, Lock, BadgeCheck } from 'lucide-react';
import Reveal from './Reveal';

const ITEMS = [
  { icon: Zap, label: 'Instant delivery' },
  { icon: ShieldCheck, label: 'Buyer protection' },
  { icon: Lock, label: 'Encrypted checkout' },
  { icon: BadgeCheck, label: 'Verified sellers' },
  { icon: RefreshCw, label: 'Money-back guarantee' },
  { icon: Headphones, label: '24/7 live support' },
];

export default function TrustBar() {
  return (
    <section className="border-y border-white/[0.06] bg-white/[0.015]">
      <Reveal className="container-x py-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4" stagger={0.06}>
        {ITEMS.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2.5 justify-center sm:justify-start text-sm text-slate-300">
            <Icon size={18} className="text-indigo-300 shrink-0" />
            <span>{label}</span>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
