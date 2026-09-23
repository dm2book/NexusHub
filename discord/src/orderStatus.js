/**
 * Turning a raw order status into something a buyer understands.
 *
 * Lives outside bot.js on purpose: bot.js logs in to Discord the moment it is
 * imported, so nothing in it can be tested. This module is pure — payload in,
 * embed data out — and is covered by discord/test/order-status.test.mjs.
 *
 * The question behind every /order is the same: "is something wrong, and do I
 * have to do anything?". Colour answers it before the text does —
 * amber = your move, blue = ours, green = done, grey = closed.
 *
 * In four languages, because the answer is only useful if it is read. The shop
 * is Dutch and sells across the border; the storefront, the emails and the
 * assistant all speak the buyer's language, and this — the place a worried
 * buyer goes when the email has not arrived — was the last English-only stop.
 * Discord already knows which language they use it in, so nobody HAS to pick;
 * and since #roles now lets them, pickedLang() puts that choice above the
 * guess.
 */

import { LANGUAGE_ROLES } from './config.js';

/** The languages this file writes. Matches the storefront's set exactly. */
export const BOT_LANGS = ['nl', 'en', 'de', 'fr'];

/**
 * Discord's locale ('nl', 'de', 'fr', 'en-GB', 'pt-BR', …) → one of ours.
 *
 * Anything we do not write falls to English rather than to Dutch: a Portuguese
 * member reading Dutch is a worse guess than a Portuguese member reading
 * English, and the shop's own language is not a lingua franca.
 */
export const botLang = (locale) => {
  const base = String(locale || '').toLowerCase().split('-')[0];
  return BOT_LANGS.includes(base) ? base : 'en';
};

/**
 * The language a member actually chose, falling back to the one Discord guesses.
 *
 * botLang() reads the locale the member's Discord client happens to be set to,
 * which is a good guess and only a guess: plenty of people run an English
 * client and do not want to be spoken to in English. Once somebody has picked
 * a language in #roles, that is not a guess any more, and it wins.
 *
 * Takes role NAMES rather than a member object so this module stays pure and
 * testable — bot.js hands it the names it already has.
 */
export const pickedLang = (roleNames = [], locale) => {
  const names = new Set((roleNames || []).map((n) => String(n)));
  const chosen = LANGUAGE_ROLES.find((l) => names.has(l.label));
  return chosen ? chosen.key : botLang(locale);
};

export const ORDER_STATE = {
  pending: {
    color: 0xf5b324, emoji: '⏳',
    title: { en: 'Waiting for your payment', nl: 'We wachten op je betaling',
      de: 'Wir warten auf deine Zahlung', fr: 'Nous attendons ton paiement' },
    next: {
      en: 'We haven’t received the payment yet. Pay the amount with your order number as the reference — the status flips by itself once it lands.',
      nl: 'We hebben de betaling nog niet binnen. Betaal het bedrag met je bestelnummer als referentie — de status springt vanzelf om zodra hij binnen is.',
      de: 'Die Zahlung ist noch nicht bei uns. Überweise den Betrag mit deiner Bestellnummer als Verwendungszweck — der Status springt von selbst um, sobald sie ankommt.',
      fr: 'Nous n’avons pas encore reçu le paiement. Paie le montant en indiquant ton numéro de commande comme référence — le statut change tout seul dès qu’il arrive.',
    },
  },
  payment_received: {
    color: 0x38bdf8, emoji: '✅',
    title: { en: 'Payment confirmed', nl: 'Betaling bevestigd',
      de: 'Zahlung bestätigt', fr: 'Paiement confirmé' },
    next: {
      en: 'Nothing left for you to do. In-stock items go out automatically; anything else we deliver by hand, usually within a few hours.',
      nl: 'Jij hoeft niets meer te doen. Wat op voorraad ligt gaat automatisch de deur uit; de rest leveren we met de hand, meestal binnen een paar uur.',
      de: 'Für dich gibt es nichts mehr zu tun. Was auf Lager ist, geht automatisch raus; alles andere liefern wir von Hand, meist innerhalb weniger Stunden.',
      fr: 'Tu n’as plus rien à faire. Ce qui est en stock part automatiquement ; le reste, nous le livrons à la main, généralement en quelques heures.',
    },
  },
  processing: {
    color: 0x38bdf8, emoji: '🔧',
    title: { en: 'Being prepared', nl: 'Wordt klaargemaakt',
      de: 'Wird vorbereitet', fr: 'En cours de préparation' },
    next: {
      en: 'We’re getting your items ready right now. Your code arrives by email.',
      nl: 'We maken je bestelling nu klaar. Je code komt per mail binnen.',
      de: 'Wir machen deine Sachen gerade fertig. Dein Code kommt per Mail.',
      fr: 'Nous préparons tes articles en ce moment. Ton code arrive par e-mail.',
    },
  },
  awaiting_fulfillment: {
    color: 0x38bdf8, emoji: '📦',
    title: { en: 'Almost there', nl: 'Bijna klaar',
      de: 'Fast geschafft', fr: 'Presque terminé' },
    next: {
      en: 'Payment is in and your order is queued for delivery. If it’s been longer than a few hours, open a ticket and we’ll chase it.',
      nl: 'De betaling is binnen en je bestelling staat in de wachtrij voor levering. Duurt het langer dan een paar uur? Open een ticket, dan gaan we erachteraan.',
      de: 'Die Zahlung ist da und deine Bestellung steht in der Warteschlange für die Lieferung. Dauert es länger als ein paar Stunden? Öffne ein Ticket, dann hängen wir uns dran.',
      fr: 'Le paiement est arrivé et ta commande est en file d’attente pour la livraison. Ça dure plus de quelques heures ? Ouvre un ticket et nous relançons.',
    },
  },
  completed: {
    color: 0x22c55e, emoji: '🎉',
    title: { en: 'Delivered', nl: 'Geleverd', de: 'Geliefert', fr: 'Livrée' },
    next: {
      en: 'Your code was sent to the email used at checkout. Can’t find it? Check spam, then open a ticket — we can resend.',
      nl: 'Je code is verstuurd naar het mailadres van je bestelling. Kun je hem niet vinden? Check spam en open anders een ticket — we sturen hem opnieuw.',
      de: 'Dein Code ging an die E-Mail-Adresse aus der Bestellung. Nicht zu finden? Schau in den Spam und öffne sonst ein Ticket — wir schicken ihn erneut.',
      fr: 'Ton code a été envoyé à l’adresse e-mail utilisée lors de la commande. Introuvable ? Regarde dans les spams, puis ouvre un ticket — nous pouvons le renvoyer.',
    },
  },
  refunded: {
    color: 0xa855f7, emoji: '↩️',
    title: { en: 'Refunded', nl: 'Terugbetaald', de: 'Zurückerstattet', fr: 'Remboursée' },
    next: {
      en: 'The money is on its way back to where you paid from — usually 1–3 working days.',
      nl: 'Het geld is onderweg terug naar waar je vandaan betaalde — meestal 1–3 werkdagen.',
      de: 'Das Geld ist unterwegs zurück dorthin, woher du bezahlt hast — meist 1–3 Werktage.',
      fr: 'L’argent repart vers le compte depuis lequel tu as payé — généralement 1 à 3 jours ouvrés.',
    },
  },
  cancelled: {
    color: 0x64748b, emoji: '✖️',
    title: { en: 'Cancelled', nl: 'Geannuleerd', de: 'Storniert', fr: 'Annulée' },
    next: {
      en: 'This order was closed. Think that’s wrong? Open a ticket with the order number.',
      nl: 'Deze bestelling is gesloten. Klopt dat niet? Open een ticket met het bestelnummer.',
      de: 'Diese Bestellung wurde geschlossen. Stimmt das nicht? Öffne ein Ticket mit der Bestellnummer.',
      fr: 'Cette commande a été clôturée. Tu penses que c’est une erreur ? Ouvre un ticket avec le numéro de commande.',
    },
  },
  failed: {
    color: 0x64748b, emoji: '⚠️',
    title: { en: 'Closed', nl: 'Afgesloten', de: 'Abgeschlossen', fr: 'Clôturée' },
    next: {
      en: 'Something went wrong with this order. Open a ticket and we’ll sort it out.',
      nl: 'Er ging iets mis met deze bestelling. Open een ticket, dan lossen we het op.',
      de: 'Bei dieser Bestellung ist etwas schiefgelaufen. Öffne ein Ticket, dann klären wir das.',
      fr: 'Quelque chose s’est mal passé avec cette commande. Ouvre un ticket et nous réglons ça.',
    },
  },
};

/** The embed's own furniture, in the same four languages. */
export const ORDER_UI = {
  progress: { en: 'Progress', nl: 'Verloop', de: 'Verlauf', fr: 'Progression' },
  total: { en: 'Total', nl: 'Totaal', de: 'Gesamt', fr: 'Total' },
  reference: { en: 'Payment reference', nl: 'Betalingsreferentie',
    de: 'Verwendungszweck', fr: 'Référence de paiement' },
  fallbackTitle: { en: 'Order status', nl: 'Bestelstatus',
    de: 'Bestellstatus', fr: 'Statut de la commande' },
  order: { en: 'Order', nl: 'Bestelling', de: 'Bestellung', fr: 'Commande' },
  live: { en: 'Live from the store', nl: 'Live uit de winkel',
    de: 'Live aus dem Shop', fr: 'En direct de la boutique' },
  page: { en: 'Live status page', nl: 'Live statuspagina',
    de: 'Live-Statusseite', fr: 'Page de statut en direct' },
  notFound: {
    en: 'No order found for `%s`. Order numbers look like `FM-2026-XXXXXXXX` — check the confirmation email, or open a ticket in #open-a-ticket and we’ll look it up for you.',
    nl: 'Geen bestelling gevonden voor `%s`. Bestelnummers zien eruit als `FM-2026-XXXXXXXX` — check je bevestigingsmail, of open een ticket in #open-a-ticket, dan zoeken wij het op.',
    de: 'Keine Bestellung zu `%s` gefunden. Bestellnummern sehen aus wie `FM-2026-XXXXXXXX` — schau in die Bestätigungsmail oder öffne ein Ticket in #open-a-ticket, dann sehen wir für dich nach.',
    fr: 'Aucune commande trouvée pour `%s`. Les numéros de commande ressemblent à `FM-2026-XXXXXXXX` — vérifie l’e-mail de confirmation, ou ouvre un ticket dans #open-a-ticket et nous chercherons pour toi.',
  },
  notConfigured: {
    en: 'Order lookup isn’t configured yet.', nl: 'Bestellingen opzoeken is nog niet ingesteld.',
    de: 'Die Bestellsuche ist noch nicht eingerichtet.', fr: 'La recherche de commande n’est pas encore configurée.',
  },
};

/** One language out of a table, never `undefined` in front of a buyer. */
export const say = (table, lang) => table?.[botLang(lang)] ?? table?.en ?? '';

const FALLBACK = { color: 0x6366f1, emoji: '📦' };

/**
 * Shape a /api/track payload into embed fields.
 * Returns plain data so this stays testable without discord.js.
 */
export function orderStatusView(o, { money = (c) => `€${(c / 100).toFixed(2)}`, lang = 'en' } = {}) {
  const L = botLang(lang);
  const state = ORDER_STATE[o.status];
  const title = state ? say(state.title, L) : (o.statusLabel || say(ORDER_UI.fallbackTitle, L));
  const emoji = state?.emoji || FALLBACK.emoji;
  const color = state?.color || FALLBACK.color;
  const progress = (o.history || []).slice(-4).map((h) => {
    const key = h.to || h.to_status;
    const at = new Date(h.at || h.created_at);
    const stamp = Number.isNaN(at.getTime()) ? '' : ` — <t:${Math.floor(at.getTime() / 1000)}:R>`;
    // Discord renders the timestamp in the reader's own timezone and language.
    return `• ${ORDER_STATE[key] ? say(ORDER_STATE[key].title, L) : key}${stamp}`;
  }).join('\n') || '—';

  const fields = [{ name: say(ORDER_UI.progress, L), value: progress }];
  if (o.totalFormatted || o.total != null) {
    fields.push({ name: say(ORDER_UI.total, L), value: o.totalFormatted || money(o.total, o.currency), inline: true });
  }
  // The reference only matters while we're still waiting for the money.
  if (o.status === 'pending') fields.push({ name: say(ORDER_UI.reference, L), value: `\`${o.number}\``, inline: true });

  return {
    color, title: `${emoji} ${title}`, description: state ? say(state.next, L) : '',
    author: `${say(ORDER_UI.order, L)} ${o.number}`, footer: say(ORDER_UI.live, L), fields,
  };
}
