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
  {
    id: 'order_received',
    name: 'Order Received',
    subject: 'Thanks for your order {{order.number}} 🎮',
    body_html: `
      <h1>Thank you for your order! 🎉</h1>
      <p>Hi {{user.name}}, thanks for shopping with {{brand.name}}! We've received
      order <strong>{{order.number}}</strong> (total <strong>{{order.total}}</strong>).</p>
      {{order.itemsHtml}}
      {{order.paymentHtml}}
      <p>Once your payment is confirmed we deliver instantly to your account & email.
      You can follow the status any time:</p>
      <p><a class="btn" href="{{order.url}}">Track your order</a></p>
      <p>Need help? Just reply to this email or open a ticket in our Discord.</p>`,
  },
  {
    id: 'payment_reminder',
    name: 'Payment Reminder',
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
  {
    id: 'payment_confirmed',
    name: 'Payment Confirmed',
    subject: 'Payment confirmed for {{order.number}}',
    body_html: `
      <h1>Payment received ✅</h1>
      <p>We've confirmed payment for order <strong>{{order.number}}</strong>.
      We're preparing your order now.</p>
      <p><a class="btn" href="{{order.url}}">View order status</a></p>`,
  },
  {
    id: 'order_processing',
    name: 'Order Processing',
    subject: 'Your order {{order.number}} is being processed',
    body_html: `
      <h1>We're on it 🔧</h1>
      <p>Order <strong>{{order.number}}</strong> is now being processed and will
      move to fulfillment shortly.</p>
      <p><a class="btn" href="{{order.url}}">Track in real time</a></p>`,
  },
  {
    id: 'order_completed',
    name: 'Order Completed',
    subject: 'Your order {{order.number}} is ready 🎮',
    // Premium, fully inline-styled (survives clients that strip <style>). The
    // delivery hero + order breakdown are injected server-side.
    body_html: `
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
      <div style="font:400 13px/1.6 'Segoe UI',Arial,sans-serif;color:#8b8fa3;text-align:center;padding-top:16px">Something not right? Just reply to this email or open a ticket in our Discord — real humans, fast. 💬</div>`,
  },
  {
    id: 'refund_issued',
    name: 'Refund Issued',
    subject: 'Refund issued for {{order.number}}',
    body_html: `
      <h1>Your refund is on the way</h1>
      <p>We've issued a refund of <strong>{{refund.amount}}</strong> for order
      <strong>{{order.number}}</strong>. It may take a few business days to
      appear on your statement.</p>
      <p><a class="btn" href="{{order.url}}">View order</a></p>`,
  },
  {
    id: 'custom_message',
    name: 'Message from Support',
    subject: 'A message about your order {{order.number}}',
    body_html: `
      <h1>{{subject}}</h1>
      <p>Hi {{user.name}}, our team sent you a message regarding order
      <strong>{{order.number}}</strong>:</p>
      <div class="quote">{{message}}</div>
      <p><a class="btn" href="{{order.url}}">View your order</a></p>`,
  },
  {
    id: 'cart_reminder',
    name: 'Abandoned Cart',
    subject: 'You left something in your cart 🛒',
    body_html: `
      <div class="badge">🛒</div>
      <h1 style="text-align:center">Still thinking it over?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, you left these
      in your cart at {{brand.name}}. They're still here — grab them before they're gone.</p>
      {{cart.itemsHtml}}
      <p style="text-align:center"><a class="btn" href="{{cart.url}}">Complete your order</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Instant delivery, buyer-protected. Questions? Just reply
      to this email or open a ticket in our Discord.</p>`,
  },
  {
    id: 'review_request',
    name: 'Review Request',
    subject: 'How was your order {{order.number}}? ⭐',
    body_html: `
      <div class="badge">⭐</div>
      <h1 style="text-align:center">How did we do?</h1>
      <p style="text-align:center;max-width:420px;margin-left:auto;margin-right:auto">Hi {{user.name}}, thanks again
      for your order <strong>{{order.number}}</strong>! If everything arrived as expected, a quick review would
      mean the world — it takes 20 seconds and helps other gamers buy with confidence.</p>
      <p style="text-align:center"><a class="btn" href="{{review.url}}">Leave a quick review</a></p>
      <p style="text-align:center;color:#8b93a7;font-size:13px">Something not right? Just reply to this email or open
      a ticket in our Discord and we'll make it right.</p>`,
  },
  {
    id: 'gift_card',
    name: 'Gift Card',
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
  {
    id: 'login_otp',
    name: 'Login Code',
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
];

/**
 * Superseded default bodies, keyed by template id. When seeding an existing
 * database we upgrade a template ONLY if its stored body still matches one of
 * these — so improved defaults roll out everywhere except where an admin has
 * customized the template.
 */
export const LEGACY_TEMPLATE_BODIES = {
  order_completed: [`
      <h1>Order complete!</h1>
      <p>Hi {{user.name}}, your order <strong>{{order.number}}</strong> is done — here
      are your items. Keep this email safe.</p>
      {{order.deliveriesHtml}}
      {{order.itemsHtml}}
      <p><a class="btn" href="{{order.url}}">View in your dashboard</a></p>`],
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
