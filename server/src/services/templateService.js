/**
 * Branded email layout + token rendering.
 *
 * Templates store only the inner content; we wrap it in a consistent,
 * email-client-safe HTML shell using the configured brand colours/logo so the
 * sender always looks on-brand. Admin edits to subject/body are honoured.
 *
 * Layout notes: table-based structure + widely-supported CSS only (no flex/grid),
 * so it renders correctly in Gmail, Outlook, Apple Mail and mobile clients.
 */
import { config } from '../config/env.js';
// The seller identity every mail footer states. The same object the legal pages,
// the invoice and the launch check read (sellerIdentityService keeps it current),
// so the footer can never name a different seller from the terms.
import { LEGAL } from '../../../src/lib/legalIdentity.js';
import { UNPAID_CANCEL_DAYS } from './emailCopy.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Replace {{a.b}} tokens from a flat/nested context. Unknown tokens → ''.
 *  Values are HTML-escaped UNLESS the token name ends in `Html` (itemsHtml,
 *  deliveriesHtml, …) — those are built server-side with their own escaping.
 *  Without this, customer-controlled fields (e.g. billing.full_name → user.name)
 *  would inject raw HTML into branded emails sent from our verified domain,
 *  turning checkout into a phishing relay to any address. */
export function renderTokens(str, ctx, { where = 'template' } = {}) {
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, pathExpr) => {
    const val = pathExpr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    if (val == null) {
      /* An empty string is still the right OUTPUT — half a subject line beats a
         raw {{token}} in someone's inbox — but it must not be silent. A caller
         that forgets a field ships mail like " is your ForgeMarket login code",
         and nothing anywhere notices; this is the only place that can see it. */
      console.warn(`[email] ${where}: {{${pathExpr}}} had no value — rendered as empty`);
      return '';
    }
    return /Html$/.test(pathExpr.split('.').pop()) ? String(val) : esc(String(val));
  });
}

/**
 * Tokens filled in for a SUBJECT line — plain text, so nothing is HTML-escaped.
 *
 * A subject is not HTML: rendered through renderTokens a product called
 * "App Store & iTunes" arrived as "App Store &amp; iTunes", and a buyer's own
 * ticket subject "Can't find" as "Can&#39;t find". Line breaks are flattened —
 * a newline in a header is the one thing a subject must never carry.
 */
export function renderSubject(str, ctx, { where = 'subject' } = {}) {
  return String(str).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, pathExpr) => {
    const val = pathExpr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    if (val == null) {
      console.warn(`[email] ${where}: {{${pathExpr}}} had no value — rendered as empty`);
      return '';
    }
    return String(val);
  }).replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Per-email identity.
 *
 * Every mail used to carry the same purple header and the same three pills
 * ("Instant delivery · Buyer protected · 24/7 support"), so a login code, a
 * refund and a delivery were indistinguishable in an inbox — and two of those
 * pills were claims the storefront no longer makes.
 *
 * Each template now gets an accent, an eyebrow line that says what the mail IS,
 * and a footer strip that only makes promises that hold for THAT mail. `pills`
 * of [] renders no strip at all — a security code is not a place for marketing.
 */
export const EMAIL_THEMES = {
  account_created: { accent: '#7c5cff', accent2: '#a855f7',
    eyebrow: { nl: 'Account aangemaakt', en: 'Account created', de: 'Konto erstellt', fr: 'Compte créé' },
    pills: [
      { nl: '🔐 Geen wachtwoord om te onthouden', en: '🔐 No password to remember', de: '🔐 Kein Passwort zu merken', fr: '🔐 Aucun mot de passe à retenir' },
      { nl: '💬 Hulp via Discord', en: '💬 Help on Discord', de: '💬 Hilfe über Discord', fr: '💬 De l’aide sur Discord' },
    ] },
  order_received: { accent: '#f5b324', accent2: '#fb923c',
    eyebrow: { nl: 'Bestelling ontvangen', en: 'Order received', de: 'Bestellung eingegangen', fr: 'Commande reçue' },
    pills: [
      { nl: '🧾 Kenmerk = je bestelnummer', en: '🧾 Reference = your order number', de: '🧾 Verwendungszweck = deine Bestellnummer', fr: '🧾 Référence = ton numéro de commande' },
      { nl: '🛡 Geld terug als we niet leveren', en: '🛡 Money back if we cannot deliver', de: '🛡 Geld zurück, wenn wir nicht liefern', fr: '🛡 Remboursé si nous ne livrons pas' },
    ] },
  /* order_received when a payment provider takes the payment: the reference
     pill is for a bank transfer that does not exist, and "Order received" read
     as if the order was settled. Chosen in renderTemplate by ctx.order.viaPsp. */
  order_received_psp: { accent: '#f5b324', accent2: '#fb923c',
    eyebrow: { nl: 'Nog niet betaald', en: 'Not paid yet', de: 'Noch nicht bezahlt', fr: 'Pas encore payée' },
    pills: [
      { nl: '🔒 Betalen via de beveiligde betaalpagina', en: '🔒 Pay on the secure payment page', de: '🔒 Bezahlen auf der sicheren Zahlungsseite', fr: '🔒 Paiement sur la page sécurisée' },
      { nl: '🛡 Geld terug als we niet leveren', en: '🛡 Money back if we cannot deliver', de: '🛡 Geld zurück, wenn wir nicht liefern', fr: '🛡 Remboursé si nous ne livrons pas' },
    ] },
  payment_reminder: { accent: '#f5b324', accent2: '#f97316',
    eyebrow: { nl: 'Wacht op betaling', en: 'Awaiting payment', de: 'Wartet auf Zahlung', fr: 'En attente de paiement' },
    pills: [
      /* Not "reserved": nothing is held back for an unpaid order. What is true
         is that it stays open until the sweep cancels it. */
      { nl: `⏳ Je bestelling staat ${UNPAID_CANCEL_DAYS} dagen open`, en: `⏳ Your order stays open for ${UNPAID_CANCEL_DAYS} days`, de: `⏳ Deine Bestellung bleibt ${UNPAID_CANCEL_DAYS} Tage offen`, fr: `⏳ Ta commande reste ouverte ${UNPAID_CANCEL_DAYS} jours` },
      { nl: '🛡 Geld terug als we niet leveren', en: '🛡 Money back if we cannot deliver', de: '🛡 Geld zurück, wenn wir nicht liefern', fr: '🛡 Remboursé si nous ne livrons pas' },
    ] },
  payment_confirmed: { accent: '#34d399', accent2: '#10b981',
    eyebrow: { nl: 'Betaling bevestigd', en: 'Payment confirmed', de: 'Zahlung bestätigt', fr: 'Paiement confirmé' },
    pills: [
      { nl: '✅ Betaling ontvangen', en: '✅ Payment received', de: '✅ Zahlung eingegangen', fr: '✅ Paiement reçu' },
      { nl: '📦 We maken je bestelling klaar', en: '📦 We are preparing your order', de: '📦 Wir machen deine Bestellung fertig', fr: '📦 Nous préparons ta commande' },
    ] },
  order_processing: { accent: '#38bdf8', accent2: '#6366f1',
    eyebrow: { nl: 'Bestelling in behandeling', en: 'Order in progress', de: 'Bestellung in Arbeit', fr: 'Commande en cours' },
    pills: [
      { nl: '📦 Wordt klaargemaakt', en: '📦 Being prepared', de: '📦 Wird vorbereitet', fr: '📦 En préparation' },
      { nl: '💬 Hulp via Discord', en: '💬 Help on Discord', de: '💬 Hilfe über Discord', fr: '💬 De l’aide sur Discord' },
    ] },
  order_completed: { accent: '#34d399', accent2: '#10b981',
    eyebrow: { nl: 'Geleverd', en: 'Delivered', de: 'Geliefert', fr: 'Livrée' },
    pills: [
      { nl: '🛡 Geld terug als we niet leveren', en: '🛡 Money back if we cannot deliver', de: '🛡 Geld zurück, wenn wir nicht liefern', fr: '🛡 Remboursé si nous ne livrons pas' },
      { nl: '💬 Klopt er iets niet? Antwoord even', en: '💬 Something off? Just reply', de: '💬 Stimmt etwas nicht? Antworte einfach', fr: '💬 Un souci ? Réponds simplement' },
    ] },
  refund_issued: { accent: '#a855f7', accent2: '#d946ef',
    eyebrow: { nl: 'Terugbetaald', en: 'Refunded', de: 'Zurückerstattet', fr: 'Remboursée' },
    pills: [
      { nl: '↩️ Je geld is onderweg', en: '↩️ Your money is on its way', de: '↩️ Dein Geld ist unterwegs', fr: '↩️ Ton argent est en route' },
    ] },
  custom_message: { accent: '#7c5cff', accent2: '#a855f7',
    eyebrow: { nl: 'Bericht van support', en: 'Message from support', de: 'Nachricht vom Support', fr: 'Message du support' },
    pills: [
      { nl: '💬 Antwoord gewoon — er zit een mens achter', en: '💬 Just reply — a person reads this', de: '💬 Antworte einfach — hier sitzt ein Mensch', fr: '💬 Réponds simplement — une personne te lit' },
    ] },
  support_reply: { accent: '#7c5cff', accent2: '#a855f7',
    eyebrow: { nl: 'Antwoord op je ticket', en: 'Reply to your ticket', de: 'Antwort auf dein Ticket', fr: 'Réponse à ton ticket' },
    pills: [
      { nl: '💬 Antwoord gewoon — er zit een mens achter', en: '💬 Just reply — a person reads this', de: '💬 Antworte einfach — hier sitzt ein Mensch', fr: '💬 Réponds simplement — une personne te lit' },
    ] },
  cart_reminder: { accent: '#7c5cff', accent2: '#d946ef',
    eyebrow: { nl: 'Staat nog in je winkelwagen', en: 'Still in your basket', de: 'Liegt noch in deinem Warenkorb', fr: 'Toujours dans ton panier' },
    pills: [
      { nl: '🛒 Geen account nodig', en: '🛒 No account needed', de: '🛒 Kein Konto nötig', fr: '🛒 Pas besoin de compte' },
      { nl: '💸 Geen verborgen kosten', en: '💸 No hidden fees', de: '💸 Keine versteckten Kosten', fr: '💸 Aucun frais caché' },
    ] },
  /* Only what the mail can back up: it is sent because the shopper asked for
     it, and every one carries the way to stop them. No "limited time" — a
     price drop in this shop has no deadline anybody set. */
  price_drop: { accent: '#22c55e', accent2: '#14b8a6',
    eyebrow: { nl: 'Prijsdaling', en: 'Price drop', de: 'Preissenkung', fr: 'Baisse de prix' },
    pills: [
      { nl: '\u{1F514} Je vroeg om deze alert', en: '\u{1F514} You asked for this alert', de: '\u{1F514} Du hast diesen Alarm eingeschaltet', fr: '\u{1F514} Tu as demandé cette alerte' },
    ] },
  review_request: { accent: '#f59e0b', accent2: '#f97316',
    eyebrow: { nl: 'Hoe deden we het?', en: 'How did we do?', de: 'Wie haben wir das gemacht?', fr: 'Comment avons-nous fait ?' },
    pills: [
      { nl: '⭐ Een paar zinnen is genoeg', en: '⭐ A couple of sentences is plenty', de: '⭐ Ein paar Sätze reichen', fr: '⭐ Quelques phrases suffisent' },
    ] },
  gift_card: { accent: '#d946ef', accent2: '#a855f7',
    eyebrow: { nl: 'Cadeaubon', en: 'Gift card', de: 'Geschenkkarte', fr: 'Carte cadeau' },
    pills: [
      { nl: '🎁 Vervalt niet zolang hij niet gebruikt is', en: '🎁 Does not expire while unused', de: '🎁 Verfällt nicht, solange sie ungenutzt ist', fr: '🎁 N’expire pas tant qu’elle n’est pas utilisée' },
    ] },
  launch_announcement: { accent: '#22d3ee', accent2: '#6366f1',
    eyebrow: { nl: 'We zijn open', en: 'We are open', de: 'Wir haben geöffnet', fr: 'Nous sommes ouverts' },
    /* Only what is true on day one. The shop has no reviews and no sales
       history to boast about, and a launch mail that overclaims is the first
       thing a new buyer has to weigh against. */
    pills: [
      { nl: '🚀 De winkel is open', en: '🚀 The shop is open', de: '🚀 Der Shop ist offen', fr: '🚀 La boutique est ouverte' },
      { nl: '🛡 Geld terug als we niet leveren', en: '🛡 Money back if we cannot deliver', de: '🛡 Geld zurück, wenn wir nicht liefern', fr: '🛡 Remboursé si nous ne livrons pas' },
    ] },
  // Security mail: no marketing, no distractions, nothing to click by mistake.
  login_otp: { accent: '#64748b', accent2: '#475569',
    eyebrow: { nl: 'Beveiligingscode', en: 'Security code', de: 'Sicherheitscode', fr: 'Code de sécurité' },
    pills: [] },
  security_alert: { accent: '#64748b', accent2: '#475569',
    eyebrow: { nl: 'Beveiligingsmelding', en: 'Security alert', de: 'Sicherheitshinweis', fr: 'Alerte de sécurité' },
    pills: [] },
  order_cancelled: { accent: '#64748b', accent2: '#94a3b8',
    eyebrow: { nl: 'Geannuleerd', en: 'Cancelled', de: 'Storniert', fr: 'Annulée' },
    pills: [] },
  /* Neutral on purpose: a buyer whose order is checked has, as far as we know,
     done nothing wrong, and the mail must not read like an accusation. */
  order_on_hold: { accent: '#38bdf8', accent2: '#6366f1',
    eyebrow: { nl: 'Extra controle', en: 'Extra check', de: 'Zusätzliche Prüfung', fr: 'Vérification supplémentaire' },
    pills: [
      { nl: '✅ Betaling ontvangen', en: '✅ Payment received', de: '✅ Zahlung eingegangen', fr: '✅ Paiement reçu' },
    ] },
  payment_not_verified: { accent: '#f5b324', accent2: '#f97316',
    eyebrow: { nl: 'Betaling niet gevonden', en: 'Payment not found', de: 'Zahlung nicht gefunden', fr: 'Paiement introuvable' },
    pills: [] },
  refund_request_received: { accent: '#a855f7', accent2: '#d946ef',
    eyebrow: { nl: 'Terugbetalingsverzoek', en: 'Refund request', de: 'Erstattungsanfrage', fr: 'Demande de remboursement' },
    pills: [] },
  refund_request_rejected: { accent: '#64748b', accent2: '#a855f7',
    eyebrow: { nl: 'Besluit over je verzoek', en: 'Decision on your request', de: 'Entscheidung zu deiner Anfrage', fr: 'Décision sur ta demande' },
    pills: [] },
  ticket_opened: { accent: '#7c5cff', accent2: '#a855f7',
    eyebrow: { nl: 'Ticket ontvangen', en: 'Ticket received', de: 'Ticket erhalten', fr: 'Ticket reçu' },
    pills: [] },
  newsletter_confirm: { accent: '#22d3ee', accent2: '#6366f1',
    eyebrow: { nl: 'Bevestig je aanmelding', en: 'Confirm your sign-up', de: 'Bestätige deine Anmeldung', fr: 'Confirme ton inscription' },
    pills: [] },
};

/**
 * Which kind of relationship a mail rests on — the "why am I getting this"
 * line in its footer. One sentence for every mail made it say "you have an
 * account or placed an order" on a price alert, a launch mail and a login code
 * alike, which is true of none of them in particular.
 */
const WHY_KIND = {
  account_created: 'account', login_otp: 'login', security_alert: 'security',
  order_received: 'order', payment_reminder: 'order', payment_confirmed: 'order',
  order_processing: 'order', order_completed: 'order', refund_issued: 'order',
  order_cancelled: 'order', order_on_hold: 'order', payment_not_verified: 'order',
  custom_message: 'order', support_reply: 'support', ticket_opened: 'support',
  refund_request_received: 'support', refund_request_rejected: 'support',
  cart_reminder: 'marketing', launch_announcement: 'newsletter', broadcast: 'marketing',
  price_drop: 'alerts', review_request: 'review', gift_card: 'gift',
  newsletter_confirm: 'confirm',
};

const WHY = {
  account: { nl: 'Je krijgt deze mail omdat er met dit adres een {brand}-account is aangemaakt.', en: 'You are receiving this because a {brand} account was created with this address.', de: 'Du bekommst diese Mail, weil mit dieser Adresse ein {brand}-Konto erstellt wurde.', fr: 'Tu reçois cet e-mail parce qu’un compte {brand} a été créé avec cette adresse.' },
  login: { nl: 'Je krijgt deze mail omdat iemand een inlogcode voor dit adres heeft aangevraagd.', en: 'You are receiving this because someone asked for a login code for this address.', de: 'Du bekommst diese Mail, weil jemand einen Anmeldecode für diese Adresse angefordert hat.', fr: 'Tu reçois cet e-mail parce que quelqu’un a demandé un code de connexion pour cette adresse.' },
  security: { nl: 'Je krijgt deze mail omdat er op je {brand}-account is ingelogd.', en: 'You are receiving this because someone signed in to your {brand} account.', de: 'Du bekommst diese Mail, weil sich jemand bei deinem {brand}-Konto angemeldet hat.', fr: 'Tu reçois cet e-mail parce que quelqu’un s’est connecté à ton compte {brand}.' },
  order: { nl: 'Je krijgt deze mail omdat je met dit adres een bestelling bij {brand} hebt geplaatst.', en: 'You are receiving this because you placed an order at {brand} with this address.', de: 'Du bekommst diese Mail, weil du mit dieser Adresse bei {brand} bestellt hast.', fr: 'Tu reçois cet e-mail parce que tu as passé une commande chez {brand} avec cette adresse.' },
  support: { nl: 'Je krijgt deze mail omdat je contact hebt opgenomen met de support van {brand}.', en: 'You are receiving this because you contacted {brand} support.', de: 'Du bekommst diese Mail, weil du den {brand}-Support kontaktiert hast.', fr: 'Tu reçois cet e-mail parce que tu as contacté le support de {brand}.' },
  marketing: { nl: 'Je krijgt deze mail omdat je hebt aangegeven nieuws en aanbiedingen van {brand} te willen ontvangen.', en: 'You are receiving this because you agreed to receive news and offers from {brand}.', de: 'Du bekommst diese Mail, weil du zugestimmt hast, Neuigkeiten und Angebote von {brand} zu erhalten.', fr: 'Tu reçois cet e-mail parce que tu as accepté de recevoir les nouveautés et offres de {brand}.' },
  newsletter: { nl: 'Je krijgt deze mail omdat je je hebt aangemeld voor berichten van {brand}.', en: 'You are receiving this because you signed up for messages from {brand}.', de: 'Du bekommst diese Mail, weil du dich für Nachrichten von {brand} angemeldet hast.', fr: 'Tu reçois cet e-mail parce que tu t’es inscrit(e) aux messages de {brand}.' },
  alerts: { nl: 'Je krijgt deze mail omdat je een prijsalert hebt aangezet.', en: 'You are receiving this because you turned on a price alert.', de: 'Du bekommst diese Mail, weil du einen Preisalarm eingeschaltet hast.', fr: 'Tu reçois cet e-mail parce que tu as activé une alerte de prix.' },
  review: { nl: 'Je krijgt deze mail omdat je bij {brand} hebt besteld.', en: 'You are receiving this because you ordered from {brand}.', de: 'Du bekommst diese Mail, weil du bei {brand} bestellt hast.', fr: 'Tu reçois cet e-mail parce que tu as commandé chez {brand}.' },
  gift: { nl: 'Je krijgt deze mail omdat iemand je een {brand}-cadeaubon heeft gestuurd.', en: 'You are receiving this because someone sent you a {brand} gift card.', de: 'Du bekommst diese Mail, weil dir jemand einen {brand}-Gutschein geschickt hat.', fr: 'Tu reçois cet e-mail parce que quelqu’un t’a envoyé une carte cadeau {brand}.' },
  confirm: { nl: 'Je krijgt deze mail omdat dit adres is opgegeven voor berichten van {brand}. Was jij dat niet? Negeer hem dan — zonder bevestiging sturen we niets.', en: 'You are receiving this because this address was entered to get messages from {brand}. Not you? Ignore it — without a confirmation we send nothing.', de: 'Du bekommst diese Mail, weil diese Adresse für Nachrichten von {brand} eingetragen wurde. Warst du das nicht? Dann ignoriere sie — ohne Bestätigung schicken wir nichts.', fr: 'Tu reçois cet e-mail parce que cette adresse a été inscrite aux messages de {brand}. Ce n’était pas toi ? Ignore-le — sans confirmation, nous n’envoyons rien.' },
};

/**
 * The line an inbox shows next to the subject, per mail.
 *
 * It was the first 110 characters of the body, which for half the templates is
 * "Hoi Sam, …" and for the delivery mail a status chip — the one bit of the
 * mail every reader sees was the least useful one. Tokens are resolved and
 * escaped like any other.
 */
const PREHEADER = {
  account_created: { nl: 'Je account staat klaar — inloggen gaat met een code per mail.', en: 'Your account is ready — you sign in with a code by email.', de: 'Dein Konto ist bereit — du meldest dich mit einem Code per Mail an.', fr: 'Ton compte est prêt — tu te connectes avec un code par e-mail.' },
  order_received: { nl: 'Bestelling {{order.number}} — zo betaal je, en wat er daarna gebeurt.', en: 'Order {{order.number}} — how to pay, and what happens next.', de: 'Bestellung {{order.number}} — so zahlst du, und was danach passiert.', fr: 'Commande {{order.number}} — comment payer, et la suite.' },
  order_received_psp: { nl: 'Bestelling {{order.number}} is geplaatst, maar nog niet betaald.', en: 'Order {{order.number}} is placed but not paid yet.', de: 'Bestellung {{order.number}} ist aufgegeben, aber noch nicht bezahlt.', fr: 'La commande {{order.number}} est passée mais pas encore payée.' },
  payment_reminder: { nl: 'We hebben je betaling voor {{order.number}} nog niet ontvangen.', en: 'We have not received your payment for {{order.number}} yet.', de: 'Deine Zahlung für {{order.number}} ist noch nicht bei uns.', fr: 'Nous n’avons pas encore reçu ton paiement pour {{order.number}}.' },
  payment_confirmed: { nl: 'Betaling ontvangen voor {{order.number}} — je hoeft niets meer te doen.', en: 'Payment received for {{order.number}} — nothing left for you to do.', de: 'Zahlung für {{order.number}} eingegangen — du musst nichts mehr tun.', fr: 'Paiement reçu pour {{order.number}} — tu n’as plus rien à faire.' },
  order_processing: { nl: 'We maken bestelling {{order.number}} met de hand klaar.', en: 'We are preparing order {{order.number}} by hand.', de: 'Wir machen Bestellung {{order.number}} von Hand fertig.', fr: 'Nous préparons la commande {{order.number}} à la main.' },
  order_completed: { nl: 'Bestelling {{order.number}} is geleverd — alles staat in deze mail.', en: 'Order {{order.number}} is delivered — everything is in this email.', de: 'Bestellung {{order.number}} ist geliefert — alles steht in dieser Mail.', fr: 'La commande {{order.number}} est livrée — tout est dans cet e-mail.' },
  refund_issued: { nl: 'Terugbetaling voor {{order.number}}: {{refund.amount}}.', en: 'Refund for {{order.number}}: {{refund.amount}}.', de: 'Erstattung für {{order.number}}: {{refund.amount}}.', fr: 'Remboursement pour {{order.number}} : {{refund.amount}}.' },
  custom_message: { nl: 'Een bericht over bestelling {{order.number}}.', en: 'A message about order {{order.number}}.', de: 'Eine Nachricht zu Bestellung {{order.number}}.', fr: 'Un message au sujet de la commande {{order.number}}.' },
  support_reply: { nl: 'Nieuw antwoord op ticket {{ticket.number}}.', en: 'New reply on ticket {{ticket.number}}.', de: 'Neue Antwort auf Ticket {{ticket.number}}.', fr: 'Nouvelle réponse au ticket {{ticket.number}}.' },
  cart_reminder: { nl: 'Dit staat nog in je winkelwagen.', en: 'This is still in your cart.', de: 'Das liegt noch in deinem Warenkorb.', fr: 'Ceci est encore dans ton panier.' },
  price_drop: { nl: '{{product.name}} kost nu {{price.current}}.', en: '{{product.name}} now costs {{price.current}}.', de: '{{product.name}} kostet jetzt {{price.current}}.', fr: '{{product.name}} coûte maintenant {{price.current}}.' },
  review_request: { nl: 'Hoe was bestelling {{order.number}}?', en: 'How was order {{order.number}}?', de: 'Wie war Bestellung {{order.number}}?', fr: 'Comment s’est passée la commande {{order.number}} ?' },
  gift_card: { nl: 'Je hebt een cadeaubon van {{giftCard.amount}} gekregen.', en: 'You received a {{giftCard.amount}} gift card.', de: 'Du hast einen Gutschein über {{giftCard.amount}} bekommen.', fr: 'Tu as reçu une carte cadeau de {{giftCard.amount}}.' },
  launch_announcement: { nl: '{{shop.name}} is open — je kunt bestellen.', en: '{{shop.name}} is open — you can order now.', de: '{{shop.name}} hat geöffnet — du kannst bestellen.', fr: '{{shop.name}} est ouvert — tu peux commander.' },
  login_otp: { nl: 'Je inlogcode — alleen invullen op {{app.host}}.', en: 'Your login code — only enter it on {{app.host}}.', de: 'Dein Anmeldecode — nur auf {{app.host}} eingeben.', fr: 'Ton code de connexion — à saisir uniquement sur {{app.host}}.' },
  security_alert: { nl: 'Er is ingelogd op je account vanaf een nieuw apparaat.', en: 'Your account was signed in to from a new device.', de: 'Bei deinem Konto hat sich ein neues Gerät angemeldet.', fr: 'Un nouvel appareil s’est connecté à ton compte.' },
  order_cancelled: { nl: 'Bestelling {{order.number}} is geannuleerd.', en: 'Order {{order.number}} has been cancelled.', de: 'Bestellung {{order.number}} wurde storniert.', fr: 'La commande {{order.number}} a été annulée.' },
  order_on_hold: { nl: 'Betaling ontvangen — we doen nog een extra controle op {{order.number}}.', en: 'Payment received — we are doing an extra check on {{order.number}}.', de: 'Zahlung eingegangen — wir prüfen {{order.number}} noch zusätzlich.', fr: 'Paiement reçu — nous faisons une vérification supplémentaire sur {{order.number}}.' },
  payment_not_verified: { nl: 'We konden je betaling voor {{order.number}} nog niet vinden.', en: 'We could not find your payment for {{order.number}} yet.', de: 'Wir konnten deine Zahlung für {{order.number}} noch nicht finden.', fr: 'Nous n’avons pas encore trouvé ton paiement pour {{order.number}}.' },
  refund_request_received: { nl: 'We hebben je terugbetalingsverzoek voor {{order.number}} ontvangen.', en: 'We received your refund request for {{order.number}}.', de: 'Wir haben deine Erstattungsanfrage für {{order.number}} erhalten.', fr: 'Nous avons reçu ta demande de remboursement pour {{order.number}}.' },
  refund_request_rejected: { nl: 'Ons besluit over je terugbetalingsverzoek voor {{order.number}}.', en: 'Our decision on your refund request for {{order.number}}.', de: 'Unsere Entscheidung zu deiner Erstattungsanfrage für {{order.number}}.', fr: 'Notre décision sur ta demande de remboursement pour {{order.number}}.' },
  ticket_opened: { nl: 'We hebben ticket {{ticket.number}} ontvangen.', en: 'We received ticket {{ticket.number}}.', de: 'Wir haben Ticket {{ticket.number}} erhalten.', fr: 'Nous avons reçu le ticket {{ticket.number}}.' },
  newsletter_confirm: { nl: 'Eén klik om je aanmelding te bevestigen.', en: 'One click to confirm your sign-up.', de: 'Ein Klick, um deine Anmeldung zu bestätigen.', fr: 'Un clic pour confirmer ton inscription.' },
};

/** Templates that are about one order: they carry the terms and the
    withdrawal/refund page in the footer, which is where a buyer looks for them
    when something has gone wrong with exactly that order. */
const ORDER_MAILS = new Set(Object.entries(WHY_KIND).filter(([, k]) => k === 'order').map(([id]) => id));

/**
 * The frame's own words — everything outside the template body.
 *
 * These were hardcoded Dutch while the bodies had been translated into four
 * languages, so a German delivery mail arrived with GELEVERD printed across its
 * header, two Dutch promises under the letter and a Dutch footer: three Dutch
 * fragments wrapped around a German letter, from a shop the buyer had never
 * bought from. That is not a rough edge, it is the thing that makes a real
 * email look like a forged one.
 */
const FRAME = {
  why: {
    nl: 'Je krijgt deze mail omdat je een {brand}-account hebt of een bestelling hebt geplaatst.',
    en: 'You are receiving this because you have a {brand} account or placed an order.',
    de: 'Du bekommst diese Mail, weil du ein {brand}-Konto hast oder eine Bestellung aufgegeben hast.',
    fr: 'Tu reçois cet e-mail parce que tu as un compte {brand} ou que tu as passé une commande.',
  },
  track: { nl: 'Bestelling volgen', en: 'Track order', de: 'Bestellung verfolgen', fr: 'Suivre ma commande' },
  help: { nl: 'Hulp via Discord', en: 'Help on Discord', de: 'Hilfe über Discord', fr: 'De l’aide sur Discord' },
  settings: { nl: 'E-mailinstellingen', en: 'Email settings', de: 'E-Mail-Einstellungen', fr: 'Préférences e-mail' },
  terms: { nl: 'Voorwaarden', en: 'Terms', de: 'AGB', fr: 'Conditions' },
  refunds: { nl: 'Herroeping & terugbetaling', en: 'Withdrawal & refunds', de: 'Widerruf & Erstattung', fr: 'Rétractation & remboursement' },
  unsubscribe: { nl: 'Uitschrijven', en: 'Unsubscribe', de: 'Abmelden', fr: 'Se désabonner' },
  kvk: { nl: 'KvK', en: 'Chamber of Commerce (KvK)', de: 'Handelsregister (KvK)', fr: 'KvK' },
  vat: { nl: 'Btw-id', en: 'VAT ID', de: 'USt-IdNr.', fr: 'N° TVA' },
  support: { nl: 'Klantenservice', en: 'Support', de: 'Kundenservice', fr: 'Service client' },
  tagline: {
    nl: 'Digitale producten voor gamers', en: 'Digital goods for gamers',
    de: 'Digitale Produkte für Gamer', fr: 'Produits numériques pour joueurs',
  },
  // The three stages of an order, for the progress strip on order mails.
  stepPlaced: { nl: 'Geplaatst', en: 'Placed', de: 'Aufgegeben', fr: 'Passée' },
  stepPaid: { nl: 'Betaald', en: 'Paid', de: 'Bezahlt', fr: 'Payée' },
  stepDelivered: { nl: 'Geleverd', en: 'Delivered', de: 'Geliefert', fr: 'Livrée' },
};

/**
 * Where an order mail sits on placed → paid → delivered: the number of steps
 * done. A buyer reading "payment received" sees at a glance that delivery is
 * next; one reading "not paid yet" sees what is still open. Mails that are not
 * about an order's progress (cancelled, refunded, a support message) get no
 * strip — a timeline there would only mislead.
 */
const ORDER_STEP = {
  order_received: 1, payment_reminder: 1, payment_not_verified: 1,
  payment_confirmed: 2, order_processing: 2, order_on_hold: 2,
  order_completed: 3,
};

/** placed → paid → delivered as a three-column table that survives every
    client: the dots and the rules between them are table cells, not shapes. */
function progressHtml(done, accent, lang) {
  const labels = [FRAME.stepPlaced, FRAME.stepPaid, FRAME.stepDelivered].map((t) => esc(pick(t, lang)));
  const rule = (show, lit) => `<td style="padding:0;vertical-align:middle"><div style="height:2px;line-height:2px;font-size:0;background-color:${show ? (lit ? accent : '#2c2c44') : '#12121c'}">&nbsp;</div></td>`;
  const cols = labels.map((label, i) => {
    const isDone = i < done;
    const isNext = i === done;
    const dot = isDone
      ? `<td width="26" height="26" bgcolor="${accent}" style="width:26px;height:26px;background-color:${accent};border-radius:999px;text-align:center;font:700 13px/26px Arial,sans-serif;color:#0b0b14">&#10003;</td>`
      : `<td width="22" height="22" bgcolor="#12121c" style="width:22px;height:22px;background-color:#12121c;border:2px solid ${isNext ? accent : '#34344e'};border-radius:999px;text-align:center;font:700 12px/22px Arial,sans-serif;color:${isNext ? '#ffffff' : '#6b7287'}">${i + 1}</td>`;
    return `<td width="33%" valign="top" style="width:33%;padding:0;text-align:center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${rule(i > 0, i <= done)}${dot}${rule(i < 2, i + 1 <= done)}</tr></table>
      <div style="font:${isDone || isNext ? 700 : 600} 12.5px/1.3 'Segoe UI',Arial,sans-serif;color:${isDone ? '#e5e7eb' : (isNext ? '#ffffff' : '#7a8197')};padding-top:8px">${label}</div>
    </td>`;
  }).join('');
  return `<table role="presentation" class="steps" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px"><tr>${cols}</tr></table>`;
}

/** One language out of a table, never `undefined` in someone's inbox. */
const pick = (table, lang) => (typeof table === 'string' ? table : (table?.[lang] ?? table?.nl ?? table?.en ?? ''));

const DEFAULT_THEME = { accent: null, eyebrow: FRAME.tagline, pills: [] };

/**
 * Inline the styles that carry meaning.
 *
 * The frame's <style> block is the first thing several clients drop (Gmail in
 * some views, Outlook.com on forwards, most "simplified view" readers). The
 * card's dark background survives — it is a bgcolor attribute — but the light
 * text colours lived only in the stylesheet, so what was left was black text on
 * a near-black card: a mail that arrives and cannot be read. This copies the
 * colours, sizes and backgrounds that matter onto the elements themselves.
 *
 * Done by hand rather than with an inliner dependency: the templates use a
 * dozen classes, all known here, and a twenty-line mapping is easier to reason
 * about than a CSS engine in the send path. An element's own inline style is
 * written last, so anything a template set deliberately still wins.
 */
/* The action button, inline. 15px padding + a 20px line box = a 50px target,
   comfortably above the 44px a thumb needs, in clients that keep only inline
   styles; display:block inside its cell so the whole bar is the link. */
const BTN_STYLE = "display:block;background-color:#7c5cff;color:#ffffff;text-decoration:none;padding:15px 24px;border-radius:12px;font-weight:700;font-size:16px;line-height:20px;text-align:center;font-family:'Segoe UI',Arial,Helvetica,sans-serif";

/**
 * Every `<a class="btn">` as a bulletproof button.
 *
 * A styled link renders as plain blue underlined text in desktop Outlook,
 * which ignores padding, radius and background on an <a>. The usual answer:
 * the coloured cell carries the colour (bgcolor works everywhere), Outlook
 * gets a VML round-rect it does draw, and every other client gets the real
 * link. Done on the rendered body, so it also covers a template the owner
 * edited — any `<a class="btn" href="…">label</a>` qualifies.
 */
function bulletproofButtons(html) {
  return String(html).replace(
    /(?:<p\b[^>]*>\s*)?<a class="btn" href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>(?:\s*<\/p>)?/g,
    (whole, href, attrs, label) => {
      const text = label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const rest = attrs.replace(/\s*\bstyle="[^"]*"/i, '');
      return `<table role="presentation" class="btn-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 22px"><tr>
<td align="center" bgcolor="#7c5cff" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:50px;v-text-anchor:middle;width:520px" arcsize="24%" stroke="f" fillcolor="#7c5cff"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold">${text}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a class="btn" href="${href}"${rest} style="${BTN_STYLE}">${label}</a><!--<![endif]-->
</td></tr></table>`;
    });
}

function inlineCritical(html, accent) {
  const TAG = {
    h1: "color:#ffffff;font-size:25px;line-height:1.25;margin:0 0 14px;font-weight:800;letter-spacing:-.3px;font-family:'Segoe UI',Arial,Helvetica,sans-serif",
    p: "color:#b9bfcd;font-size:15.5px;line-height:1.65;margin:0 0 16px;font-family:'Segoe UI',Arial,Helvetica,sans-serif",
    strong: 'color:#ffffff',
    a: 'color:#b9a7ff',
  };
  const CLASS = {
    btn: BTN_STYLE,
    // The one small line under the button: "Vragen? Beantwoord deze mail…".
    help: 'color:#8b93a7;font-size:14px;line-height:1.6;margin:0 0 12px',
    // Unsubscribe / "why you get this" lines inside a body.
    fine: 'color:#8b93a7;font-size:12.5px;line-height:1.6;margin:16px 0 0',
    code: "font:800 30px/1.1 'Courier New',Courier,monospace;letter-spacing:8px;color:#ffffff;background-color:#1a1a2e;border:1px solid #3a3a64;border-radius:14px;padding:22px 16px;text-align:center;margin:4px 0 18px;-webkit-user-select:all;user-select:all",
    notice: `background-color:#171727;border:1px solid #2c2c48;border-left:3px solid ${accent};border-radius:0 12px 12px 0;padding:14px 18px;margin:6px 0 20px;color:#aab2c4;font-size:14px;line-height:1.6`,
    quote: `background-color:#171727;border:1px solid #2c2c48;border-left:3px solid ${accent};border-radius:0 12px 12px 0;padding:16px 18px;margin:0 0 20px;color:#cbd1de;font-size:14.5px;line-height:1.6`,
    badge: `width:64px;height:64px;border-radius:18px;background-color:${accent};text-align:center;font-size:30px;line-height:64px;margin:2px auto 18px`,
    'pill-note': 'display:inline-block;font:700 12px/1 Arial,sans-serif;color:#c7d2fe;background-color:#1b1b30;border:1px solid #34345c;border-radius:999px;padding:9px 16px',
    summary: 'width:100%;border-collapse:collapse;margin:2px 0 20px;font-size:14px;color:#cbd1de',
    r: 'text-align:right;color:#ffffff;white-space:nowrap;font-weight:600',
  };
  return String(html).replace(/<(h1|p|a|strong|div|span|table|td)\b([^>]*)>/gi, (whole, tag, attrs) => {
    const cls = (attrs.match(/\bclass="([^"]*)"/i) || [])[1] || '';
    const own = (attrs.match(/\bstyle="([^"]*)"/i) || [])[1] || '';
    const parts = [TAG[tag.toLowerCase()] || '', ...cls.split(/\s+/).map((c) => CLASS[c] || '')].filter(Boolean);
    if (!parts.length) return whole;
    const rest = attrs.replace(/\s*\bstyle="[^"]*"/i, '');
    return `<${tag}${rest} style="${[...parts, own].filter(Boolean).join(';')}">`;
  });
}

/**
 * The hidden preview line, escaped and padded.
 *
 * Escaped because a token in it can be customer-controlled (a product or a
 * name). Padded because a client shows the preheader and then keeps reading
 * into the body; the run of zero-width characters is what stops "Hoi Sam,
 * GELEVERD Bestelling" from being appended to a sentence that was chosen.
 */
function preheaderHtml(text) {
  const clean = esc(String(text || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim());
  return clean + '&#847;&zwnj;&nbsp;'.repeat(60);
}

/**
 * Who sent this — in the footer of every mail, in the reader's language.
 *
 * A consumer must be able to see who they are dealing with, and an email from a
 * webshop that names nobody is also what a phishing mail looks like. Only the
 * fields that are filled in are printed: an empty KvK is left out, never shown
 * as a blank label or a placeholder.
 */
function sellerLine(lang) {
  const F = (key) => pick(FRAME[key], lang);
  const L = LEGAL || {};
  const v = (k) => String(L[k] || '').trim();
  const name = v('legalName')
    ? (v('tradeName') && v('tradeName') !== v('legalName') ? `${v('tradeName')} — ${v('legalName')}` : v('legalName'))
    : v('tradeName');
  const place = [v('postcode'), v('city')].filter(Boolean).join(' ');
  const address = [v('address'), place, v('country')].filter(Boolean).join(', ');
  const bits = [name, address,
    v('kvk') ? `${F('kvk')} ${v('kvk')}` : '',
    v('vat') ? `${F('vat')} ${v('vat')}` : ''].filter(Boolean).map(esc);
  const support = String(config.email.replyTo || '').trim();
  if (support) bits.push(`${esc(F('support'))}: <a href="mailto:${esc(support)}" style="color:#8b93a7;text-decoration:none">${esc(support)}</a>`);
  return bits.join(' · ');
}

/** A footer promise without its leading emoji — the trust row draws its own
    check mark, so a mail does not end in a row of pictographs. */
const plainPill = (t) => String(t || '').replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '').trim();

/** Wrap rendered content in the premium branded layout. */
export function wrapBranded(contentHtml, {
  preheader = '', theme = DEFAULT_THEME, lang = 'nl', templateId = null, unsubscribeUrl = null,
} = {}) {
  const brand = config.email.fromName;
  // The accent tints the header, the progress strip and the rules — so the
  // mail's purpose is readable before a single word is.
  const color = theme.accent || config.email.brandColor;
  const color2 = theme.accent2 || '#a855f7';
  const pills = (theme.pills || []).map((t) => plainPill(pick(t, lang))).filter(Boolean);
  const eyebrow = pick(theme.eyebrow || DEFAULT_THEME.eyebrow, lang);
  const F = (key) => pick(FRAME[key], lang);
  const year = new Date().getFullYear();
  const app = String(config.appUrl || '').replace(/\/+$/, '');
  const why = pick(WHY[WHY_KIND[templateId]] || FRAME.why, lang).replace('{brand}', brand);
  const linkStyle = 'display:inline-block;color:#c3b5ff;text-decoration:none;font-weight:600;font-size:13px;padding:3px 0';
  const dot = '<span class="dot" style="color:#3a3f55;padding:0 8px">·</span>';
  const links = [
    `<a href="${app}/track" style="${linkStyle}">${esc(F('track'))}</a>`,
    `<a href="${app}/discord" style="${linkStyle}">${esc(F('help'))}</a>`,
    `<a href="${app}/account/settings" style="${linkStyle}">${esc(F('settings'))}</a>`,
    // The terms and the withdrawal page, on the mails about an order — the
    // place a buyer looks for them when that order goes wrong.
    ...(ORDER_MAILS.has(templateId) ? [
      `<a href="${app}/terms" style="${linkStyle}">${esc(F('terms'))}</a>`,
      `<a href="${app}/refunds" style="${linkStyle}">${esc(F('refunds'))}</a>`,
    ] : []),
  ];
  const seller = sellerLine(lang);
  const step = ORDER_STEP[templateId];
  const logo = config.email.logoUrl
    ? `<img src="${config.email.logoUrl}" alt="${esc(brand)}" height="34" style="display:block;border:0" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
         <td width="38" height="38" bgcolor="#ffffff" style="width:38px;height:38px;background-color:#ffffff;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);border-radius:11px;text-align:center;vertical-align:middle;font:800 19px/38px Arial,sans-serif;color:#ffffff">⚡</td>
         <td style="padding-left:12px;font:800 22px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">${esc(brand)}</td>
       </tr></table>`;
  const body = bulletproofButtons(inlineCritical(contentHtml, color));
  const trust = pills.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="trust" style="margin:4px 0 22px"><tr>
        <td bgcolor="#161624" style="background-color:#161624;border:1px solid #26263c;border-radius:14px;padding:12px 16px;text-align:center">${pills.map((p) => `<span class="pill" style="display:inline-block;font:600 12.5px/1.5 'Segoe UI',Arial,sans-serif;color:#b6bdcd;padding:3px 9px"><span style="color:${color};font-weight:800">&#10003;</span>&nbsp;${esc(p)}</span>`).join('')}</td>
      </tr></table>`
    : '';

  return `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>body,table,td,a,p,div,span{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
<style>
  body{margin:0;padding:0;background:#08080f;font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#e5e7eb;-webkit-text-size-adjust:100%}
  .wrap{max-width:600px;margin:0 auto;padding:32px 16px}
  .card{background:#12121c;border:1px solid #26263a;border-radius:20px;overflow:hidden}
  .head{background-color:${color};padding:26px 32px 22px;
        background-image:radial-gradient(circle at 88% 0%,rgba(255,255,255,.30),transparent 46%),
                         radial-gradient(circle at 0% 100%,rgba(0,0,0,.18),transparent 55%),
                         linear-gradient(125deg,${color} 0%,${color2} 100%)}
  /* The eyebrow is the status of THIS mail ("Geleverd", "Nog niet betaald"):
     a chip, so it reads as a label rather than a second, smaller logo. */
  .head-sub{display:inline-block;font:700 11px/1 Arial,sans-serif;color:#fff;margin-top:16px;
            letter-spacing:1.6px;text-transform:uppercase;background:rgba(0,0,0,.24);
            border:1px solid rgba(255,255,255,.32);border-radius:999px;padding:8px 14px}
  .body{padding:36px 32px 10px}
  h1{font-size:25px;line-height:1.25;color:#ffffff;margin:0 0 14px;font-weight:800;letter-spacing:-.3px}
  p{font-size:15.5px;line-height:1.65;color:#b9bfcd;margin:0 0 16px}
  .badge{width:64px;height:64px;border-radius:18px;background-color:${color};background:linear-gradient(135deg,${color},${color2});
         text-align:center;font-size:30px;line-height:64px;margin:2px auto 18px;
         box-shadow:0 10px 26px rgba(0,0,0,.5)}
  .pill-note{display:inline-block;font:700 12.5px/1 Arial,sans-serif;color:#c7d2fe;background:#1b1b30;
             border:1px solid #34345c;border-radius:999px;padding:9px 16px;letter-spacing:.3px}
  strong{color:#fff}
  a{color:#b9a7ff}
  /* One action colour across every mail, deliberately NOT the accent.
     The accent answers "which mail is this"; the button answers "what do I
     press". Those are different questions and they have different, consistent
     answers. The solid background-color comes first so a client that drops
     gradients still draws a purple button rather than white text on nothing. */
  a.btn{display:block;background-color:#7c5cff;
        background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%);
        color:#ffffff !important;text-decoration:none;text-align:center;
        padding:15px 24px;border-radius:12px;font-weight:700;font-size:16px;line-height:20px;
        box-shadow:0 10px 24px rgba(124,92,255,.32)}
  p.help{color:#8b93a7;font-size:14px;line-height:1.6;margin:0 0 12px}
  p.fine{color:#8b93a7;font-size:12.5px;line-height:1.6;margin:16px 0 0}
  p.fine a,p.help a{color:#b9a7ff}
  .code{font:800 30px/1.1 'Courier New',Courier,monospace;letter-spacing:8px;color:#ffffff;
        background-color:#1a1a2e;background-image:linear-gradient(180deg,#1d1d33,#17172a);border:1px solid #3a3a64;border-radius:14px;
        padding:22px 16px;text-align:center;margin:4px 0 18px}
  .notice{background:#171727;border:1px solid #2c2c48;border-left:3px solid ${color};border-radius:0 12px 12px 0;
          padding:14px 18px;margin:6px 0 20px;color:#aab2c4;font-size:14px;line-height:1.6}
  .notice strong{color:#e5e7eb}
  .quote{border:1px solid #2c2c48;border-left:3px solid ${color};background:#171727;border-radius:0 12px 12px 0;
         padding:16px 18px;margin:0 0 20px;color:#cbd1de;font-size:14.5px;line-height:1.6}
  .summary{width:100%;border-collapse:collapse;margin:2px 0 20px;font-size:14.5px}
  .summary td{padding:10px 0;border-bottom:1px solid #24243a;color:#cbd1de}
  .summary .r{text-align:right;color:#fff;white-space:nowrap;font-weight:600}
  .summary .tot td{border-top:2px solid #34345a;border-bottom:0;font-weight:800;color:#fff;padding-top:14px;font-size:15.5px}
  .divider{height:1px;background:#22223a;margin:6px 0 20px}
  .foot{color:#8b93a7;font-size:12px;line-height:1.6;text-align:center}
  .foot-links a{display:inline-block;color:#c3b5ff;text-decoration:none;font-weight:600;font-size:13px;padding:3px 0}
  .foot .dot{color:#3a3f55;padding:0 8px}
  .preheader{display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all}
  /* Phones: a little less air around the card, the code a size down so a
     long key breaks at its dashes instead of running off the card. Progressive
     only — every size above is already readable without it. */
  @media only screen and (max-width:480px){
    .outer{padding:16px 8px !important}
    .wrap{padding:0 !important}
    .head{padding:22px 22px 20px !important}
    .body{padding:28px 22px 6px !important}
    .foot-cell{padding:16px 22px 26px !important}
    .pad-x{padding-left:22px !important;padding-right:22px !important}
    h1{font-size:23px !important}
    .code-val{font-size:19px !important;letter-spacing:1.5px !important}
  }
</style></head>
<body bgcolor="#08080f" style="margin:0;padding:0;background-color:#08080f;color:#e5e7eb">
<span class="preheader" style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all">${preheaderHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#08080f" style="background-color:#08080f"><tr><td align="center" class="outer" style="padding:32px 16px">
<div class="wrap" style="max-width:600px;margin:0 auto">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
  <table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#12121c" style="background-color:#12121c;border:1px solid #26263a;border-radius:20px;overflow:hidden">
    <tr><td class="head" bgcolor="${color}" style="background-color:${color};background-image:linear-gradient(125deg,${color} 0%,${color2} 100%);padding:26px 32px 22px">${logo}
      <div class="head-sub" style="display:inline-block;font:700 11px/1 Arial,sans-serif;color:#ffffff;margin-top:16px;letter-spacing:1.6px;text-transform:uppercase;background-color:#1f1f2e;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.32);border-radius:999px;padding:8px 14px">${esc(eyebrow)}</div>
    </td></tr>
    <tr><td class="body" bgcolor="#12121c" style="background-color:#12121c;color:#b9bfcd;padding:36px 32px 10px;font-family:'Segoe UI',Arial,Helvetica,sans-serif">${step ? progressHtml(step, color, lang) : ''}${body}</td></tr>
    <tr><td class="pad-x" bgcolor="#12121c" style="background-color:#12121c;padding:0 32px">
      ${trust}
      <div class="divider" style="height:1px;background-color:#22223a;margin:4px 0 4px;font-size:0;line-height:1px">&nbsp;</div>
    </td></tr>
    <tr><td class="foot-cell" bgcolor="#12121c" style="background-color:#12121c;padding:20px 32px 30px;color:#8b93a7;font-size:12px;line-height:1.6;text-align:center;font-family:'Segoe UI',Arial,Helvetica,sans-serif">
    <div class="foot">
      <div class="foot-links">${links.join(dot)}</div>
      <div class="foot-why" style="padding-top:14px;color:#8b93a7;font-size:12px;line-height:1.6">${esc(why)}${unsubscribeUrl
        ? ` <a href="${esc(unsubscribeUrl)}" style="color:#c3b5ff;text-decoration:underline">${esc(F('unsubscribe'))}</a>` : ''}</div>
      ${seller ? `<div class="foot-seller" style="padding-top:10px;color:#8b93a7;font-size:12px;line-height:1.6">${seller}</div>` : ''}
      <div class="foot-legal" style="padding-top:12px;color:#6b7287;font-size:12px">© ${year} ${esc(brand)} — <a href="${app}" style="color:#8b93a7;text-decoration:none">${app.replace(/^https?:\/\//, '')}</a></div>
    </div>
    </td></tr>
  </table>
<!--[if mso]></td></tr></table><![endif]-->
</div>
</td></tr></table>
</body></html>`;
}

/**
 * A plain frame for mail to the owner.
 *
 * Owner alerts went out in the customer frame — eyebrow, footer saying "you get
 * this because you placed an order", a link to the account settings. An alert
 * about a chargeback is not a letter to a customer and should not look like
 * one, and it has no business carrying an unsubscribe-shaped footer.
 */
export function wrapAdmin(contentHtml, { preheader = '' } = {}) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body bgcolor="#ffffff" style="margin:0;padding:0;background-color:#ffffff;color:#111827;font-family:Arial,Helvetica,sans-serif">
<span class="preheader" style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all">${preheaderHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"><tr><td style="padding:20px;font-size:14px;line-height:1.6;color:#111827">
${String(contentHtml).replace(/<a class="btn"/g, '<a style="color:#1d4ed8;font-weight:700"')
    .replace(/<div class="notice">/g, '<div style="margin-top:16px;padding:10px 12px;border:1px solid #d1d5db;color:#374151;font-size:12px">')}
<p style="margin-top:24px;color:#6b7280;font-size:12px">${esc(config.email.fromName)} · admin</p>
</td></tr></table>
</body></html>`;
}

/** Build a default context shared by all emails. */
export function baseContext(extra = {}) {
  const url = String(config.appUrl || '');
  let host = url;
  try { host = new URL(url).host; } catch { /* not a URL — keep as typed */ }
  return {
    brand: { name: config.email.fromName },
    app: { url, host },
    ...extra,
  };
}

/**
 * Free text a person typed, made safe to show as paragraphs.
 *
 * A support reply and a staff message were dropped into the mail through an
 * escaping token, so every line break the writer made collapsed into one block
 * — and switching them to a raw token would have let whatever was typed into
 * the admin become HTML in a mail from our domain. Escaped first, then each
 * newline becomes a <br>; nothing else is let through.
 */
const nl2br = (v) => esc(String(v ?? '')).replace(/\r?\n/g, '<br>');
function withDerived(ctx = {}) {
  const out = { ...ctx };
  if (ctx.message != null && ctx.messageHtml == null) out.messageHtml = nl2br(ctx.message);
  if (ctx.reply != null && ctx.replyHtml == null) out.replyHtml = nl2br(ctx.reply);
  return out;
}

/** Render a stored template row → { subject, html }. */
export function renderTemplate(template, rawCtx) {
  const ctx = withDerived(rawCtx);
  const subject = renderSubject(template.subject, ctx, { where: `${template.id} subject` });
  const inner = renderTokens(template.body_html, ctx, { where: `${template.id} body` });
  const lang = template.lang || 'nl';
  /* A chosen preview line when the mail has one; otherwise the first words of
     the letter, as before. */
  const psp = template.id === 'order_received' && ctx?.order?.viaPsp;
  const chosen = psp ? PREHEADER.order_received_psp : PREHEADER[template.id];
  const preheader = chosen
    ? renderTokens(pick(chosen, lang), ctx, { where: `${template.id} preheader` })
    : inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110);
  const theme = (psp && EMAIL_THEMES.order_received_psp) || EMAIL_THEMES[template.id] || DEFAULT_THEME;
  /* The row already knows: loadTemplate picked it by language. Passing it on is
     what stops a German letter arriving inside a Dutch frame. */
  return {
    subject,
    html: wrapBranded(inner, {
      preheader, theme, lang, templateId: template.id,
      unsubscribeUrl: ctx?.unsubscribe?.url || null,
    }),
  };
}
