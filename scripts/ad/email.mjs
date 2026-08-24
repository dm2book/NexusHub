#!/usr/bin/env node
/**
 * The real delivery email for a real order, rendered so it can be filmed —
 * with the code covered.
 *
 *   DATABASE_URL=postgres://… node scripts/ad/email.mjs --order=FM-2026-XXXX \
 *     --out=scripts/ad/out/robux-1000
 *
 * These are the same bytes the customer received: the row in email_log holds
 * the full render context, and this puts it back through the same template the
 * mailer used. Nothing is written for the advert, and if the shop never sent
 * that email this exits rather than inventing one.
 *
 * WHAT IS COVERED, AND WHY. A delivered game code is a bearer token — whoever
 * reads it first spends it. On a phone screen at 1080p a twenty-character code
 * is entirely legible, and a paused frame is a gift to whoever paused it. So
 * the characters are replaced before the HTML is ever written to disk: the
 * advert shows a code arriving, in the real email, in the real layout, without
 * showing the code. The buyer address is masked for the same reason — it is a
 * real inbox somebody owns.
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const ORDER = arg('order');
const OUT = path.resolve(arg('out') || path.join('scripts', 'ad', 'out'));
if (!ORDER) { console.error('Pass --order=FM-2026-XXXX'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const { get, all } = await import('../../server/src/db/index.js');
const { renderTemplate, baseContext } = await import('../../server/src/services/templateService.js');

const order = await get(
  `SELECT id, number, email FROM orders WHERE number = @n`, { n: ORDER.toUpperCase() });
if (!order) { console.error(`No order ${ORDER} in this database.`); process.exit(1); }

/* The delivery mail, as it was actually sent. `order_completed` is the one that
   carries the codes; falling back to the newest mail for that address would
   film a payment confirmation and call it a delivery. */
const log = await get(
  `SELECT id, template_id, subject, status, context, created_at
     FROM email_log
    WHERE to_email = @e AND template_id = 'order_completed'
      AND context LIKE @like
    ORDER BY created_at DESC LIMIT 1`,
  { e: order.email, like: `%${order.number}%` });

if (!log) {
  console.error(`No order_completed email was sent for ${order.number}.`);
  console.error('Refusing to render a delivery email the shop never sent.');
  process.exit(1);
}

const tpl = await get(`SELECT * FROM email_templates WHERE id = @id`, { id: log.template_id });
if (!tpl) { console.error(`Template ${log.template_id} is missing.`); process.exit(1); }

let ctx = {};
try { ctx = JSON.parse(log.context || '{}'); } catch { /* rendered empty below */ }
const { subject, html: realHtml } = renderTemplate(tpl, baseContext(ctx));

/* The codes this order actually delivered — read from the database rather than
   guessed at with a pattern, so the mask covers exactly what is secret and
   nothing that is not. */
const codes = (await all(
  `SELECT content FROM deliveries WHERE order_id = @o AND content IS NOT NULL`, { o: order.id }))
  .map((d) => String(d.content)).filter(Boolean);

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const maskOf = (code) => {
  // Keep the shape — an advert should show that something code-shaped arrived.
  const visible = code.slice(0, 4);
  return `${visible}${'•'.repeat(Math.max(6, Math.min(18, code.length - 4)))}`;
};

let html = realHtml;
let masked = 0;
for (const code of codes) {
  const before = html;
  html = html.replace(new RegExp(esc(code), 'g'), maskOf(code));
  if (html !== before) masked++;
}
// The address, too. Both the visible copy and any mailto:.
const addr = String(order.email);
const at = addr.indexOf('@');
const maskedAddr = at > 1 ? `${addr[0]}${'•'.repeat(Math.max(3, at - 1))}${addr.slice(at)}` : '•••';
html = html.split(addr).join(maskedAddr);

/* A last sweep for anything code-shaped the delivery rows did not know about —
   a replacement typed in by hand, say. Cheap, and the cost of missing one is
   somebody else redeeming it. */
const LOOSE = /\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,}){2,}\b/g;
html = html.replace(LOOSE, (m) => (m.includes('•') ? m : maskOf(m)));

if (!codes.length) {
  console.warn('  ⚠ this order delivered no code rows — nothing to mask, check the order.');
}

const file = path.join(OUT, 'email.html');
fs.writeFileSync(file, html);
fs.writeFileSync(path.join(OUT, 'email.json'), JSON.stringify({
  order: order.number, template: log.template_id, subject,
  sentAt: log.created_at, status: log.status,
  codesMasked: masked, addressMasked: true,
}, null, 2));

console.log(`\n📧 ${file}`);
console.log(`   "${subject}"`);
console.log(`   sent ${log.created_at} · status ${log.status}`);
console.log(`   ${masked} code(s) and the buyer address masked before writing.\n`);
process.exit(0);
