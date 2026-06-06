'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const FAQS: [string, string][] = [
  ['How fast is delivery?', 'Most top-ups are delivered automatically within seconds of payment. You can watch the status update live and the code also arrives by email.'],
  ['Is ForgeMarket safe?', 'Yes — passwordless sign-in, encrypted checkout, automated fraud screening, buyer protection and full audit logging on every order.'],
  ['What if something goes wrong?', 'Open a support ticket or reach us on Discord 24/7. Eligible orders are covered by our money-back guarantee.'],
  ['Which payment methods can I use?', 'Secure card payments via Stripe at checkout. More methods are added regularly.'],
  ['Do I need an account?', 'You can check out as a guest, but an account unlocks your dashboard, order history and instant re-orders.'],
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="container-x py-20 max-w-3xl">
      <div className="text-center mb-12">
        <span className="eyebrow">FAQ</span>
        <h2 className="text-3xl sm:text-5xl mt-4">Questions, answered</h2>
      </div>
      <div className="space-y-3">
        {FAQS.map(([q, a], i) => (
          <button key={q} onClick={() => setOpen(open === i ? null : i)} className="w-full text-left card p-5 hover:border-primary/30 transition">
            <div className="flex items-center justify-between gap-4">
              <span className="text-white font-medium">{q}</span>
              <ChevronDown size={18} className={`text-slate-400 shrink-0 transition-transform ${open === i ? 'rotate-180' : ''}`} />
            </div>
            {open === i && <p className="text-slate-400 text-sm mt-3 leading-relaxed">{a}</p>}
          </button>
        ))}
      </div>
    </section>
  );
}
