/**
 * The same emails, in the other three languages the shop speaks.
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
 * Same ids, same tokens, same links, same structure as the Dutch set (see the
 * house-style note at the top of DEFAULT_TEMPLATES). Only the prose differs,
 * so a template that gains a token gains it everywhere; the tests check
 * exactly that, because a mail that renders `{{order.url}}` as an empty string
 * in one language only is the kind of thing nobody sees until a buyer cannot
 * find their code.
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
      <h1>Welcome, {{user.name}}</h1>
      <p>Your {{brand.name}} account is ready. You can now place orders, follow them and download your
      invoices from your account.</p>
      <p><strong>No password needed.</strong> You sign in with a code we email you, and you stay signed in
      on this device.</p>
      <p><a class="btn" href="{{app.url}}/account">Go to your account</a></p>
      <p class="help">Questions? Reply to this email or open a ticket in our Discord.</p>`,
    },
    order_received: {
      subject: 'Order {{order.number}} is placed — complete your payment',
      body_html: `
      <h1>Your order is placed</h1>
      <p>Hi {{user.name}}, we have received order <strong>{{order.number}}</strong> (total
      <strong>{{order.total}}</strong>). Complete your payment; as soon as it is in, we deliver.</p>
      {{order.paymentHtml}}
      {{order.itemsHtml}}
      {{order.needsFromBuyerHtml}}
      <p><a class="btn" href="{{order.url}}">Complete payment</a></p>
      <p class="help">That page also shows the status of your order — no account needed. Questions?
      Reply to this email or open a ticket in our Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_reminder: {
      subject: 'Order {{order.number}} is still waiting for your payment ⏳',
      body_html: `
      <h1>We are still waiting for your payment</h1>
      <p>Hi {{user.name}}, you placed order <strong>{{order.number}}</strong> (total
      <strong>{{order.total}}</strong>), but your payment has not come in yet. The order stays open for
      {{order.openDays}} days after you placed it; after that we cancel it automatically.</p>
      {{order.paymentHtml}}
      {{order.itemsHtml}}
      <p><a class="btn" href="{{order.url}}">Complete payment</a></p>
      <p class="help">Already paid? Then you can ignore this email — a payment can take a little while to be
      confirmed. Questions? Reply to this email or open a ticket in our Discord.</p>`,
    },
    payment_confirmed: {
      subject: 'Payment received for order {{order.number}} ✅',
      body_html: `
      <h1>Payment received</h1>
      <p>Hi {{user.name}}, your payment for order <strong>{{order.number}}</strong> is in. There is nothing
      left for you to do: we are preparing your order now.</p>
      {{order.needsFromBuyerHtml}}
      {{order.summaryHtml}}
      <p>What we have in stock goes out automatically; what we buy in for you, we deliver by hand. Either way,
      the delivery arrives in this inbox.</p>
      <p><a class="btn" href="{{order.url}}">Track order</a></p>
      <p class="help">That page refreshes by itself — no account needed. Questions? Reply to this email or
      open a ticket in our Discord.</p>
      {{order.invoiceHtml}}
      {{order.consentHtml}}`,
    },
    order_processing: {
      subject: 'We are preparing order {{order.number}}',
      body_html: `
      <h1>We are preparing your order</h1>
      <p>Hi {{user.name}}, we are getting order <strong>{{order.number}}</strong> ready for you by hand.
      You will get an email as soon as it is delivered.</p>
      {{order.needsFromBuyerHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Track order</a></p>
      <p class="help">Taking longer than you expected? Reply to this email or open a ticket in our Discord —
      we would rather hear from you early.</p>`,
    },
    order_completed: {
      subject: 'Order {{order.number}} is delivered 🎮',
      body_html: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Delivered</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Order {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 28px/1.2 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Your order is delivered</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hi {{user.name}}, below is what you ordered and how to use it. Keep this email.</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Order summary</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" bgcolor="#7c5cff" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a class="btn" href="{{order.url}}" style="display:block;margin:0;padding:15px 24px;font:700 16px/20px 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none;box-shadow:none">View order</a>
        </td>
      </tr></table>
      {{order.invoiceHtml}}
      {{order.reviewAskHtml}}
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Something not right? Reply to this email or open a ticket in our Discord.</div>
      {{order.consentHtml}}`,
    },
    refund_issued: {
      subject: 'Refund for order {{order.number}}: {{refund.amount}}',
      body_html: `
      <h1>Your refund has been processed</h1>
      <p>Hi {{user.name}}, we have refunded <strong>{{refund.amount}}</strong> for order
      <strong>{{order.number}}</strong>. Below is how and where it went.</p>
      {{refund.detailsHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">View order</a></p>
      <p class="help">Is the amount wrong, or has nothing arrived after a few working days? Reply to this
      email and we will look into it.</p>`,
    },
    custom_message: {
      subject: '{{subject}} — order {{order.number}}',
      body_html: `
      <h1>{{subject}}</h1>
      <p>Hi {{user.name}}, this message is about order <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{messageHtml}}</div>
      <p><a class="btn" href="{{order.url}}">View order</a></p>
      <p class="help">You can simply reply to this email — it reaches the person who sent it.</p>`,
    },
    support_reply: {
      subject: 'Re: {{ticket.subject}} · ticket {{ticket.number}}',
      body_html: `
      <h1>New reply on your ticket</h1>
      <p>Hi {{user.name}}, we have answered ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}}:</p>
      <div class="quote">{{replyHtml}}</div>
      <p><a class="btn" href="{{ticket.url}}">Read the conversation</a></p>
      <p class="help">Just reply to this email — your message lands on the same ticket.</p>`,
    },
    cart_reminder: {
      subject: 'This is still in your cart 🛒',
      body_html: `
      <h1>This is still in your cart</h1>
      <p>Hi {{user.name}}, your cart at {{brand.name}} has been saved. Want to carry on? It is ready for you,
      at today's prices.</p>
      {{cart.itemsHtml}}
      <p><a class="btn" href="{{cart.url}}">Go to your cart</a></p>
      <p class="help">Questions? Reply to this email or open a ticket in our Discord.</p>
      <p class="fine">No more reminders? <a href="{{unsubscribe.url}}">Unsubscribe</a></p>`,
    },
    price_drop: {
      subject: '{{product.name}} is now {{price.current}} \u{1F4C9}',
      body_html: `
      <h1>Price drop on your wishlist</h1>
      <p>Hi {{user.name}}, <strong>{{product.name}}</strong> just got cheaper.</p>
      <p style="font-size:15px;margin:18px 0 4px">
        <span style="color:#8b93a7;text-decoration:line-through">{{price.previous}}</span>
        &nbsp;→&nbsp;<strong style="font-size:22px">{{price.current}}</strong></p>
      <p style="margin:0 0 18px"><span class="pill-note">{{price.diff}} cheaper</span></p>
      <p><a class="btn" href="{{product.url}}">View product</a></p>
      <p class="help">You saved this product at {{price.saved}}. <a href="{{wishlist.url}}">Go to your wishlist</a></p>
      <p class="fine">You are getting this because you turned on a price alert.
      <a href="{{wishlist.alertsOffUrl}}">Turn off all price alerts</a></p>`,
    },
    review_request: {
      subject: 'How was order {{order.number}}? ⭐',
      body_html: `
      <h1>How was your order?</h1>
      <p>Hi {{user.name}}, thank you for order <strong>{{order.number}}</strong>. Did everything arrive as
      expected? A short review helps other gamers decide whether to buy from us.</p>
      <p><a class="btn" href="{{review.url}}">Write a review</a></p>
      {{review.trustpilotHtml}}
      <p class="help">Something not right? Reply to this email or open a ticket in our Discord and we will look into it.</p>
      <p class="fine">Rather not get review requests? <a href="{{unsubscribe.url}}">Turn them off</a></p>`,
    },
    launch_announcement: {
      subject: '{{shop.name}} is open \u{1F680}',
      body_html: `
      <h1>We are open</h1>
      <p>Hi, you asked us to let you know when {{shop.name}} opened. It has: the shop is open and you can
      order.</p>
      <p><a class="btn" href="{{shop.url}}/shop">Visit the shop</a></p>
      <p class="help">What we have in stock goes out automatically; everything else we deliver by hand.</p>
      <p class="fine">You are getting this because you signed up. <a href="{{unsubscribe.url}}">Unsubscribe</a></p>`,
    },
    gift_card: {
      subject: 'You received a {{giftCard.amount}} {{brand.name}} gift card 🎁',
      body_html: `
      <h1>You received a gift card</h1>
      <p>Hi, someone sent you <strong>{{giftCard.amount}}</strong> to spend at {{brand.name}}. Redeem the
      code below; the balance goes to your store credit and is applied automatically at checkout.</p>
      <p class="code">{{giftCard.code}}</p>
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">Worth {{giftCard.amount}} · redeemable once</span></p>
      {{giftCard.noteHtml}}
      <p><a class="btn" href="{{app.url}}/account/wallet">Redeem gift card</a></p>
      <p class="help">The button takes you to your Wallet. No account yet? Create one for free with this
      email address, then paste the code.</p>
      <div class="notice"><strong>Keep this code private.</strong> Anyone who has it can redeem the balance.</div>`,
    },
    login_otp: {
      subject: 'Your {{brand.name}} login code',
      body_html: `
      <h1 style="text-align:center">Your login code</h1>
      <p style="text-align:center">Enter this code on the {{brand.name}} login screen.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">Expires in {{otp.ttl}} minutes · one-time use</span></p>
      <p class="help" style="text-align:center">Typing it on another device? The code is
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice"><strong>Only enter this code on {{app.host}}.</strong> {{brand.name}} will
      <strong>never</strong> ask you for this code — not by email, DM or phone. Didn't try to sign in? You can
      ignore this email; without the code nobody can access your account.</div>`,
    },
    security_alert: {
      subject: 'New sign-in to your {{brand.name}} account',
      body_html: `
      <h1>New sign-in to your account</h1>
      <p>Hi {{user.name}}, someone just signed in to your {{brand.name}} account from a device or location
      we had not seen before.</p>
      <div class="quote">{{login.detailsHtml}}</div>
      <p><strong>Was this you?</strong> Then there is nothing to do.<br>
      <strong>Wasn't you?</strong> Sign the device out in your security settings and reply to this email,
      and we will look into it with you.</p>
      <p><a class="btn" href="{{app.url}}/account/settings">Open security settings</a></p>
      <p class="help">We never ask for a login code or password — not by email, DM or phone.</p>`,
    },
    order_cancelled: {
      subject: 'Order {{order.number}} has been cancelled',
      body_html: `
      <h1>Your order has been cancelled</h1>
      <p>Hi {{user.name}}, order <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>)
      has been cancelled. Still want it? You can place a new order any time.</p>
      {{cancel.reasonHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{app.url}}/shop">Visit the shop</a></p>
      <p class="help">Had you already paid, or does this look wrong? Reply to this email and we will look into it.</p>`,
    },
    order_on_hold: {
      subject: 'Order {{order.number}}: payment received, one more check',
      body_html: `
      <h1>Payment received — one more check</h1>
      <p>Hi {{user.name}}, your payment for order <strong>{{order.number}}</strong> is in. Before we deliver,
      one of us takes a quick look at the order. There is nothing you need to do; if we need anything from
      you, we will email you.</p>
      <p>We do this for a share of orders, among other things to prevent misuse of payment details.</p>
      {{order.needsFromBuyerHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Track order</a></p>
      <p class="help">Questions? Reply to this email or open a ticket in our Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_not_verified: {
      subject: 'We have not found your payment for order {{order.number}} yet',
      body_html: `
      <h1>We have not found your payment yet</h1>
      <p>Hi {{user.name}}, you sent a proof of payment for order <strong>{{order.number}}</strong>, but we
      could not match that payment yet. Check the amount (<strong>{{order.total}}</strong>) and that your order
      number was used as the reference, then resubmit your proof.</p>
      {{proof.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">Resubmit proof</a></p>
      <p class="help">Sure it is right? Reply to this email with a screenshot of the payment and we will check it.</p>`,
    },
    refund_request_received: {
      subject: 'We received your refund request for order {{order.number}}',
      body_html: `
      <h1>Your request is in</h1>
      <p>Hi {{user.name}}, we have received your refund request for order
      <strong>{{order.number}}</strong>. One of us will review it; you will hear our decision by email.</p>
      {{request.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">View order</a></p>
      <p class="help">Want to add something? Reply to this email.</p>`,
    },
    refund_request_rejected: {
      subject: 'Decision on your refund request for order {{order.number}}',
      body_html: `
      <h1>We cannot grant this request</h1>
      <p>Hi {{user.name}}, we reviewed your refund request for order
      <strong>{{order.number}}</strong> and cannot grant it.</p>
      {{request.reasonHtml}}
      <p>Disagree, or did we miss something? Reply to this email with what is going on and someone will look
      at it again. The withdrawal and refunds page explains when you are entitled to your money back.</p>
      <p><a class="btn" href="{{app.url}}/refunds">Withdrawal &amp; refunds</a></p>
      <p class="help">You can simply reply to this email.</p>`,
    },
    ticket_opened: {
      subject: 'We received your ticket {{ticket.number}}',
      body_html: `
      <h1>We received your message</h1>
      <p>Hi {{user.name}}, ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}} is with us. You will
      get our answer by email.</p>
      <div class="quote">{{ticket.subject}}</div>
      <p><a class="btn" href="{{ticket.url}}">View ticket</a></p>
      <p class="help">Want to add something? Just reply to this email.</p>`,
    },
    newsletter_confirm: {
      subject: 'Confirm your sign-up at {{brand.name}}',
      body_html: `
      <h1>Confirm your sign-up</h1>
      <p>Hi, this address was entered to receive messages from {{brand.name}}. We only send you anything
      once you confirm below.</p>
      <p><a class="btn" href="{{newsletter.confirmUrl}}">Confirm sign-up</a></p>
      <p class="help">Not you? Just ignore this email.</p>`,
    },
  },
  de: {
    account_created: {
      subject: 'Willkommen bei {{brand.name}} 🎉',
      body_html: `
      <h1>Willkommen, {{user.name}}</h1>
      <p>Dein {{brand.name}}-Konto ist bereit. Du kannst jetzt bestellen, deine Bestellungen verfolgen und
      deine Rechnungen in deinem Konto herunterladen.</p>
      <p><strong>Kein Passwort nötig.</strong> Du meldest dich mit einem Code an, den wir dir per Mail
      schicken, und auf diesem Gerät bleibst du angemeldet.</p>
      <p><a class="btn" href="{{app.url}}/account">Zu deinem Konto</a></p>
      <p class="help">Fragen? Antworte auf diese Mail oder öffne ein Ticket in unserem Discord.</p>`,
    },
    order_received: {
      subject: 'Bestellung {{order.number}} ist aufgegeben — schließ deine Zahlung ab',
      body_html: `
      <h1>Deine Bestellung ist aufgegeben</h1>
      <p>Hallo {{user.name}}, wir haben Bestellung <strong>{{order.number}}</strong> erhalten (Gesamt
      <strong>{{order.total}}</strong>). Schließ deine Zahlung ab; sobald sie da ist, liefern wir.</p>
      {{order.paymentHtml}}
      {{order.itemsHtml}}
      {{order.needsFromBuyerHtml}}
      <p><a class="btn" href="{{order.url}}">Zahlung abschließen</a></p>
      <p class="help">Auf dieser Seite siehst du auch den Status deiner Bestellung — ohne Konto. Fragen?
      Antworte auf diese Mail oder öffne ein Ticket in unserem Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_reminder: {
      subject: 'Bestellung {{order.number}} wartet noch auf deine Zahlung ⏳',
      body_html: `
      <h1>Wir warten noch auf deine Zahlung</h1>
      <p>Hallo {{user.name}}, du hast Bestellung <strong>{{order.number}}</strong> aufgegeben (Gesamt
      <strong>{{order.total}}</strong>), aber deine Zahlung ist noch nicht eingegangen. Die Bestellung bleibt
      {{order.openDays}} Tage nach der Aufgabe offen; danach stornieren wir sie automatisch.</p>
      {{order.paymentHtml}}
      {{order.itemsHtml}}
      <p><a class="btn" href="{{order.url}}">Zahlung abschließen</a></p>
      <p class="help">Schon bezahlt? Dann kannst du diese Mail ignorieren — eine Zahlung braucht manchmal
      etwas, bis sie bestätigt ist. Fragen? Antworte auf diese Mail oder öffne ein Ticket in unserem Discord.</p>`,
    },
    payment_confirmed: {
      subject: 'Zahlung für Bestellung {{order.number}} eingegangen ✅',
      body_html: `
      <h1>Zahlung eingegangen</h1>
      <p>Hallo {{user.name}}, deine Zahlung für Bestellung <strong>{{order.number}}</strong> ist da. Du musst
      nichts mehr tun: Wir machen deine Bestellung jetzt fertig.</p>
      {{order.needsFromBuyerHtml}}
      {{order.summaryHtml}}
      <p>Was wir auf Lager haben, geht automatisch raus; was wir für dich einkaufen, liefern wir von Hand.
      Die Lieferung kommt in jedem Fall in dieses Postfach.</p>
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p class="help">Die Seite aktualisiert sich selbst — ohne Konto. Fragen? Antworte auf diese Mail oder
      öffne ein Ticket in unserem Discord.</p>
      {{order.invoiceHtml}}
      {{order.consentHtml}}`,
    },
    order_processing: {
      subject: 'Wir machen Bestellung {{order.number}} fertig',
      body_html: `
      <h1>Wir machen deine Bestellung fertig</h1>
      <p>Hallo {{user.name}}, wir bereiten Bestellung <strong>{{order.number}}</strong> gerade von Hand für dich
      vor. Du bekommst eine Mail, sobald sie geliefert ist.</p>
      {{order.needsFromBuyerHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p class="help">Dauert es länger als erwartet? Antworte auf diese Mail oder öffne ein Ticket in unserem
      Discord — wir hören lieber früh von dir.</p>`,
    },
    order_completed: {
      subject: 'Bestellung {{order.number}} ist geliefert 🎮',
      body_html: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Geliefert</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Bestellung {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 28px/1.2 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Deine Bestellung ist geliefert</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Hallo {{user.name}}, unten steht, was du bestellt hast und wie du es benutzt. Bewahre diese Mail auf.</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Bestellübersicht</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" bgcolor="#7c5cff" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a class="btn" href="{{order.url}}" style="display:block;margin:0;padding:15px 24px;font:700 16px/20px 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none;box-shadow:none">Bestellung ansehen</a>
        </td>
      </tr></table>
      {{order.invoiceHtml}}
      {{order.reviewAskHtml}}
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Stimmt etwas nicht? Antworte auf diese Mail oder öffne ein Ticket in unserem Discord.</div>
      {{order.consentHtml}}`,
    },
    refund_issued: {
      subject: 'Erstattung für Bestellung {{order.number}}: {{refund.amount}}',
      body_html: `
      <h1>Deine Erstattung ist bearbeitet</h1>
      <p>Hallo {{user.name}}, wir haben <strong>{{refund.amount}}</strong> für Bestellung
      <strong>{{order.number}}</strong> erstattet. Unten steht, wie und wohin.</p>
      {{refund.detailsHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Bestellung ansehen</a></p>
      <p class="help">Stimmt der Betrag nicht, oder ist nach ein paar Werktagen noch nichts angekommen?
      Antworte auf diese Mail, dann kümmern wir uns darum.</p>`,
    },
    custom_message: {
      subject: '{{subject}} — Bestellung {{order.number}}',
      body_html: `
      <h1>{{subject}}</h1>
      <p>Hallo {{user.name}}, diese Nachricht betrifft Bestellung <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{messageHtml}}</div>
      <p><a class="btn" href="{{order.url}}">Bestellung ansehen</a></p>
      <p class="help">Du kannst einfach auf diese Mail antworten — sie erreicht die Person, die sie geschickt hat.</p>`,
    },
    support_reply: {
      subject: 'Re: {{ticket.subject}} · Ticket {{ticket.number}}',
      body_html: `
      <h1>Neue Antwort auf dein Ticket</h1>
      <p>Hallo {{user.name}}, wir haben Ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}} beantwortet:</p>
      <div class="quote">{{replyHtml}}</div>
      <p><a class="btn" href="{{ticket.url}}">Unterhaltung lesen</a></p>
      <p class="help">Antworte einfach auf diese Mail — deine Nachricht landet im selben Ticket.</p>`,
    },
    cart_reminder: {
      subject: 'Das liegt noch in deinem Warenkorb 🛒',
      body_html: `
      <h1>Das liegt noch in deinem Warenkorb</h1>
      <p>Hallo {{user.name}}, dein Warenkorb bei {{brand.name}} ist gespeichert. Möchtest du weitermachen?
      Er liegt für dich bereit, zu den aktuellen Preisen.</p>
      {{cart.itemsHtml}}
      <p><a class="btn" href="{{cart.url}}">Zum Warenkorb</a></p>
      <p class="help">Fragen? Antworte auf diese Mail oder öffne ein Ticket in unserem Discord.</p>
      <p class="fine">Keine Erinnerungen mehr? <a href="{{unsubscribe.url}}">Abmelden</a></p>`,
    },
    price_drop: {
      subject: '{{product.name}} kostet jetzt {{price.current}} \u{1F4C9}',
      body_html: `
      <h1>Preissenkung auf deiner Wunschliste</h1>
      <p>Hallo {{user.name}}, <strong>{{product.name}}</strong> ist günstiger geworden.</p>
      <p style="font-size:15px;margin:18px 0 4px">
        <span style="color:#8b93a7;text-decoration:line-through">{{price.previous}}</span>
        &nbsp;→&nbsp;<strong style="font-size:22px">{{price.current}}</strong></p>
      <p style="margin:0 0 18px"><span class="pill-note">{{price.diff}} günstiger</span></p>
      <p><a class="btn" href="{{product.url}}">Produkt ansehen</a></p>
      <p class="help">Du hast dieses Produkt bei {{price.saved}} gespeichert. <a href="{{wishlist.url}}">Zur Wunschliste</a></p>
      <p class="fine">Du bekommst das, weil du einen Preisalarm eingeschaltet hast.
      <a href="{{wishlist.alertsOffUrl}}">Alle Preisalarme ausschalten</a></p>`,
    },
    review_request: {
      subject: 'Wie war Bestellung {{order.number}}? ⭐',
      body_html: `
      <h1>Wie war deine Bestellung?</h1>
      <p>Hallo {{user.name}}, danke für Bestellung <strong>{{order.number}}</strong>. Ist alles wie erwartet
      angekommen? Eine kurze Bewertung hilft anderen Gamern bei der Entscheidung, ob sie bei uns kaufen.</p>
      <p><a class="btn" href="{{review.url}}">Bewertung schreiben</a></p>
      {{review.trustpilotHtml}}
      <p class="help">Stimmt etwas nicht? Antworte auf diese Mail oder öffne ein Ticket in unserem Discord, dann schauen wir uns das an.</p>
      <p class="fine">Lieber keine Bewertungsanfragen mehr? <a href="{{unsubscribe.url}}">Ausschalten</a></p>`,
    },
    launch_announcement: {
      subject: '{{shop.name}} hat geöffnet \u{1F680}',
      body_html: `
      <h1>Wir haben geöffnet</h1>
      <p>Hallo, du wolltest Bescheid bekommen, sobald {{shop.name}} öffnet. Jetzt ist es so weit: Der Shop
      ist offen und du kannst bestellen.</p>
      <p><a class="btn" href="{{shop.url}}/shop">Zum Shop</a></p>
      <p class="help">Was wir auf Lager haben, geht automatisch raus; alles andere liefern wir von Hand.</p>
      <p class="fine">Du bekommst diese Mail, weil du dich angemeldet hast. <a href="{{unsubscribe.url}}">Abmelden</a></p>`,
    },
    gift_card: {
      subject: 'Du hast einen {{brand.name}}-Gutschein über {{giftCard.amount}} bekommen 🎁',
      body_html: `
      <h1>Du hast einen Gutschein bekommen</h1>
      <p>Hallo, jemand hat dir <strong>{{giftCard.amount}}</strong> geschickt, die du bei {{brand.name}}
      ausgeben kannst. Löse den Code unten ein; das Guthaben landet auf deinem Konto und wird an der Kasse
      automatisch verrechnet.</p>
      <p class="code">{{giftCard.code}}</p>
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">Wert {{giftCard.amount}} · einmal einlösbar</span></p>
      {{giftCard.noteHtml}}
      <p><a class="btn" href="{{app.url}}/account/wallet">Gutschein einlösen</a></p>
      <p class="help">Der Button bringt dich zu deinem Wallet. Noch kein Konto? Erstell kostenlos eins mit
      dieser E-Mail-Adresse und füg danach den Code ein.</p>
      <div class="notice"><strong>Behalte diesen Code für dich.</strong> Wer ihn hat, kann das Guthaben einlösen.</div>`,
    },
    login_otp: {
      subject: 'Dein Anmeldecode für {{brand.name}}',
      body_html: `
      <h1 style="text-align:center">Dein Anmeldecode</h1>
      <p style="text-align:center">Gib diesen Code auf der Anmeldeseite von {{brand.name}} ein.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">Läuft in {{otp.ttl}} Minuten ab · einmal verwendbar</span></p>
      <p class="help" style="text-align:center">Tippst du ihn auf einem anderen Gerät ab? Der Code lautet
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice"><strong>Gib diesen Code nur auf {{app.host}} ein.</strong> {{brand.name}} fragt dich
      <strong>nie</strong> nach diesem Code — nicht per Mail, DM oder Telefon. Wolltest du dich nicht anmelden?
      Dann kannst du diese Mail ignorieren; ohne den Code kommt niemand in dein Konto.</div>`,
    },
    security_alert: {
      subject: 'Neue Anmeldung bei deinem {{brand.name}}-Konto',
      body_html: `
      <h1>Neue Anmeldung bei deinem Konto</h1>
      <p>Hallo {{user.name}}, gerade hat sich jemand bei deinem {{brand.name}}-Konto angemeldet, von einem Gerät
      oder Ort, den wir noch nicht kannten.</p>
      <div class="quote">{{login.detailsHtml}}</div>
      <p><strong>Warst du das?</strong> Dann musst du nichts tun.<br>
      <strong>Warst du das nicht?</strong> Melde das Gerät in deinen Sicherheitseinstellungen ab und antworte auf
      diese Mail, dann schauen wir es uns mit dir an.</p>
      <p><a class="btn" href="{{app.url}}/account/settings">Sicherheitseinstellungen öffnen</a></p>
      <p class="help">Wir fragen nie nach einem Anmeldecode oder Passwort — nicht per Mail, DM oder Telefon.</p>`,
    },
    order_cancelled: {
      subject: 'Bestellung {{order.number}} wurde storniert',
      body_html: `
      <h1>Deine Bestellung wurde storniert</h1>
      <p>Hallo {{user.name}}, Bestellung <strong>{{order.number}}</strong> (Gesamt <strong>{{order.total}}</strong>)
      wurde storniert. Möchtest du sie doch? Du kannst jederzeit neu bestellen.</p>
      {{cancel.reasonHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{app.url}}/shop">Zum Shop</a></p>
      <p class="help">Hattest du schon bezahlt, oder stimmt das nicht? Antworte auf diese Mail, dann klären wir das.</p>`,
    },
    order_on_hold: {
      subject: 'Bestellung {{order.number}}: Zahlung eingegangen, noch eine kurze Prüfung',
      body_html: `
      <h1>Zahlung eingegangen — noch eine kurze Prüfung</h1>
      <p>Hallo {{user.name}}, deine Zahlung für Bestellung <strong>{{order.number}}</strong> ist da. Bevor wir
      liefern, schaut sich jemand von uns die Bestellung kurz an. Du musst nichts tun; brauchen wir etwas von
      dir, schreiben wir dir.</p>
      <p>Das machen wir bei einem Teil der Bestellungen, unter anderem, um Missbrauch von Zahlungsdaten zu verhindern.</p>
      {{order.needsFromBuyerHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Bestellung verfolgen</a></p>
      <p class="help">Fragen? Antworte auf diese Mail oder öffne ein Ticket in unserem Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_not_verified: {
      subject: 'Wir haben deine Zahlung für Bestellung {{order.number}} noch nicht gefunden',
      body_html: `
      <h1>Wir haben deine Zahlung noch nicht gefunden</h1>
      <p>Hallo {{user.name}}, du hast einen Zahlungsnachweis für Bestellung <strong>{{order.number}}</strong>
      geschickt, aber wir konnten die Zahlung noch nicht zuordnen. Prüf den Betrag (<strong>{{order.total}}</strong>)
      und ob deine Bestellnummer als Verwendungszweck angegeben war, und schick deinen Nachweis dann erneut.</p>
      {{proof.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">Nachweis erneut senden</a></p>
      <p class="help">Sicher, dass es stimmt? Antworte auf diese Mail mit einem Screenshot der Zahlung, dann prüfen wir es.</p>`,
    },
    refund_request_received: {
      subject: 'Deine Erstattungsanfrage für Bestellung {{order.number}} ist eingegangen',
      body_html: `
      <h1>Deine Anfrage ist da</h1>
      <p>Hallo {{user.name}}, wir haben deine Erstattungsanfrage für Bestellung
      <strong>{{order.number}}</strong> erhalten. Jemand von uns prüft sie; unsere Entscheidung bekommst du per Mail.</p>
      {{request.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">Bestellung ansehen</a></p>
      <p class="help">Möchtest du etwas ergänzen? Antworte auf diese Mail.</p>`,
    },
    refund_request_rejected: {
      subject: 'Entscheidung zu deiner Erstattungsanfrage für Bestellung {{order.number}}',
      body_html: `
      <h1>Wir können diese Anfrage nicht bewilligen</h1>
      <p>Hallo {{user.name}}, wir haben deine Erstattungsanfrage für Bestellung
      <strong>{{order.number}}</strong> geprüft und können sie nicht bewilligen.</p>
      {{request.reasonHtml}}
      <p>Bist du anderer Meinung, oder haben wir etwas übersehen? Antworte auf diese Mail mit dem, was los ist,
      dann schaut sich jemand das noch einmal an. Auf der Seite zu Widerruf und Erstattung steht, wann du dein
      Geld zurückbekommst.</p>
      <p><a class="btn" href="{{app.url}}/refunds">Widerruf &amp; Erstattung</a></p>
      <p class="help">Du kannst einfach auf diese Mail antworten.</p>`,
    },
    ticket_opened: {
      subject: 'Wir haben dein Ticket {{ticket.number}} erhalten',
      body_html: `
      <h1>Wir haben deine Nachricht erhalten</h1>
      <p>Hallo {{user.name}}, Ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}} ist bei uns. Unsere
      Antwort bekommst du per Mail.</p>
      <div class="quote">{{ticket.subject}}</div>
      <p><a class="btn" href="{{ticket.url}}">Ticket ansehen</a></p>
      <p class="help">Möchtest du etwas ergänzen? Antworte einfach auf diese Mail.</p>`,
    },
    newsletter_confirm: {
      subject: 'Bestätige deine Anmeldung bei {{brand.name}}',
      body_html: `
      <h1>Bestätige deine Anmeldung</h1>
      <p>Hallo, diese Adresse wurde für Nachrichten von {{brand.name}} eingetragen. Erst wenn du unten
      bestätigst, schicken wir dir etwas.</p>
      <p><a class="btn" href="{{newsletter.confirmUrl}}">Anmeldung bestätigen</a></p>
      <p class="help">Warst du das nicht? Dann ignoriere diese Mail einfach.</p>`,
    },
  },
  fr: {
    account_created: {
      subject: 'Bienvenue chez {{brand.name}} 🎉',
      body_html: `
      <h1>Bienvenue, {{user.name}}</h1>
      <p>Ton compte {{brand.name}} est prêt. Tu peux maintenant commander, suivre tes commandes et télécharger
      tes factures depuis ton compte.</p>
      <p><strong>Pas de mot de passe.</strong> Tu te connectes avec un code que nous t’envoyons par e-mail, et
      tu restes connecté(e) sur cet appareil.</p>
      <p><a class="btn" href="{{app.url}}/account">Aller à mon compte</a></p>
      <p class="help">Des questions ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>`,
    },
    order_received: {
      subject: 'Commande {{order.number}} passée — finalise ton paiement',
      body_html: `
      <h1>Ta commande est passée</h1>
      <p>Bonjour {{user.name}}, nous avons reçu la commande <strong>{{order.number}}</strong> (total
      <strong>{{order.total}}</strong>). Finalise ton paiement ; dès qu’il est reçu, nous livrons.</p>
      {{order.paymentHtml}}
      {{order.itemsHtml}}
      {{order.needsFromBuyerHtml}}
      <p><a class="btn" href="{{order.url}}">Finaliser le paiement</a></p>
      <p class="help">Cette page affiche aussi le statut de ta commande — sans compte. Des questions ?
      Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_reminder: {
      subject: 'La commande {{order.number}} attend encore ton paiement ⏳',
      body_html: `
      <h1>Nous attendons encore ton paiement</h1>
      <p>Bonjour {{user.name}}, tu as passé la commande <strong>{{order.number}}</strong> (total
      <strong>{{order.total}}</strong>), mais ton paiement n’est pas encore arrivé. La commande reste ouverte
      {{order.openDays}} jours après sa création ; ensuite, nous l’annulons automatiquement.</p>
      {{order.paymentHtml}}
      {{order.itemsHtml}}
      <p><a class="btn" href="{{order.url}}">Finaliser le paiement</a></p>
      <p class="help">Déjà payé ? Tu peux ignorer cet e-mail — un paiement peut mettre un peu de temps à être
      confirmé. Des questions ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>`,
    },
    payment_confirmed: {
      subject: 'Paiement reçu pour la commande {{order.number}} ✅',
      body_html: `
      <h1>Paiement reçu</h1>
      <p>Bonjour {{user.name}}, ton paiement pour la commande <strong>{{order.number}}</strong> est arrivé. Tu
      n’as plus rien à faire : nous préparons ta commande.</p>
      {{order.needsFromBuyerHtml}}
      {{order.summaryHtml}}
      <p>Ce que nous avons en stock part automatiquement ; ce que nous achetons pour toi, nous le livrons à la
      main. Dans tous les cas, la livraison arrive dans cette boîte mail.</p>
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p class="help">Cette page se met à jour toute seule — sans compte. Des questions ? Réponds à cet e-mail
      ou ouvre un ticket sur notre Discord.</p>
      {{order.invoiceHtml}}
      {{order.consentHtml}}`,
    },
    order_processing: {
      subject: 'Nous préparons la commande {{order.number}}',
      body_html: `
      <h1>Nous préparons ta commande</h1>
      <p>Bonjour {{user.name}}, nous préparons la commande <strong>{{order.number}}</strong> à la main. Tu
      recevras un e-mail dès qu’elle est livrée.</p>
      {{order.needsFromBuyerHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p class="help">C’est plus long que prévu ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord —
      nous préférons le savoir tôt.</p>`,
    },
    order_completed: {
      subject: 'La commande {{order.number}} est livrée 🎮',
      body_html: `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
        <td style="padding:0 8px 0 0"><span style="display:inline-block;padding:6px 13px;background-color:#0e1f18;border:1px solid #145c43;border-radius:999px;color:#34d399;font-size:12px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif">● Livrée</span></td>
        <td><span style="display:inline-block;padding:6px 13px;background-color:#181826;border:1px solid #34345a;border-radius:999px;color:#9aa3b8;font-size:12px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif">Commande {{order.number}}</span></td>
      </tr></table>
      <div style="font:800 28px/1.2 'Segoe UI',Arial,sans-serif;color:#ffffff;letter-spacing:-.4px">Ta commande est livrée</div>
      <div style="font:400 15px/1.6 'Segoe UI',Arial,sans-serif;color:#b9bfcd;padding-top:10px">Bonjour {{user.name}}, voici ce que tu as commandé et comment l’utiliser. Garde cet e-mail.</div>
      <div style="padding-top:22px">{{order.deliveryHtml}}</div>
      {{order.redeemHtml}}
      <div style="height:1px;font-size:0;line-height:1px;background-color:#26263a;margin:26px 0 20px">&nbsp;</div>
      <div style="font:700 11px/1 'Segoe UI',Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#8b8fa3;padding-bottom:12px">Récapitulatif de la commande</div>
      {{order.summaryHtml}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 4px"><tr>
        <td align="center" bgcolor="#7c5cff" style="border-radius:12px;background-color:#7c5cff;background-image:linear-gradient(120deg,#7c5cff 0%,#a855f7 55%,#d946ef 100%)">
          <a class="btn" href="{{order.url}}" style="display:block;margin:0;padding:15px 24px;font:700 16px/20px 'Segoe UI',Arial,sans-serif;color:#ffffff;text-decoration:none;box-shadow:none">Voir ma commande</a>
        </td>
      </tr></table>
      {{order.invoiceHtml}}
      {{order.reviewAskHtml}}
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Un souci ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</div>
      {{order.consentHtml}}`,
    },
    refund_issued: {
      subject: 'Remboursement de la commande {{order.number}} : {{refund.amount}}',
      body_html: `
      <h1>Ton remboursement est effectué</h1>
      <p>Bonjour {{user.name}}, nous avons remboursé <strong>{{refund.amount}}</strong> pour la commande
      <strong>{{order.number}}</strong>. Voici comment et vers où.</p>
      {{refund.detailsHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Voir ma commande</a></p>
      <p class="help">Le montant n’est pas le bon, ou rien n’est arrivé après quelques jours ouvrés ? Réponds
      à cet e-mail et nous nous en occupons.</p>`,
    },
    custom_message: {
      subject: '{{subject}} — commande {{order.number}}',
      body_html: `
      <h1>{{subject}}</h1>
      <p>Bonjour {{user.name}}, ce message concerne la commande <strong>{{order.number}}</strong> :</p>
      <div class="quote">{{messageHtml}}</div>
      <p><a class="btn" href="{{order.url}}">Voir ma commande</a></p>
      <p class="help">Tu peux simplement répondre à cet e-mail — il arrive chez la personne qui l’a envoyé.</p>`,
    },
    support_reply: {
      subject: 'Re : {{ticket.subject}} · ticket {{ticket.number}}',
      body_html: `
      <h1>Nouvelle réponse à ton ticket</h1>
      <p>Bonjour {{user.name}}, nous avons répondu au ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}} :</p>
      <div class="quote">{{replyHtml}}</div>
      <p><a class="btn" href="{{ticket.url}}">Lire la conversation</a></p>
      <p class="help">Réponds simplement à cet e-mail — ton message arrive sur le même ticket.</p>`,
    },
    cart_reminder: {
      subject: 'Ceci est encore dans ton panier 🛒',
      body_html: `
      <h1>Ceci est encore dans ton panier</h1>
      <p>Bonjour {{user.name}}, ton panier chez {{brand.name}} est enregistré. Tu veux continuer ? Il t’attend,
      aux prix actuels.</p>
      {{cart.itemsHtml}}
      <p><a class="btn" href="{{cart.url}}">Voir mon panier</a></p>
      <p class="help">Des questions ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>
      <p class="fine">Plus de rappels ? <a href="{{unsubscribe.url}}">Se désabonner</a></p>`,
    },
    price_drop: {
      subject: '{{product.name}} coûte maintenant {{price.current}} \u{1F4C9}',
      body_html: `
      <h1>Baisse de prix sur ta liste de souhaits</h1>
      <p>Bonjour {{user.name}}, <strong>{{product.name}}</strong> est moins cher.</p>
      <p style="font-size:15px;margin:18px 0 4px">
        <span style="color:#8b93a7;text-decoration:line-through">{{price.previous}}</span>
        &nbsp;→&nbsp;<strong style="font-size:22px">{{price.current}}</strong></p>
      <p style="margin:0 0 18px"><span class="pill-note">{{price.diff}} de moins</span></p>
      <p><a class="btn" href="{{product.url}}">Voir le produit</a></p>
      <p class="help">Tu avais enregistré ce produit à {{price.saved}}. <a href="{{wishlist.url}}">Voir ma liste de souhaits</a></p>
      <p class="fine">Tu reçois ceci parce que tu as activé une alerte de prix.
      <a href="{{wishlist.alertsOffUrl}}">Désactiver toutes les alertes de prix</a></p>`,
    },
    review_request: {
      subject: 'Comment s’est passée la commande {{order.number}} ? ⭐',
      body_html: `
      <h1>Comment s’est passée ta commande ?</h1>
      <p>Bonjour {{user.name}}, merci pour la commande <strong>{{order.number}}</strong>. Tout est arrivé comme
      prévu ? Un court avis aide d’autres joueurs à décider s’ils veulent acheter chez nous.</p>
      <p><a class="btn" href="{{review.url}}">Laisser un avis</a></p>
      {{review.trustpilotHtml}}
      <p class="help">Un souci ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord et nous regardons.</p>
      <p class="fine">Plus de demandes d’avis ? <a href="{{unsubscribe.url}}">Les désactiver</a></p>`,
    },
    launch_announcement: {
      subject: '{{shop.name}} est ouvert \u{1F680}',
      body_html: `
      <h1>Nous sommes ouverts</h1>
      <p>Bonjour, tu nous avais demandé de te prévenir à l’ouverture de {{shop.name}}. C’est fait : la boutique
      est ouverte et tu peux commander.</p>
      <p><a class="btn" href="{{shop.url}}/shop">Visiter la boutique</a></p>
      <p class="help">Ce que nous avons en stock part automatiquement ; le reste, nous le livrons à la main.</p>
      <p class="fine">Tu reçois cet e-mail parce que tu t’étais inscrit(e). <a href="{{unsubscribe.url}}">Se désabonner</a></p>`,
    },
    gift_card: {
      subject: 'Tu as reçu une carte cadeau {{brand.name}} de {{giftCard.amount}} 🎁',
      body_html: `
      <h1>Tu as reçu une carte cadeau</h1>
      <p>Bonjour, quelqu’un t’a envoyé <strong>{{giftCard.amount}}</strong> à dépenser chez {{brand.name}}.
      Utilise le code ci-dessous ; le montant arrive dans ton crédit boutique et se déduit automatiquement au
      paiement.</p>
      <p class="code">{{giftCard.code}}</p>
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">Valeur {{giftCard.amount}} · utilisable une fois</span></p>
      {{giftCard.noteHtml}}
      <p><a class="btn" href="{{app.url}}/account/wallet">Utiliser ma carte cadeau</a></p>
      <p class="help">Le bouton t’amène à ton Wallet. Pas encore de compte ? Crée-en un gratuitement avec cette
      adresse e-mail, puis colle le code.</p>
      <div class="notice"><strong>Garde ce code pour toi.</strong> Toute personne qui l’a peut utiliser le solde.</div>`,
    },
    login_otp: {
      subject: 'Ton code de connexion {{brand.name}}',
      body_html: `
      <h1 style="text-align:center">Ton code de connexion</h1>
      <p style="text-align:center">Saisis ce code sur l’écran de connexion de {{brand.name}}.</p>
      {{otp.codeHtml}}
      <p style="text-align:center;margin:14px 0 6px"><span class="pill-note">Expire dans {{otp.ttl}} minutes · usage unique</span></p>
      <p class="help" style="text-align:center">Tu le recopies sur un autre appareil ? Le code est
      <strong style="letter-spacing:2px;color:#e5e7eb">{{otp.code}}</strong></p>
      <div class="notice"><strong>Ne saisis ce code que sur {{app.host}}.</strong> {{brand.name}} ne te demandera
      <strong>jamais</strong> ce code — ni par e-mail, ni par DM, ni par téléphone. Tu n’as pas essayé de te
      connecter ? Ignore cet e-mail ; sans le code, personne ne peut accéder à ton compte.</div>`,
    },
    security_alert: {
      subject: 'Nouvelle connexion à ton compte {{brand.name}}',
      body_html: `
      <h1>Nouvelle connexion à ton compte</h1>
      <p>Bonjour {{user.name}}, quelqu’un vient de se connecter à ton compte {{brand.name}} depuis un appareil
      ou un lieu que nous ne connaissions pas encore.</p>
      <div class="quote">{{login.detailsHtml}}</div>
      <p><strong>C’était toi ?</strong> Alors tu n’as rien à faire.<br>
      <strong>Ce n’était pas toi ?</strong> Déconnecte l’appareil dans tes paramètres de sécurité et réponds à
      cet e-mail, nous regarderons avec toi.</p>
      <p><a class="btn" href="{{app.url}}/account/settings">Ouvrir mes paramètres de sécurité</a></p>
      <p class="help">Nous ne demandons jamais de code de connexion ni de mot de passe — ni par e-mail, ni par DM, ni par téléphone.</p>`,
    },
    order_cancelled: {
      subject: 'La commande {{order.number}} a été annulée',
      body_html: `
      <h1>Ta commande a été annulée</h1>
      <p>Bonjour {{user.name}}, la commande <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>)
      a été annulée. Tu la veux quand même ? Tu peux passer une nouvelle commande à tout moment.</p>
      {{cancel.reasonHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{app.url}}/shop">Visiter la boutique</a></p>
      <p class="help">Tu avais déjà payé, ou ce n’est pas normal ? Réponds à cet e-mail et nous vérifions.</p>`,
    },
    order_on_hold: {
      subject: 'Commande {{order.number}} : paiement reçu, encore une courte vérification',
      body_html: `
      <h1>Paiement reçu — encore une courte vérification</h1>
      <p>Bonjour {{user.name}}, ton paiement pour la commande <strong>{{order.number}}</strong> est arrivé. Avant de
      livrer, l’un de nous jette un œil à la commande. Tu n’as rien à faire ; si nous avons besoin de quelque
      chose, nous t’écrivons.</p>
      <p>Nous le faisons pour une partie des commandes, notamment pour éviter l’utilisation abusive de moyens de paiement.</p>
      {{order.needsFromBuyerHtml}}
      {{order.summaryHtml}}
      <p><a class="btn" href="{{order.url}}">Suivre ma commande</a></p>
      <p class="help">Des questions ? Réponds à cet e-mail ou ouvre un ticket sur notre Discord.</p>
      {{order.consentHtml}}`,
    },
    payment_not_verified: {
      subject: 'Nous n’avons pas encore trouvé ton paiement pour la commande {{order.number}}',
      body_html: `
      <h1>Nous n’avons pas encore trouvé ton paiement</h1>
      <p>Bonjour {{user.name}}, tu as envoyé une preuve de paiement pour la commande <strong>{{order.number}}</strong>,
      mais nous n’avons pas encore pu retrouver ce paiement. Vérifie le montant (<strong>{{order.total}}</strong>)
      et que ton numéro de commande figure en référence, puis renvoie ta preuve.</p>
      {{proof.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">Renvoyer la preuve</a></p>
      <p class="help">Tu es sûr(e) que c’est correct ? Réponds à cet e-mail avec une capture du paiement et nous vérifions.</p>`,
    },
    refund_request_received: {
      subject: 'Ta demande de remboursement pour la commande {{order.number}} est reçue',
      body_html: `
      <h1>Ta demande est bien arrivée</h1>
      <p>Bonjour {{user.name}}, nous avons reçu ta demande de remboursement pour la commande
      <strong>{{order.number}}</strong>. L’un de nous l’examine ; tu recevras notre décision par e-mail.</p>
      {{request.reasonHtml}}
      <p><a class="btn" href="{{order.url}}">Voir ma commande</a></p>
      <p class="help">Tu veux ajouter quelque chose ? Réponds à cet e-mail.</p>`,
    },
    refund_request_rejected: {
      subject: 'Décision sur ta demande de remboursement pour la commande {{order.number}}',
      body_html: `
      <h1>Nous ne pouvons pas accepter cette demande</h1>
      <p>Bonjour {{user.name}}, nous avons examiné ta demande de remboursement pour la commande
      <strong>{{order.number}}</strong> et ne pouvons pas l’accepter.</p>
      {{request.reasonHtml}}
      <p>Tu n’es pas d’accord, ou nous avons oublié quelque chose ? Réponds à cet e-mail en expliquant la
      situation et quelqu’un la réexaminera. La page rétractation et remboursement explique quand tu as droit
      à un remboursement.</p>
      <p><a class="btn" href="{{app.url}}/refunds">Rétractation &amp; remboursement</a></p>
      <p class="help">Tu peux simplement répondre à cet e-mail.</p>`,
    },
    ticket_opened: {
      subject: 'Nous avons reçu ton ticket {{ticket.number}}',
      body_html: `
      <h1>Nous avons reçu ton message</h1>
      <p>Bonjour {{user.name}}, le ticket <strong>{{ticket.number}}</strong>{{ticket.orderLine}} est bien chez
      nous. Tu recevras notre réponse par e-mail.</p>
      <div class="quote">{{ticket.subject}}</div>
      <p><a class="btn" href="{{ticket.url}}">Voir mon ticket</a></p>
      <p class="help">Tu veux ajouter quelque chose ? Réponds simplement à cet e-mail.</p>`,
    },
    newsletter_confirm: {
      subject: 'Confirme ton inscription chez {{brand.name}}',
      body_html: `
      <h1>Confirme ton inscription</h1>
      <p>Bonjour, cette adresse a été inscrite pour recevoir les messages de {{brand.name}}. Nous ne t’envoyons
      rien tant que tu n’as pas confirmé ci-dessous.</p>
      <p><a class="btn" href="{{newsletter.confirmUrl}}">Confirmer mon inscription</a></p>
      <p class="help">Ce n’était pas toi ? Ignore simplement cet e-mail.</p>`,
    },
  },
};
