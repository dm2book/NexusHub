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
      automatisch de deur uit; de rest leveren we met de hand, meestal binnen een paar uur.
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
      <h1>Je bestelling staat klaar — rond je betaling af</h1>
      <p>Hoi {{user.name}}, je hebt bestelling <strong>{{order.number}}</strong> geplaatst
      (totaal <strong>{{order.total}}</strong>), maar we hebben je betaling nog niet ontvangen.
      Je items staan nog voor je gereserveerd.</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p><a class="btn" href="{{order.url}}">Bestelling afronden</a></p>
      <p>Al betaald? Dan kun je deze mail negeren — een betaling kan een paar minuten duren
      voordat hij bevestigd is. Vragen? Beantwoord deze mail of open een ticket in onze Discord.</p>`,
  },
  {
    id: 'payment_confirmed',
    name: 'Payment Confirmed',
    subject: 'Betaling bevestigd voor {{order.number}} ✅',
    body_html: `
      <h1>Betaling ontvangen ✅</h1>
      <p>Hoi {{user.name}}, we hebben je betaling gekoppeld aan bestelling
      <strong>{{order.number}}</strong>. Jij hoeft niets meer te doen — we maken hem nu klaar.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><strong>Wat er nu gebeurt:</strong> wat we op voorraad hebben gaat binnen enkele
      minuten automatisch de deur uit. Wat we voor je inkopen leveren we met de hand, meestal
      binnen een paar uur overdag. Hoe dan ook: de code komt in deze inbox terecht.</p>
      <p><a class="btn" href="{{order.url}}">Volg je bestelling</a></p>
      <p style="color:#8b93a7;font-size:13px">Die pagina ververst zichzelf — geen account nodig,
      niet verversen. Ondertussen een vraag? Beantwoord deze mail gerust.</p>`,
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
      <p>Deze status betekent dat we je items met de hand klaarzetten. Overdag duurt dat meestal
      een paar uur; komt je bestelling buiten onze actieve uren binnen, dan gaat hij er meteen
      daarna uit.</p>
      <p><a class="btn" href="{{order.url}}">Volg je bestelling</a></p>
      <p style="color:#8b93a7;font-size:13px">Duurt het langer dan je verwachtte? Beantwoord deze mail
      of open een ticket in onze Discord — er antwoordt een echt mens, en we horen het liever te vroeg
      dan te laat.</p>`,
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
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Je loot staat klaar 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hoi {{user.name}} — je betaling is rond en alles hieronder is van jou. Pak het, spring erin en ga winnen. 🚀</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Overzicht van je bestelling</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">Bekijk je bestelling</a>
        </td>
      </tr></table>
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Klopt er iets niet? Beantwoord deze mail of open een ticket in onze Discord — echte mensen, snel antwoord. 💬</div>`,
  },
  {
    id: 'refund_issued',
    name: 'Refund Issued',
    subject: 'Terugbetaling voor {{order.number}} — {{refund.amount}}',
    body_html: `
      <h1>Je geld is onderweg terug ↩️</h1>
      <p>Hoi {{user.name}}, we hebben <strong>{{refund.amount}}</strong> terugbetaald voor bestelling
      <strong>{{order.number}}</strong>.</p>
      {{order.summaryHtml}}
      <p><strong>Wanneer je het ziet:</strong> een bankoverschrijving staat er meestal binnen 1–3 werkdagen op.
      Het komt terug op de rekening waarmee je betaalde. Betaalde je met tegoed, dan staat dat deel al
      terug in je saldo en kun je het meteen gebruiken.</p>
      <p><a class="btn" href="{{order.url}}">Bekijk deze bestelling</a></p>
      <p style="color:#8b93a7;font-size:13px">Niet wat je verwachtte, of na drie werkdagen nog niets binnen?
      Beantwoord deze mail met je bestelnummer en we gaan erachteraan.</p>`,
  },
  {
    id: 'custom_message',
    name: 'Message from Support',
    subject: '{{subject}} — bestelling {{order.number}}',
    body_html: `
      <h1>{{subject}}</h1>
      <p>Hoi {{user.name}}, dit gaat over je bestelling <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{message}}</div>
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
      <div class="quote">{{reply}}</div>
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
      nog in je winkelwagen bij {{brand.name}}. Het ligt er nog — haal het op voordat het weg is.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Bestelling afronden</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Geen account nodig, geen verborgen kosten. Vragen?
      Beantwoord deze mail of open een ticket in onze Discord.</p>`,
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
      enorm waarderen — het kost 20 seconden en helpt andere gamers met vertrouwen te kopen.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Schrijf een korte review</a></p>
      {{review.trustpilotHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Klopt er iets niet? Beantwoord deze mail of open
      een ticket in onze Discord, dan lossen we het op.</p>`,
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
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">💳 Waarde {{giftCard.amount}} · in seconden ingewisseld</span></p>
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
    subject: '{{otp.code}} is je inlogcode voor {{brand.name}}',
    body_html: `
      <div class="badge">🔐</div>
      <h1 style="text-align:center">Je inlogcode</h1>
      <p style="text-align:center;max-width:400px;margin-left:auto;margin-right:auto">Hoi <strong>{{user.name}}</strong>,
      welkom terug! Vul deze code in op het inlogscherm en je bent binnen.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">⏱ Verloopt over {{otp.ttl}} minuten · eenmalig te gebruiken</span></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Typ je hem op een ander apparaat over? De code is
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice">🛡️ <strong>Blijf veilig:</strong> {{brand.name}} vraagt je <strong>nooit</strong>
      om deze code — niet per e-mail, DM of telefoon. Probeerde jij niet in te loggen? Dan kun je deze mail
      gerust negeren; zonder de code kan niemand bij je account.</div>`,
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
