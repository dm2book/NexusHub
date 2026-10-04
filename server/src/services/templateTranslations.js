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
      sent automatically; anything else we deliver by hand.
      Follow the status here — no account needed:</p>
      <p><a class="btn" href="{{order.url}}">Track your order</a></p>
      <p>Need help? Just reply to this email or open a ticket in our Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_reminder: {
      subject: 'Your {{brand.name}} order {{order.number}} is waiting ⏳',
      body_html: `
      <h1>Your order is waiting for your payment</h1>
      <p>Hi {{user.name}}, you placed order <strong>{{order.number}}</strong>
      (total <strong>{{order.total}}</strong>) but we have not received your payment yet.
      Your order stays open for {{order.openDays}} days after you placed it; if no payment arrives
      in that time, we cancel it automatically.</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p><a class="btn" href="{{order.url}}">Complete your order</a></p>
      <p>Already paid? Then you can ignore this email — a payment can take a little while
      to be confirmed. Questions? Just reply or open a ticket in our Discord.</p>`,
    },
    payment_confirmed: {
      subject: 'Payment confirmed for {{order.number}} ✅',
      body_html: `
      <h1>Payment received ✅</h1>
      <p>Hi {{user.name}}, we matched your payment to order <strong>{{order.number}}</strong>.
      We're preparing it now.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><strong>What happens next:</strong> items we have in stock are sent automatically.
      Anything we buy in for you is delivered by hand.
      Either way the delivery lands in this same inbox.</p>
      <p><a class="btn" href="{{order.url}}">Follow your order</a></p>
      <p style="color:#8b93a7;font-size:13px">That page updates by itself — no account needed.
      Questions in the meantime? Just reply to this email.</p>
      {{order.invoiceHtml}}
      {{order.consentHtml}}`,
    },
    order_processing: {
      subject: 'Your order {{order.number}} is being prepared',
      body_html: `
      <h1>We're on it 🔧</h1>
      <p>Hi {{user.name}}, order <strong>{{order.number}}</strong> is being prepared right now.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p>This status means we're getting your items ready by hand. You'll get an email as soon as
      it's delivered; you can always follow the status with the button below.</p>
      <p><a class="btn" href="{{order.url}}">Follow your order</a></p>
      <p style="color:#8b93a7;font-size:13px">Taking longer than you expected? Reply to this email
      or open a ticket in our Discord — we'd rather hear from you early.</p>`,
    },
    order_completed: {
      subject: 'Your order {{order.number}} is ready 🎮',
      body_html: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Delivered</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Order {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Your order is ready 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hi {{user.name}} — your payment is complete and below is what you ordered.</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Order summary</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" bgcolor="#7c5cff" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">View your order</a>
        </td>
      </tr></table>
      {{order.invoiceHtml}}
      {{order.reviewAskHtml}}
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Something not right? Just reply to this email or open a ticket in our Discord. 💬</div>
      {{order.consentHtml}}`,
    },
    refund_issued: {
      subject: 'Refund issued for {{order.number}} — {{refund.amount}}',
      body_html: `
      <h1>Your refund has been processed ↩️</h1>
      <p>Hi {{user.name}}, we've refunded <strong>{{refund.amount}}</strong> for order
      <strong>{{order.number}}</strong>.</p>
      {{refund.detailsHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">View this order</a></p>
      <p style="color:#8b93a7;font-size:13px">Not what you expected, or nothing arrived after a few
      working days? Reply to this email with your order number and we'll chase it.</p>`,
    },
    custom_message: {
      subject: '{{subject}} — order {{order.number}}',
      body_html: `
      <h1>{{subject}}</h1>
      <p>Hi {{user.name}}, this is about your order <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{messageHtml}}</div>
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
      <div class="quote">{{replyHtml}}</div>
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
      in your cart at {{brand.name}}. Your cart is saved if you want to pick up where you left off.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Go to your cart</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Questions? Just reply to this email or open a ticket in our Discord.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px">No more reminders? <a href="{{unsubscribe.url}}" style="color:#8b93a7">Unsubscribe</a></p>`,
    },
    price_drop: {
      subject: '{{product.name}} is now {{price.current}} \u{1F4C9}',
      body_html: `
      <div class="badge">\u{1F4C9}</div>
      <h1 style="text-align:center">Price drop on your wishlist</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, <strong>{{product.name}}</strong> just got cheaper.</p>
      <p style="text-align:center;font-size:15px;margin:18px 0 4px">
        <span style="color:#8b93a7;text-decoration:line-through">{{price.previous}}</span>
        &nbsp;→&nbsp;<strong style="font-size:22px">{{price.current}}</strong></p>
      <p style="text-align:center;margin:0 0 18px"><span class="pill-note">{{price.diff}} cheaper</span></p>
      <p style="text-align:center"><a class="btn" href="{{product.url}}">View the product</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">You saved this at {{price.saved}}.
      <a href="{{wishlist.url}}" style="color:#8b93a7">Go to your wishlist</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:12px;margin-top:22px">You are getting this because you turned on a price alert.
      <a href="{{wishlist.alertsOffUrl}}" style="color:#8b93a7">Turn off all price alerts</a></p>`,
    },
    review_request: {
      subject: 'How was your order {{order.number}}? ⭐',
      body_html: `
      <div class="badge">⭐</div>
      <h1 style="text-align:center">How did we do?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, thanks again
      for your order <strong>{{order.number}}</strong>! If everything arrived as expected, we would appreciate a short
      review — it helps other gamers decide whether to buy from us.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Leave a short review</a></p>
      {{review.trustpilotHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Something not right? Just reply to this email or open
      a ticket in our Discord and we'll look into it.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px">Rather not get review requests?
      <a href="{{unsubscribe.url}}" style="color:#8b93a7">Turn them off</a></p>`,
    },
    launch_announcement: {
      subject: '{{shop.name}} is open \u{1F680}',
      body_html: `
      <div class="badge">\u{1F680}</div>
      <h1 style="text-align:center">We're open</h1>
      <p style="text-align:center;max-width:440px;margin-left:auto;margin-right:auto">You asked us to let you know
      when {{shop.name}} opened. It has — the shop is live and you can order.</p>
      <p style="text-align:center"><a class="btn" href="{{shop.url}}/shop">Open the shop</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">In stock goes out automatically; everything else by
      hand. You pay after ordering.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px;margin-top:22px">You are getting this because you
      signed up. <a href="{{unsubscribe.url}}" style="color:#8b93a7">Unsubscribe</a></p>`,
    },
    gift_card: {
      subject: 'You received a {{giftCard.amount}} {{brand.name}} gift card 🎁',
      body_html: `
      <div class="badge">🎁</div>
      <h1 style="text-align:center">You've got a gift card!</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Someone sent you
      <strong>{{giftCard.amount}}</strong> to spend at {{brand.name}} on Robux, V-Bucks, gift cards and more.</p>
      <p class="code">{{giftCard.code}}</p>
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">💳 Worth {{giftCard.amount}} · redeemable once</span></p>
      {{giftCard.noteHtml}}
      <p style="text-align:center"><a class="btn" href="{{app.url}}/account">Redeem your gift card</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Sign in (or create a free account), open
      <strong>Wallet</strong> and paste the code above — the balance lands in your store credit and applies
      automatically at checkout.</p>
      <div class="notice">🔒 <strong>Keep this code private.</strong> Anyone with it can redeem the balance.
      Redeemable once, on any order.</div>`,
    },
    login_otp: {
      subject: 'Your {{brand.name}} login code',
      body_html: `
      <div class="badge">🔐</div>
      <h1 style="text-align:center">Your login code</h1>
      <p style="text-align:center;max-width:400px;margin-left:auto;margin-right:auto">Enter this code on the
      {{brand.name}} login screen.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">⏱ Expires in {{otp.ttl}} minutes · one-time use</span></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Typing on another device? The code is
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice">🛡️ <strong>Only enter this code on {{app.host}}.</strong> {{brand.name}} will
      <strong>never</strong> ask you for this code — not by email, DM or phone. Didn't try to sign in? You can
      safely ignore this email; without the code nobody can access your account.</div>`,
    },
    security_alert: {
      subject: 'New sign-in to your {{brand.name}} account',
      body_html: `
      <div class="badge">🛡️</div>
      <h1 style="text-align:center">New sign-in to your account</h1>
      <p>Hi {{user.name}}, someone just signed in to your {{brand.name}} account from a device or
      location we had not seen before.</p>
      <div class="quote">{{login.detailsHtml}}</div>
      <p><strong>Was this you?</strong> Then there is nothing to do.</p>
      <p><strong>Wasn't you?</strong> Sign the device out in your security settings and reply to this
      email, and we will look into it with you.</p>
      <p><a class="btn" href="{{app.url}}/account/settings">Go to your security settings</a></p>`,
    },
    order_cancelled: {
      subject: 'Your order {{order.number}} has been cancelled',
      body_html: `
      <h1>Your order has been cancelled</h1>
      <p>Hi {{user.name}}, order <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>)
      has been cancelled.</p>
      {{cancel.reasonHtml}}
      {{order.summaryHtml}}
      <p>Still want it? You can place a new order any time.</p>
      <p><a class="btn" href="{{app.url}}/shop">Go to the shop</a></p>
      <p style="color:#8b93a7;font-size:13px">Had you already paid, or does this look wrong? Reply to this
      email with your order number and we will look into it.</p>`,
    },
    order_on_hold: {
      subject: 'Your order {{order.number}}: payment received, one more check',
      body_html: `
      <h1>Payment received — one more check</h1>
      <p>Hi {{user.name}}, we have received your payment for order <strong>{{order.number}}</strong>.</p>
      <p>Before we deliver, one of us takes a quick look at this order. We do this for a share of orders,
      among other things to prevent misuse of payment details. There is nothing you need to do; if we need
      anything from you, we will email you.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><a class="btn" href="{{order.url}}">Follow your order</a></p>
      <p style="color:#8b93a7;font-size:13px">Questions? Reply to this email.</p>
      {{order.consentHtml}}`,
    },
    payment_not_verified: {
      subject: 'We could not find your payment for {{order.number}} yet',
      body_html: `
      <h1>We could not find your payment yet</h1>
      <p>Hi {{user.name}}, you sent a proof of payment for order <strong>{{order.number}}</strong>,
      but we could not match that payment yet.</p>
      {{proof.reasonHtml}}
      <p>Please check the amount (<strong>{{order.total}}</strong>) and that your order number was used as
      the reference, then resubmit your proof.</p>
      <p><a class="btn" href="{{order.url}}">Resubmit your proof</a></p>
      <p style="color:#8b93a7;font-size:13px">Sure it is right? Reply to this email with a screenshot of the
      payment and we will check it.</p>`,
    },
    refund_request_received: {
      subject: 'We received your refund request for {{order.number}}',
      body_html: `
      <h1>Your request is in</h1>
      <p>Hi {{user.name}}, we received your refund request for order
      <strong>{{order.number}}</strong>. One of us will review it and you will hear our decision by email.</p>
      {{request.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">View your order</a></p>
      <p style="color:#8b93a7;font-size:13px">Want to add something? Reply to this email.</p>`,
    },
    refund_request_rejected: {
      subject: 'Your refund request for {{order.number}}',
      body_html: `
      <h1>We cannot grant this request</h1>
      <p>Hi {{user.name}}, we reviewed your refund request for order
      <strong>{{order.number}}</strong> and cannot grant it.</p>
      {{request.reasonHtml}}
      <p>Disagree, or did we miss something? Reply to this email with what is going on — someone will
      look at it again. The withdrawal and refunds page explains when you are entitled to your money back.</p>
      <p><a class="btn" href="{{app.url}}/refunds">Withdrawal &amp; refunds</a></p>`,
    },
    ticket_opened: {
      subject: 'We received your ticket · {{ticket.number}}',
      body_html: `
      <h1>We received your message</h1>
      <p>Hi {{user.name}}, your ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}} is with us.
      You will get our answer by email.</p>
      <div class="quote">{{ticket.subject}}</div>
      <p><a class="btn" href="{{ticket.url}}">View your ticket</a></p>
      <p style="color:#8b93a7;font-size:13px">Want to add something? Just reply to this email.</p>`,
    },
    newsletter_confirm: {
      subject: 'Confirm your sign-up at {{brand.name}}',
      body_html: `
      <div class="badge">✉️</div>
      <h1 style="text-align:center">Confirm your sign-up</h1>
      <p style="text-align:center;max-width:440px;margin-left:auto;margin-right:auto">This address was entered
      to receive messages from {{brand.name}}. We only send you anything once you confirm below.</p>
      <p style="text-align:center"><a class="btn" href="{{newsletter.confirmUrl}}">Yes, confirm my sign-up</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Not you? Just ignore this email.</p>`,
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
      automatisch raus; den Rest liefern wir von Hand.
      Den Status verfolgst du hier — ohne Konto:</p>
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p>Hilfe nötig? Antworte auf diese Mail oder öffne ein Ticket auf unserem Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_reminder: {
      subject: 'Deine {{brand.name}}-Bestellung {{order.number}} wartet noch ⏳',
      body_html: `
      <h1>Deine Bestellung wartet auf deine Zahlung</h1>
      <p>Hallo {{user.name}}, du hast Bestellung <strong>{{order.number}}</strong> aufgegeben
      (Gesamt <strong>{{order.total}}</strong>), aber deine Zahlung ist noch nicht bei uns.
      Deine Bestellung bleibt nach dem Aufgeben {{order.openDays}} Tage offen; geht in dieser Zeit keine
      Zahlung ein, stornieren wir sie automatisch.</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p><a class="btn" href="{{order.url}}">Bestellung abschließen</a></p>
      <p>Schon bezahlt? Dann kannst du diese Mail ignorieren — eine Zahlung braucht manchmal
      etwas Zeit bis zur Bestätigung. Fragen? Antworte auf diese Mail oder öffne ein
      Ticket auf unserem Discord.</p>`,
    },
    payment_confirmed: {
      subject: 'Zahlung bestätigt für {{order.number}} ✅',
      body_html: `
      <h1>Zahlung eingegangen ✅</h1>
      <p>Hallo {{user.name}}, wir haben deine Zahlung der Bestellung
      <strong>{{order.number}}</strong> zugeordnet. Wir machen sie jetzt fertig.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><strong>Was jetzt passiert:</strong> was wir auf Lager haben, geht automatisch raus.
      Was wir für dich einkaufen, liefern wir von Hand. So oder so landet die Lieferung in genau diesem Postfach.</p>
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p style="color:#8b93a7;font-size:13px">Diese Seite aktualisiert sich selbst — kein Konto
      nötig. Zwischendurch eine Frage? Antworte einfach auf diese Mail.</p>
      {{order.invoiceHtml}}
      {{order.consentHtml}}`,
    },
    order_processing: {
      subject: 'Deine Bestellung {{order.number}} wird vorbereitet',
      body_html: `
      <h1>Wir sind dran 🔧</h1>
      <p>Hallo {{user.name}}, Bestellung <strong>{{order.number}}</strong> wird gerade vorbereitet.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p>Dieser Status heißt, dass wir deine Artikel von Hand fertig machen. Du bekommst eine Mail,
      sobald alles geliefert ist; den Status siehst du jederzeit über den Button unten.</p>
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p style="color:#8b93a7;font-size:13px">Dauert es länger als gedacht? Antworte auf diese Mail
      oder öffne ein Ticket auf unserem Discord — wir hören lieber zu früh von dir als zu spät.</p>`,
    },
    order_completed: {
      subject: 'Deine Bestellung {{order.number}} ist fertig 🎮',
      body_html: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Geliefert</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Bestellung {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Deine Bestellung ist da 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hallo {{user.name}} — die Zahlung ist abgeschlossen, und unten steht, was du bestellt hast.</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Übersicht deiner Bestellung</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" bgcolor="#7c5cff" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">Bestellung ansehen</a>
        </td>
      </tr></table>
      {{order.invoiceHtml}}
      {{order.reviewAskHtml}}
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Stimmt etwas nicht? Antworte auf diese Mail oder öffne ein Ticket auf unserem Discord. 💬</div>
      {{order.consentHtml}}`,
    },
    refund_issued: {
      subject: 'Erstattung für {{order.number}} — {{refund.amount}}',
      body_html: `
      <h1>Deine Erstattung ist veranlasst ↩️</h1>
      <p>Hallo {{user.name}}, wir haben <strong>{{refund.amount}}</strong> für Bestellung
      <strong>{{order.number}}</strong> erstattet.</p>
      {{refund.detailsHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Diese Bestellung ansehen</a></p>
      <p style="color:#8b93a7;font-size:13px">Nicht wie erwartet, oder nach ein paar Werktagen noch
      nichts da? Antworte auf diese Mail mit deiner Bestellnummer und wir gehen dem nach.</p>`,
    },
    custom_message: {
      subject: '{{subject}} — Bestellung {{order.number}}',
      body_html: `
      <h1>{{subject}}</h1>
      <p>Hallo {{user.name}}, hier geht es um deine Bestellung <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{messageHtml}}</div>
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
      <div class="quote">{{replyHtml}}</div>
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
      das hier lag noch in deinem Warenkorb bei {{brand.name}}. Dein Warenkorb ist gespeichert, falls du
      weitermachen möchtest.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Zum Warenkorb</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Fragen? Antworte auf diese Mail oder öffne ein Ticket auf unserem Discord.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px">Keine Erinnerungen mehr? <a href="{{unsubscribe.url}}" style="color:#8b93a7">Abmelden</a></p>`,
    },
    price_drop: {
      subject: '{{product.name}} kostet jetzt {{price.current}} \u{1F4C9}',
      body_html: `
      <div class="badge">\u{1F4C9}</div>
      <h1 style="text-align:center">Preissenkung auf deiner Wunschliste</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hallo {{user.name}}, <strong>{{product.name}}</strong> ist günstiger geworden.</p>
      <p style="text-align:center;font-size:15px;margin:18px 0 4px">
        <span style="color:#8b93a7;text-decoration:line-through">{{price.previous}}</span>
        &nbsp;→&nbsp;<strong style="font-size:22px">{{price.current}}</strong></p>
      <p style="text-align:center;margin:0 0 18px"><span class="pill-note">{{price.diff}} günstiger</span></p>
      <p style="text-align:center"><a class="btn" href="{{product.url}}">Zum Produkt</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Du hast dieses Produkt für {{price.saved}} gespeichert.
      <a href="{{wishlist.url}}" style="color:#8b93a7">Zu deiner Wunschliste</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:12px;margin-top:22px">Du bekommst diese E-Mail, weil du einen Preisalarm eingeschaltet hast.
      <a href="{{wishlist.alertsOffUrl}}" style="color:#8b93a7">Alle Preisalarme ausschalten</a></p>`,
    },
    review_request: {
      subject: 'Wie war deine Bestellung {{order.number}}? ⭐',
      body_html: `
      <div class="badge">⭐</div>
      <h1 style="text-align:center">Wie haben wir uns geschlagen?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hallo {{user.name}},
      nochmals danke für Bestellung <strong>{{order.number}}</strong>! Wenn alles wie erwartet ankam,
      würden wir uns über eine kurze Bewertung freuen — sie hilft anderen Gamern einzuschätzen, ob sie
      bei uns kaufen möchten.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Kurze Bewertung schreiben</a></p>
      {{review.trustpilotHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Stimmt etwas nicht? Antworte auf diese
      Mail oder öffne ein Ticket auf unserem Discord, dann sehen wir es uns an.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px">Lieber keine Bewertungsanfragen mehr?
      <a href="{{unsubscribe.url}}" style="color:#8b93a7">Ausschalten</a></p>`,
    },
    launch_announcement: {
      subject: '{{shop.name}} hat geöffnet \u{1F680}',
      body_html: `
      <div class="badge">\u{1F680}</div>
      <h1 style="text-align:center">Wir haben geöffnet</h1>
      <p style="text-align:center;max-width:440px;margin-left:auto;margin-right:auto">Du wolltest Bescheid wissen,
      sobald {{shop.name}} öffnet. Es ist so weit — der Shop ist offen und du kannst bestellen.</p>
      <p style="text-align:center"><a class="btn" href="{{shop.url}}/shop">Zum Shop</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Was auf Lager ist, geht automatisch raus; alles andere
      von Hand. Du zahlst erst nach der Bestellung.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px;margin-top:22px">Diese Mail bekommst du, weil
      du dich eingetragen hast. <a href="{{unsubscribe.url}}" style="color:#8b93a7">Abmelden</a></p>`,
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
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">💳 Wert {{giftCard.amount}} · einmal einlösbar</span></p>
      {{giftCard.noteHtml}}
      <p style="text-align:center"><a class="btn" href="{{app.url}}/account">Gutschein einlösen</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Melde dich an (oder erstell ein kostenloses
      Konto), öffne <strong>Wallet</strong> und füg den Code oben ein — das Guthaben landet in deinem
      Konto und wird an der Kasse automatisch verrechnet.</p>
      <div class="notice">🔒 <strong>Behalte diesen Code für dich.</strong> Wer ihn hat, kann das
      Guthaben einlösen. Einmal verwendbar, für jede Bestellung.</div>`,
    },
    login_otp: {
      subject: 'Dein Anmeldecode für {{brand.name}}',
      body_html: `
      <div class="badge">🔐</div>
      <h1 style="text-align:center">Dein Anmeldecode</h1>
      <p style="text-align:center;max-width:400px;margin-left:auto;margin-right:auto">Gib diesen Code im
      Anmeldefenster von {{brand.name}} ein.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">⏱ Läuft in {{otp.ttl}} Minuten ab · einmal verwendbar</span></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Tippst du ihn auf einem anderen Gerät ab? Der Code ist
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice">🛡️ <strong>Gib diesen Code nur auf {{app.host}} ein.</strong> {{brand.name}} fragt dich
      <strong>nie</strong> nach diesem Code — weder per E-Mail noch per DM oder Telefon. Wolltest du dich gar nicht
      anmelden? Dann kannst du diese Mail ruhig ignorieren; ohne den Code kommt niemand an dein Konto.</div>`,
    },
    security_alert: {
      subject: 'Neue Anmeldung bei deinem {{brand.name}}-Konto',
      body_html: `
      <div class="badge">🛡️</div>
      <h1 style="text-align:center">Neue Anmeldung bei deinem Konto</h1>
      <p>Hallo {{user.name}}, gerade hat sich jemand von einem Gerät oder Ort, den wir noch nicht kannten,
      bei deinem {{brand.name}}-Konto angemeldet.</p>
      <div class="quote">{{login.detailsHtml}}</div>
      <p><strong>Warst du das?</strong> Dann musst du nichts tun.</p>
      <p><strong>Warst du das nicht?</strong> Melde das Gerät in deinen Sicherheitseinstellungen ab und
      antworte auf diese Mail, dann schauen wir es uns mit dir an.</p>
      <p><a class="btn" href="{{app.url}}/account/settings">Zu deinen Sicherheitseinstellungen</a></p>`,
    },
    order_cancelled: {
      subject: 'Deine Bestellung {{order.number}} wurde storniert',
      body_html: `
      <h1>Deine Bestellung wurde storniert</h1>
      <p>Hallo {{user.name}}, Bestellung <strong>{{order.number}}</strong> (Gesamt <strong>{{order.total}}</strong>)
      wurde storniert.</p>
      {{cancel.reasonHtml}}
      {{order.summaryHtml}}
      <p>Möchtest du es doch? Du kannst jederzeit neu bestellen.</p>
      <p><a class="btn" href="{{app.url}}/shop">Zum Shop</a></p>
      <p style="color:#8b93a7;font-size:13px">Hattest du schon bezahlt, oder stimmt das nicht? Antworte auf
      diese Mail mit deiner Bestellnummer, dann gehen wir dem nach.</p>`,
    },
    order_on_hold: {
      subject: 'Deine Bestellung {{order.number}}: Zahlung eingegangen, noch eine kurze Prüfung',
      body_html: `
      <h1>Zahlung eingegangen — noch eine zusätzliche Prüfung</h1>
      <p>Hallo {{user.name}}, deine Zahlung für Bestellung <strong>{{order.number}}</strong> ist eingegangen.</p>
      <p>Bevor wir liefern, sieht sich jemand von uns diese Bestellung kurz an. Das machen wir bei einem Teil
      der Bestellungen, unter anderem um Missbrauch von Zahlungsdaten zu verhindern. Du musst dafür nichts tun;
      wenn wir etwas von dir brauchen, schreiben wir dir.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p style="color:#8b93a7;font-size:13px">Fragen? Antworte auf diese Mail.</p>
      {{order.consentHtml}}`,
    },
    payment_not_verified: {
      subject: 'Wir konnten deine Zahlung für {{order.number}} noch nicht finden',
      body_html: `
      <h1>Wir konnten deine Zahlung noch nicht finden</h1>
      <p>Hallo {{user.name}}, du hast einen Zahlungsnachweis für Bestellung <strong>{{order.number}}</strong>
      geschickt, aber wir konnten die Zahlung noch nicht zuordnen.</p>
      {{proof.reasonHtml}}
      <p>Prüf bitte den Betrag (<strong>{{order.total}}</strong>) und ob deine Bestellnummer als
      Verwendungszweck angegeben war, und reiche deinen Nachweis dann erneut ein.</p>
      <p><a class="btn" href="{{order.url}}">Nachweis erneut einreichen</a></p>
      <p style="color:#8b93a7;font-size:13px">Sicher, dass alles stimmt? Antworte auf diese Mail mit einem
      Screenshot der Zahlung, dann prüfen wir das.</p>`,
    },
    refund_request_received: {
      subject: 'Wir haben deine Erstattungsanfrage für {{order.number}} erhalten',
      body_html: `
      <h1>Deine Anfrage ist da</h1>
      <p>Hallo {{user.name}}, wir haben deine Erstattungsanfrage für Bestellung
      <strong>{{order.number}}</strong> erhalten. Jemand von uns prüft sie, und du bekommst unsere Entscheidung per Mail.</p>
      {{request.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">Bestellung ansehen</a></p>
      <p style="color:#8b93a7;font-size:13px">Möchtest du etwas ergänzen? Antworte auf diese Mail.</p>`,
    },
    refund_request_rejected: {
      subject: 'Deine Erstattungsanfrage für {{order.number}}',
      body_html: `
      <h1>Wir können diese Anfrage nicht bewilligen</h1>
      <p>Hallo {{user.name}}, wir haben deine Erstattungsanfrage für Bestellung
      <strong>{{order.number}}</strong> geprüft und können sie nicht bewilligen.</p>
      {{request.reasonHtml}}
      <p>Bist du anderer Meinung, oder haben wir etwas übersehen? Antworte auf diese Mail und schreib, worum es
      geht — dann sieht es sich jemand noch einmal an. Auf der Seite zu Widerruf und Erstattung steht, wann du
      Anspruch auf dein Geld hast.</p>
      <p><a class="btn" href="{{app.url}}/refunds">Widerruf &amp; Erstattung</a></p>`,
    },
    ticket_opened: {
      subject: 'Wir haben dein Ticket erhalten · {{ticket.number}}',
      body_html: `
      <h1>Wir haben deine Nachricht erhalten</h1>
      <p>Hallo {{user.name}}, dein Ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}} ist bei uns.
      Unsere Antwort bekommst du per Mail.</p>
      <div class="quote">{{ticket.subject}}</div>
      <p><a class="btn" href="{{ticket.url}}">Ticket ansehen</a></p>
      <p style="color:#8b93a7;font-size:13px">Etwas ergänzen? Antworte einfach auf diese Mail.</p>`,
    },
    newsletter_confirm: {
      subject: 'Bestätige deine Anmeldung bei {{brand.name}}',
      body_html: `
      <div class="badge">✉️</div>
      <h1 style="text-align:center">Bestätige deine Anmeldung</h1>
      <p style="text-align:center;max-width:440px;margin-left:auto;margin-right:auto">Diese Adresse wurde für
      Nachrichten von {{brand.name}} eingetragen. Erst wenn du unten bestätigst, schicken wir dir etwas.</p>
      <p style="text-align:center"><a class="btn" href="{{newsletter.confirmUrl}}">Ja, Anmeldung bestätigen</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Warst du das nicht? Dann ignoriere diese Mail einfach.</p>`,
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
      automatiquement ; le reste, nous le livrons à la main.
      Suis le statut ici — sans compte :</p>
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p>Besoin d’aide ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_reminder: {
      subject: 'Ta commande {{brand.name}} {{order.number}} attend encore ⏳',
      body_html: `
      <h1>Ta commande attend ton paiement</h1>
      <p>Bonjour {{user.name}}, tu as passé la commande <strong>{{order.number}}</strong>
      (total <strong>{{order.total}}</strong>), mais nous n’avons pas encore reçu ton paiement.
      Ta commande reste ouverte {{order.openDays}} jours après sa création ; si aucun paiement n’arrive
      d’ici là, nous l’annulons automatiquement.</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p><a class="btn" href="{{order.url}}">Terminer ma commande</a></p>
      <p>Déjà payé ? Alors tu peux ignorer cet e-mail — un paiement met parfois un peu de temps
      à être confirmé. Des questions ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>`,
    },
    payment_confirmed: {
      subject: 'Paiement confirmé pour {{order.number}} ✅',
      body_html: `
      <h1>Paiement reçu ✅</h1>
      <p>Bonjour {{user.name}}, nous avons rattaché ton paiement à la commande
      <strong>{{order.number}}</strong>. Nous la préparons maintenant.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><strong>Ce qui se passe maintenant :</strong> ce que nous avons en stock part
      automatiquement. Ce que nous achetons pour toi, nous le livrons à la main. Dans les deux cas, la livraison arrive dans cette même boîte mail.</p>
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p style="color:#8b93a7;font-size:13px">Cette page se met à jour toute seule — pas besoin de compte.
      Une question entre-temps ? Réponds simplement à cet e-mail.</p>
      {{order.invoiceHtml}}
      {{order.consentHtml}}`,
    },
    order_processing: {
      subject: 'Ta commande {{order.number}} est en préparation',
      body_html: `
      <h1>On s’en occupe 🔧</h1>
      <p>Bonjour {{user.name}}, la commande <strong>{{order.number}}</strong> est en préparation.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p>Ce statut veut dire que nous préparons tes articles à la main. Tu reçois un e-mail dès que
      c’est livré ; tu peux toujours suivre le statut avec le bouton ci-dessous.</p>
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p style="color:#8b93a7;font-size:13px">Cela prend plus de temps que prévu ? Réponds à cet
      e-mail ou ouvre un ticket sur notre Discord — nous préférons avoir de tes nouvelles trop tôt
      que trop tard.</p>`,
    },
    order_completed: {
      subject: 'Ta commande {{order.number}} est prête 🎮',
      body_html: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Livrée</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Commande {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 29px/1.15 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Ta commande est prête 🎮</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Bonjour {{user.name}} — ton paiement est finalisé et voici ce que tu as commandé.</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Récapitulatif de ta commande</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" bgcolor="#7c5cff" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a href="{{order.url}}" style="display:block;padding:15px 24px;font:700 16px/1 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none">Voir ma commande</a>
        </td>
      </tr></table>
      {{order.invoiceHtml}}
      {{order.reviewAskHtml}}
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Quelque chose ne va pas ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord. 💬</div>
      {{order.consentHtml}}`,
    },
    refund_issued: {
      subject: 'Remboursement pour {{order.number}} — {{refund.amount}}',
      body_html: `
      <h1>Ton remboursement est effectué ↩️</h1>
      <p>Bonjour {{user.name}}, nous avons remboursé <strong>{{refund.amount}}</strong> pour la
      commande <strong>{{order.number}}</strong>.</p>
      {{refund.detailsHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Voir cette commande</a></p>
      <p style="color:#8b93a7;font-size:13px">Ce n’est pas ce que tu attendais, ou toujours rien
      après quelques jours ouvrés ? Réponds à cet e-mail avec ton numéro de commande et nous
      relançons.</p>`,
    },
    custom_message: {
      subject: '{{subject}} — commande {{order.number}}',
      body_html: `
      <h1>{{subject}}</h1>
      <p>Bonjour {{user.name}}, il s’agit de ta commande <strong>{{order.number}}</strong> :</p>
      <div class="quote">{{messageHtml}}</div>
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
      <div class="quote">{{replyHtml}}</div>
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
      ceci était encore dans ton panier chez {{brand.name}}. Ton panier est enregistré si tu veux reprendre
      là où tu t’étais arrêté.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Voir mon panier</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Des questions ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px">Plus de rappels ? <a href="{{unsubscribe.url}}" style="color:#8b93a7">Se désabonner</a></p>`,
    },
    price_drop: {
      subject: '{{product.name}} est maintenant à {{price.current}} \u{1F4C9}',
      body_html: `
      <div class="badge">\u{1F4C9}</div>
      <h1 style="text-align:center">Baisse de prix dans ta liste de souhaits</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Bonjour {{user.name}}, <strong>{{product.name}}</strong> est moins cher.</p>
      <p style="text-align:center;font-size:15px;margin:18px 0 4px">
        <span style="color:#8b93a7;text-decoration:line-through">{{price.previous}}</span>
        &nbsp;→&nbsp;<strong style="font-size:22px">{{price.current}}</strong></p>
      <p style="text-align:center;margin:0 0 18px"><span class="pill-note">{{price.diff}} de moins</span></p>
      <p style="text-align:center"><a class="btn" href="{{product.url}}">Voir le produit</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Tu l’avais enregistré à {{price.saved}}.
      <a href="{{wishlist.url}}" style="color:#8b93a7">Voir ta liste de souhaits</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:12px;margin-top:22px">Tu reçois cet e-mail parce que tu as activé une alerte de prix.
      <a href="{{wishlist.alertsOffUrl}}" style="color:#8b93a7">Désactiver toutes les alertes de prix</a></p>`,
    },
    review_request: {
      subject: 'Comment s’est passée ta commande {{order.number}} ? ⭐',
      body_html: `
      <div class="badge">⭐</div>
      <h1 style="text-align:center">On s’en est sortis comment ?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Bonjour {{user.name}},
      merci encore pour la commande <strong>{{order.number}}</strong> ! Si tout est bien arrivé, un court avis
      nous ferait plaisir — il aide d’autres joueurs à décider s’ils veulent acheter chez nous.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Laisser un court avis</a></p>
      {{review.trustpilotHtml}}
      <p style="text-align:center;color:#8b93a7;font-size:13px">Quelque chose ne va pas ? Réponds à cet e-mail
      ou ouvre un ticket sur notre Discord, et nous regardons ça.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px">Tu préfères ne plus recevoir de demandes d’avis ?
      <a href="{{unsubscribe.url}}" style="color:#8b93a7">Les désactiver</a></p>`,
    },
    launch_announcement: {
      subject: '{{shop.name}} est ouvert \u{1F680}',
      body_html: `
      <div class="badge">\u{1F680}</div>
      <h1 style="text-align:center">Nous sommes ouverts</h1>
      <p style="text-align:center;max-width:440px;margin-left:auto;margin-right:auto">Tu voulais être prévenu
      dès l’ouverture de {{shop.name}}. C’est fait — la boutique est ouverte et tu peux commander.</p>
      <p style="text-align:center"><a class="btn" href="{{shop.url}}/shop">Voir la boutique</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Ce qui est en stock part automatiquement ; le reste à
      la main. Tu paies après la commande.</p>
      <p style="text-align:center;color:#8b93a7;font-size:12px;margin-top:22px">Tu reçois cet e-mail
      parce que tu t’étais inscrit. <a href="{{unsubscribe.url}}" style="color:#8b93a7">Se désabonner</a></p>`,
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
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">💳 Valeur {{giftCard.amount}} · utilisable une fois</span></p>
      {{giftCard.noteHtml}}
      <p style="text-align:center"><a class="btn" href="{{app.url}}/account">Utiliser ma carte cadeau</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Connecte-toi (ou crée un compte gratuit), ouvre
      <strong>Wallet</strong> et colle le code ci-dessus — le montant arrive dans ton crédit boutique et se
      déduit automatiquement au paiement.</p>
      <div class="notice">🔒 <strong>Garde ce code pour toi.</strong> Toute personne qui l’a peut utiliser
      le solde. Utilisable une seule fois, sur n’importe quelle commande.</div>`,
    },
    login_otp: {
      subject: 'Ton code de connexion {{brand.name}}',
      body_html: `
      <div class="badge">🔐</div>
      <h1 style="text-align:center">Ton code de connexion</h1>
      <p style="text-align:center;max-width:400px;margin-left:auto;margin-right:auto">Saisis ce code sur l’écran
      de connexion de {{brand.name}}.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">⏱ Expire dans {{otp.ttl}} minutes · à usage unique</span></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Tu le recopies sur un autre appareil ? Le code est
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice">🛡️ <strong>Saisis ce code uniquement sur {{app.host}}.</strong> {{brand.name}} ne te
      demandera <strong>jamais</strong> ce code — ni par e-mail, ni en message privé, ni par téléphone. Tu n’as pas
      essayé de te connecter ? Tu peux ignorer cet e-mail ; sans le code, personne ne peut accéder à ton compte.</div>`,
    },
    security_alert: {
      subject: 'Nouvelle connexion à ton compte {{brand.name}}',
      body_html: `
      <div class="badge">🛡️</div>
      <h1 style="text-align:center">Nouvelle connexion à ton compte</h1>
      <p>Bonjour {{user.name}}, quelqu’un vient de se connecter à ton compte {{brand.name}} depuis un appareil
      ou un lieu que nous ne connaissions pas encore.</p>
      <div class="quote">{{login.detailsHtml}}</div>
      <p><strong>C’était toi ?</strong> Alors tu n’as rien à faire.</p>
      <p><strong>Ce n’était pas toi ?</strong> Déconnecte l’appareil dans tes paramètres de sécurité et
      réponds à cet e-mail, nous regarderons cela avec toi.</p>
      <p><a class="btn" href="{{app.url}}/account/settings">Mes paramètres de sécurité</a></p>`,
    },
    order_cancelled: {
      subject: 'Ta commande {{order.number}} a été annulée',
      body_html: `
      <h1>Ta commande a été annulée</h1>
      <p>Bonjour {{user.name}}, la commande <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>)
      a été annulée.</p>
      {{cancel.reasonHtml}}
      {{order.summaryHtml}}
      <p>Tu la veux quand même ? Tu peux passer une nouvelle commande à tout moment.</p>
      <p><a class="btn" href="{{app.url}}/shop">Voir la boutique</a></p>
      <p style="color:#8b93a7;font-size:13px">Tu avais déjà payé, ou ça te semble incorrect ? Réponds à cet
      e-mail avec ton numéro de commande et nous regardons.</p>`,
    },
    order_on_hold: {
      subject: 'Ta commande {{order.number}} : paiement reçu, encore une courte vérification',
      body_html: `
      <h1>Paiement reçu — encore une vérification</h1>
      <p>Bonjour {{user.name}}, nous avons reçu ton paiement pour la commande <strong>{{order.number}}</strong>.</p>
      <p>Avant de livrer, l’un de nous jette un œil à cette commande. Nous le faisons pour une partie des
      commandes, notamment pour éviter l’usage abusif de données de paiement. Tu n’as rien à faire ; si nous
      avons besoin de quelque chose, nous t’écrivons.</p>
      {{order.summaryHtml}}
      {{order.needsFromBuyerHtml}}
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p style="color:#8b93a7;font-size:13px">Des questions ? Réponds à cet e-mail.</p>
      {{order.consentHtml}}`,
    },
    payment_not_verified: {
      subject: 'Nous n’avons pas encore trouvé ton paiement pour {{order.number}}',
      body_html: `
      <h1>Nous n’avons pas encore trouvé ton paiement</h1>
      <p>Bonjour {{user.name}}, tu as envoyé une preuve de paiement pour la commande <strong>{{order.number}}</strong>,
      mais nous n’avons pas encore pu rattacher ce paiement.</p>
      {{proof.reasonHtml}}
      <p>Vérifie le montant (<strong>{{order.total}}</strong>) et que ton numéro de commande figurait en
      référence, puis envoie à nouveau ta preuve.</p>
      <p><a class="btn" href="{{order.url}}">Renvoyer ma preuve</a></p>
      <p style="color:#8b93a7;font-size:13px">Tu es sûr(e) que tout est correct ? Réponds à cet e-mail avec une
      capture du paiement et nous vérifions.</p>`,
    },
    refund_request_received: {
      subject: 'Nous avons reçu ta demande de remboursement pour {{order.number}}',
      body_html: `
      <h1>Ta demande est bien arrivée</h1>
      <p>Bonjour {{user.name}}, nous avons reçu ta demande de remboursement pour la commande
      <strong>{{order.number}}</strong>. L’un de nous l’examine et tu recevras notre décision par e-mail.</p>
      {{request.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">Voir ma commande</a></p>
      <p style="color:#8b93a7;font-size:13px">Tu veux ajouter quelque chose ? Réponds à cet e-mail.</p>`,
    },
    refund_request_rejected: {
      subject: 'Ta demande de remboursement pour {{order.number}}',
      body_html: `
      <h1>Nous ne pouvons pas accepter cette demande</h1>
      <p>Bonjour {{user.name}}, nous avons examiné ta demande de remboursement pour la commande
      <strong>{{order.number}}</strong> et ne pouvons pas l’accepter.</p>
      {{request.reasonHtml}}
      <p>Tu n’es pas d’accord, ou nous avons raté quelque chose ? Réponds à cet e-mail en expliquant la
      situation — quelqu’un la réexaminera. La page rétractation et remboursement explique quand tu as droit
      à un remboursement.</p>
      <p><a class="btn" href="{{app.url}}/refunds">Rétractation &amp; remboursement</a></p>`,
    },
    ticket_opened: {
      subject: 'Nous avons reçu ton ticket · {{ticket.number}}',
      body_html: `
      <h1>Nous avons reçu ton message</h1>
      <p>Bonjour {{user.name}}, ton ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}} est bien chez nous.
      Tu recevras notre réponse par e-mail.</p>
      <div class="quote">{{ticket.subject}}</div>
      <p><a class="btn" href="{{ticket.url}}">Voir mon ticket</a></p>
      <p style="color:#8b93a7;font-size:13px">Quelque chose à ajouter ? Réponds simplement à cet e-mail.</p>`,
    },
    newsletter_confirm: {
      subject: 'Confirme ton inscription chez {{brand.name}}',
      body_html: `
      <div class="badge">✉️</div>
      <h1 style="text-align:center">Confirme ton inscription</h1>
      <p style="text-align:center;max-width:440px;margin-left:auto;margin-right:auto">Cette adresse a été
      inscrite aux messages de {{brand.name}}. Nous ne t’envoyons rien tant que tu n’as pas confirmé ci-dessous.</p>
      <p style="text-align:center"><a class="btn" href="{{newsletter.confirmUrl}}">Oui, confirmer mon inscription</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Ce n’était pas toi ? Ignore simplement cet e-mail.</p>`,
    },
  },
};
