/**
 * Default content for each transactional email event. These are seeded into the
 * email_templates table where admins may edit subject + body. The body is the
 * inner content block only; templateService wraps it in the branded layout.
 *
 * Available tokens (resolved at send time): {{user.name}}, {{order.number}},
 * {{order.total}}, {{order.status}}, {{order.url}}, {{brand.name}},
 * {{refund.amount}}, plus any extra context passed by the caller.
 */
export const DEFAULT_TEMPLATES = [
  {
    id: 'account_created',
    name: 'Account Created',
    subject: 'Welkom bij {{brand.name}} 🎉',
    body_html: `
      <h1>Welkom, {{user.name}}! 🎉</h1>
      <p>Je {{brand.name}}-account staat klaar. Je kunt nu bestellen, je levering
      volgen, facturen downloaden en alles beheren vanuit je dashboard.</p>
      <p><strong>Geen wachtwoord om te onthouden.</strong> Elke keer dat je inlogt
      mailen we je een nieuwe eenmalige code — en op dit apparaat blijf je
      ingelogd, dus vaak zul je dat niet hoeven.</p>
      <p><a class="btn" href="{{app.url}}/account">Naar je dashboard</a></p>
      <p>Vragen? Beantwoord deze mail gewoon, of open een ticket in onze Discord. 💜</p>`,
  },
  {
    id: 'order_received',
    name: 'Order Received',
    subject: 'Bedankt voor je bestelling {{order.number}} 🎮',
    body_html: `
      <h1>Bedankt voor je bestelling! 🎉</h1>
      <p>Hoi {{user.name}}, bedankt voor je aankoop bij {{brand.name}}. We hebben
      bestelling <strong>{{order.number}}</strong> ontvangen (totaal <strong>{{order.total}}</strong>).</p>
      {{order.itemsHtml}}
      {{order.needsFromBuyerHtml}}
      {{order.paymentHtml}}
      <p>Zodra je betaling bevestigd is, leveren we. Wat we op voorraad hebben gaat
      automatisch de deur uit; de rest leveren we met de hand.
      Volg de status hier — geen account nodig:</p>
      <p><a class="btn" href="{{order.url}}">Volg je bestelling</a></p>
      <p>Hulp nodig? Beantwoord deze mail of open een ticket in onze Discord.</p>
      {{order.consentHtml}}`,
  },
  {
    id: 'payment_reminder',
    name: 'Payment Reminder',
    subject: 'Je {{brand.name}}-bestelling {{order.number}} wacht nog ⏳',
    body_html: `
      <h1>Je bestelling wacht op je betaling</h1>
      <p>Hoi {{user.name}}, je hebt bestelling <strong>{{order.number}}</strong> geplaatst
      (totaal <strong>{{order.total}}</strong>), maar we hebben je betaling nog niet ontvangen.
      Je bestelling blijft {{order.openDays}} dagen na het plaatsen open; komt er in die tijd geen
      betaling binnen, dan annuleren we hem automatisch.</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p><a class="btn" href="{{order.url}}">Bestelling afronden</a></p>
      <p>Al betaald? Dan kun je deze mail negeren — een betaling kan even duren
      voordat hij bevestigd is. Vragen? Beantwoord deze mail of open een ticket in onze Discord.</p>`,
  },
  {
    id: 'payment_confirmed',
    name: 'Payment Confirmed',
    subject: 'Betaling bevestigd voor {{order.number}} ✅',
    body_html: `
      <h1>Betaling ontvangen ✅</h1>
      <p>Hoi {{user.name}}, we hebben je betaling gekoppeld aan bestelling
      <strong>{{order.number}}</strong>. We maken hem nu klaar.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><strong>Wat er nu gebeurt:</strong> wat we op voorraad hebben gaat automatisch de deur uit.
      Wat we voor je inkopen leveren we met de hand.
      Hoe dan ook: de levering komt in deze inbox terecht.</p>
      <p><a class="btn" href="{{order.url}}">Volg je bestelling</a></p>
      <p style="color:#8b93a7;font-size:13px">Die pagina ververst zichzelf — geen account nodig.
      Ondertussen een vraag? Beantwoord deze mail gerust.</p>
      {{order.invoiceHtml}}
      {{order.consentHtml}}`,
  },
  {
    id: 'order_processing',
    name: 'Order Processing',
    subject: 'Je bestelling {{order.number}} wordt klaargemaakt',
    body_html: `
      <h1>We zijn ermee bezig 🔧</h1>
      <p>Hoi {{user.name}}, bestelling <strong>{{order.number}}</strong> wordt op dit moment klaargemaakt.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p>Deze status betekent dat we je items met de hand klaarzetten. Je krijgt een mail zodra
      het geleverd is; de status volg je altijd via de knop hieronder.</p>
      <p><a class="btn" href="{{order.url}}">Volg je bestelling</a></p>
      <p style="color:#8b93a7;font-size:13px">Duurt het langer dan je verwachtte? Beantwoord deze mail
      of open een ticket in onze Discord — we horen het liever te vroeg dan te laat.</p>`,
  },
  {
    id: 'order_completed',
    name: 'Order Completed',
    subject: 'Je bestelling {{order.number}} is klaar 🎮',
    // Premium, fully inline-styled (survives clients that strip <style>). The
    // delivery hero + order breakdown are injected server-side.
    body_html: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Geleverd</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Bestelling {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Je bestelling staat klaar 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hoi {{user.name}} — je betaling is rond en hieronder staat wat je hebt besteld.</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Overzicht van je bestelling</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" bgcolor="#7c5cff" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">Bekijk je bestelling</a>
        </td>
      </tr></table>
      {{order.invoiceHtml}}
      {{order.reviewAskHtml}}
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Klopt er iets niet? Beantwoord deze mail of open een ticket in onze Discord. 💬</div>
      {{order.consentHtml}}`,
  },
  {
    id: 'refund_issued',
    name: 'Refund Issued',
    subject: 'Terugbetaling voor {{order.number}} — {{refund.amount}}',
    body_html: `
      <h1>Je terugbetaling is verwerkt ↩️</h1>
      <p>Hoi {{user.name}}, we hebben <strong>{{refund.amount}}</strong> terugbetaald voor bestelling
      <strong>{{order.number}}</strong>.</p>
      {{refund.detailsHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Bekijk deze bestelling</a></p>
      <p style="color:#8b93a7;font-size:13px">Niet wat je verwachtte, of na een paar werkdagen nog niets binnen?
      Beantwoord deze mail met je bestelnummer en we gaan erachteraan.</p>`,
  },
  {
    id: 'custom_message',
    name: 'Message from Support',
    subject: '{{subject}} — bestelling {{order.number}}',
    body_html: `
      <h1>{{subject}}</h1>
      <p>Hoi {{user.name}}, dit gaat over je bestelling <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{messageHtml}}</div>
      <p><a class="btn" href="{{order.url}}">Bekijk je bestelling</a></p>
      <p style="color:#8b93a7;font-size:13px">Je kunt gewoon op deze mail antwoorden — hij komt bij
      dezelfde persoon terecht die hem stuurde. Liever chatten? Onderaan staat de link naar onze Discord.</p>`,
  },
  {
    id: 'support_reply',
    name: 'Support Reply',
    subject: 'Re: {{ticket.subject}} · ticket {{ticket.number}}',
    body_html: `
      <h1>We hebben op je ticket geantwoord</h1>
      <p>Hoi <strong>{{user.name}}</strong>, iemand van de shop heeft ticket
      <strong>{{ticket.number}}</strong>{{ticket.orderLine}} beantwoord:</p>
      <div class="quote">{{replyHtml}}</div>
      <p><a class="btn" href="{{ticket.url}}">Lees het hele gesprek</a></p>
      <p style="color:#8b93a7;font-size:13px">Antwoord gewoon op deze mail — je bericht komt terug op
      hetzelfde ticket, zonder account.</p>`,
  },
  {
    id: 'cart_reminder',
    name: 'Abandoned Cart',
    subject: 'Je hebt iets in je winkelwagen laten staan 🛒',
    body_html: `
      <div class="badge">🛒</div>
      <h1 style="text-align:center">Nog aan het twijfelen?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hoi {{user.name}}, dit stond
      nog in je winkelwagen bij {{brand.name}}. Je winkelwagen is bewaard, mocht je verder willen.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Naar je winkelwagen</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Vragen? Beantwoord deze mail of open een ticket in onze Discord.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px">Geen herinneringen meer? <a href="{{unsubscribe.url}}" style="color:#8b93a7">Uitschrijven</a></p>`,
  },
  {
    id: 'price_drop',
    name: 'Price Drop (wishlist)',
    subject: '{{product.name}} is nu {{price.current}} \u{1F4C9}',
    /* Sent only when somebody saved the product AND turned the alert on, and
       only when the price is below what they last knew. Every one carries the
       link that turns alerts off without signing in. */
    body_html: `
      <div class="badge">\u{1F4C9}</div>
      <h1 style="text-align:center">Prijsdaling op je verlanglijst</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hoi {{user.name}},
      <strong>{{product.name}}</strong> is goedkoper geworden.</p>
      <p style="text-align:center;font-size:15px;margin:18px 0 4px">
        <span style="color:#8b93a7;text-decoration:line-through">{{price.previous}}</span>
        &nbsp;→&nbsp;<strong style="font-size:22px">{{price.current}}</strong></p>
      <p style="text-align:center;margin:0 0 18px"><span class="pill-note">{{price.diff}} goedkoper</span></p>
      <p style="text-align:center"><a class="btn" href="{{product.url}}">Bekijk het product</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Je bewaarde dit product voor {{price.saved}}.
      <a href="{{wishlist.url}}" style="color:#8b93a7">Naar je verlanglijst</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:12px;margin-top:22px">Je krijgt dit omdat je een prijsalert
      aanzette. <a href="{{wishlist.alertsOffUrl}}" style="color:#8b93a7">Alle prijsalerts uitzetten</a></p>`,
  },
  {
    id: 'review_request',
    name: 'Review Request',
    subject: 'Hoe was je bestelling {{order.number}}? ⭐',
    body_html: `
      <div class="badge">⭐</div>
      <h1 style="text-align:center">Hoe deden we het?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hoi {{user.name}}, nogmaals bedankt
      voor bestelling <strong>{{order.number}}</strong>! Kwam alles aan zoals verwacht, dan zouden we een korte review
      waarderen — het helpt andere gamers om in te schatten of ze bij ons willen kopen.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Schrijf een korte review</a></p>
      {{review.trustpilotHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Klopt er iets niet? Beantwoord deze mail of open
      een ticket in onze Discord, dan kijken we ernaar.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px">Liever geen reviewverzoeken meer?
      <a href="{{unsubscribe.url}}" style="color:#8b93a7">Zet ze uit</a></p>`,
  },
  {
    id: 'launch_announcement',
    name: 'Launch Announcement',
    subject: '{{shop.name}} is open \u{1F680}',
    /* The one mail the pre-launch banner promised. Sent once, only after the
       shop has actually opened, only to people who confirmed their sign-up. */
    body_html: `
      <div class="badge">\u{1F680}</div>
      <h1 style="text-align:center">We zijn open</h1>
      <p style="text-align:center;max-width:440px;margin-left:auto;margin-right:auto">Je vroeg of we je een
      berichtje wilden sturen zodra {{shop.name}} opengaat. Bij dezen: de winkel is open en je kunt bestellen.</p>
      <p style="text-align:center"><a class="btn" href="{{shop.url}}/shop">Bekijk de winkel</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Op voorraad gaat automatisch de deur uit; de rest
      met de hand. Je betaalt pas na je bestelling.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px;margin-top:22px">Je krijgt deze mail omdat je
      je had aangemeld. <a href="{{unsubscribe.url}}" style="color:#8b93a7">Uitschrijven</a></p>`,
  },
  {
    id: 'gift_card',
    name: 'Gift Card',
    subject: 'Je hebt een {{brand.name}}-cadeaubon van {{giftCard.amount}} gekregen 🎁',
    body_html: `
      <div class="badge">🎁</div>
      <h1 style="text-align:center">Je hebt een cadeaubon!</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Iemand heeft je
      <strong>{{giftCard.amount}}</strong> gestuurd om bij {{brand.name}} uit te geven aan Robux, V-Bucks,
      giftcards en meer.</p>
      <p class="code">{{giftCard.code}}</p>
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">💳 Waarde {{giftCard.amount}} · eenmalig in te wisselen</span></p>
      {{giftCard.noteHtml}}
      <p style="text-align:center"><a class="btn" href="{{app.url}}/account">Wissel je cadeaubon in</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Log in (of maak een gratis account), open
      <strong>Wallet</strong> en plak de code hierboven — het saldo komt in je tegoed te staan en wordt
      automatisch verrekend bij het afrekenen.</p>
      <div class="notice">🔒 <strong>Houd deze code privé.</strong> Iedereen met deze code kan het saldo
      inwisselen. Eenmalig te gebruiken, op elke bestelling.</div>`,
  },
  {
    id: 'login_otp',
    name: 'Login Code',
    /* No code in the subject: a subject line is shown on lock screens, in
       notification previews and in mail-server logs, none of which should be
       able to sign anyone in. And no "Hoi <local-part>" — the address is all
       we know, and greeting someone as "jan.de.vries84" reads like a script. */
    subject: 'Je inlogcode voor {{brand.name}}',
    body_html: `
      <div class="badge">🔐</div>
      <h1 style="text-align:center">Je inlogcode</h1>
      <p style="text-align:center;max-width:400px;margin-left:auto;margin-right:auto">Vul deze code in op het
      inlogscherm van {{brand.name}}.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">⏱ Verloopt over {{otp.ttl}} minuten · eenmalig te gebruiken</span></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Typ je hem op een ander apparaat over? De code is
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice">🛡️ <strong>Vul deze code alleen in op {{app.host}}.</strong> {{brand.name}} vraagt je
      <strong>nooit</strong> om deze code — niet per e-mail, DM of telefoon. Probeerde jij niet in te loggen? Dan kun
      je deze mail gerust negeren; zonder de code kan niemand bij je account.</div>`,
  },
  {
    id: 'security_alert',
    name: 'Security Alert',
    /* No IP in the subject: subjects end up in previews and logs, and the
       address is only useful to the account holder, inside the mail. */
    subject: 'Nieuwe aanmelding op je {{brand.name}}-account',
    body_html: `
      <div class="badge">🛡️</div>
      <h1 style="text-align:center">Nieuwe aanmelding op je account</h1>
      <p>Hoi {{user.name}}, er is zojuist ingelogd op je {{brand.name}}-account vanaf een apparaat of
      locatie die we nog niet kenden.</p>
      <div class="quote">{{login.detailsHtml}}</div>
      <p><strong>Was jij dit?</strong> Dan hoef je niets te doen.</p>
      <p><strong>Was jij dit niet?</strong> Meld het apparaat af in je beveiligingsinstellingen en beantwoord
      deze mail, dan kijken we met je mee.</p>
      <p><a class="btn" href="{{app.url}}/account/settings">Naar je beveiligingsinstellingen</a></p>`,
  },
  {
    id: 'order_cancelled',
    name: 'Order Cancelled',
    subject: 'Je bestelling {{order.number}} is geannuleerd',
    body_html: `
      <h1>Je bestelling is geannuleerd</h1>
      <p>Hoi {{user.name}}, bestelling <strong>{{order.number}}</strong> (totaal <strong>{{order.total}}</strong>)
      is geannuleerd.</p>
      {{cancel.reasonHtml}}
      {{order.summaryHtml}}
      <p>Wil je het toch hebben? Je kunt altijd een nieuwe bestelling plaatsen.</p>
      <p><a class="btn" href="{{app.url}}/shop">Naar de winkel</a></p>
      <p style="color:#8b93a7;font-size:13px">Had je al betaald, of klopt dit niet? Beantwoord deze mail met
      je bestelnummer, dan zoeken we het uit.</p>`,
  },
  {
    id: 'order_on_hold',
    name: 'Order On Hold (review)',
    subject: 'Je bestelling {{order.number}}: betaling ontvangen, nog een korte controle',
    body_html: `
      <h1>Betaling ontvangen — nog een extra controle</h1>
      <p>Hoi {{user.name}}, we hebben je betaling voor bestelling <strong>{{order.number}}</strong> ontvangen.</p>
      <p>Voordat we leveren, bekijkt iemand van ons deze bestelling nog even. Dat doen we bij een deel van de
      bestellingen, onder meer om misbruik van betaalgegevens te voorkomen. Je hoeft hiervoor niets te doen;
      als we iets van je nodig hebben, mailen we je.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><a class="btn" href="{{order.url}}">Volg je bestelling</a></p>
      <p style="color:#8b93a7;font-size:13px">Vragen? Beantwoord deze mail.</p>
      {{order.consentHtml}}`,
  },
  {
    id: 'payment_not_verified',
    name: 'Payment Not Verified',
    subject: 'We konden je betaling voor {{order.number}} nog niet vinden',
    body_html: `
      <h1>We konden je betaling nog niet vinden</h1>
      <p>Hoi {{user.name}}, je stuurde een betaalbewijs voor bestelling <strong>{{order.number}}</strong>,
      maar we konden die betaling nog niet terugvinden.</p>
      {{proof.reasonHtml}}
      <p>Controleer het bedrag (<strong>{{order.total}}</strong>) en of je bestelnummer als omschrijving
      is meegegeven, en stuur je bewijs daarna opnieuw in.</p>
      <p><a class="btn" href="{{order.url}}">Bewijs opnieuw insturen</a></p>
      <p style="color:#8b93a7;font-size:13px">Zeker dat het klopt? Beantwoord deze mail met een screenshot
      van de betaling, dan kijken we het na.</p>`,
  },
  {
    id: 'refund_request_received',
    name: 'Refund Request Received',
    subject: 'We hebben je terugbetalingsverzoek voor {{order.number}} ontvangen',
    body_html: `
      <h1>Je verzoek is binnen</h1>
      <p>Hoi {{user.name}}, we hebben je verzoek om terugbetaling voor bestelling
      <strong>{{order.number}}</strong> ontvangen. Iemand van ons bekijkt het en je hoort per mail wat we besluiten.</p>
      {{request.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">Bekijk je bestelling</a></p>
      <p style="color:#8b93a7;font-size:13px">Wil je iets toevoegen? Beantwoord deze mail.</p>`,
  },
  {
    id: 'refund_request_rejected',
    name: 'Refund Request Rejected',
    subject: 'Je terugbetalingsverzoek voor {{order.number}}',
    body_html: `
      <h1>We kunnen dit verzoek niet toekennen</h1>
      <p>Hoi {{user.name}}, we hebben je verzoek om terugbetaling voor bestelling
      <strong>{{order.number}}</strong> bekeken en kunnen het niet toekennen.</p>
      {{request.reasonHtml}}
      <p>Ben je het hier niet mee eens, of hebben we iets gemist? Beantwoord deze mail met wat er speelt —
      dan bekijkt iemand het opnieuw. Op de pagina over herroeping en terugbetaling lees je wanneer je recht
      hebt op je geld terug.</p>
      <p><a class="btn" href="{{app.url}}/refunds">Herroeping &amp; terugbetaling</a></p>`,
  },
  {
    id: 'ticket_opened',
    name: 'Ticket Opened',
    subject: 'We hebben je ticket ontvangen · {{ticket.number}}',
    body_html: `
      <h1>We hebben je bericht ontvangen</h1>
      <p>Hoi {{user.name}}, je ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}} staat bij ons.
      Je krijgt ons antwoord per mail.</p>
      <div class="quote">{{ticket.subject}}</div>
      <p><a class="btn" href="{{ticket.url}}">Bekijk je ticket</a></p>
      <p style="color:#8b93a7;font-size:13px">Iets toevoegen? Antwoord gewoon op deze mail.</p>`,
  },
  {
    id: 'newsletter_confirm',
    name: 'Newsletter Confirmation',
    subject: 'Bevestig je aanmelding bij {{brand.name}}',
    body_html: `
      <div class="badge">✉️</div>
      <h1 style="text-align:center">Bevestig je aanmelding</h1>
      <p style="text-align:center;max-width:440px;margin-left:auto;margin-right:auto">Dit adres is opgegeven
      voor berichten van {{brand.name}}. Pas als je hieronder bevestigt, sturen we je iets.</p>
      <p style="text-align:center"><a class="btn" href="{{newsletter.confirmUrl}}">Ja, bevestig mijn aanmelding</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Was jij dit niet? Negeer deze mail dan gewoon.</p>`,
  },
];

/**
 * Superseded default bodies, keyed by template id. When seeding an existing
 * database we upgrade a template ONLY if its stored body still matches one of
 * these — so improved defaults roll out everywhere except where an admin has
 * customized the template.
 */
export const LEGACY_TEMPLATE_BODIES = {
  /* ── The English originals ─────────────────────────────────────────────────
     Every one of these thirteen templates was English on a shop whose entire
     storefront, checkout and legal pages are Dutch — including the login code
     and the delivery mail, the two messages every buyer reads. An English mail
     from a Dutch shop is also exactly what a phishing mail looks like, which is
     the version of this that costs a sale rather than an apology.
     Listed here so a database seeded with the English copy upgrades on the next
     boot, while anything the owner has edited by hand is left alone. */
  // The English default, before the shop's own emails became Dutch.
  account_created: [`
      <h1>Welcome, {{user.name}}! 🎉</h1>
      <p>Your {{brand.name}} account is ready. You can now place orders, track
      deliveries, download invoices and manage everything from your dashboard.</p>
      <p><strong>No password to remember.</strong> Whenever you sign in we email
      you a fresh one-time code — and we keep you signed in on this device, so
      you won't have to do it often.</p>
      <p><a class="btn" href="{{app.url}}/account">Go to your dashboard</a></p>
      <p>Questions? Just reply to this email or open a ticket in our Discord. 💜</p>`],
  // The English default, before the shop's own emails became Dutch.
  order_received: [`
      <h1>Thank you for your order! 🎉</h1>
      <p>Hi {{user.name}}, thanks for shopping with {{brand.name}}! We've received
      order <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>).</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p>As soon as we confirm your payment we deliver. Items we have in stock are
      sent automatically; anything else we deliver by hand, usually within a few hours.
      Follow the status here — no account needed:</p>
      <p><a class="btn" href="{{order.url}}">Track your order</a></p>
      <p>Need help? Just reply to this email or open a ticket in our Discord.</p>
      {{order.consentHtml}}`],
  // The English default, before the shop's own emails became Dutch.
  payment_reminder: [`
      <h1>Your order is reserved — complete your payment</h1>
      <p>Hi {{user.name}}, we noticed you placed order <strong>{{order.number}}</strong>
      (total <strong>{{order.total}}</strong>) but we have not received your payment yet.
      Your items are still reserved for you.</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p><a class="btn" href="{{order.url}}">Complete your order</a></p>
      <p>Already paid? Then you can ignore this email — payments can take a few minutes
      to be confirmed. Questions? Just reply or open a ticket in our Discord.</p>`],
  // The English default, before the shop's own emails became Dutch.
  payment_confirmed: [`
      <h1>Payment received ✅</h1>
      <p>Hi {{user.name}}, we matched your payment to order <strong>{{order.number}}</strong>.
      Nothing left for you to do — we're preparing it now.</p>
      {{order.summaryHtml}}
      <p><strong>What happens next:</strong> items we have in stock are sent automatically
      within minutes. Anything we buy in for you is delivered by hand, usually within a few
      hours during the day. Either way the code lands in this same inbox.</p>
      <p><a class="btn" href="{{order.url}}">Follow your order</a></p>
      <p style="color:#8b93a7;font-size:13px">That page updates by itself — no account needed,
      no refreshing. Questions in the meantime? Just reply to this email.</p>`],
  // The English default, before the shop's own emails became Dutch.
  order_processing: [`
      <h1>We're on it 🔧</h1>
      <p>Hi {{user.name}}, order <strong>{{order.number}}</strong> is being prepared right now.</p>
      {{order.summaryHtml}}
      <p>This status means we're getting your items ready by hand. It usually takes a few hours
      during the day; if it lands outside our active hours it goes out first thing after.</p>
      <p><a class="btn" href="{{order.url}}">Follow your order</a></p>
      <p style="color:#8b93a7;font-size:13px">Taking longer than you expected? Reply to this email
      or open a ticket in our Discord — a real person answers, and we'd rather hear from you early.</p>`],
  // The English default, before the shop's own emails became Dutch.
  order_completed: [`
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Delivered</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Order {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Your loot is ready 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hi {{user.name}} — payment cleared and everything below is yours. Grab it, jump in, and go win. 🚀</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Order summary</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">View your order</a>
        </td>
      </tr></table>
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Something not right? Just reply to this email or open a ticket in our Discord — real humans, fast. 💬</div>`],
  // The English default, before the shop's own emails became Dutch.
  refund_issued: [`
      <h1>Your refund is on the way ↩️</h1>
      <p>Hi {{user.name}}, we've refunded <strong>{{refund.amount}}</strong> for order
      <strong>{{order.number}}</strong>.</p>
      {{order.summaryHtml}}
      <p><strong>When you'll see it:</strong> bank transfers usually land within 1–3 working days.
      It comes back to the account you paid from. If you paid with store credit, that part is
      already back in your balance and ready to use.</p>
      <p><a class="btn" href="{{order.url}}">View this order</a></p>
      <p style="color:#8b93a7;font-size:13px">Not what you expected, or nothing arrived after
      three working days? Reply to this email with your order number and we'll chase it.</p>`],
  // The English default, before the shop's own emails became Dutch.
  custom_message: [`
      <h1>{{subject}}</h1>
      <p>Hi {{user.name}}, this is about your order <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{message}}</div>
      <p><a class="btn" href="{{order.url}}">View your order</a></p>
      <p style="color:#8b93a7;font-size:13px">You can reply straight to this email — it reaches
      the same person who sent it. Prefer chat? Our Discord ticket is linked at the bottom.</p>`],
  // The English default, before the shop's own emails became Dutch.
  support_reply: [`
      <h1>We replied to your ticket</h1>
      <p>Hi <strong>{{user.name}}</strong>, someone from the shop answered ticket
      <strong>{{ticket.number}}</strong>{{ticket.orderLine}}:</p>
      <div class="quote">{{reply}}</div>
      <p><a class="btn" href="{{ticket.url}}">Read the whole thread</a></p>
      <p style="color:#8b93a7;font-size:13px">Reply straight to this email and it lands back on the
      same ticket — no account needed.</p>`],
  // The English default, before the shop's own emails became Dutch.
  cart_reminder: [`
      <div class="badge">🛒</div>
      <h1 style="text-align:center">Still thinking it over?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, you left these
      in your cart at {{brand.name}}. They're still here — grab them before they're gone.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Complete your order</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">No account needed, no hidden fees. Questions? Just reply
      to this email or open a ticket in our Discord.</p>`],
  // The English default, before the shop's own emails became Dutch.
  review_request: [`
      <div class="badge">⭐</div>
      <h1 style="text-align:center">How did we do?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, thanks again
      for your order <strong>{{order.number}}</strong>! If everything arrived as expected, a quick review would
      mean the world — it takes 20 seconds and helps other gamers buy with confidence.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Leave a quick review</a></p>
      {{review.trustpilotHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Something not right? Just reply to this email or open
      a ticket in our Discord and we'll make it right.</p>`],
  // The English default, before the shop's own emails became Dutch.
  gift_card: [`
      <div class="badge">🎁</div>
      <h1 style="text-align:center">You've got a gift card!</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Someone sent you
      <strong>{{giftCard.amount}}</strong> to spend at {{brand.name}} on Robux, V-Bucks, gift cards and more.</p>
      <p class="code">{{giftCard.code}}</p>
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">💳 Worth {{giftCard.amount}} · redeem it in seconds</span></p>
      {{giftCard.noteHtml}}
      <p style="text-align:center"><a class="btn" href="{{app.url}}/account">Redeem your gift card</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Sign in (or create a free account), open
      <strong>Wallet</strong> and paste the code above — the balance lands in your store credit and applies
      automatically at checkout.</p>
      <div class="notice">🔒 <strong>Keep this code private.</strong> Anyone with it can redeem the balance.
      Redeemable once, on any order.</div>`],
  // The English default, before the shop's own emails became Dutch.
  login_otp: [`
      <div class="badge">🔐</div>
      <h1 style="text-align:center">Your login code</h1>
      <p style="text-align:center;max-width:400px;margin-left:auto;margin-right:auto">Hey <strong>{{user.name}}</strong>,
      welcome back! Enter this code on the login screen and you're in.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">⏱ Expires in {{otp.ttl}} minutes · one-time use</span></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Typing on another device? The code is
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice">🛡️ <strong>Stay safe:</strong> {{brand.name}} will <strong>never</strong> ask
      you for this code — not by email, DM or phone. Didn't try to sign in? You can safely ignore
      this email; without the code nobody can access your account.</div>`],

  // Same copy, before the optional Trustpilot line was added — so a live
  // database that never customized this mail picks the new one up on boot.
  review_request: [`
      <div class="badge">⭐</div>
      <h1 style="text-align:center">How did we do?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, thanks again
      for your order <strong>{{order.number}}</strong>! If everything arrived as expected, a quick review would
      mean the world — it takes 20 seconds and helps other gamers buy with confidence.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Leave a quick review</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Something not right? Just reply to this email or open
      a ticket in our Discord and we'll make it right.</p>`],
  order_completed: [`
      <h1>Order complete!</h1>
      <p>Hi {{user.name}}, your order <strong>{{order.number}}</strong> is done — here
      are your items. Keep this email safe.</p>
      {{order.deliveriesHtml}}
      {{order.itemsHtml}}
      <p><a class="btn" href="{{order.url}}">View in your dashboard</a></p>`, `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Delivered</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Order {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Your loot is ready 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hi {{user.name}} — payment cleared and everything below is yours. Grab it, jump in, and go win. 🚀</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Order summary</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">View in your dashboard</a>
        </td>
      </tr></table>
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Something not right? Just reply to this email or open a ticket in our Discord — real humans, fast. 💬</div>`, `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Delivered</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Order {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Your loot is ready 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hi {{user.name}} — payment cleared and everything below is yours. Grab it, jump in, and go win. 🚀</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Order summary</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">View your order</a>
        </td>
      </tr></table>
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Something not right? Just reply to this email or open a ticket in our Discord — real humans, fast. 💬</div>`],
  // Both of these promised instant delivery and buyer protection — the exact
  // claims the storefront stopped making. An email that over-promises does the
  // same damage as a homepage that does.
  order_received: [`
      <h1>Thank you for your order! 🎉</h1>
      <p>Hi {{user.name}}, thanks for shopping with {{brand.name}}! We've received
      order <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>).</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p>Once your payment is confirmed we deliver instantly to your account & email.
      You can follow the status any time:</p>
      <p><a class="btn" href="{{order.url}}">Track your order</a></p>
      <p>Need help? Just reply to this email or open a ticket in our Discord.</p>`, `
      <h1>Thank you for your order! 🎉</h1>
      <p>Hi {{user.name}}, thanks for shopping with {{brand.name}}! We've received
      order <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>).</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p>As soon as we confirm your payment we deliver. Items we have in stock are
      sent automatically; anything else we deliver by hand, usually within a few hours.
      Follow the status here — no account needed:</p>
      <p><a class="btn" href="{{order.url}}">Track your order</a></p>
      <p>Need help? Just reply to this email or open a ticket in our Discord.</p>`],
  // Superseded by copy that says what happens next and when — the originals were
  // two lines and a button, which is where "where is my order?" tickets start.
  payment_confirmed: [`
      <h1>Payment received ✅</h1>
      <p>We've confirmed payment for order <strong>{{order.number}}</strong>.
      We're preparing your order now.</p>
      <p><a class="btn" href="{{order.url}}">View order status</a></p>`],
  order_processing: [`
      <h1>We're on it 🔧</h1>
      <p>Order <strong>{{order.number}}</strong> is now being processed and will
      move to fulfillment shortly.</p>
      <p><a class="btn" href="{{order.url}}">Track in real time</a></p>`],
  refund_issued: [`
      <h1>Your refund is on the way</h1>
      <p>We've issued a refund of <strong>{{refund.amount}}</strong> for order
      <strong>{{order.number}}</strong>. It may take a few business days to
      appear on your statement.</p>
      <p><a class="btn" href="{{order.url}}">View order</a></p>`],
  custom_message: [`
      <h1>{{subject}}</h1>
      <p>Hi {{user.name}}, our team sent you a message regarding order
      <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{message}}</div>
      <p><a class="btn" href="{{order.url}}">View your order</a></p>`],
  cart_reminder: [`
      <div class="badge">🛒</div>
      <h1 style="text-align:center">Still thinking it over?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, you left these
      in your cart at {{brand.name}}. They're still here — grab them before they're gone.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Complete your order</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Money back if we cannot deliver. Questions? Just reply
      to this email or open a ticket in our Discord.</p>`],
  login_otp: [`
      <h1>Your login code</h1>
      <p>Use this code to sign in. It expires in {{otp.ttl}} minutes.</p>
      <p class="code">{{otp.code}}</p>
      <p>If you didn't request this, you can safely ignore this email.</p>`, `
      <h1 style="text-align:center">🔐 Your login code</h1>
      <p style="text-align:center">Hi <strong>{{user.name}}</strong> — enter this code to sign in.
      It works once and expires in <strong>{{otp.ttl}} minutes</strong>.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Typing on another device? The code is
      <strong style="letter-spacing:2px">{{otp.code}}</strong></p>
      <div class="notice">🛡️ <strong>Stay safe:</strong> {{brand.name}} will <strong>never</strong> ask
      you for this code — not by email, DM or phone. Didn't try to sign in? You can safely ignore
      this email; without the code nobody can access your account.</div>`],
};

/**
 * Every earlier default, in every language, as a fingerprint.
 *
 * LEGACY_TEMPLATE_BODIES above only ever covered the Dutch rows, so the
 * English, German and French templates were seeded once and then frozen: a copy
 * fix (a false "reserved", a login code in the subject) reached new shops and
 * never the running one. Keeping every old body verbatim for four languages
 * would be most of a megabyte of dead prose, so what is kept is a short hash of
 * each normalised body and subject. A stored row whose hash is on this list is
 * an untouched default and may be upgraded; anything else is an owner's edit
 * and is left exactly as they wrote it.
 *
 * Captured from the shipped defaults before the October 2026 mail audit.
 * Keyed lang → template id → { body: [hash], subject: [hash] }.
 */
export const LEGACY_TEMPLATE_HASHES = {"nl":{"account_created":{"body":["f5ca783b94c816c9","61e284fded7d043c"],"subject":["d423e67f2b3e7e75","070fe34cce4b6739"]},"order_received":{"body":["7d015f84020815cf","22d30c17af2538f9","41c9971f88527349","a94cc5354277fea6"],"subject":["b2f2efc93f8e2ade","6f1118c93ae504ed"]},"payment_reminder":{"body":["6b8ebc650de3a1d6","b38b9e6184082d77"],"subject":["7969968b066a32e3","1f862fe5125e8329"]},"payment_confirmed":{"body":["06c3d477740da7a3","8b7fab2c5f442dc5","036d89e4a9375514"],"subject":["f7747a22afda6d27","0e6d55a8a0732c56"]},"order_processing":{"body":["c4aca96240d7541f","05817ce136df1f78","5becfb338752456c"],"subject":["7e77f6fb7031a5da","cdefd042dd95a6b9"]},"order_completed":{"body":["1cc0e2e0fffbb808","16e416dfe6b31cde","5c160e01cc040545","b6143e29c6fb9634","82511debbd9bc129"],"subject":["1ecf88fac65277e7","a1722a02e0079575"]},"refund_issued":{"body":["8f91ab6098b5aeca","85783c2a31b4df9f","aadc09fb3a6f47ae"],"subject":["9ad71828a48434b1","f2c25f8be6f1a24c"]},"custom_message":{"body":["0fe55eec42192430","a0f0d52934c56271","ddb14c456d7a4923"],"subject":["7b8812f957edf979","3683c9433ba177d4"]},"support_reply":{"body":["f808146730a118ed","e21f0a5a13c2bac1"],"subject":["3c45c64c6e1457d8"]},"cart_reminder":{"body":["6501ac1b4a57ad88","b46a6e7adbe9f821","7a2916d997a3caef"],"subject":["51bcbb7181727b9e","c7b7429e0dbb8a3d"]},"price_drop":{"body":["1706d72f597eed15","e8de81a3458e7fc7"],"subject":["982b3ddf025b9d7c","10658c1483f1f644"]},"review_request":{"body":["d8d49a99217b6d81","600674f3d75089af","b27ce7fbd14c71c7"],"subject":["53be0b6f38fa15d4","b8814658043af021"]},"launch_announcement":{"body":["ceaa1c69e7eba628","2d08313ab72f9c2b"],"subject":["09c44a8ab8bea398"]},"gift_card":{"body":["fd60cc88a1a44dc9","8446ec35f0297e41"],"subject":["70476dbcbf28e423","453af286fa5740ff"]},"login_otp":{"body":["04fa9fe9f91f4796","3d32d1276bdea772","ed52c887e0683947","db9520ab62fcbb26"],"subject":["db2b757370a7c6a9","1be089caa70f7ecd"]}},"en":{"account_created":{"body":["61e284fded7d043c"],"subject":["070fe34cce4b6739"]},"order_received":{"body":["a94cc5354277fea6"],"subject":["6f1118c93ae504ed"]},"payment_reminder":{"body":["b38b9e6184082d77"],"subject":["1f862fe5125e8329"]},"payment_confirmed":{"body":["036d89e4a9375514"],"subject":["0e6d55a8a0732c56"]},"order_processing":{"body":["5becfb338752456c"],"subject":["cdefd042dd95a6b9"]},"order_completed":{"body":["82511debbd9bc129"],"subject":["a1722a02e0079575"]},"refund_issued":{"body":["aadc09fb3a6f47ae"],"subject":["f2c25f8be6f1a24c"]},"custom_message":{"body":["ddb14c456d7a4923"],"subject":["3683c9433ba177d4"]},"support_reply":{"body":["e21f0a5a13c2bac1"],"subject":["3c45c64c6e1457d8"]},"cart_reminder":{"body":["7a2916d997a3caef"],"subject":["c7b7429e0dbb8a3d"]},"price_drop":{"body":["e8de81a3458e7fc7"],"subject":["10658c1483f1f644"]},"review_request":{"body":["b27ce7fbd14c71c7"],"subject":["b8814658043af021"]},"launch_announcement":{"body":["2d08313ab72f9c2b"],"subject":["09c44a8ab8bea398"]},"gift_card":{"body":["8446ec35f0297e41"],"subject":["453af286fa5740ff"]},"login_otp":{"body":["db9520ab62fcbb26"],"subject":["1be089caa70f7ecd"]}},"de":{"account_created":{"body":["a16acdcb2b4ca8c7"],"subject":["77ee94ba672a9449"]},"order_received":{"body":["6eea40cac1f33d1e"],"subject":["2b6ec6cdb5caed26"]},"payment_reminder":{"body":["317e85eab440c78a"],"subject":["ae84f87d2241beca"]},"payment_confirmed":{"body":["6597799df390e7be"],"subject":["9f93cbc6ac369cb0"]},"order_processing":{"body":["7486eb0807af9015"],"subject":["1d2e95827dfe7604"]},"order_completed":{"body":["f4c93f4dd4da210d"],"subject":["edffb871478230f8"]},"refund_issued":{"body":["7ab493c8436ee037"],"subject":["dfdc8d5bbde14e8e"]},"custom_message":{"body":["b744c4047638d4fc"],"subject":["970666274d12617d"]},"support_reply":{"body":["0942934603c01842"],"subject":["ebba493caa7b0f95"]},"cart_reminder":{"body":["d710447428b56f76"],"subject":["728dfbaefc3874e8"]},"price_drop":{"body":["04bb9fe49d8acc89"],"subject":["fe118219a3e70f17"]},"review_request":{"body":["b571a5546a8e9fb7"],"subject":["b9af8e73bc604ea5"]},"launch_announcement":{"body":["c27376eb738c901e"],"subject":["83709444e872da91"]},"gift_card":{"body":["e30c2267bfc888fa"],"subject":["55290b9f8ee7d03f"]},"login_otp":{"body":["e781020ed5468aac"],"subject":["cdd6e9958ac1fa80"]}},"fr":{"account_created":{"body":["e00e10b25e89e868"],"subject":["775a113b533690d5"]},"order_received":{"body":["0488f5285152b0aa"],"subject":["c3b4d4f29124d092"]},"payment_reminder":{"body":["48217d1e546c2b3f"],"subject":["946d9368526d3e9d"]},"payment_confirmed":{"body":["05aed3b51db7599c"],"subject":["c8003e00227826b7"]},"order_processing":{"body":["a6ad4a52125f9227"],"subject":["89886d16dbe459c2"]},"order_completed":{"body":["42c4d4467e673600"],"subject":["e009fc10b9fcc2d9"]},"refund_issued":{"body":["e531187eb0782ff4"],"subject":["6f4b2e9e02769387"]},"custom_message":{"body":["9c856753ad707bd1"],"subject":["7ee743deaf99ea31"]},"support_reply":{"body":["85826ebdbc9ae7bc"],"subject":["01299ff4a22043fb"]},"cart_reminder":{"body":["be0e8cc7ed010864"],"subject":["f4bcbc7a12fb41ba"]},"price_drop":{"body":["4b23aae73690fa07"],"subject":["15add653a1716062"]},"review_request":{"body":["141c6a284b410572"],"subject":["cfb6edb7f2b1ec4b"]},"launch_announcement":{"body":["4b205147a72e7fb2"],"subject":["38f33447b56ae6a7"]},"gift_card":{"body":["e002dccbc5866f17"],"subject":["19834f212638005e"]},"login_otp":{"body":["b14b5de8328050fe"],"subject":["8c77203a2ee88d09"]}}};

/**
 * The comparison both upgrade paths use.
 *
 * Whitespace-insensitive, including BETWEEN tags and tokens: migration 011
 * wrote the payment reminder as one concatenated line, the defaults file has it
 * indented over ten, and a comparison that only collapsed runs of spaces called
 * them different — which is how the Dutch shop kept sending that one mail in
 * English.
 */
export function normalizeTemplate(s) {
  return String(s || '').replace(/(>|\}\})\s+(?=<|\{\{)/g, '$1').replace(/\s+/g, ' ').trim();
}
