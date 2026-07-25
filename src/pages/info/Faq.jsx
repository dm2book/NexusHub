import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { usePageMeta } from '../../lib/useMeta.js';

// Full EN + NL content sets — one language per render, never mixed.
const CONTENT = {
  en: {
    eyebrow: 'Help center', title: 'Frequently asked questions',
    groups: [
      { title: 'Orders & delivery', items: [
        ['How fast is delivery?', 'Most digital goods are delivered automatically within seconds of payment. You can watch the status update live on your order page.'],
        ['Where do I find my codes?', 'In your dashboard under Downloads, and on the order page once the order is completed.'],
        ['Can I track my order?', 'Yes — use the order page in your dashboard, or the public Track Order page with your order number.'],
      ] },
      { title: 'Payments & refunds', items: [
        ['Which payment methods are supported?', 'You can pay with Tikkie, Revolut or PayPal. At checkout you pick a method and pay using your order number as the reference — see our Payment Methods page for details.'],
        ['How do refunds work?', 'Request a refund from your order page or open a ticket in our Discord. Once approved, eligible orders are refunded to your original method.'],
      ] },
      { title: 'Account & security', items: [
        ['Do I need an account?', 'You can track orders by number without one, but an account unlocks your dashboard, downloads and history.'],
        ['How do you keep my account safe?', 'Passwordless sign-in, encrypted sessions, automated fraud screening and full audit logging.'],
        ['Can I sign in with Google or Discord?', 'Yes, when those providers are enabled — plus passwordless email codes.'],
      ] },
    ],
  },
  nl: {
    eyebrow: 'Helpcentrum', title: 'Veelgestelde vragen',
    groups: [
      { title: 'Bestellingen & levering', items: [
        ['Hoe snel is de levering?', 'De meeste digitale producten worden binnen seconden na betaling automatisch geleverd. Je kunt de status live volgen op je bestelpagina.'],
        ['Waar vind ik mijn codes?', 'In je dashboard onder Downloads, en op de bestelpagina zodra de bestelling is afgerond.'],
        ['Kan ik mijn bestelling volgen?', 'Ja — via de bestelpagina in je dashboard, of via de publieke Volg-pagina met je bestelnummer.'],
      ] },
      { title: 'Betalingen & terugbetalingen', items: [
        ['Welke betaalmethoden worden ondersteund?', 'Je kunt betalen met Tikkie, Revolut of PayPal. Bij het afrekenen kies je een methode en betaal je met je bestelnummer als referentie — zie onze Betaalmethoden-pagina voor details.'],
        ['Hoe werken terugbetalingen?', 'Vraag een terugbetaling aan via je bestelpagina of open een ticket in onze Discord. Na goedkeuring wordt het bedrag teruggestort via je oorspronkelijke betaalmethode.'],
      ] },
      { title: 'Account & veiligheid', items: [
        ['Heb ik een account nodig?', 'Je kunt bestellingen volgen met alleen je bestelnummer, maar een account geeft je toegang tot je dashboard, downloads en geschiedenis.'],
        ['Hoe houden jullie mijn account veilig?', 'Wachtwoordloos inloggen, versleutelde sessies, automatische fraudecontrole en volledige audit-logging.'],
        ['Kan ik inloggen met Google of Discord?', 'Ja, wanneer die providers zijn ingeschakeld — plus wachtwoordloze e-mailcodes.'],
      ] },
    ],
  },
};

export default function Faq() {
  usePageMeta('FAQ — delivery, payment & refunds', 'How fast delivery is, how paying works, what happens if an order does not arrive, and how refunds are handled.');
  const { lang } = useI18n();
  const L = CONTENT[lang] || CONTENT.en;
  return (
    <InfoShell eyebrow={L.eyebrow} title={L.title}>
      <div className="space-y-10">
        {L.groups.map((g) => (
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
