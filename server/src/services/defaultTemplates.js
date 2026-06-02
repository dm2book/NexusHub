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
    subject: 'We received your order {{order.number}}',
    body_html: `
      <h1>Thanks for your order!</h1>
      <p>Hi {{user.name}}, we've received order <strong>{{order.number}}</strong>
      and it's now pending payment confirmation.</p>
      <p>Total: <strong>{{order.total}}</strong></p>
      <p><a class="btn" href="{{order.url}}">Track your order</a></p>`,
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
      <p>Hi {{user.name}}, your order <strong>{{order.number}}</strong> is done.
      Any digital deliveries are available in your dashboard.</p>
      <p><a class="btn" href="{{order.url}}">View deliveries & downloads</a></p>`,
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
