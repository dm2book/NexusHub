/**
 * The parts of an email the server writes rather than the template.
 *
 * A template is prose with tokens in it. Several of those tokens are filled by
 * code — the delivered-code card, the redeem instructions for the category that
 * was bought, the order breakdown, the withdrawal-right footnote, the "we still
 * need your username" block — and all of it was hardcoded Dutch. So translating
 * the templates alone would have produced a German email with a Dutch order
 * summary and Dutch redeem steps inside it, which is worse than one honest
 * language.
 *
 * Keyed by language, falling back to Dutch for anything unlisted, exactly like
 * the templates. Kept in one file rather than beside each generator, because
 * the failure mode being avoided is a phrase that exists in three languages in
 * one place and one language in another.
 */

import { REDEEM } from '../../../src/lib/redeemRecipes.js';

const FALLBACK = 'nl';

const PHRASES = {
  nl: {
    redeemAt: 'Inwisselen op',
    deliveredTitle: '⚡ Rechtstreeks op je account geleverd',
    deliveredSub: 'Opgewaardeerd en klaar om te spelen — geen code om in te wisselen.',
    yourAccount: 'Je account',
    subtotal: 'Subtotaal', coupon: 'Kortingscode', memberOff: 'Forge+-korting',
    bundle: 'Bundel', credit: 'Tegoed', total: 'Totaal',
    withdrawalTitle: 'Herroepingsrecht',
    withdrawalConfirmed: (stamp, sentence) => `Op ${stamp} bevestigde je: “${sentence}”`,
    withdrawalDefault: (stamp) => `Op ${stamp} vroeg je om directe levering en erkende je dat het herroepingsrecht van 14 dagen vervalt zodra de bestelling geleverd is.`,
    withdrawalCancel: 'Tot de levering kun je nog annuleren — beantwoord daarvoor gewoon deze mail.',
    needTitle: '⚠️ We hebben nog één ding van je nodig',
    needBody: (need) => `Deze bestelling leveren we rechtstreeks op je account, dus we hebben je <strong style="color:#fff">${need}</strong> nodig. Beantwoord deze mail met alleen dat gegeven — daarna gaat je bestelling meteen de deur uit. We vragen <strong style="color:#fff">nooit</strong> om je wachtwoord.`,
    payExact: (amt) => `Betaal ${amt} — het bedrag staat er al in`,
    paySendTo: (amt, target) => `Maak ${amt} over naar ${target}`,
    payPrefilled: 'bedrag staat er al in',
    payOr: 'Of maak het zelf over', payComplete: 'Rond je betaling af',
    reviewAskTitle: 'Blij met je bestelling?',
    reviewAskBody: 'Een korte review op Trustpilot kost twintig seconden en helpt de volgende koper meer dan wat wij over onszelf kunnen zeggen — wij kunnen er niets aan veranderen of weghalen.',
    reviewAskCta: 'Schrijf een review op Trustpilot',
    payHow: (number) => `Betaal via een van de methoden hieronder en zet je bestelnummer <strong>${number}</strong> erbij als kenmerk. Je bestelling is bevestigd zodra we hem binnen hebben.`,
  },
  en: {
    redeemAt: 'Redeem at',
    deliveredTitle: '⚡ Delivered straight to your account',
    deliveredSub: 'Topped up and ready to play — no code to redeem.',
    yourAccount: 'Your account',
    subtotal: 'Subtotal', coupon: 'Coupon', memberOff: 'Forge+ discount',
    bundle: 'Bundle', credit: 'Store credit', total: 'Total',
    withdrawalTitle: 'Right of withdrawal',
    withdrawalConfirmed: (stamp, sentence) => `On ${stamp} you confirmed: “${sentence}”`,
    withdrawalDefault: (stamp) => `On ${stamp} you asked for immediate delivery and acknowledged that the 14-day right of withdrawal lapses once the order has been delivered.`,
    withdrawalCancel: 'Until delivery you can still cancel — just reply to this email.',
    needTitle: '⚠️ We still need one thing from you',
    needBody: (need) => `This order is delivered straight to your account, so we need your <strong style="color:#fff">${need}</strong>. Reply to this email with just that, and your order goes out right away. We <strong style="color:#fff">never</strong> ask for your password.`,
    payExact: (amt) => `Pay ${amt} — the amount is already filled in`,
    paySendTo: (amt, target) => `Send ${amt} to ${target}`,
    payPrefilled: 'amount filled in',
    payOr: 'Or pay it yourself', payComplete: 'Complete your payment',
    reviewAskTitle: 'Happy with your order?',
    reviewAskBody: 'A short review on Trustpilot takes twenty seconds and helps the next buyer more than anything we can say about ourselves — we cannot edit or remove a word of it.',
    reviewAskCta: 'Leave a review on Trustpilot',
    payHow: (number) => `Pay using one of the methods below and put your order number <strong>${number}</strong> as the reference. Your order is confirmed as soon as we receive it.`,
  },
  de: {
    redeemAt: 'Einlösen auf',
    deliveredTitle: '⚡ Direkt auf dein Konto geliefert',
    deliveredSub: 'Aufgeladen und startklar — kein Code zum Einlösen.',
    yourAccount: 'Dein Konto',
    subtotal: 'Zwischensumme', coupon: 'Rabattcode', memberOff: 'Forge+-Rabatt',
    bundle: 'Bündel', credit: 'Guthaben', total: 'Gesamt',
    withdrawalTitle: 'Widerrufsrecht',
    withdrawalConfirmed: (stamp, sentence) => `Am ${stamp} hast du bestätigt: „${sentence}"`,
    withdrawalDefault: (stamp) => `Am ${stamp} hast du um sofortige Lieferung gebeten und anerkannt, dass das 14-tägige Widerrufsrecht erlischt, sobald die Bestellung geliefert ist.`,
    withdrawalCancel: 'Bis zur Lieferung kannst du noch stornieren — antworte dafür einfach auf diese Mail.',
    needTitle: '⚠️ Wir brauchen noch eine Sache von dir',
    needBody: (need) => `Diese Bestellung liefern wir direkt auf dein Konto, wir brauchen also dein <strong style="color:#fff">${need}</strong>. Antworte auf diese Mail mit nur dieser Angabe — dann geht deine Bestellung sofort raus. Nach deinem Passwort fragen wir <strong style="color:#fff">nie</strong>.`,
    payExact: (amt) => `Zahle ${amt} — der Betrag steht schon drin`,
    paySendTo: (amt, target) => `Überweise ${amt} an ${target}`,
    payPrefilled: 'Betrag steht schon drin',
    payOr: 'Oder überweise selbst', payComplete: 'Schließ deine Zahlung ab',
    reviewAskTitle: 'Zufrieden mit deiner Bestellung?',
    reviewAskBody: 'Eine kurze Bewertung auf Trustpilot dauert zwanzig Sekunden und hilft dem nächsten Käufer mehr als alles, was wir über uns selbst sagen können — wir können dort kein Wort ändern oder löschen.',
    reviewAskCta: 'Bewertung auf Trustpilot schreiben',
    payHow: (number) => `Zahl über eine der Methoden unten und gib deine Bestellnummer <strong>${number}</strong> als Verwendungszweck an. Deine Bestellung ist bestätigt, sobald wir sie haben.`,
  },
  fr: {
    redeemAt: 'À utiliser sur',
    deliveredTitle: '⚡ Livré directement sur ton compte',
    deliveredSub: 'Crédité et prêt à jouer — aucun code à utiliser.',
    yourAccount: 'Ton compte',
    subtotal: 'Sous-total', coupon: 'Code de réduction', memberOff: 'Remise Forge+',
    bundle: 'Pack', credit: 'Crédit boutique', total: 'Total',
    withdrawalTitle: 'Droit de rétractation',
    withdrawalConfirmed: (stamp, sentence) => `Le ${stamp} tu as confirmé : « ${sentence} »`,
    withdrawalDefault: (stamp) => `Le ${stamp} tu as demandé une livraison immédiate et reconnu que le droit de rétractation de 14 jours s’éteint dès que la commande est livrée.`,
    withdrawalCancel: 'Jusqu’à la livraison tu peux encore annuler — réponds simplement à cet e-mail.',
    needTitle: '⚠️ Il nous manque encore une chose',
    needBody: (need) => `Cette commande est livrée directement sur ton compte : il nous faut donc ton <strong style="color:#fff">${need}</strong>. Réponds à cet e-mail avec seulement cette information et ta commande part tout de suite. Nous ne demandons <strong style="color:#fff">jamais</strong> ton mot de passe.`,
    payExact: (amt) => `Paie ${amt} — le montant est déjà rempli`,
    paySendTo: (amt, target) => `Vire ${amt} à ${target}`,
    payPrefilled: 'montant déjà rempli',
    payOr: 'Ou fais le virement toi-même', payComplete: 'Termine ton paiement',
    reviewAskTitle: 'Content de ta commande ?',
    reviewAskBody: 'Un court avis sur Trustpilot prend vingt secondes et aide le prochain acheteur bien plus que tout ce que nous pouvons dire de nous-mêmes — nous ne pouvons y modifier ni supprimer un mot.',
    reviewAskCta: 'Laisser un avis sur Trustpilot',
    payHow: (number) => `Paie avec un des moyens ci-dessous et mets ton numéro de commande <strong>${number}</strong> en référence. Ta commande est confirmée dès que nous le recevons.`,
  },
};

/** Phrases for a language, falling back to Dutch. */
export function emailCopy(lang) {
  return PHRASES[lang] || PHRASES[FALLBACK];
}

/** The redeem recipe for a category, falling back to the generic one. */
export function redeemSteps(lang, category) {
  const table = REDEEM[lang] || REDEEM[FALLBACK];
  return table[String(category || '').toLowerCase()] || null;
}

/** The generic recipe, for an order whose categories have no recipe of their own. */
export function redeemFallback(lang) {
  return (REDEEM[lang] || REDEEM[FALLBACK])._;
}

export const EMAIL_LANGS = Object.keys(PHRASES);
