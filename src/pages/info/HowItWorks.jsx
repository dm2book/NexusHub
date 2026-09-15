import { Link } from 'react-router-dom';
import { Wallet, CreditCard, PackageCheck, ShieldCheck, Zap, Headphones } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { usePageMeta } from '../../lib/useMeta.js';

/* One full content set per language the shop offers — the page renders one
   language, never a mix.
   It carried EN and NL only, and `CONTENT[lang] || CONTENT.en` meant a German
   or French reader got this entire page in English: the heading, all four
   steps and all three promises. i18n-content.test now refuses a map like this
   one that does not cover every offered language. */
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
  de: {
    eyebrow: 'Anleitung', title: 'So funktioniert es', subtitle: 'Vom Warenkorb ins Spiel, in vier einfachen Schritten.',
    steps: [
      [Wallet, 'Aussuchen', 'Wähle deine Spiele-Aufladung, Geschenkkarte oder dein Abo im Shop.'],
      [CreditCard, 'Bezahlen, wie du willst', 'Zahle mit Tikkie, Revolut oder PayPal — deine Bestellnummer ist der Verwendungszweck.'],
      [ShieldCheck, 'Wir bestätigen', 'Deine Zahlung wird geprüft (während der Öffnungszeiten meist innerhalb von Minuten).'],
      [PackageCheck, 'Du bekommst deinen Code', 'Auf Lager: automatisch verschickt, sobald wir bestätigen. Sonst von Hand geliefert, meistens in wenigen Stunden.'],
    ],
    perks: [
      [Zap, 'Was auf Lager ist, geht von allein raus', 'Sobald die Zahlung bestätigt ist, wartest du nicht auf uns.'],
      [ShieldCheck, 'Geld zurück', 'Können wir deine Bestellung nicht liefern, bekommst du alles zurück.'],
      [Headphones, 'Ein echter Mensch', 'Öffne jederzeit ein Ticket in Discord — tagsüber antworten wir am schnellsten.'],
    ],
    cta: 'Zum Shop',
  },
  fr: {
    eyebrow: 'Guide', title: 'Comment ça marche', subtitle: 'Du panier au jeu, en quatre étapes simples.',
    steps: [
      [Wallet, 'Choisis ton produit', 'Choisis ta recharge de jeu, ta carte cadeau ou ton abonnement dans la boutique.'],
      [CreditCard, 'Paie comme tu veux', 'Paie avec Tikkie, Revolut ou PayPal — ton numéro de commande sert de référence.'],
      [ShieldCheck, 'On confirme', 'Ton paiement est vérifié (en général en quelques minutes pendant les heures d’ouverture).'],
      [PackageCheck, 'Tu reçois ton code', 'En stock : envoyé automatiquement dès qu’on confirme. Sinon livré à la main, en général en quelques heures.'],
    ],
    perks: [
      [Zap, 'Ce qui est en stock part tout seul', 'Une fois le paiement confirmé, tu ne nous attends pas.'],
      [ShieldCheck, 'Remboursé', 'Si nous ne pouvons pas livrer ta commande, tu es remboursé intégralement.'],
      [Headphones, 'Une vraie personne', 'Ouvre un ticket sur Discord quand tu veux — la réponse est la plus rapide en journée.'],
    ],
    cta: 'Aller à la boutique',
  },
};

export default function HowItWorks() {
  /* No arguments: usePageMeta falls back to this route's own copy in
     content/seo.js, which exists in all four languages. Passing an English
     string here overrode it — the tab said "How it works — order to delivery" above a page written in
     German. */
  usePageMeta();
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
