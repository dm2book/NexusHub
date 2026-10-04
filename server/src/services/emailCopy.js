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
    needBody: (need) => `Deze bestelling leveren we rechtstreeks op je account, dus we hebben je <strong style="color:#fff">${need}</strong> nodig. Beantwoord deze mail met alleen dat gegeven — we beginnen zodra we het hebben. We vragen <strong style="color:#fff">nooit</strong> om je wachtwoord.`,
    payExact: (amt) => `Betaal ${amt} — het bedrag staat er al in`,
    paySendTo: (amt, target) => `Maak ${amt} over naar ${target}`,
    payPrefilled: 'bedrag staat er al in',
    payRefNeeded: 'zet je bestelnummer in de omschrijving',
    payOr: 'Of maak het zelf over', payComplete: 'Rond je betaling af',
    reviewAskTitle: 'Blij met je bestelling?',
    reviewAskBody: 'Een korte review op Trustpilot helpt de volgende koper meer dan wat wij over onszelf kunnen zeggen — wij kunnen er niets aan veranderen of weghalen.',
    reviewAskCta: 'Schrijf een review op Trustpilot',
    payHow: (number) => `Betaal via een van de methoden hieronder en zet je bestelnummer <strong>${number}</strong> erbij als kenmerk. Je bestelling is bevestigd zodra we hem binnen hebben.`,
    /* When an order is completed with nothing recorded to show — the normal
       path for a product delivered by hand. The mail says "alles hieronder is
       van jou", so there has to BE something below, and it has to be true. */
    byHandTitle: '✅ Met de hand geleverd',
    byHandSub: 'Deze bestelling is door ons persoonlijk afgehandeld — er staat geen code in dit overzicht.',
    byHandCheck: 'Kijk in je game of in de inbox waar we je eerder over deze bestelling schreven.',
    byHandMissing: 'Niets ontvangen? Beantwoord deze mail met je bestelnummer, dan zoeken we het uit.',

    /* Robux goes onto an account, and two facts decide when: Roblox will not
       accept a payout without 2-step verification, and it caps how much one
       account may receive per day. Said up front so "why is half of it
       missing?" is answered before it is asked. */
    need2fa: 'Zet ook 2-staps-verificatie (2FA) aan op je Roblox-account — zonder 2FA kunnen we niet leveren.',
    needSplit: (amount, days) => `Roblox staat maximaal 5.000 R$ per account per dag toe. Je ${amount} R$ leveren we daarom verdeeld over ${days} dagen.`,
    deliveryLabels: { code: 'Code', key: 'Licentiesleutel', file: 'Bestand', link: 'Link', account: 'Account' },
    orderLine: (number) => ` over bestelling ${number}`,
    reviewTrustpilot: (link) => `of laat hem achter op ${link} — die is openbaar en wij kunnen hem niet aanpassen.`,
    vatIncl: (amount, pct) => `incl. ${amount} btw (${pct}%)`,
    vatMpv: 'cadeaukaart (meervoudig doeleinden-voucher) — geen btw bij verkoop',
    invoiceLine: 'Je factuur staat bij deze bestelling in je account.',
    refundRefunded: 'Terugbetaald', refundRemaining: 'Blijft staan', refundVia: 'Via',
    refundMethods: { bank: 'bankoverschrijving', card: 'je betaalmethode', credit: 'tegoed in je account', manual: 'dezelfde weg als je betaalde' },
    refundTiming: {
      card: 'De terugbetaling gaat naar de betaalmethode waarmee je betaalde. Hoe snel je het ziet, bepaalt je bank of kaartuitgever — meestal binnen enkele werkdagen.',
      bank: 'Een bankoverschrijving staat er meestal binnen 1–3 werkdagen op, op de rekening waarmee je betaalde.',
      manual: 'We betalen terug via dezelfde weg als je betaalde. Hoe snel je het ziet, hangt af van die dienst.',
      credit: 'Het tegoeddeel staat al terug in je saldo en kun je meteen gebruiken.',
    },
    cancelAuto: (days) => `We hebben geen betaling ontvangen binnen ${days} dagen na je bestelling, dus hebben we hem automatisch geannuleerd.`,
    cancelOther: 'Deze bestelling is geannuleerd.',
    cancelCredit: (amount) => `Het tegoed dat je gebruikte (${amount}) staat weer in je account.`,
    stampZone: 'Nederlandse tijd',
    notice: {
      received: (n) => `Bestelling ${n} ontvangen`,
      receivedBody: 'We hebben je bestelling ontvangen en wachten op je betaling.',
      status: (n, label) => `Bestelling ${n}: ${label}`,
      newDelivery: (n) => `Bestelling ${n}: nieuwe levering`,
      newDeliveryBody: 'Er is een nieuwe code aan je bestelling toegevoegd — kijk in je mail en je dashboard.',
      reminder: (n) => `Bestelling ${n} wacht op betaling`,
      reminderBody: (days) => `Rond je betaling af om je items te ontvangen — je bestelling blijft ${days} dagen open.`,
      payLink: (n) => `Betaallink klaar voor ${n}`,
      payLinkBody: 'Je betaallink met het exacte bedrag staat klaar.',
      cart: 'Er staat nog iets in je winkelwagen',
      cartBody: (count) => `${count} item(s) staan nog in je winkelwagen.`,
      proofOk: 'Betaling bevestigd',
      proofOkBody: (n) => `We hebben je betaling voor ${n} gecontroleerd. Je bestelling wordt verwerkt.`,
      proofBad: 'Betaling vraagt aandacht',
      proofBadBody: 'We konden je betaling nog niet controleren. Stuur je bewijs opnieuw in.',
      security: 'Nieuwe aanmelding op je account',
      securityBody: 'Er is ingelogd vanaf een nieuw apparaat. Bekijk je actieve apparaten als jij dit niet was.',
      ticketReply: (n) => `Antwoord op ticket ${n}`,
      ticketReplyBody: 'Support heeft op je ticket gereageerd.',
      labels: { pending: 'Wacht op betaling', payment_received: 'Betaling ontvangen', processing: 'In behandeling', awaiting_fulfillment: 'Wordt met de hand geleverd', completed: 'Geleverd', refunded: 'Terugbetaald', cancelled: 'Geannuleerd', failed: 'Mislukt' },
      blurbs: {
        payment_received: 'We hebben je betaling bevestigd en maken je bestelling klaar.',
        processing: 'Je bestelling wordt verwerkt — we mailen je zodra hij klaar is.',
        awaiting_fulfillment: 'We halen deze bestelling met de hand voor je op. Hij komt per e-mail.',
        completed: 'Je bestelling is geleverd — bekijk je leveringen en downloads.',
        refunded: 'Er is een terugbetaling voor je bestelling gedaan.',
        cancelled: 'Je bestelling is geannuleerd.',
      },
    },
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
    needBody: (need) => `This order is delivered straight to your account, so we need your <strong style="color:#fff">${need}</strong>. Reply to this email with just that — we start as soon as we have it. We <strong style="color:#fff">never</strong> ask for your password.`,
    payExact: (amt) => `Pay ${amt} — the amount is already filled in`,
    paySendTo: (amt, target) => `Send ${amt} to ${target}`,
    payPrefilled: 'amount filled in',
    payRefNeeded: 'put your order number in the description',
    payOr: 'Or pay it yourself', payComplete: 'Complete your payment',
    reviewAskTitle: 'Happy with your order?',
    reviewAskBody: 'A short review on Trustpilot helps the next buyer more than anything we can say about ourselves — we cannot edit or remove a word of it.',
    reviewAskCta: 'Leave a review on Trustpilot',
    payHow: (number) => `Pay using one of the methods below and put your order number <strong>${number}</strong> as the reference. Your order is confirmed as soon as we receive it.`,
    byHandTitle: '✅ Delivered by hand',
    byHandSub: 'We handled this order personally — there is no code to show in this summary.',
    byHandCheck: 'Check the game itself, or the inbox we last wrote to you about this order on.',
    byHandMissing: 'Nothing arrived? Reply to this email with your order number and we will look into it.',

    need2fa: 'Also turn on 2-Step Verification (2FA) on your Roblox account — without 2FA we cannot deliver.',
    needSplit: (amount, days) => `Roblox allows at most 5,000 R$ per account per day, so your ${amount} R$ is delivered over ${days} days.`,
    deliveryLabels: { code: 'Code', key: 'Licence key', file: 'File', link: 'Link', account: 'Account' },
    orderLine: (number) => ` about order ${number}`,
    reviewTrustpilot: (link) => `or leave it on ${link} — that one is public and we cannot edit it.`,
    vatIncl: (amount, pct) => `incl. ${amount} VAT (${pct}%)`,
    vatMpv: 'gift card (multi-purpose voucher) — no VAT on sale',
    invoiceLine: 'Your invoice is with this order in your account.',
    refundRefunded: 'Refunded', refundRemaining: 'Remaining', refundVia: 'Via',
    refundMethods: { bank: 'bank transfer', card: 'your payment method', credit: 'store credit', manual: 'the same way you paid' },
    refundTiming: {
      card: 'The refund goes back to the payment method you used. How soon you see it is up to your bank or card issuer — usually within a few working days.',
      bank: 'A bank transfer usually lands within 1–3 working days, on the account you paid from.',
      manual: 'We refund the same way you paid. How soon you see it depends on that service.',
      credit: 'The store-credit part is already back in your balance and ready to use.',
    },
    cancelAuto: (days) => `We did not receive a payment within ${days} days of your order, so it was cancelled automatically.`,
    cancelOther: 'This order has been cancelled.',
    cancelCredit: (amount) => `The store credit you used (${amount}) is back in your account.`,
    stampZone: 'Amsterdam time',
    notice: {
      received: (n) => `Order ${n} received`,
      receivedBody: 'We have received your order and it is waiting for payment.',
      status: (n, label) => `Order ${n}: ${label}`,
      newDelivery: (n) => `Order ${n}: new delivery`,
      newDeliveryBody: 'A new code was added to your order — check your email and dashboard.',
      reminder: (n) => `Order ${n} is waiting for payment`,
      reminderBody: (days) => `Complete your payment to receive your items — your order stays open for ${days} days.`,
      payLink: (n) => `Payment link ready for ${n}`,
      payLinkBody: 'Your payment link with the exact amount is ready.',
      cart: 'Something is still in your cart',
      cartBody: (count) => `${count} item(s) are still in your cart.`,
      proofOk: 'Payment confirmed',
      proofOkBody: (n) => `We verified your payment for ${n}. Your order is being processed.`,
      proofBad: 'Payment needs attention',
      proofBadBody: 'We could not verify your payment yet. Please resubmit your proof.',
      security: 'New sign-in to your account',
      securityBody: 'A new device signed in to your account. Review your active devices if this wasn’t you.',
      ticketReply: (n) => `Reply on ticket ${n}`,
      ticketReplyBody: 'Support replied to your ticket.',
      labels: { pending: 'Awaiting payment', payment_received: 'Payment received', processing: 'Processing', awaiting_fulfillment: 'Being delivered by hand', completed: 'Delivered', refunded: 'Refunded', cancelled: 'Cancelled', failed: 'Failed' },
      blurbs: {
        payment_received: 'We confirmed your payment and are preparing your order.',
        processing: 'Your order is being processed — we will email you when it is ready.',
        awaiting_fulfillment: 'We are getting this one for you by hand. It arrives by email.',
        completed: 'Your order has been delivered — check your deliveries and downloads.',
        refunded: 'A refund has been issued for your order.',
        cancelled: 'Your order has been cancelled.',
      },
    },
  },
  de: {
    redeemAt: 'Einlösen auf',
    deliveredTitle: '⚡ Direkt auf dein Konto geliefert',
    deliveredSub: 'Aufgeladen und startklar — kein Code zum Einlösen.',
    yourAccount: 'Dein Konto',
    subtotal: 'Zwischensumme', coupon: 'Rabattcode', memberOff: 'Forge+-Rabatt',
    bundle: 'Bündel', credit: 'Guthaben', total: 'Gesamt',
    withdrawalTitle: 'Widerrufsrecht',
    withdrawalConfirmed: (stamp, sentence) => `Am ${stamp} hast du bestätigt: „${sentence}“`,
    withdrawalDefault: (stamp) => `Am ${stamp} hast du um sofortige Lieferung gebeten und anerkannt, dass das 14-tägige Widerrufsrecht erlischt, sobald die Bestellung geliefert ist.`,
    withdrawalCancel: 'Bis zur Lieferung kannst du noch stornieren — antworte dafür einfach auf diese Mail.',
    needTitle: '⚠️ Wir brauchen noch eine Sache von dir',
    needBody: (need) => `Diese Bestellung liefern wir direkt auf dein Konto, wir brauchen also ${/name$/.test(need) ? 'deinen' : 'dein'} <strong style="color:#fff">${/name$/.test(need) ? `${need}n` : need}</strong>. Antworte auf diese Mail mit nur dieser Angabe — wir legen los, sobald wir sie haben. Nach deinem Passwort fragen wir <strong style="color:#fff">nie</strong>.`,
    payExact: (amt) => `Zahle ${amt} — der Betrag steht schon drin`,
    paySendTo: (amt, target) => `Überweise ${amt} an ${target}`,
    payPrefilled: 'Betrag steht schon drin',
    payRefNeeded: 'trag deine Bestellnummer als Verwendungszweck ein',
    payOr: 'Oder überweise selbst', payComplete: 'Schließ deine Zahlung ab',
    reviewAskTitle: 'Zufrieden mit deiner Bestellung?',
    reviewAskBody: 'Eine kurze Bewertung auf Trustpilot hilft dem nächsten Käufer mehr als alles, was wir über uns selbst sagen können — wir können dort kein Wort ändern oder löschen.',
    reviewAskCta: 'Bewertung auf Trustpilot schreiben',
    payHow: (number) => `Zahl über eine der Methoden unten und gib deine Bestellnummer <strong>${number}</strong> als Verwendungszweck an. Deine Bestellung ist bestätigt, sobald wir sie haben.`,
    byHandTitle: '✅ Von Hand geliefert',
    byHandSub: 'Diese Bestellung haben wir persönlich bearbeitet — in dieser Übersicht steht kein Code.',
    byHandCheck: 'Schau im Spiel selbst nach, oder in dem Postfach, an das wir zuletzt zu dieser Bestellung geschrieben haben.',
    byHandMissing: 'Nichts angekommen? Antworte auf diese Mail mit deiner Bestellnummer, dann gehen wir der Sache nach.',

    need2fa: 'Aktiviere außerdem die Bestätigung in zwei Schritten (2FA) in deinem Roblox-Konto — ohne 2FA können wir nicht liefern.',
    needSplit: (amount, days) => `Roblox erlaubt höchstens 5.000 R$ pro Konto und Tag. Deine ${amount} R$ liefern wir deshalb verteilt auf ${days} Tage.`,
    deliveryLabels: { code: 'Code', key: 'Lizenzschlüssel', file: 'Datei', link: 'Link', account: 'Konto' },
    orderLine: (number) => ` zur Bestellung ${number}`,
    reviewTrustpilot: (link) => `oder hinterlass sie auf ${link} — die ist öffentlich und wir können sie nicht ändern.`,
    vatIncl: (amount, pct) => `inkl. ${amount} MwSt. (${pct} %)`,
    vatMpv: 'Guthabenkarte (Mehrzweck-Gutschein) — beim Verkauf keine MwSt.',
    invoiceLine: 'Deine Rechnung findest du bei dieser Bestellung in deinem Konto.',
    refundRefunded: 'Erstattet', refundRemaining: 'Verbleibt', refundVia: 'Über',
    refundMethods: { bank: 'Banküberweisung', card: 'deine Zahlungsmethode', credit: 'Guthaben in deinem Konto', manual: 'denselben Weg, über den du bezahlt hast' },
    refundTiming: {
      card: 'Die Erstattung geht zurück an die Zahlungsmethode, mit der du bezahlt hast. Wann du sie siehst, entscheidet deine Bank oder dein Kartenanbieter — meistens innerhalb weniger Werktage.',
      bank: 'Eine Banküberweisung ist meistens innerhalb von 1–3 Werktagen auf dem Konto, mit dem du bezahlt hast.',
      manual: 'Wir erstatten über denselben Weg, über den du bezahlt hast. Wie schnell du es siehst, hängt von diesem Dienst ab.',
      credit: 'Der Guthaben-Anteil ist schon wieder in deinem Guthaben und sofort nutzbar.',
    },
    cancelAuto: (days) => `Innerhalb von ${days} Tagen nach deiner Bestellung ist keine Zahlung eingegangen, deshalb wurde sie automatisch storniert.`,
    cancelOther: 'Diese Bestellung wurde storniert.',
    cancelCredit: (amount) => `Das Guthaben, das du eingesetzt hast (${amount}), ist wieder in deinem Konto.`,
    stampZone: 'niederländischer Zeit',
    notice: {
      received: (n) => `Bestellung ${n} eingegangen`,
      receivedBody: 'Wir haben deine Bestellung erhalten und warten auf deine Zahlung.',
      status: (n, label) => `Bestellung ${n}: ${label}`,
      newDelivery: (n) => `Bestellung ${n}: neue Lieferung`,
      newDeliveryBody: 'Deiner Bestellung wurde ein neuer Code hinzugefügt — schau in deine Mails und dein Dashboard.',
      reminder: (n) => `Bestellung ${n} wartet auf Zahlung`,
      reminderBody: (days) => `Schließ deine Zahlung ab, um deine Artikel zu bekommen — deine Bestellung bleibt ${days} Tage offen.`,
      payLink: (n) => `Zahlungslink für ${n} bereit`,
      payLinkBody: 'Dein Zahlungslink mit dem genauen Betrag ist bereit.',
      cart: 'In deinem Warenkorb liegt noch etwas',
      cartBody: (count) => `${count} Artikel liegen noch in deinem Warenkorb.`,
      proofOk: 'Zahlung bestätigt',
      proofOkBody: (n) => `Wir haben deine Zahlung für ${n} geprüft. Deine Bestellung wird bearbeitet.`,
      proofBad: 'Zahlung braucht Aufmerksamkeit',
      proofBadBody: 'Wir konnten deine Zahlung noch nicht prüfen. Bitte reiche deinen Nachweis erneut ein.',
      security: 'Neue Anmeldung bei deinem Konto',
      securityBody: 'Ein neues Gerät hat sich angemeldet. Prüf deine aktiven Geräte, falls du das nicht warst.',
      ticketReply: (n) => `Antwort auf Ticket ${n}`,
      ticketReplyBody: 'Der Support hat auf dein Ticket geantwortet.',
      labels: { pending: 'Wartet auf Zahlung', payment_received: 'Zahlung eingegangen', processing: 'In Bearbeitung', awaiting_fulfillment: 'Wird von Hand geliefert', completed: 'Geliefert', refunded: 'Erstattet', cancelled: 'Storniert', failed: 'Fehlgeschlagen' },
      blurbs: {
        payment_received: 'Wir haben deine Zahlung bestätigt und machen deine Bestellung fertig.',
        processing: 'Deine Bestellung wird bearbeitet — wir mailen dir, sobald sie fertig ist.',
        awaiting_fulfillment: 'Diese Bestellung holen wir von Hand für dich. Sie kommt per E-Mail.',
        completed: 'Deine Bestellung ist geliefert — schau dir deine Lieferungen und Downloads an.',
        refunded: 'Für deine Bestellung wurde eine Erstattung ausgelöst.',
        cancelled: 'Deine Bestellung wurde storniert.',
      },
    },
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
    needBody: (need) => `Cette commande est livrée directement sur ton compte : il nous faut donc ton <strong style="color:#fff">${need}</strong>. Réponds à cet e-mail avec seulement cette information — nous commençons dès que nous l’avons. Nous ne demandons <strong style="color:#fff">jamais</strong> ton mot de passe.`,
    payExact: (amt) => `Paie ${amt} — le montant est déjà rempli`,
    paySendTo: (amt, target) => `Vire ${amt} à ${target}`,
    payPrefilled: 'montant déjà rempli',
    payRefNeeded: 'indique ton numéro de commande en description',
    payOr: 'Ou fais le virement toi-même', payComplete: 'Termine ton paiement',
    reviewAskTitle: 'Content de ta commande ?',
    reviewAskBody: 'Un court avis sur Trustpilot aide le prochain acheteur bien plus que tout ce que nous pouvons dire de nous-mêmes — nous ne pouvons y modifier ni supprimer un mot.',
    reviewAskCta: 'Laisser un avis sur Trustpilot',
    payHow: (number) => `Paie avec un des moyens ci-dessous et mets ton numéro de commande <strong>${number}</strong> en référence. Ta commande est confirmée dès que nous le recevons.`,
    byHandTitle: '✅ Livré à la main',
    byHandSub: 'Nous avons traité cette commande personnellement — aucun code ne figure dans ce récapitulatif.',
    byHandCheck: 'Regarde dans le jeu, ou dans la boîte mail à laquelle nous avons écrit au sujet de cette commande.',
    byHandMissing: 'Rien reçu ? Réponds à cet e-mail avec ton numéro de commande et nous regardons ce qui s’est passé.',

    need2fa: 'Active aussi la validation en deux étapes (2FA) sur ton compte Roblox — sans 2FA, nous ne pouvons pas livrer.',
    needSplit: (amount, days) => `Roblox autorise au maximum 5 000 R$ par compte et par jour : tes ${amount} R$ sont donc livrés sur ${days} jours.`,
    deliveryLabels: { code: 'Code', key: 'Clé de licence', file: 'Fichier', link: 'Lien', account: 'Compte' },
    orderLine: (number) => ` au sujet de la commande ${number}`,
    reviewTrustpilot: (link) => `ou laisse-le sur ${link} — il est public et nous ne pouvons pas le modifier.`,
    vatIncl: (amount, pct) => `dont ${amount} de TVA (${pct} %)`,
    vatMpv: 'carte cadeau (bon à usages multiples) — pas de TVA à la vente',
    invoiceLine: 'Ta facture se trouve avec cette commande dans ton compte.',
    refundRefunded: 'Remboursé', refundRemaining: 'Restant', refundVia: 'Par',
    refundMethods: { bank: 'virement bancaire', card: 'ton moyen de paiement', credit: 'crédit boutique', manual: 'le même moyen que ton paiement' },
    refundTiming: {
      card: 'Le remboursement revient sur le moyen de paiement que tu as utilisé. Le délai dépend de ta banque ou de l’émetteur de ta carte — en général quelques jours ouvrés.',
      bank: 'Un virement bancaire arrive en général sous 1 à 3 jours ouvrés, sur le compte avec lequel tu as payé.',
      manual: 'Nous remboursons par le même moyen que ton paiement. Le délai dépend de ce service.',
      credit: 'La partie en crédit boutique est déjà de retour dans ton solde et utilisable tout de suite.',
    },
    cancelAuto: (days) => `Nous n’avons pas reçu de paiement dans les ${days} jours suivant ta commande : elle a donc été annulée automatiquement.`,
    cancelOther: 'Cette commande a été annulée.',
    cancelCredit: (amount) => `Le crédit boutique que tu avais utilisé (${amount}) est de retour sur ton compte.`,
    stampZone: 'heure d’Amsterdam',
    notice: {
      received: (n) => `Commande ${n} reçue`,
      receivedBody: 'Nous avons bien reçu ta commande, elle attend ton paiement.',
      status: (n, label) => `Commande ${n} : ${label}`,
      newDelivery: (n) => `Commande ${n} : nouvelle livraison`,
      newDeliveryBody: 'Un nouveau code a été ajouté à ta commande — regarde tes e-mails et ton tableau de bord.',
      reminder: (n) => `La commande ${n} attend ton paiement`,
      reminderBody: (days) => `Termine ton paiement pour recevoir tes articles — ta commande reste ouverte ${days} jours.`,
      payLink: (n) => `Lien de paiement prêt pour ${n}`,
      payLinkBody: 'Ton lien de paiement avec le montant exact est prêt.',
      cart: 'Il reste quelque chose dans ton panier',
      cartBody: (count) => `${count} article(s) sont encore dans ton panier.`,
      proofOk: 'Paiement confirmé',
      proofOkBody: (n) => `Nous avons vérifié ton paiement pour ${n}. Ta commande est en cours de traitement.`,
      proofBad: 'Ton paiement demande ton attention',
      proofBadBody: 'Nous n’avons pas encore pu vérifier ton paiement. Envoie à nouveau ta preuve.',
      security: 'Nouvelle connexion à ton compte',
      securityBody: 'Un nouvel appareil s’est connecté à ton compte. Vérifie tes appareils actifs si ce n’était pas toi.',
      ticketReply: (n) => `Réponse au ticket ${n}`,
      ticketReplyBody: 'Le support a répondu à ton ticket.',
      labels: { pending: 'En attente de paiement', payment_received: 'Paiement reçu', processing: 'En cours', awaiting_fulfillment: 'Livraison à la main', completed: 'Livrée', refunded: 'Remboursée', cancelled: 'Annulée', failed: 'Échouée' },
      blurbs: {
        payment_received: 'Nous avons confirmé ton paiement et préparons ta commande.',
        processing: 'Ta commande est en cours de traitement — nous t’écrivons dès qu’elle est prête.',
        awaiting_fulfillment: 'Nous allons chercher cette commande à la main pour toi. Elle arrive par e-mail.',
        completed: 'Ta commande est livrée — consulte tes livraisons et téléchargements.',
        refunded: 'Un remboursement a été effectué pour ta commande.',
        cancelled: 'Ta commande a été annulée.',
      },
    },
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

const STAMP_LOCALES = { nl: 'nl-NL', en: 'en-IE', de: 'de-DE', fr: 'fr-FR' };

/**
 * A moment, written the way the reader's clock shows it.
 *
 * The withdrawal confirmation printed "2026-10-24 21:05 UTC", which is an hour
 * or two away from what the buyer's own clock said when they ticked the box —
 * and it is the one timestamp they may one day have to hold up against ours.
 * The shop is Dutch and its terms are in Dutch law, so the clock is Amsterdam's,
 * named in the reader's language.
 */
export function localStamp(iso, lang = FALLBACK) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const text = new Intl.DateTimeFormat(STAMP_LOCALES[lang] || STAMP_LOCALES.nl, {
    timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(when);
  return `${text} (${emailCopy(lang).stampZone})`;
}

/**
 * The unsubscribe page, reached from the link in a marketing mail.
 *
 * Two things it must never do: unsubscribe on a GET (mail scanners follow every
 * link, and a scanner is not the reader), and say "you will not get any more
 * email" — order confirmations, deliveries and login codes keep coming, and a
 * buyer told otherwise stops looking for the mail with their code in it.
 */
export const UNSUBSCRIBE_PAGE = {
  nl: {
    title: 'Uitschrijven',
    scopes: { marketing: 'nieuws en aanbiedingen', alerts: 'prijsalerts', reviews: 'verzoeken om een review' },
    ask: (what) => `Wil je geen mails meer over ${what}?`,
    button: 'Ja, schrijf me uit',
    done: (what) => `Je bent uitgeschreven voor ${what}.`,
    still: 'Mails over je bestellingen, leveringen en inlogcodes blijven komen — die heb je nodig.',
    invalid: 'Deze link is niet (meer) geldig. Je kunt je instellingen aanpassen in je account.',
  },
  en: {
    title: 'Unsubscribe',
    scopes: { marketing: 'news and offers', alerts: 'price alerts', reviews: 'review requests' },
    ask: (what) => `Stop emails about ${what}?`,
    button: 'Yes, unsubscribe me',
    done: (what) => `You are unsubscribed from ${what}.`,
    still: 'Emails about your orders, deliveries and login codes will still arrive — you need those.',
    invalid: 'This link is not valid (any more). You can change your settings in your account.',
  },
  de: {
    title: 'Abmelden',
    scopes: { marketing: 'Neuigkeiten und Angebote', alerts: 'Preisalarme', reviews: 'Bewertungsanfragen' },
    ask: (what) => `Keine Mails mehr zu ${what}?`,
    button: 'Ja, abmelden',
    done: (what) => `Du bist von ${what} abgemeldet.`,
    still: 'Mails zu deinen Bestellungen, Lieferungen und Anmeldecodes bekommst du weiterhin — die brauchst du.',
    invalid: 'Dieser Link ist nicht (mehr) gültig. Deine Einstellungen kannst du in deinem Konto ändern.',
  },
  fr: {
    title: 'Se désabonner',
    scopes: { marketing: 'les nouveautés et offres', alerts: 'les alertes de prix', reviews: 'les demandes d’avis' },
    ask: (what) => `Ne plus recevoir d’e-mails sur ${what} ?`,
    button: 'Oui, me désabonner',
    done: (what) => `Tu es désabonné(e) de ${what}.`,
    still: 'Les e-mails sur tes commandes, livraisons et codes de connexion continuent d’arriver — tu en as besoin.',
    invalid: 'Ce lien n’est pas (ou plus) valable. Tu peux modifier tes préférences dans ton compte.',
  },
};

/** The same, for the newsletter's double opt-in confirmation page. */
export const CONFIRM_PAGE = {
  nl: { title: 'Aanmelding bevestigen', ask: 'Bevestig dat je mails van ons wilt ontvangen.', button: 'Ja, bevestig mijn aanmelding', done: 'Bedankt — je aanmelding is bevestigd.', invalid: 'Deze link is niet (meer) geldig.' },
  en: { title: 'Confirm sign-up', ask: 'Confirm that you want to receive email from us.', button: 'Yes, confirm my sign-up', done: 'Thanks — your sign-up is confirmed.', invalid: 'This link is not valid (any more).' },
  de: { title: 'Anmeldung bestätigen', ask: 'Bestätige, dass du Mails von uns bekommen möchtest.', button: 'Ja, Anmeldung bestätigen', done: 'Danke — deine Anmeldung ist bestätigt.', invalid: 'Dieser Link ist nicht (mehr) gültig.' },
  fr: { title: 'Confirmer l’inscription', ask: 'Confirme que tu veux recevoir nos e-mails.', button: 'Oui, confirmer mon inscription', done: 'Merci — ton inscription est confirmée.', invalid: 'Ce lien n’est pas (ou plus) valable.' },
};

/**
 * How long an unpaid order stays open before the maintenance sweep cancels it.
 *
 * Lives here, beside the words that promise it, because the reminder mail used
 * to say "your items are still reserved for you" — nothing is reserved; the
 * order simply stays open until the sweep closes it. The sweep reads this same
 * number, so the mail and the job that keeps the promise cannot disagree.
 */
export const UNPAID_CANCEL_DAYS = 14;
