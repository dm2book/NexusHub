/**
 * The same thirteen emails, in the other three languages the shop speaks.
 *
 * defaultTemplates.js holds the Dutch set — the shop's own language, and the
 * fallback for anything not covered here. This file is what a buyer who read
 * the shop in English, German or French gets instead.
 *
 * Why it exists: a buyer chose a language, paid in it, and then received a
 * Dutch confirmation. Useless to them, and coming from a shop they had never
 * bought from before, indistinguishable from a phishing mail — which is the
 * version of this that costs the sale rather than an apology.
 *
 * Same ids, same tokens, same structure as the Dutch set. Only the prose
 * differs, so a template that gains a token gains it everywhere; the test
 * checks exactly that, because a mail that renders `{{order.url}}` as an empty
 * string in one language only is the kind of thing nobody sees until a buyer
 * cannot find their code.
 *
 * On the legal footnote: `{{order.consentHtml}}` and the redeem instructions
 * are generated server-side (see orderService.js and emailCopy.js), not
 * written here, so they follow the same language without being duplicated.
 */
export const TEMPLATE_TRANSLATIONS = {
  en: {
    account_created: {
      subject: 'Welcome to {{brand.name}} 🎉',
      body_html: `
      <h1>Welcome, {{user.name}}! 🎉</h1>
      <p>Your {{brand.name}} account is ready. You can now place orders, track
      deliveries, download invoices and manage everything from your dashboard.</p>
      <p><strong>No password to remember.</strong> Whenever you sign in we email
      you a fresh one-time code — and we keep you signed in on this device, so
      you won't have to do it often.</p>
      <p><a class="btn" href="{{app.url}}/account">Go to your dashboard</a></p>
      <p>Questions? Just reply to this email or open a ticket in our Discord. 💜</p>`,
    },
    order_received: {
      subject: 'Thanks for your order {{order.number}} 🎮',
      body_html: `
      <h1>Thank you for your order! 🎉</h1>
      <p>Hi {{user.name}}, thanks for shopping with {{brand.name}}! We've received
      order <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>).</p>
      {{order.itemsHtml}}
      {{order.needsFromBuyerHtml}}
      {{order.paymentHtml}}
      <p>As soon as we confirm your payment we deliver. Items we have in stock are
      sent automatically; anything else we deliver by hand, usually within a few hours.
      Follow the status here — no account needed:</p>
      <p><a class="btn" href="{{order.url}}">Track your order</a></p>
      <p>Need help? Just reply to this email or open a ticket in our Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_reminder: {
      subject: 'Your {{brand.name}} order {{order.number}} is waiting ⏳',
      body_html: `
      <h1>Your order is reserved — complete your payment</h1>
      <p>Hi {{user.name}}, we noticed you placed order <strong>{{order.number}}</strong>
      (total <strong>{{order.total}}</strong>) but we have not received your payment yet.
      Your items are still reserved for you.</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p><a class="btn" href="{{order.url}}">Complete your order</a></p>
      <p>Already paid? Then you can ignore this email — payments can take a few minutes
      to be confirmed. Questions? Just reply or open a ticket in our Discord.</p>`,
    },
    payment_confirmed: {
      subject: 'Payment confirmed for {{order.number}} ✅',
      body_html: `
      <h1>Payment received ✅</h1>
      <p>Hi {{user.name}}, we matched your payment to order <strong>{{order.number}}</strong>.
      Nothing left for you to do — we're preparing it now.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><strong>What happens next:</strong> items we have in stock are sent automatically
      within minutes. Anything we buy in for you is delivered by hand, usually within a few
      hours during the day. Either way the code lands in this same inbox.</p>
      <p><a class="btn" href="{{order.url}}">Follow your order</a></p>
      <p style="color:#8b93a7;font-size:13px">That page updates by itself — no account needed,
      no refreshing. Questions in the meantime? Just reply to this email.</p>`,
    },
    order_processing: {
      subject: 'Your order {{order.number}} is being prepared',
      body_html: `
      <h1>We're on it 🔧</h1>
      <p>Hi {{user.name}}, order <strong>{{order.number}}</strong> is being prepared right now.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p>This status means we're getting your items ready by hand. It usually takes a few hours
      during the day; if it lands outside our active hours it goes out first thing after.</p>
      <p><a class="btn" href="{{order.url}}">Follow your order</a></p>
      <p style="color:#8b93a7;font-size:13px">Taking longer than you expected? Reply to this email
      or open a ticket in our Discord — a real person answers, and we'd rather hear from you early.</p>`,
    },
    order_completed: {
      subject: 'Your order {{order.number}} is ready 🎮',
      body_html: `
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
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Something not right? Just reply to this email or open a ticket in our Discord — real humans, fast. 💬</div>`,
    },
    refund_issued: {
      subject: 'Refund issued for {{order.number}} — {{refund.amount}}',
      body_html: `
      <h1>Your refund is on the way ↩️</h1>
      <p>Hi {{user.name}}, we've refunded <strong>{{refund.amount}}</strong> for order
      <strong>{{order.number}}</strong>.</p>
      {{order.summaryHtml}}
      <p><strong>When you'll see it:</strong> bank transfers usually land within 1–3 working days.
      It comes back to the account you paid from. If you paid with store credit, that part is
      already back in your balance and ready to use.</p>
      <p><a class="btn" href="{{order.url}}">View this order</a></p>
      <p style="color:#8b93a7;font-size:13px">Not what you expected, or nothing arrived after
      three working days? Reply to this email with your order number and we'll chase it.</p>`,
    },
    custom_message: {
      subject: '{{subject}} — order {{order.number}}',
      body_html: `
      <h1>{{subject}}</h1>
      <p>Hi {{user.name}}, this is about your order <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{message}}</div>
      <p><a class="btn" href="{{order.url}}">View your order</a></p>
      <p style="color:#8b93a7;font-size:13px">You can reply straight to this email — it reaches
      the same person who sent it. Prefer chat? Our Discord ticket is linked at the bottom.</p>`,
    },
    support_reply: {
      subject: 'Re: {{ticket.subject}} · ticket {{ticket.number}}',
      body_html: `
      <h1>We replied to your ticket</h1>
      <p>Hi <strong>{{user.name}}</strong>, someone from the shop answered ticket
      <strong>{{ticket.number}}</strong>{{ticket.orderLine}}:</p>
      <div class="quote">{{reply}}</div>
      <p><a class="btn" href="{{ticket.url}}">Read the whole thread</a></p>
      <p style="color:#8b93a7;font-size:13px">Reply straight to this email and it lands back on the
      same ticket — no account needed.</p>`,
    },
    cart_reminder: {
      subject: 'You left something in your cart 🛒',
      body_html: `
      <div class="badge">🛒</div>
      <h1 style="text-align:center">Still thinking it over?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, you left these
      in your cart at {{brand.name}}. They're still here — grab them before they're gone.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Complete your order</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">No account needed, no hidden fees. Questions? Just reply
      to this email or open a ticket in our Discord.</p>`,
    },
    review_request: {
      subject: 'How was your order {{order.number}}? ⭐',
      body_html: `
      <div class="badge">⭐</div>
      <h1 style="text-align:center">How did we do?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, thanks again
      for your order <strong>{{order.number}}</strong>! If everything arrived as expected, a quick review would
      mean the world — it takes 20 seconds and helps other gamers buy with confidence.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Leave a quick review</a></p>
      {{review.trustpilotHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Something not right? Just reply to this email or open
      a ticket in our Discord and we'll make it right.</p>`,
    },
    gift_card: {
      subject: 'You received a {{giftCard.amount}} {{brand.name}} gift card 🎁',
      body_html: `
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
      Redeemable once, on any order.</div>`,
    },
    login_otp: {
      subject: '{{otp.code}} is your {{brand.name}} login code',
      body_html: `
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
      this email; without the code nobody can access your account.</div>`,
    },
  },
  de: {
    account_created: {
      subject: 'Willkommen bei {{brand.name}} 🎉',
      body_html: `
      <h1>Willkommen, {{user.name}}! 🎉</h1>
      <p>Dein {{brand.name}}-Konto ist bereit. Du kannst jetzt bestellen, Lieferungen
      verfolgen, Rechnungen herunterladen und alles über dein Dashboard verwalten.</p>
      <p><strong>Kein Passwort zum Merken.</strong> Bei jeder Anmeldung mailen wir dir
      einen frischen Einmalcode — und auf diesem Gerät bleibst du angemeldet, du wirst
      es also selten brauchen.</p>
      <p><a class="btn" href="{{app.url}}/account">Zu deinem Dashboard</a></p>
      <p>Fragen? Antworte einfach auf diese Mail oder öffne ein Ticket auf unserem Discord. 💜</p>`,
    },
    order_received: {
      subject: 'Danke für deine Bestellung {{order.number}} 🎮',
      body_html: `
      <h1>Danke für deine Bestellung! 🎉</h1>
      <p>Hallo {{user.name}}, danke für deinen Einkauf bei {{brand.name}}. Wir haben
      Bestellung <strong>{{order.number}}</strong> erhalten (Gesamt <strong>{{order.total}}</strong>).</p>
      {{order.itemsHtml}}
      {{order.needsFromBuyerHtml}}
      {{order.paymentHtml}}
      <p>Sobald deine Zahlung bestätigt ist, liefern wir. Was wir auf Lager haben, geht
      automatisch raus; den Rest liefern wir von Hand, meistens innerhalb weniger Stunden.
      Den Status verfolgst du hier — ohne Konto:</p>
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p>Hilfe nötig? Antworte auf diese Mail oder öffne ein Ticket auf unserem Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_reminder: {
      subject: 'Deine {{brand.name}}-Bestellung {{order.number}} wartet noch ⏳',
      body_html: `
      <h1>Deine Bestellung ist reserviert — schließ die Zahlung ab</h1>
      <p>Hallo {{user.name}}, du hast Bestellung <strong>{{order.number}}</strong> aufgegeben
      (Gesamt <strong>{{order.total}}</strong>), aber deine Zahlung ist noch nicht bei uns.
      Deine Artikel sind weiterhin für dich reserviert.</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p><a class="btn" href="{{order.url}}">Bestellung abschließen</a></p>
      <p>Schon bezahlt? Dann kannst du diese Mail ignorieren — eine Zahlung braucht manchmal
      ein paar Minuten bis zur Bestätigung. Fragen? Antworte auf diese Mail oder öffne ein
      Ticket auf unserem Discord.</p>`,
    },
    payment_confirmed: {
      subject: 'Zahlung bestätigt für {{order.number}} ✅',
      body_html: `
      <h1>Zahlung eingegangen ✅</h1>
      <p>Hallo {{user.name}}, wir haben deine Zahlung der Bestellung
      <strong>{{order.number}}</strong> zugeordnet. Für dich gibt es nichts mehr zu tun —
      wir machen sie gerade fertig.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><strong>Was jetzt passiert:</strong> was wir auf Lager haben, geht innerhalb weniger
      Minuten automatisch raus. Was wir für dich einkaufen, liefern wir von Hand, tagsüber
      meistens innerhalb weniger Stunden. So oder so landet der Code in genau diesem Postfach.</p>
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p style="color:#8b93a7;font-size:13px">Diese Seite aktualisiert sich selbst — kein Konto
      nötig, kein Neuladen. Zwischendurch eine Frage? Antworte einfach auf diese Mail.</p>`,
    },
    order_processing: {
      subject: 'Deine Bestellung {{order.number}} wird vorbereitet',
      body_html: `
      <h1>Wir sind dran 🔧</h1>
      <p>Hallo {{user.name}}, Bestellung <strong>{{order.number}}</strong> wird gerade vorbereitet.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p>Dieser Status heißt, dass wir deine Artikel von Hand fertig machen. Tagsüber dauert das
      meistens ein paar Stunden; kommt deine Bestellung außerhalb unserer aktiven Zeiten rein,
      geht sie gleich danach raus.</p>
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p style="color:#8b93a7;font-size:13px">Dauert es länger als gedacht? Antworte auf diese Mail
      oder öffne ein Ticket auf unserem Discord — es antwortet ein echter Mensch, und wir hören
      lieber zu früh von dir als zu spät.</p>`,
    },
    order_completed: {
      subject: 'Deine Bestellung {{order.number}} ist fertig 🎮',
      body_html: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Geliefert</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Bestellung {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Dein Loot ist da 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hallo {{user.name}} — die Zahlung ist durch und alles hier unten gehört dir. Schnapp es dir, spring rein und gewinn. 🚀</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Übersicht deiner Bestellung</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">Bestellung ansehen</a>
        </td>
      </tr></table>
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Stimmt etwas nicht? Antworte auf diese Mail oder öffne ein Ticket auf unserem Discord — echte Menschen, schnelle Antwort. 💬</div>`,
    },
    refund_issued: {
      subject: 'Erstattung für {{order.number}} — {{refund.amount}}',
      body_html: `
      <h1>Dein Geld ist auf dem Rückweg ↩️</h1>
      <p>Hallo {{user.name}}, wir haben <strong>{{refund.amount}}</strong> für Bestellung
      <strong>{{order.number}}</strong> erstattet.</p>
      {{order.summaryHtml}}
      <p><strong>Wann du es siehst:</strong> eine Banküberweisung ist meistens innerhalb von
      1–3 Werktagen da. Es geht zurück auf das Konto, mit dem du bezahlt hast. Hast du mit
      Guthaben bezahlt, ist dieser Teil schon wieder in deinem Guthaben und sofort nutzbar.</p>
      <p><a class="btn" href="{{order.url}}">Diese Bestellung ansehen</a></p>
      <p style="color:#8b93a7;font-size:13px">Nicht wie erwartet, oder nach drei Werktagen noch
      nichts da? Antworte auf diese Mail mit deiner Bestellnummer und wir gehen dem nach.</p>`,
    },
    custom_message: {
      subject: '{{subject}} — Bestellung {{order.number}}',
      body_html: `
      <h1>{{subject}}</h1>
      <p>Hallo {{user.name}}, hier geht es um deine Bestellung <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{message}}</div>
      <p><a class="btn" href="{{order.url}}">Bestellung ansehen</a></p>
      <p style="color:#8b93a7;font-size:13px">Du kannst direkt auf diese Mail antworten — sie
      landet bei derselben Person, die sie geschrieben hat. Lieber chatten? Der Discord-Link
      steht unten.</p>`,
    },
    support_reply: {
      subject: 'Re: {{ticket.subject}} · Ticket {{ticket.number}}',
      body_html: `
      <h1>Wir haben auf dein Ticket geantwortet</h1>
      <p>Hallo <strong>{{user.name}}</strong>, jemand aus dem Shop hat Ticket
      <strong>{{ticket.number}}</strong>{{ticket.orderLine}} beantwortet:</p>
      <div class="quote">{{reply}}</div>
      <p><a class="btn" href="{{ticket.url}}">Den ganzen Verlauf lesen</a></p>
      <p style="color:#8b93a7;font-size:13px">Antworte direkt auf diese Mail — deine Nachricht
      landet wieder auf demselben Ticket, ohne Konto.</p>`,
    },
    cart_reminder: {
      subject: 'Du hast etwas im Warenkorb liegen lassen 🛒',
      body_html: `
      <div class="badge">🛒</div>
      <h1 style="text-align:center">Noch am Überlegen?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hallo {{user.name}},
      das hier lag noch in deinem Warenkorb bei {{brand.name}}. Es ist noch da — hol es dir,
      bevor es weg ist.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Bestellung abschließen</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Kein Konto nötig, keine versteckten
      Kosten. Fragen? Antworte auf diese Mail oder öffne ein Ticket auf unserem Discord.</p>`,
    },
    review_request: {
      subject: 'Wie war deine Bestellung {{order.number}}? ⭐',
      body_html: `
      <div class="badge">⭐</div>
      <h1 style="text-align:center">Wie haben wir uns geschlagen?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hallo {{user.name}},
      nochmals danke für Bestellung <strong>{{order.number}}</strong>! Wenn alles wie erwartet ankam,
      würden wir uns über eine kurze Bewertung sehr freuen — sie dauert 20 Sekunden und hilft anderen
      Gamern, mit gutem Gefühl zu kaufen.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Kurze Bewertung schreiben</a></p>
      {{review.trustpilotHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Stimmt etwas nicht? Antworte auf diese
      Mail oder öffne ein Ticket auf unserem Discord, dann bringen wir das in Ordnung.</p>`,
    },
    gift_card: {
      subject: 'Du hast einen {{brand.name}}-Gutschein über {{giftCard.amount}} bekommen 🎁',
      body_html: `
      <div class="badge">🎁</div>
      <h1 style="text-align:center">Du hast einen Gutschein!</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Jemand hat dir
      <strong>{{giftCard.amount}}</strong> geschickt, die du bei {{brand.name}} für Robux, V-Bucks,
      Guthabenkarten und mehr ausgeben kannst.</p>
      <p class="code">{{giftCard.code}}</p>
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">💳 Wert {{giftCard.amount}} · in Sekunden eingelöst</span></p>
      {{giftCard.noteHtml}}
      <p style="text-align:center"><a class="btn" href="{{app.url}}/account">Gutschein einlösen</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Melde dich an (oder erstell ein kostenloses
      Konto), öffne <strong>Wallet</strong> und füg den Code oben ein — das Guthaben landet in deinem
      Konto und wird an der Kasse automatisch verrechnet.</p>
      <div class="notice">🔒 <strong>Behalte diesen Code für dich.</strong> Wer ihn hat, kann das
      Guthaben einlösen. Einmal verwendbar, für jede Bestellung.</div>`,
    },
    login_otp: {
      subject: '{{otp.code}} ist dein Anmeldecode für {{brand.name}}',
      body_html: `
      <div class="badge">🔐</div>
      <h1 style="text-align:center">Dein Anmeldecode</h1>
      <p style="text-align:center;max-width:400px;margin-left:auto;margin-right:auto">Hallo <strong>{{user.name}}</strong>,
      willkommen zurück! Gib diesen Code im Anmeldefenster ein und du bist drin.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">⏱ Läuft in {{otp.ttl}} Minuten ab · einmal verwendbar</span></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Tippst du ihn auf einem anderen Gerät ab? Der Code ist
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice">🛡️ <strong>Bleib sicher:</strong> {{brand.name}} fragt dich <strong>nie</strong>
      nach diesem Code — weder per E-Mail noch per DM oder Telefon. Wolltest du dich gar nicht anmelden? Dann kannst
      du diese Mail ruhig ignorieren; ohne den Code kommt niemand an dein Konto.</div>`,
    },
  },
  fr: {
    account_created: {
      subject: 'Bienvenue chez {{brand.name}} 🎉',
      body_html: `
      <h1>Bienvenue, {{user.name}} ! 🎉</h1>
      <p>Ton compte {{brand.name}} est prêt. Tu peux maintenant commander, suivre tes
      livraisons, télécharger tes factures et tout gérer depuis ton tableau de bord.</p>
      <p><strong>Aucun mot de passe à retenir.</strong> À chaque connexion nous t’envoyons
      un nouveau code à usage unique — et sur cet appareil tu restes connecté, tu n’auras
      donc pas souvent à le faire.</p>
      <p><a class="btn" href="{{app.url}}/account">Aller à mon tableau de bord</a></p>
      <p>Des questions ? Réponds simplement à cet e-mail ou ouvre un ticket sur notre Discord. 💜</p>`,
    },
    order_received: {
      subject: 'Merci pour ta commande {{order.number}} 🎮',
      body_html: `
      <h1>Merci pour ta commande ! 🎉</h1>
      <p>Bonjour {{user.name}}, merci pour ton achat chez {{brand.name}}. Nous avons bien reçu
      la commande <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>).</p>
      {{order.itemsHtml}}
      {{order.needsFromBuyerHtml}}
      {{order.paymentHtml}}
      <p>Dès que ton paiement est confirmé, nous livrons. Ce que nous avons en stock part
      automatiquement ; le reste, nous le livrons à la main, en général en quelques heures.
      Suis le statut ici — sans compte :</p>
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p>Besoin d’aide ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_reminder: {
      subject: 'Ta commande {{brand.name}} {{order.number}} attend encore ⏳',
      body_html: `
      <h1>Ta commande est réservée — termine ton paiement</h1>
      <p>Bonjour {{user.name}}, tu as passé la commande <strong>{{order.number}}</strong>
      (total <strong>{{order.total}}</strong>), mais nous n’avons pas encore reçu ton paiement.
      Tes articles restent réservés pour toi.</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p><a class="btn" href="{{order.url}}">Terminer ma commande</a></p>
      <p>Déjà payé ? Alors tu peux ignorer cet e-mail — un paiement met parfois quelques minutes
      à être confirmé. Des questions ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>`,
    },
    payment_confirmed: {
      subject: 'Paiement confirmé pour {{order.number}} ✅',
      body_html: `
      <h1>Paiement reçu ✅</h1>
      <p>Bonjour {{user.name}}, nous avons rattaché ton paiement à la commande
      <strong>{{order.number}}</strong>. Tu n’as plus rien à faire — nous la préparons.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><strong>Ce qui se passe maintenant :</strong> ce que nous avons en stock part
      automatiquement en quelques minutes. Ce que nous achetons pour toi, nous le livrons à la
      main, en général en quelques heures en journée. Dans les deux cas, le code arrive dans
      cette même boîte mail.</p>
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p style="color:#8b93a7;font-size:13px">Cette page se met à jour toute seule — pas de compte,
      pas besoin de rafraîchir. Une question entre-temps ? Réponds simplement à cet e-mail.</p>`,
    },
    order_processing: {
      subject: 'Ta commande {{order.number}} est en préparation',
      body_html: `
      <h1>On s’en occupe 🔧</h1>
      <p>Bonjour {{user.name}}, la commande <strong>{{order.number}}</strong> est en préparation.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p>Ce statut veut dire que nous préparons tes articles à la main. En journée, cela prend
      normalement quelques heures ; si ta commande arrive en dehors de nos heures actives, elle
      part juste après.</p>
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p style="color:#8b93a7;font-size:13px">Cela prend plus de temps que prévu ? Réponds à cet
      e-mail ou ouvre un ticket sur notre Discord — une vraie personne répond, et nous préférons
      avoir de tes nouvelles trop tôt que trop tard.</p>`,
    },
    order_completed: {
      subject: 'Ta commande {{order.number}} est prête 🎮',
      body_html: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Livrée</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Commande {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Ton loot est prêt 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Bonjour {{user.name}} — le paiement est passé et tout ce qui suit est à toi. Prends-le, lance-toi et gagne. 🚀</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Récapitulatif de ta commande</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">Voir ma commande</a>
        </td>
      </tr></table>
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Quelque chose ne va pas ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord — de vraies personnes, vite. 💬</div>`,
    },
    refund_issued: {
      subject: 'Remboursement pour {{order.number}} — {{refund.amount}}',
      body_html: `
      <h1>Ton argent est en route ↩️</h1>
      <p>Bonjour {{user.name}}, nous avons remboursé <strong>{{refund.amount}}</strong> pour la
      commande <strong>{{order.number}}</strong>.</p>
      {{order.summaryHtml}}
      <p><strong>Quand tu le verras :</strong> un virement bancaire arrive en général sous 1 à 3
      jours ouvrés. Il revient sur le compte avec lequel tu as payé. Si tu as payé avec ton crédit
      boutique, cette partie est déjà de retour dans ton solde et utilisable tout de suite.</p>
      <p><a class="btn" href="{{order.url}}">Voir cette commande</a></p>
      <p style="color:#8b93a7;font-size:13px">Ce n’est pas ce que tu attendais, ou toujours rien
      après trois jours ouvrés ? Réponds à cet e-mail avec ton numéro de commande et nous
      relançons.</p>`,
    },
    custom_message: {
      subject: '{{subject}} — commande {{order.number}}',
      body_html: `
      <h1>{{subject}}</h1>
      <p>Bonjour {{user.name}}, il s’agit de ta commande <strong>{{order.number}}</strong> :</p>
      <div class="quote">{{message}}</div>
      <p><a class="btn" href="{{order.url}}">Voir ma commande</a></p>
      <p style="color:#8b93a7;font-size:13px">Tu peux répondre directement à cet e-mail — il arrive
      chez la même personne qui l’a écrit. Tu préfères discuter ? Le lien Discord est en bas.</p>`,
    },
    support_reply: {
      subject: 'Re : {{ticket.subject}} · ticket {{ticket.number}}',
      body_html: `
      <h1>Nous avons répondu à ton ticket</h1>
      <p>Bonjour <strong>{{user.name}}</strong>, quelqu’un de la boutique a répondu au ticket
      <strong>{{ticket.number}}</strong>{{ticket.orderLine}} :</p>
      <div class="quote">{{reply}}</div>
      <p><a class="btn" href="{{ticket.url}}">Lire toute la conversation</a></p>
      <p style="color:#8b93a7;font-size:13px">Réponds directement à cet e-mail — ton message revient
      sur le même ticket, sans compte.</p>`,
    },
    cart_reminder: {
      subject: 'Tu as laissé quelque chose dans ton panier 🛒',
      body_html: `
      <div class="badge">🛒</div>
      <h1 style="text-align:center">Encore en train d’hésiter ?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Bonjour {{user.name}},
      ceci était encore dans ton panier chez {{brand.name}}. C’est toujours là — attrape-le avant qu’il
      ne parte.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Terminer ma commande</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Pas besoin de compte, aucun frais caché.
      Des questions ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>`,
    },
    review_request: {
      subject: 'Comment s’est passée ta commande {{order.number}} ? ⭐',
      body_html: `
      <div class="badge">⭐</div>
      <h1 style="text-align:center">On s’en est sortis comment ?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Bonjour {{user.name}},
      merci encore pour la commande <strong>{{order.number}}</strong> ! Si tout est bien arrivé, un court avis
      nous ferait énormément plaisir — cela prend 20 secondes et aide d’autres joueurs à acheter en confiance.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Laisser un court avis</a></p>
      {{review.trustpilotHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Quelque chose ne va pas ? Réponds à cet e-mail
      ou ouvre un ticket sur notre Discord, et nous arrangerons ça.</p>`,
    },
    gift_card: {
      subject: 'Tu as reçu une carte cadeau {{brand.name}} de {{giftCard.amount}} 🎁',
      body_html: `
      <div class="badge">🎁</div>
      <h1 style="text-align:center">Tu as une carte cadeau !</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Quelqu’un t’a envoyé
      <strong>{{giftCard.amount}}</strong> à dépenser chez {{brand.name}} en Robux, V-Bucks, cartes cadeaux
      et plus encore.</p>
      <p class="code">{{giftCard.code}}</p>
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">💳 Valeur {{giftCard.amount}} · utilisable en quelques secondes</span></p>
      {{giftCard.noteHtml}}
      <p style="text-align:center"><a class="btn" href="{{app.url}}/account">Utiliser ma carte cadeau</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Connecte-toi (ou crée un compte gratuit), ouvre
      <strong>Wallet</strong> et colle le code ci-dessus — le montant arrive dans ton crédit boutique et se
      déduit automatiquement au paiement.</p>
      <div class="notice">🔒 <strong>Garde ce code pour toi.</strong> Toute personne qui l’a peut utiliser
      le solde. Utilisable une seule fois, sur n’importe quelle commande.</div>`,
    },
    login_otp: {
      subject: '{{otp.code}} est ton code de connexion {{brand.name}}',
      body_html: `
      <div class="badge">🔐</div>
      <h1 style="text-align:center">Ton code de connexion</h1>
      <p style="text-align:center;max-width:400px;margin-left:auto;margin-right:auto">Bonjour <strong>{{user.name}}</strong>,
      content de te revoir ! Saisis ce code sur l’écran de connexion et tu es dedans.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">⏱ Expire dans {{otp.ttl}} minutes · à usage unique</span></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Tu le recopies sur un autre appareil ? Le code est
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice">🛡️ <strong>Reste prudent :</strong> {{brand.name}} ne te demandera <strong>jamais</strong>
      ce code — ni par e-mail, ni en message privé, ni par téléphone. Tu n’as pas essayé de te connecter ? Tu peux
      ignorer cet e-mail sans souci ; sans le code, personne ne peut accéder à ton compte.</div>`,
    },
  },
};
