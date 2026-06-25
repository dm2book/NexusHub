import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';

const GROUPS = [
  {
    title: 'Orders & delivery',
    items: [
      ['How fast is delivery?', 'Most digital goods are delivered automatically within seconds of payment. You can watch the status update live on your order page.'],
      ['Where do I find my codes?', 'In your dashboard under Downloads, and on the order page once the order is completed.'],
      ['Can I track my order?', 'Yes — use the order page in your dashboard, or the public Track Order page with your order number.'],
    ],
  },
  {
    title: 'Payments & refunds',
    items: [
      ['Which payment methods are supported?', 'You can pay with Tikkie, Revolut or PayPal. At checkout you pick a method and pay using your order number as the reference — see our Payment Methods page for details.'],
      ['How do refunds work?', 'Request a refund from your order page or open a ticket in our Discord. Once approved, eligible orders are refunded to your original method.'],
    ],
  },
  {
    title: 'Account & security',
    items: [
      ['Do I need an account?', 'You can track orders by number without one, but an account unlocks your dashboard, downloads and history.'],
      ['How do you keep my account safe?', 'Passwordless sign-in, encrypted sessions, automated fraud screening and full audit logging.'],
      ['Can I sign in with Google or Discord?', 'Yes, when those providers are enabled — plus passwordless email codes.'],
    ],
  },
];

export default function Faq() {
  return (
    <InfoShell eyebrow="Help center" title="Frequently asked questions">
      <div className="space-y-10">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h2 className="text-white font-display text-lg mb-3">{g.title}</h2>
            <div className="space-y-3">{g.items.map(([q, a]) => <Item key={q} q={q} a={a} />)}</div>
          </div>
        ))}
      </div>
    </InfoShell>
  );
}

function Item({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen((v) => !v)} className="w-full text-left card p-5 hover:border-primary/30 transition">
      <div className="flex items-center justify-between gap-4">
        <span className="text-white font-medium">{q}</span>
        <ChevronDown size={18} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      {open && <p className="text-slate-400 text-sm mt-3 leading-relaxed">{a}</p>}
    </button>
  );
}
