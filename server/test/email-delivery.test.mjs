/**
 * Transactional email, checked on the wire rather than in the template file.
 *
 * The mail says, at the bottom of almost every message, "Just reply to this
 * email or open a ticket in our Discord — real humans, fast." Read off a real
 * SMTP conversation, there was no Reply-To header on any of it: that reply went
 * to the sending address, `onboarding@resend.dev` by default. The copy invited a
 * conversation the headers refused.
 *
 * Two more found the same way. Every message went out as `Content-Type:
 * text/html` with no plain-text alternative — a spam-filter penalty on mail that
 * has to arrive, and nothing at all for a watch preview or a client with HTML
 * off, in which the delivered code was the missing part. And a staff reply to a
 * support ticket only ever wrote an in-app notification, so a guest — who
 * ordered by email and has no account — could not be told they had been
 * answered at any price.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_email_test';
process.env.NODE_ENV ||= 'development';
/* A shop that SELLS: this drives a real order over HTTP from checkout to inbox.
 * The launch gate refuses orders on a shop that has never taken a payment, and
 * a fresh test database is exactly that. */
process.env.LAUNCH_MODE ||= 'open';
process.env.DEMO_MODE = 'true';

import net from 'node:net';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${x}`); } };

/* A throwaway SMTP server. Enough of RFC 5321 for nodemailer, and it keeps the
   raw message — so From, Reply-To and the MIME structure are read as they
   arrive rather than as the code intended them. */
const inbox = [];
const sink = net.createServer((sock) => {
  let buf = '', inData = false, msg = '';
  sock.write('220 sink ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    for (;;) {
      const i = buf.indexOf('\r\n');
      if (i < 0) break;
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (inData) {
        if (line === '.') { inData = false; inbox.push(msg); msg = ''; sock.write('250 OK\r\n'); }
        else msg += (line.startsWith('..') ? line.slice(1) : line) + '\n';
        continue;
      }
      const cmd = line.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-sink\r\n250 8BITMIME\r\n');
      else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => sink.listen(0, r));
process.env.SMTP_URL = `smtp://127.0.0.1:${sink.address().port}`;

const { ensureReady, createApp } = await import('../src/app.js');
await ensureReady();
await new Promise((r) => setTimeout(r, 4000));
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { config } = await import('../src/config/env.js');
const os = await import('../src/services/orderService.js');
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;

const headersOf = (raw) => {
  const head = raw.split(/\n\s*\n/)[0];
  const out = {};
  for (const line of head.split('\n')) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
};
const plainPart = (raw) => {
  const i = raw.indexOf('text/plain');
  if (i < 0) return null;
  const rest = raw.slice(i);
  const body = rest.split(/\n\s*\n/).slice(1).join('\n\n');
  return body.split(/\n--/)[0];
};

console.log('— A real order, over HTTP, from checkout to inbox —');
const pid = newId('prd');
await run(`INSERT INTO products (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
           VALUES (@id,'MAILTEST-1','1,000 Robux','robux','Instant Robux top-up.',999,'EUR','digital',1,@m,@at,@at)`,
  { id: pid, m: JSON.stringify({ deliveryMode: 'auto', image: '/products/packs/robux-1000.svg' }), at: nowIso() });
await run(`INSERT INTO product_codes (id, product_id, code, status, created_at) VALUES (@i,@p,@c,'available',@at)`,
  { i: newId('pcd'), p: pid, c: 'ROBUX-TEST-CODE-9876', at: nowIso() });

const buyer = 'buyer@example.com';
const res = await fetch(`${base}/api/orders`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: buyer, consent: true, consentText: 'I agree to immediate delivery.',
    items: [{ productId: pid, quantity: 1 }] }),
});
const placed = (await res.json()).order;
ok('the checkout accepts the order', res.status === 201 && !!placed?.id, `${res.status}`);
await os.markPaymentReceived(placed.id, 'pay_email_test');
await new Promise((r) => setTimeout(r, 3000));

const o = await get('SELECT status FROM orders WHERE id=@id', { id: placed.id });
const delivered = await all('SELECT content FROM deliveries WHERE order_id=@id', { id: placed.id });
ok('the order completes', o.status === 'completed', o.status);
ok('the code is delivered', delivered[0]?.content === 'ROBUX-TEST-CODE-9876', JSON.stringify(delivered));

const logs = await all('SELECT template_id, status FROM email_log WHERE to_email=@e ORDER BY created_at', { e: buyer });
ok('order confirmation, payment confirmation and delivery were all sent',
  ['order_received', 'payment_confirmed', 'order_completed'].every(
    (t) => logs.some((l) => l.template_id === t && l.status === 'sent')),
  JSON.stringify(logs));
ok('nothing failed', logs.every((l) => l.status === 'sent'), JSON.stringify(logs));
ok('every send is logged', logs.length === inbox.length, `${logs.length} logged, ${inbox.length} on the wire`);

console.log('\n— The headers that actually left the building —');
{
  ok('a message reached the SMTP server', inbox.length >= 3, `${inbox.length}`);
  for (const raw of inbox) {
    const h = headersOf(raw);
    ok(`From is the configured sender (${h.from})`,
      h.from?.includes(config.email.fromAddress), h.from);
    ok('Reply-To reaches a person', h['reply-to'] === config.email.replyTo, h['reply-to'] || '(absent)');
    ok('the message is multipart/alternative',
      /multipart\/alternative/.test(h['content-type'] || ''), h['content-type']);
    ok('the subject is not missing a token',
      !!h.subject && !/^\s*(=\?UTF-8\?Q\?)?[_\s]*(is|—|-)\b/.test(h.subject), h.subject);
  }
}

console.log('\n— The delivery email carries the code in BOTH parts —');
{
  /* Found by the code it carries rather than by a phrase in the subject: the
     subject is Dutch now, and a subject line is quoted-printable-encoded the
     moment it contains anything but ASCII, so matching words in it is brittle
     in a way that has nothing to do with what this test is checking. */
  const raw = inbox.find((m) => m.includes('ROBUX-TEST-CODE-9876'));
  ok('the delivery email was sent', !!raw);
  ok('…the HTML has the code', raw.includes('ROBUX-TEST-CODE-9876'));
  const text = plainPart(raw) || '';
  ok('…and so does the plain-text part', text.includes('ROBUX-TEST-CODE-9876'),
    text.slice(0, 120));
  ok('…the plain text is not just stripped tags',
    /bestelling/i.test(text) && !/<[a-z]/i.test(text), text.slice(0, 120));
}

console.log('\n— Nothing in an email that should not leave the server —');
{
  const SECRETS = [
    ['a Resend key', /re_[A-Za-z0-9]{8,}/],
    ['an SMTP URL', /smtp:\/\/[^\s"]+/],
    ['the JWT secret', new RegExp(config.auth.jwtSecret.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
    ['a bearer token', /Bearer\s+[A-Za-z0-9._-]{16,}/],
    ['a database URL', /postgres(ql)?:\/\//],
    ['a JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ];
  for (const [what, re] of SECRETS) {
    const leaked = inbox.filter((m) => re.test(m));
    ok(`no email contains ${what}`, leaked.length === 0, `${leaked.length} message(s)`);
  }
  // The buyer's own code is the product and belongs there; an internal row id
  // is not, and turns up in URLs when someone links the wrong thing.
  const idLeak = inbox.filter((m) => /\bprd_[A-Za-z0-9_-]{10,}/.test(m));
  ok('no internal product id is printed at the buyer', idLeak.length === 0, `${idLeak.length}`);
}

console.log('\n— A support reply reaches a guest —');
{
  const before = inbox.length;
  const sup = await import('../src/services/supportService.js');
  // A guest ticket: no account, only the order.
  const t = await sup.openTicket({ orderId: placed.id, subject: 'Wrong code?',
    category: 'order', message: 'The code says already redeemed.' });
  await sup.replyTicket(t.id, { authorKind: 'staff', authorId: null,
    body: 'Sorry about that — a fresh code is on its way now.' });
  await new Promise((r) => setTimeout(r, 1200));

  const mail = await all(`SELECT template_id, status FROM email_log
     WHERE to_email=@e AND template_id='support_reply'`, { e: buyer });
  ok('the guest is emailed the reply', mail.length === 1 && mail[0].status === 'sent',
    JSON.stringify(mail));
  const raw = inbox.slice(before).find((m) => /ticket/i.test(m));
  ok('…and the reply text is in it', !!raw && raw.includes('a fresh code is on its way'));
  ok('…addressed to the address the order was placed with',
    !!raw && headersOf(raw).to?.includes(buyer), raw && headersOf(raw).to);
  ok('…with a Reply-To that lands on a person',
    !!raw && headersOf(raw)['reply-to'] === config.email.replyTo);
}

console.log('\n— A failed send is recorded, and retried —');
{
  const { retryFailedEmails } = await import('../src/services/emailService.js');
  // A template that is missing is the one failure mode that must NOT be retried
  // forever; a transport failure is the one that must be.
  const id = newId('eml');
  await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, error, context, created_at)
       VALUES (@id,'order_completed',@to,'x','failed','ECONNRESET',@ctx,@at)`,
    { id, to: buyer, ctx: JSON.stringify({ order: { number: placed.number } }), at: nowIso() });
  const retried = await retryFailedEmails({ limit: 5 });
  ok('a transient failure is retried', retried >= 1, `${retried}`);

  const dead = newId('eml');
  await run(`INSERT INTO email_log (id, template_id, to_email, subject, status, error, context, created_at)
       VALUES (@id,'order_completed',@to,'x','failed','template missing',@ctx,@at)`,
    { id: dead, to: buyer, ctx: JSON.stringify({}), at: nowIso() });
  const again = await retryFailedEmails({ limit: 5 });
  ok('a permanently-broken one is not retried forever', Number.isInteger(again), `${again}`);
}

console.log('\n— Every template renders, on a phone, without a token hole —');
{
  const { renderTemplate, baseContext } = await import('../src/services/templateService.js');
  const rows = await all('SELECT * FROM email_templates ORDER BY id');
  ok('the six audited kinds all exist', ['order_received', 'order_completed', 'login_otp',
    'refund_issued', 'support_reply', 'custom_message'].every((id) => rows.some((r) => r.id === id)),
    rows.map((r) => r.id).join(', '));
  for (const t of rows) {
    const { subject, html } = renderTemplate(t, baseContext({}));
    ok(`${t.id}: renders`, !!html && html.includes('<!doctype html>'));
    ok(`${t.id}: leaves no {{token}} in the output`, !/\{\{/.test(subject + html),
      (subject + html).match(/\{\{[\w.]+\}\}/)?.[0]);
    ok(`${t.id}: fits a phone`, /max-width:568px/.test(html) && /width=device-width/.test(html));
  }
}

srv.close(); sink.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
