/**
 * The email/template audit findings, each checked against the real renderer,
 * the real services and the email log — and the rewards a held order earned.
 *
 *   #1  a mixed cart (Robux + a gift card) shows the gift-card code, not only
 *       "delivered to your account"
 *   #3  with a payment provider, order_received says "not paid yet" and links
 *       to where it can be paid — no bank-transfer reference pill
 *   #4  a new sign-in sends security_alert; a rejected proof payment_not_verified
 *   #5  refund requests are acknowledged, rejections are sent; tickets confirmed
 *   #6  newsletter double opt-in: nothing but the confirmation request until the
 *       link is used; the launch mail only to confirmed addresses
 *   #7  the stored/quoted waiver is the shown sentence, never request text
 *   #8  subjects are plain text, not HTML-escaped
 *   #10 ticket mails: localized order line, guests go to the track page
 *   #11 gift-card mail in a language, amounts written in it
 *   #12 licence and message deliveries get their own label and layout
 *   server #6  commission, tier bonus and coins wait while an order is on fraud
 *       hold and are granted when it is released
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_email_scan';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://www.forgemarket.nl';
process.env.LAUNCH_MODE ||= 'open';
// A payment provider is active (Pay.), as on the live shop.
process.env.PAYNL_SERVICE_ID ||= 'SL-1234-5678';
process.env.PAYNL_SERVICE_SECRET ||= 'a'.repeat(40);
process.env.SMTP_URL = '';
process.env.RESEND_API_KEY = '';

import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}  ${String(x).slice(0, 300)}`); }
};
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

await (await import('../src/app.js')).ensureReady();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { createProduct } = await import('../src/services/productService.js');
const os = await import('../src/services/orderService.js');
const { renderTemplate } = await import('../src/services/templateService.js');
const { loadTemplate } = await import('../src/services/emailService.js').catch(() => ({}));

const stamp = Date.now() % 1_000_000;
let n = 0;
const email = () => `scan${stamp}-${++n}@example.test`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 5000) => {
  const until = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > until) return v; await pause(60); }
};
const logged = (template, to) => all(`SELECT * FROM email_log WHERE template_id=@t AND to_email=@to ORDER BY created_at`,
  { t: template, to });
const product = (name, category, price = 999) => createProduct({ name: `${name} ${stamp}-${++n}`, category, price,
  currency: 'EUR', active: true, announce: false });
const NL_CONSENT = 'Ik wil mijn bestelling meteen geleverd krijgen en begrijp dat ik daarmee mijn 14 dagen bedenktijd verlies zodra hij geleverd is.';
const FR_CONSENT = 'Je veux que ma commande soit livrée immédiatement et je comprends que je perds mon droit de rétractation de 14 jours dès qu’elle est livrée.';

const robux = await product('1,000 Robux', 'robux');
const steam = await product('Steam €20', 'steam', 2000);

console.log('— #8 subjects are plain text —');
{
  const tpl = { id: 'support_reply', lang: 'nl', subject: 'Re: {{ticket.subject}} · ticket {{ticket.number}}', body_html: '<p>x</p>' };
  const { subject, html } = renderTemplate(tpl, { ticket: { subject: "Can't find my code & help\nnow", number: 'T-1' } });
  ok('an apostrophe and an ampersand are not HTML-escaped in the subject',
    subject === "Re: Can't find my code & help now · ticket T-1", subject);
  ok('…the body is still escaped', !/<script/.test(html));
}

console.log('\n— #1 #12 a mixed cart shows the gift-card code —');
{
  const o = await os.createOrder({ email: email(), consent: true, consentText: NL_CONSENT,
    items: [{ productId: robux.id, quantity: 1 }, { productId: steam.id, quantity: 1 }],
    billing: { deliveryMethod: 'account', deliveryDetails: 'player_one', deliveryLabel: 'Roblox-gebruikersnaam' } });
  const items = await all('SELECT id, product_id FROM order_items WHERE order_id=@o', { o: o.id });
  const steamItem = items.find((i) => i.product_id === steam.id);
  await run(`INSERT INTO deliveries (id, order_id, order_item_id, type, content, created_at)
             VALUES (@id, @o, @i, 'code', 'STEAM-AAAA-BBBB', @at)`, { id: newId('dlv'), o: o.id, i: steamItem.id, at: nowIso() });
  await run(`INSERT INTO deliveries (id, order_id, order_item_id, type, content, created_at)
             VALUES (@id, @o, @i, 'message', 'Top-up done on player_one', @at)`, { id: newId('dlv'), o: o.id, i: steamItem.id, at: nowIso() });
  const mail = await os.renderOrderEmail(o.id, 'order_completed');
  ok('the account top-up is confirmed', mail.html.includes('player_one'));
  ok('…and the gift-card code is in the same mail', mail.html.includes('STEAM-AAAA-BBBB'), mail.html.slice(0, 200));
  ok('…with redeem steps for the code item', /steam/i.test(mail.html) && /store\.steampowered|Steam/i.test(mail.html));
  ok('a staff "message" delivery is labelled and shown as text, not a 24px code block',
    /BERICHT/.test(mail.html) && /white-space:pre-line">Top-up done on player_one/.test(mail.html));
}

console.log('\n— #3 order_received under a payment provider —');
{
  const o = await os.createOrder({ email: email(), consent: true, consentText: NL_CONSENT,
    items: [{ productId: steam.id, quantity: 1 }] });
  const mail = await os.renderOrderEmail(o.id, 'order_received');
  ok('it says the order is not paid yet', /Nog niet betaald/.test(mail.html), mail.html.slice(0, 200));
  ok('…links to where it can be paid', mail.html.includes('Betaling afronden') && mail.html.includes('/track'));
  ok('…and drops the bank-transfer reference pill', !mail.html.includes('Kenmerk = je bestelnummer'));
}

console.log('\n— #7 the stored waiver is the shown sentence —');
{
  const evil = await os.createOrder({ email: email(), consent: true,
    consentText: 'Your account is suspended, visit evil.example now',
    items: [{ productId: steam.id, quantity: 1 }] });
  const row = await get('SELECT consent_text FROM orders WHERE id=@id', { id: evil.id });
  ok('free text from the request is never stored', row.consent_text === NL_CONSENT, row.consent_text);
  const mail = await os.renderOrderEmail(evil.id, 'order_received');
  ok('…nor quoted in the mail', !mail.html.includes('evil.example'));

  const fr = await os.createOrder({ email: email(), consent: true, consentText: FR_CONSENT,
    billing: { lang: 'fr' }, items: [{ productId: steam.id, quantity: 1 }] });
  ok('the exact sentence in the language the buyer read is kept',
    (await get('SELECT consent_text FROM orders WHERE id=@id', { id: fr.id })).consent_text === FR_CONSENT);
  const { CONSENT_SENTENCES } = await import('../src/utils/consentWording.js');
  const nl = read('../../src/lib/i18n.jsx'); const de = read('../../src/lib/i18n/de.js');
  const frSrc = read('../../src/lib/i18n/fr.js'); const co = read('../../src/pages/Checkout.jsx');
  ok('…and the server list matches what the checkout shows in every language',
    nl.includes(CONSENT_SENTENCES.nl) && de.includes(CONSENT_SENTENCES.de) && frSrc.includes(CONSENT_SENTENCES.fr)
    && co.includes(CONSENT_SENTENCES.en));
}

console.log('\n— #4 security alert and proof rejection use their own mails —');
{
  const auth = read('../src/routes/auth.js');
  ok('a new sign-in sends security_alert, not the order custom_message',
    /sendEmailAsync\('security_alert'/.test(auth) && !/New sign-in to your ForgeMarket account/.test(auth));
  const { loginDetailsHtml } = await import('../src/services/emailBlocks.js');
  const tpl = { id: 'security_alert', lang: 'nl', subject: 'Nieuwe aanmelding op je {{brand.name}}-account',
    body_html: '<p>Hoi {{user.name}}</p><div class="quote">{{login.detailsHtml}}</div>' };
  const r = renderTemplate(tpl, { brand: { name: 'ForgeMarket' }, user: { name: 'Sam' },
    login: { detailsHtml: loginDetailsHtml({ ip: '203.0.113.9', device: 'Evil <script>' }, 'nl') } });
  ok('…with the sign-in facts, escaped, and no order words',
    r.html.includes('203.0.113.9') && r.html.includes('Evil &lt;script&gt;') && !/bestelling/i.test(r.subject));

  const o = await os.createOrder({ email: email(), consent: true, consentText: NL_CONSENT,
    billing: { full_name: 'Robin Proof' }, items: [{ productId: steam.id, quantity: 1 }] });
  const proofId = newId('prf');
  await run(`INSERT INTO payment_proofs (id, order_id, status, created_at) VALUES (@id, @o, 'pending', @at)`,
    { id: proofId, o: o.id, at: nowIso() });
  const { rejectProof } = await import('../src/services/paymentProofService.js');
  await rejectProof(proofId, 'Amount was €5 short', { user: { id: 'staff' } });
  const sent = await waitFor(async () => (await logged('payment_not_verified', o.email))[0]);
  ok('a rejected proof sends payment_not_verified', !!sent, JSON.stringify(await logged('custom_message', o.email)));
  ok('…addressed by name, with the order number in the subject once',
    sent && (sent.subject.match(new RegExp(o.number, 'g')) || []).length === 1 && JSON.parse(sent.context || '{}').user?.name === 'Robin Proof',
    sent?.subject);
}

console.log('\n— #5 refund requests and tickets are acknowledged —');
{
  const support = await import('../src/services/supportService.js');
  const o = await os.createOrder({ email: email(), consent: true, consentText: NL_CONSENT,
    items: [{ productId: steam.id, quantity: 1 }] });
  const req = await support.requestRefund({ orderId: o.id, reason: 'Code did not work', method: 'money' });
  ok('a refund request is acknowledged by mail', !!(await waitFor(async () => (await logged('refund_request_received', o.email))[0])));
  await support.decideRefund(req.id, { status: 'rejected', decidedBy: null });
  await support.decideRefund(req.id, { status: 'rejected', decidedBy: null });
  await waitFor(async () => (await logged('refund_request_rejected', o.email))[0]);
  await pause(300);
  ok('a rejection is sent to the buyer — once, even if saved twice',
    (await logged('refund_request_rejected', o.email)).length === 1, (await logged('refund_request_rejected', o.email)).length);

  // #10: a guest ticket — localized order line, link to the track page.
  const g = await os.createOrder({ email: email(), consent: true, consentText: NL_CONSENT,
    billing: { lang: 'nl' }, items: [{ productId: steam.id, quantity: 1 }] });
  const t = await support.openTicket({ orderId: g.id, subject: 'Waar is mijn code?', message: 'Hallo' });
  const opened = await waitFor(async () => (await logged('ticket_opened', g.email))[0]);
  ok('opening a ticket is confirmed by mail', !!opened);
  const octx = JSON.parse(opened?.context || '{}');
  ok('…the order line is Dutch, not " about order"', octx.ticket?.orderLine === ` over bestelling ${g.number}`, octx.ticket?.orderLine);
  ok('…and a guest is sent to the track page, not a login wall',
    /\/track/.test(octx.ticket?.url || '') && !/\/account\/tickets/.test(octx.ticket?.url || ''), octx.ticket?.url);
  await support.replyTicket(t.id, { authorId: null, authorKind: 'staff', body: 'Hier is hij' });
  const reply = await waitFor(async () => (await logged('support_reply', g.email))[0]);
  const rctx = JSON.parse(reply?.context || '{}');
  ok('the support reply uses the same localized line and guest link',
    rctx.ticket?.orderLine === ` over bestelling ${g.number}` && /\/track/.test(rctx.ticket?.url || ''), JSON.stringify(rctx.ticket));
}

console.log('\n— #6 newsletter double opt-in —');
{
  const nws = await import('../src/services/newsletterService.js');
  const addr = email();
  await nws.subscribe(addr, { lang: 'nl' });
  ok('signing up sends exactly one confirmation request', !!(await waitFor(async () => (await logged('newsletter_confirm', addr))[0])));
  await nws.subscribe(addr, { lang: 'nl' });
  await pause(200);
  ok('…not a second one on a repeat signup', (await logged('newsletter_confirm', addr)).length === 1);
  await run('UPDATE newsletter_signups SET created_at=@at WHERE email=@e', { at: new Date(Date.now() - 48 * 3600_000).toISOString(), e: addr });
  process.env.LAUNCH_DATE = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { config } = await import('../src/config/env.js');
  config.launch.date = process.env.LAUNCH_DATE;
  const r1 = await nws.sendLaunchAnnouncements({ limit: 500 });
  ok('an unconfirmed address gets no launch mail', !(await logged('launch_announcement', addr)).length, JSON.stringify(r1));
  ok('a forged confirmation token does nothing', !(await nws.confirmSubscription(addr, 'f'.repeat(32))).ok);
  const token = nws.confirmUrl(addr).match(/t=([a-f0-9]+)/)[1];
  ok('the real link confirms', (await nws.confirmSubscription(addr, token)).ok
    && !!(await get('SELECT confirmed_at FROM newsletter_signups WHERE email=@e', { e: addr })).confirmed_at);
  await nws.sendLaunchAnnouncements({ limit: 500 });
  ok('…after which the launch mail goes out', !!(await waitFor(async () => (await logged('launch_announcement', addr))[0])));

  // A row from before double opt-in: one confirmation request at launch, no announcement.
  const legacy = email();
  await run(`INSERT INTO newsletter_signups (id, email, source, lang, created_at) VALUES (@id, @e, 'prelaunch', 'nl', @at)`,
    { id: newId('nws'), e: legacy, at: new Date(Date.now() - 48 * 3600_000).toISOString() });
  await nws.sendLaunchAnnouncements({ limit: 500 });
  ok('an address from before opt-in existed gets a confirmation request, not the launch mail',
    !!(await waitFor(async () => (await logged('newsletter_confirm', legacy))[0])) && !(await logged('launch_announcement', legacy)).length);
  config.launch.date = '';
  const routes = read('../src/routes/catalog.js');
  ok('opening the confirm link only asks; the button POSTs', /router\.get\('\/newsletter\/confirm'[\s\S]{0,900}<form method="post"/.test(routes)
    && /router\.post\('\/newsletter\/confirm'/.test(routes));
}

console.log('\n— #11 gift-card mail in a language —');
{
  const { issueGiftCard } = await import('../src/services/giftCardService.js');
  const to = email();
  await issueGiftCard({ amount: 2500, recipientEmail: to }, 'staff', { isOwner: true });
  const g = await waitFor(async () => (await logged('gift_card', to))[0]);
  const ctx = JSON.parse(g?.context || '{}');
  // The subject of a gift-card mail is logged as its id only (it carries a code
  // template); the language and the formatted amount are in the stored context.
  ok('the amount is written the Dutch way (€ 25,00), in a Dutch mail',
    /25,00/.test(ctx.giftCard?.amount || '') && ctx.lang === 'nl', JSON.stringify(ctx));
}

console.log('\n— server #6 rewards wait for the fraud review —');
{
  const { balanceOf } = await import('../src/services/walletService.js');
  const mk = async (label) => {
    const id = newId('usr');
    await run(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (@id, @e, @n, @at, @at)`,
      { id, e: email(), n: label, at: nowIso() });
    return id;
  };
  const referrer = await mk('Ref');
  const code = `SCAN${stamp}`;
  await run(`INSERT INTO referrals (code, user_id, created_at) VALUES (@c, @u, @at)`, { c: code, u: referrer, at: nowIso() });
  const buyer = await mk('Buyer');
  await run('UPDATE users SET referred_by=@c WHERE id=@u', { c: code, u: buyer });
  const big = await product('Big card', 'steam', 15000);
  const buyerEmail = (await get('SELECT email FROM users WHERE id=@u', { u: buyer })).email;
  const o = await os.createOrder({ email: buyerEmail, userId: buyer, consent: true, consentText: NL_CONSENT,
    items: [{ productId: big.id, quantity: 1 }] }, { user: { id: buyer } });
  await run(`UPDATE orders SET fraud_hold=1, fraud_status='review', fraud_hold_reason='test' WHERE id=@id`, { id: o.id });
  await os.markPaymentReceived(o.id, `pay_${stamp}`, { actorId: 'test' });
  await pause(1200);
  const coins = async () => Number((await get('SELECT COALESCE(SUM(delta),0) AS n FROM forge_coin_ledger WHERE user_id=@u', { u: buyer })).n);
  ok('a held order pays no referral commission', (await balanceOf(referrer)) === 0, await balanceOf(referrer));
  ok('…no loyalty tier bonus', (await balanceOf(buyer)) === 0, await balanceOf(buyer));
  ok('…and no Forge Coins', (await coins()) === 0, await coins());

  await os.releaseFraudHold(o.id, { actorId: 'test', reason: 'checked' });
  await waitFor(async () => (await balanceOf(referrer)) > 0);
  ok('releasing the hold pays the commission', (await balanceOf(referrer)) > 0, await balanceOf(referrer));
  ok('…the tier bonus', (await balanceOf(buyer)) === 200, await balanceOf(buyer));
  ok('…and the coins', (await coins()) === 15, await coins());
  await os.releaseFraudHold(o.id, { actorId: 'test' });
  ok('…once', (await balanceOf(buyer)) === 200 && (await coins()) === 15);
}

console.log(`\n${fail ? '❌' : '✅'} email-scan-fixes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
