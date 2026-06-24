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
      <h1>Welcome, {{user.name}}!</h1>
      <p>Your {{brand.name}} account is ready. You can now place orders, track
      deliveries, download invoices and manage everything from your dashboard.</p>
      <p><a class="btn" href="{{app.url}}/account">Go to your dashboard</a></p>`,
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
    subject: 'Your order {{order.number}} is complete 🎁',
    body_html: `
      <h1>Order complete!</h1>
      <p>Hi {{user.name}}, your order <strong>{{order.number}}</strong> is done — here
      are your items. Keep this email safe.</p>
      {{order.deliveriesHtml}}
      {{order.itemsHtml}}
      <p><a class="btn" href="{{order.url}}">View in your dashboard</a></p>`,
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
    id: 'login_otp',
    name: 'Login Code',
    subject: 'Your {{brand.name}} login code: {{otp.code}}',
    body_html: `
      <h1>Your login code</h1>
      <p>Use this code to sign in. It expires in {{otp.ttl}} minutes.</p>
      <p class="code">{{otp.code}}</p>
      <p>If you didn't request this, you can safely ignore this email.</p>`,
  },
];
