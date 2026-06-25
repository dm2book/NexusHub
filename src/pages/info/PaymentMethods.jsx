import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, ShieldCheck, Clock, BadgeCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import InfoShell from '../../components/InfoShell.jsx';

const META = {
  tikkie: { icon: '🟢', name: 'Tikkie', blurb: 'Pay in seconds with a Tikkie payment request — ideal in the Netherlands.' },
  revolut: { icon: '⚫', name: 'Revolut', blurb: 'Send your payment instantly via your Revolut link.' },
  paypal: { icon: '🔵', name: 'PayPal', blurb: 'Pay with your PayPal balance, bank or card — buyer-protected.' },
};
const STEPS = [
  ['Pick your item', 'Add a product to your cart and go to checkout.'],
  ['Choose a method', 'Select Tikkie, Revolut or PayPal at checkout.'],
  ['Pay with your order number', 'Use your order number (e.g. FM-2026-XXXX) as the payment reference.'],
  ['Get it instantly', 'We confirm your payment and your items are delivered automatically.'],
];

export default function PaymentMethods() {
  const [methods, setMethods] = useState(null);
  useEffect(() => { api.get('/api/config').then((c) => setMethods(c.paymentMethods || [])).catch(() => setMethods([])); }, []);
  const list = (methods && methods.length ? methods.map((m) => m.id) : ['tikkie', 'revolut', 'paypal']);

  return (
    <InfoShell eyebrow="Checkout" title="Payment methods">
      <p className="text-slate-400 mb-8 max-w-2xl">
        We keep payments simple and secure. Choose your favourite method at checkout, pay with
        your order number as the reference, and we confirm it — usually within minutes during open hours.
      </p>

      <div className="grid sm:grid-cols-3 gap-4 mb-12">
        {list.map((id) => {
          const m = META[id] || { icon: '💳', name: id, blurb: 'Secure payment method.' };
          return (
            <div key={id} className="card p-5">
              <div className="text-3xl">{m.icon}</div>
              <h3 className="text-white font-semibold mt-2">{m.name}</h3>
              <p className="text-slate-400 text-sm mt-1">{m.blurb}</p>
            </div>
          );
        })}
      </div>

      <h2 className="text-white font-display text-lg mb-4">How it works</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        {STEPS.map(([t, d], i) => (
          <div key={t} className="card p-5">
            <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center font-display mb-3">{i + 1}</div>
            <h3 className="text-white text-sm font-medium">{t}</h3>
            <p className="text-slate-400 text-sm mt-1">{d}</p>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-10">
        {[[Zap, 'Instant delivery', 'Codes & top-ups arrive in seconds after confirmation.'],
          [ShieldCheck, 'Secure & fraud-screened', 'Every order is screened; we never see your card details.'],
          [BadgeCheck, 'Buyer protection', 'Issues? Open a ticket — eligible orders are money-back guaranteed.']].map(([I, t, d]) => (
          <div key={t} className="glass rounded-2xl p-5">
            <I size={20} className="text-indigo-300 mb-2" />
            <h3 className="text-white text-sm font-medium">{t}</h3>
            <p className="text-slate-400 text-sm mt-1">{d}</p>
          </div>
        ))}
      </div>

      <div className="card p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-slate-300"><Clock size={18} className="text-indigo-300" /> Already ordered? Track it and complete payment any time.</div>
        <Link to="/track" className="btn-primary">Track an order</Link>
      </div>
    </InfoShell>
  );
}
