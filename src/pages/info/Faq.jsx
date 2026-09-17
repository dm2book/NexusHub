import { useState, useEffect, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import InfoShell from '../../components/InfoShell.jsx';
import { useI18n } from '../../lib/i18n.jsx';
import { getConfig } from '../../lib/useConfig.js';
import { usePageMeta, useJsonLd } from '../../lib/useMeta.js';
import { faqLd } from '../../content/seo.js';

/* One full content set per language the shop offers — one language per
   render, never mixed.
   It carried EN and NL only, so `CONTENT[lang] || CONTENT.en` served a German
   or French reader the entire help centre in English. i18n-content.test now
   refuses a map like this one that does not cover every offered language. */
/**
 * Which methods are on, answered by the shop rather than by this file.
 *
 * It used to name five providers and a PSP: "iDEAL, Bancontact, Apple Pay,
 * credit card and PayPal, through Mollie". The shop takes Tikkie, by hand.
 * That answer is also fed to Google as FAQ structured data, so it was a
 * machine-readable claim as well as a human one.
 *
 * A token rather than a rewrite, because the honest answer changes the day a
 * Mollie key is set — and an answer that has to be edited by hand on that day
 * is an answer that will be wrong again.
 */
const PAY_NOW = '{{methods}}';

const SENTENCE = {
  en: { known: (m) => `Right now: ${m}.`, none: 'The methods on offer are shown at checkout.',
        auto: 'Confirmation is automatic.', hand: 'We confirm every payment by hand, usually within minutes during the day.' },
  nl: { known: (m) => `Op dit moment: ${m}.`, none: 'Welke methoden er zijn zie je bij het afrekenen.',
        auto: 'De bevestiging gaat automatisch.', hand: 'We bevestigen elke betaling met de hand, overdag meestal binnen een paar minuten.' },
  de: { known: (m) => `Aktuell: ${m}.`, none: 'Welche Methoden es gibt, siehst du an der Kasse.',
        auto: 'Die Bestätigung läuft automatisch.', hand: 'Wir bestätigen jede Zahlung von Hand, tagsüber meist innerhalb weniger Minuten.' },
  fr: { known: (m) => `En ce moment : ${m}.`, none: 'Les moyens disponibles sont indiqués au moment de payer.',
        auto: 'La confirmation est automatique.', hand: 'Nous confirmons chaque paiement à la main, en journée généralement en quelques minutes.' },
};

const CONTENT = {
  en: {
    eyebrow: 'Help center', title: 'Frequently asked questions',
    groups: [
      { title: 'Orders & delivery', items: [
        ['How fast is delivery?', 'What we hold in stock is released automatically as soon as your payment is confirmed. Everything else we buy in and deliver by hand, usually within a few hours during the day. Your order page shows which one applies and updates live.'],
        ['Where do I find my codes?', 'In your dashboard under Downloads, and on the order page once the order is completed.'],
        ['Can I track my order?', 'Yes — use the order page in your dashboard, or the public Track Order page with your order number.'],
      ] },
      { title: 'Payments & refunds', items: [
        ['Which payment methods are supported?', `You order first and pay after, with your order number as the reference — nothing is charged automatically. ${PAY_NOW}`],
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
        ['Hoe snel is de levering?', 'Wat we op voorraad hebben gaat automatisch de deur uit zodra je betaling bevestigd is. De rest kopen we in en leveren we met de hand, meestal binnen een paar uur overdag. Op je bestelpagina zie je welke van de twee geldt, en die ververst live.'],
        ['Waar vind ik mijn codes?', 'In je dashboard onder Downloads, en op de bestelpagina zodra de bestelling is afgerond.'],
        ['Kan ik mijn bestelling volgen?', 'Ja — via de bestelpagina in je dashboard, of via de publieke Volg-pagina met je bestelnummer.'],
      ] },
      { title: 'Betalingen & terugbetalingen', items: [
        ['Welke betaalmethoden worden ondersteund?', `Je bestelt eerst en betaalt daarna, met je bestelnummer als referentie — er wordt niets automatisch afgeschreven. ${PAY_NOW}`],
        ['Hoe werken terugbetalingen?', 'Vraag een terugbetaling aan via je bestelpagina of open een ticket in onze Discord. Na goedkeuring wordt het bedrag teruggestort via je oorspronkelijke betaalmethode.'],
      ] },
      { title: 'Account & veiligheid', items: [
        ['Heb ik een account nodig?', 'Je kunt bestellingen volgen met alleen je bestelnummer, maar een account geeft je toegang tot je dashboard, downloads en geschiedenis.'],
        ['Hoe houden jullie mijn account veilig?', 'Wachtwoordloos inloggen, versleutelde sessies, automatische fraudecontrole en volledige audit-logging.'],
        ['Kan ik inloggen met Google of Discord?', 'Ja, wanneer die providers zijn ingeschakeld — plus wachtwoordloze e-mailcodes.'],
      ] },
    ],
  },
  de: {
    eyebrow: 'Hilfebereich', title: 'Häufige Fragen',
    groups: [
      { title: 'Bestellungen & Lieferung', items: [
        ['Wie schnell wird geliefert?', 'Was wir auf Lager haben, geht automatisch raus, sobald deine Zahlung bestätigt ist. Alles andere kaufen wir ein und liefern es von Hand, tagsüber meistens innerhalb weniger Stunden. Auf deiner Bestellseite siehst du, was für dich gilt, und sie aktualisiert sich live.'],
        ['Wo finde ich meine Codes?', 'In deinem Dashboard unter Downloads, und auf der Bestellseite, sobald die Bestellung abgeschlossen ist.'],
        ['Kann ich meine Bestellung verfolgen?', 'Ja — über die Bestellseite in deinem Dashboard oder über die öffentliche Verfolgen-Seite mit deiner Bestellnummer.'],
      ] },
      { title: 'Zahlungen & Rückerstattungen', items: [
        ['Welche Zahlungsmethoden werden unterstützt?', `Du bestellst zuerst und zahlst danach, mit deiner Bestellnummer als Verwendungszweck — es wird nichts automatisch abgebucht. ${PAY_NOW}`],
        ['Wie funktionieren Rückerstattungen?', 'Beantrage eine Rückerstattung auf deiner Bestellseite oder öffne ein Ticket in unserem Discord. Nach der Freigabe wird der Betrag auf deinem ursprünglichen Zahlungsweg zurückerstattet.'],
      ] },
      { title: 'Konto & Sicherheit', items: [
        ['Brauche ich ein Konto?', 'Du kannst Bestellungen allein mit der Bestellnummer verfolgen, aber ein Konto gibt dir Zugang zu deinem Dashboard, deinen Downloads und deiner Historie.'],
        ['Wie haltet ihr mein Konto sicher?', 'Anmeldung ohne Passwort, verschlüsselte Sitzungen, automatische Betrugsprüfung und vollständige Audit-Protokolle.'],
        ['Kann ich mich mit Google oder Discord anmelden?', 'Ja, wenn diese Anbieter aktiviert sind — dazu Anmeldecodes per E-Mail, ganz ohne Passwort.'],
      ] },
    ],
  },
  fr: {
    eyebrow: 'Centre d’aide', title: 'Questions fréquentes',
    groups: [
      { title: 'Commandes & livraison', items: [
        ['La livraison prend combien de temps ?', 'Ce que nous avons en stock part automatiquement dès que ton paiement est confirmé. Le reste, nous l’achetons et le livrons à la main, en général en quelques heures dans la journée. Ta page de commande indique lequel des deux s’applique et se met à jour en direct.'],
        ['Où est-ce que je trouve mes codes ?', 'Dans ton tableau de bord sous Téléchargements, et sur la page de commande une fois la commande terminée.'],
        ['Puis-je suivre ma commande ?', 'Oui — via la page de commande de ton tableau de bord, ou via la page de suivi publique avec ton numéro de commande.'],
      ] },
      { title: 'Paiements & remboursements', items: [
        ['Quels moyens de paiement sont acceptés ?', `Tu commandes d’abord et tu paies ensuite, avec ton numéro de commande comme référence — rien n’est prélevé automatiquement. ${PAY_NOW}`],
        ['Comment fonctionnent les remboursements ?', 'Demande un remboursement depuis ta page de commande ou ouvre un ticket sur notre Discord. Une fois approuvé, le montant est remboursé sur ton moyen de paiement d’origine.'],
      ] },
      { title: 'Compte & sécurité', items: [
        ['Ai-je besoin d’un compte ?', 'Tu peux suivre une commande avec son seul numéro, mais un compte te donne accès à ton tableau de bord, à tes téléchargements et à ton historique.'],
        ['Comment protégez-vous mon compte ?', 'Connexion sans mot de passe, sessions chiffrées, contrôle antifraude automatique et journalisation complète.'],
        ['Puis-je me connecter avec Google ou Discord ?', 'Oui, quand ces fournisseurs sont activés — ainsi que par code e-mail, sans mot de passe.'],
      ] },
    ],
  },
};

export default function Faq() {
  /* No arguments: usePageMeta falls back to this route's own copy in
     content/seo.js, which exists in all four languages. Passing an English
     string here overrode it — the tab said "FAQ — delivery, payment & refunds" above a page written in
     German. */
  usePageMeta();
  const { lang } = useI18n();
  const base = CONTENT[lang] || CONTENT.en;

  /* Ask the shop which methods are on, and fill the token in. Until the answer
     arrives the sentence simply ends after "shown at checkout" — true either
     way, and never a list that turns out to be wrong a moment later. */
  const [methods, setMethods] = useState(null);
  useEffect(() => {
    getConfig()
      .then((c) => setMethods({
        names: [
          ...(c.paymentMethods || []).map((m) => m.label).filter(Boolean),
          ...(c.mollieMethods || []).map((m) => m.label || m.id).filter(Boolean),
        ],
        automatic: (c.mollieMethods || []).length > 0 || (c.paymentProvider && c.paymentProvider !== 'manual'),
      }))
      .catch(() => setMethods({ names: [], automatic: false }));
  }, []);

  const L = useMemo(() => {
    const S = SENTENCE[lang] || SENTENCE.en;
    const names = [...new Set(methods?.names || [])];
    const filled = [names.length ? S.known(names.join(', ')) : S.none,
      methods ? (methods.automatic ? S.auto : S.hand) : ''].filter(Boolean).join(' ');
    const swap = (t) => t.replace('{{methods}}', filled).replace(/\s+([.,])/g, '$1').trim();
    return {
      ...base,
      groups: base.groups.map((g) => ({ ...g, items: g.items.map(([q, a]) => [q, swap(a)]) })),
    };
  }, [base, lang, methods]);
  // Built from the questions this page actually renders, not a hand-kept second
  // list. FAQ markup that does not match the visible page is the fastest way to
  // lose the rich result it was added for.
  useJsonLd('faq', faqLd(L.groups.flatMap((g) => g.items.map(([q, a]) => ({ q, a })))));
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
