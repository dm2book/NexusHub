import { Link } from 'react-router-dom';
import { Wallet, CreditCard, PackageCheck, ShieldCheck, Zap, Headphones } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { usePageMeta } from '../../lib/useMeta.js';

// Full EN + NL content sets — the page renders one language, never a mix.
const CONTENT = {
  en: {
    eyebrow: 'Guide', title: 'How it works', subtitle: 'From cart to in-game in four simple steps.',
    steps: [
      [Wallet, 'Browse & pick', 'Choose your game top-up, gift card or subscription from the shop.'],
      [CreditCard, 'Pay your way', 'Check out with Tikkie, Revolut or PayPal — your order number is the reference.'],
      [ShieldCheck, 'We confirm', 'Your payment is verified (usually within minutes during open hours).'],
      [PackageCheck, 'You get your code', 'In stock: sent automatically the moment we confirm. Otherwise delivered by hand, usually within a few hours.'],
    ],
    perks: [
      [Zap, 'In stock goes out by itself', 'No waiting on us once the payment is confirmed.'],
      [ShieldCheck, 'Money back', 'If we cannot deliver your order, you are refunded in full.'],
      [Headphones, 'A real person', 'Open a ticket in Discord any time — answered fastest during the day.'],
    ],
    cta: 'Start shopping',
  },
  nl: {
    eyebrow: 'Uitleg', title: 'Hoe het werkt', subtitle: 'Van winkelwagen naar in-game in vier simpele stappen.',
    steps: [
      [Wallet, 'Kies je product', 'Kies je game top-up, cadeaukaart of abonnement in de shop.'],
      [CreditCard, 'Betaal zoals jij wilt', 'Reken af met Tikkie, Revolut of PayPal — je bestelnummer is de referentie.'],
      [ShieldCheck, 'Wij bevestigen', 'Je betaling wordt geverifieerd (meestal binnen minuten tijdens openingstijden).'],
      [PackageCheck, 'Je krijgt je code', 'Op voorraad: automatisch verstuurd zodra we bevestigen. Anders met de hand, meestal binnen een paar uur.'],
    ],
    perks: [
      [Zap, 'Op voorraad gaat vanzelf', 'Zodra je betaling bevestigd is hoef je niet op ons te wachten.'],
      [ShieldCheck, 'Geld terug', 'Kunnen we je bestelling niet leveren, dan krijg je alles terug.'],
      [Headphones, 'Een echt mens', 'Open op elk moment een ticket in Discord — overdag krijg je het snelst antwoord.'],
    ],
    cta: 'Begin met shoppen',
  },
};

export default function HowItWorks() {
  usePageMeta('How it works — order to delivery', 'Pick your item, pay by bank transfer with the reference shown, and get your code once the payment is confirmed.');
  const { lang } = useI18n();
  const L = CONTENT[lang] || CONTENT.en;
  return (
    <InfoShell eyebrow={L.eyebrow} title={L.title} subtitle={L.subtitle} narrow={false}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12 max-w-5xl mx-auto">
        {L.steps.map(([I, t, d], i) => (
          <div key={t} className="relative card p-6">
            <span className="absolute top-4 right-5 font-display text-5xl text-white/5">{i + 1}</span>
            <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-4"><I size={22} className="text-primary" /></div>
            <h3 className="text-white mb-1.5">{t}</h3>
            <p className="text-slate-400 text-sm">{d}</p>
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-3 gap-4 max-w-5xl mx-auto mb-10">
        {L.perks.map(([I, t, d]) => (
          <div key={t} className="glass rounded-2xl p-5"><I size={20} className="text-indigo-300 mb-2" /><h3 className="text-white text-sm font-medium">{t}</h3><p className="text-slate-400 text-sm mt-1">{d}</p></div>
        ))}
      </div>
      <div className="text-center"><Link to="/shop" className="btn-primary px-7 py-3.5">{L.cta}</Link></div>
    </InfoShell>
  );
}
