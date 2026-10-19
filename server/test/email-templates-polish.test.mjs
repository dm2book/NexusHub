/**
 * Every customer email, in every language, rendered for real and held to one
 * house style.
 *
 * 23 templates × 4 languages, through the same renderTemplate the send path
 * uses, with a context that fills every token. Checked per mail:
 *   - nothing unfilled ({{…}}), no "undefined"/"NaN" a reader would see
 *   - exactly one primary button where there is something to do
 *   - a chosen preview line, not "Hoi Sam, …"
 *   - a subject that fits (≤ 78 characters, at most one emoji)
 *   - every link on the shop's own https://www host
 *   - no emoji in the heading, one small help line
 *   - the same tokens and links in all four languages
 * Then, against a real database: the order mail under Pay. has one button,
 * an untouched old default is upgraded on boot while an owner's edit is kept,
 * and the cart reminder quotes today's price in the reader's language.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_email_polish';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL = 'https://www.forgemarket.nl';
process.env.PAYNL_SERVICE_ID = 'SL-0000-0000';
process.env.PAYNL_SERVICE_SECRET = 'a'.repeat(40);
process.env.LAUNCH_MODE = 'open';
process.env.LAUNCH_DATE = '2026-01-01T00:00:00Z';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { DEFAULT_TEMPLATES } = await import('../src/services/defaultTemplates.js');
const { TEMPLATE_TRANSLATIONS } = await import('../src/services/templateTranslations.js');
const { renderTemplate, baseContext } = await import('../src/services/templateService.js');

const APP = 'https://www.forgemarket.nl';
const N = 'FM-2026-ABCD1234';
const ctx = baseContext({
  user: { name: 'Sam' },
  order: {
    number: N, total: '€ 9,99', status: 'Pending', openDays: 14, url: `${APP}/track?number=${N}`,
    itemsHtml: '<table class="summary"><tr><td>1× 1,000 Robux</td><td class="r">€ 9,99</td></tr></table>',
    summaryHtml: '<table class="summary"><tr><td>1× 1,000 Robux</td><td class="r">€ 9,99</td></tr></table>',
    deliveryHtml: '<div>CODE-1234</div>', deliveriesHtml: '<div>CODE-1234</div>', redeemHtml: '',
    paymentHtml: '', consentHtml: '', needsFromBuyerHtml: '', reviewAskHtml: '', invoiceHtml: '',
  },
  refund: { amount: '€ 9,99', detailsHtml: '' },
  cancel: { reasonHtml: '' },
  subject: 'Over je levering', message: 'Hallo\nTweede regel',
  ticket: { subject: 'Code werkt niet', number: 'T-12', orderLine: '', url: `${APP}/track?ticket=T-12` },
  reply: 'We hebben het opgelost.',
  cart: { itemsHtml: '<table class="summary"><tr><td>1× Robux</td><td class="r">€ 9,99</td></tr></table>', url: `${APP}/cart` },
  unsubscribe: { url: `${APP}/unsubscribe?t=x` },
  product: { name: 'App Store & iTunes €25', url: `${APP}/product/p1` },
  price: { current: '€ 22,50', previous: '€ 25,00', diff: '€ 2,50', saved: '€ 25,00' },
  wishlist: { url: `${APP}/wishlist`, alertsOffUrl: `${APP}/wishlist/alerts-off?t=x` },
  review: { url: `${APP}/review?o=1`, trustpilotHtml: '<p><a href="https://nl.trustpilot.com/evaluate/forgemarket.nl">Trustpilot</a></p>' },
  shop: { name: 'ForgeMarket', url: APP },
  giftCard: { amount: '€ 25,00', code: 'GIFT-AAAA-BBBB', noteHtml: '' },
  otp: { code: '123456', codeHtml: '<p class="code">123456</p>', ttl: 10 },
  login: { detailsHtml: 'Chrome op Windows · Amsterdam' },
  proof: { reasonHtml: '' }, request: { reasonHtml: '' },
  newsletter: { confirmUrl: `${APP}/newsletter/confirm?t=x` },
});

const LANGS = ['nl', 'en', 'de', 'fr'];
const rowsFor = (lang) => DEFAULT_TEMPLATES.map((t) => (lang === 'nl'
  ? { id: t.id, lang, subject: t.subject, body_html: t.body_html }
  : { id: t.id, lang, ...TEMPLATE_TRANSLATIONS[lang][t.id] }));
const NO_ACTION = new Set(['login_otp']);           // a code to type, nothing to press
const EMOJI = /\p{Extended_Pictographic}/gu;
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const tokensOf = (t) => [...`${t.subject} ${t.body_html}`.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
const hrefsOf = (t) => [...t.body_html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).sort();

console.log('— Every template × every language —');
const problems = { unfilled: [], buttons: [], preheader: [], subject: [], links: [], heading: [], help: [], warn: [] };
for (const lang of LANGS) {
  for (const row of rowsFor(lang)) {
    const tag = `${row.id}/${lang}`;
    const warns = [];
    const realWarn = console.warn;
    console.warn = (m) => warns.push(String(m));
    const out = renderTemplate(row, { ...ctx, lang });
    console.warn = realWarn;
    if (warns.length) problems.warn.push(`${tag}: ${warns[0]}`);
    const visible = text(out.html);
    if (/\{\{|\}\}/.test(out.subject + out.html) || /\bundefined\b|\bNaN\b/.test(out.subject + visible)) problems.unfilled.push(tag);
    const buttons = (out.html.match(/class="btn"/g) || []).length;
    if (buttons !== (NO_ACTION.has(row.id) ? 0 : 1)) problems.buttons.push(`${tag}=${buttons}`);
    const pre = (out.html.match(/<span class="preheader"[^>]*>([\s\S]*?)&#847;/) || [])[1] || '';
    if (pre.trim().length < 15 || /^(Hoi|Hi|Hallo|Bonjour)\b/.test(pre.trim())) problems.preheader.push(`${tag}: "${pre.trim()}"`);
    if (out.subject.length > 78 || (out.subject.match(EMOJI) || []).length > 1) problems.subject.push(`${tag} (${out.subject.length}): ${out.subject}`);
    for (const href of [...out.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])) {
      if (!/^(https:\/\/www\.forgemarket\.nl(\/|$)|mailto:|https:\/\/nl\.trustpilot\.com\/)/.test(href)) problems.links.push(`${tag}: ${href}`);
    }
    const h1 = (row.body_html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]
      ?? (row.body_html.match(/font:800[^"]*">([^<]*)</) || [])[1] ?? '';
    if ((h1.match(EMOJI) || []).length) problems.heading.push(`${tag}: ${h1}`);
    /* The delivery mail keeps its support line as the exact <div> migration 038
       anchors on (it inserts the review block above it on older rows). */
    const supportDiv = row.id === 'order_completed' && /color:#8b8fa3;text-align:center;padding-top:16px">/.test(row.body_html);
    if (!/class="help"/.test(row.body_html) && !supportDiv) problems.help.push(tag);
  }
}
ok('nothing renders unfilled, undefined or NaN', !problems.unfilled.length, problems.unfilled.join(', '));
ok('…and no token is missing a value (no renderer warnings)', !problems.warn.length, problems.warn.slice(0, 3).join(' | '));
ok('exactly one primary button in every mail with something to do', !problems.buttons.length, problems.buttons.join(', '));
ok('a chosen preview line on every mail', !problems.preheader.length, problems.preheader.slice(0, 3).join(' | '));
ok('subjects ≤ 78 characters with at most one emoji', !problems.subject.length, problems.subject.slice(0, 3).join(' | '));
ok('every link points at https://www.forgemarket.nl (or mailto/Trustpilot)', !problems.links.length, problems.links.slice(0, 3).join(' | '));
ok('no emoji in any heading', !problems.heading.length, problems.heading.slice(0, 4).join(' | '));
ok('every mail ends in the small help line', !problems.help.length, problems.help.slice(0, 6).join(', '));

console.log('\n— The same mail in four languages —');
{
  const diff = [];
  for (const t of DEFAULT_TEMPLATES) {
    const nl = { subject: t.subject, body_html: t.body_html };
    for (const lang of ['en', 'de', 'fr']) {
      const tr = TEMPLATE_TRANSLATIONS[lang][t.id];
      if (!tr) { diff.push(`${t.id}/${lang}: missing`); continue; }
      if (tokensOf(tr).join() !== tokensOf(nl).join()) diff.push(`${t.id}/${lang}: tokens`);
      if (hrefsOf(tr).join() !== hrefsOf(nl).join()) diff.push(`${t.id}/${lang}: links`);
      if ((tr.body_html.match(/class="btn"/g) || []).length !== (nl.body_html.match(/class="btn"/g) || []).length) diff.push(`${t.id}/${lang}: buttons`);
    }
  }
  ok('same tokens, links and buttons in nl/en/de/fr', !diff.length, diff.slice(0, 5).join(' | '));
}

console.log('\n— The frame —');
{
  const out = renderTemplate(rowsFor('nl').find((r) => r.id === 'payment_confirmed'), { ...ctx, lang: 'nl' });
  ok('the card is 600px wide', /\.wrap\{max-width:600px/.test(out.html) && /class="wrap" style="max-width:600px/.test(out.html));
  const btn = (out.html.match(/<a class="btn"[^>]*style="([^"]*)"/) || [])[1] || '';
  ok('the button carries a 20px line box + 15px padding (a 50px target) inline', /line-height:20px/.test(btn) && /padding:15px/.test(btn), btn);
  // 15.5px since the design pass (email-templates-design.test holds the floor).
  ok('body text is at least 14px', /<p style="color:#b9bfcd;font-size:15\.5px/.test(out.html));
  ok('the body cell has an explicit dark background (dark-mode safe)', /<td class="body" bgcolor="#12121c"/.test(out.html));
  const gift = renderTemplate(rowsFor('de').find((r) => r.id === 'gift_card'), { ...ctx, lang: 'de' });
  ok('the gift-card button goes straight to the wallet', /<a class="btn" href="https:\/\/www\.forgemarket\.nl\/account\/wallet"/.test(gift.html));
}

/* ── Against a real database ─────────────────────────────────────────────── */
const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { syncEmailTemplates } = await import('../src/db/seed.js');

console.log('\n— The order mail under Pay. —');
{
  const { createProduct } = await import('../src/services/productService.js');
  const { createOrder, renderOrderEmail } = await import('../src/services/orderService.js');
  const p = await createProduct({ name: `Polish ${Date.now()}`, category: 'steam', price: 999, currency: 'EUR', active: true, announce: false });
  const o = await createOrder({ email: `polish-${Date.now()}@example.test`, consent: true, consentText: 'x',
    items: [{ productId: p.id, quantity: 1 }], billing: { lang: 'nl' } });
  const mail = await renderOrderEmail(o.id, 'order_received');
  ok('one button, not one in the payment block and another under it',
    (mail.html.match(/class="btn"/g) || []).length === 1, String((mail.html.match(/class="btn"/g) || []).length));
  ok('…which says what to do next', /Betaling afronden/.test(mail.html) && /Nog niet betaald/.test(mail.html));
  ok('…and the subject says it is not finished yet', /rond je betaling af/.test(mail.subject), mail.subject);
}

console.log('\n— Upgrading stored templates —');
{
  /* Verbatim defaults from before this pass: an untouched copy must upgrade,
     an owner's edit must stay exactly as written. */
  const OLD_NL_ORDER_RECEIVED = `
      <h1>Bedankt voor je bestelling! 🎉</h1>
      <p>Hoi {{user.name}}, bedankt voor je aankoop bij {{brand.name}}. We hebben
      bestelling <strong>{{order.number}}</strong> ontvangen (totaal <strong>{{order.total}}</strong>).</p>
      {{order.itemsHtml}}
      {{order.needsFromBuyerHtml}}
      {{order.paymentHtml}}
      <p>Zodra je betaling bevestigd is, leveren we. Wat we op voorraad hebben gaat
      automatisch de deur uit; de rest leveren we met de hand.
      Volg de status hier — geen account nodig:</p>
      <p><a class="btn" href="{{order.url}}">Volg je bestelling</a></p>
      <p>Hulp nodig? Beantwoord deze mail of open een ticket in onze Discord.</p>
      {{order.consentHtml}}`;
  const OLD_EN_GIFT = `
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
      Redeemable once, on any order.</div>`;
  await run(`UPDATE email_templates SET body_html=@b, subject=@s WHERE id='order_received' AND lang='nl'`,
    { b: OLD_NL_ORDER_RECEIVED, s: 'Bedankt voor je bestelling {{order.number}} 🎮' });
  await run(`UPDATE email_templates SET body_html=@b WHERE id='gift_card' AND lang='en'`, { b: OLD_EN_GIFT });
  const EDITED = `${OLD_NL_ORDER_RECEIVED}<p>Mijn eigen regel.</p>`;
  await run(`UPDATE email_templates SET body_html=@b WHERE id='order_received' AND lang='de'`, { b: EDITED });
  await syncEmailTemplates(nowIso());
  const nl = await get(`SELECT subject, body_html FROM email_templates WHERE id='order_received' AND lang='nl'`);
  const nlDefault = DEFAULT_TEMPLATES.find((t) => t.id === 'order_received');
  ok('an untouched old Dutch order mail is upgraded (body and subject)',
    nl.body_html === nlDefault.body_html && nl.subject === nlDefault.subject, nl.subject);
  const en = await get(`SELECT body_html FROM email_templates WHERE id='gift_card' AND lang='en'`);
  ok('an untouched old English gift-card mail is upgraded (recognised by its fingerprint)',
    en.body_html === TEMPLATE_TRANSLATIONS.en.gift_card.body_html);
  const de = await get(`SELECT body_html FROM email_templates WHERE id='order_received' AND lang='de'`);
  ok('an owner-edited template is left exactly as written', de.body_html === EDITED);
}

console.log('\n— The cart reminder —');
{
  const { createProduct, updateProduct } = await import('../src/services/productService.js');
  const { sendCartReminders, cartReminderLines } = await import('../src/services/cartService.js');
  const live = await createProduct({ name: `Cart Live ${Date.now()}`, category: 'steam', price: 999, currency: 'EUR', active: true, announce: false });
  const gone = await createProduct({ name: `Cart Gone ${Date.now()}`, category: 'steam', price: 500, currency: 'EUR', active: true, announce: false });
  await run(`UPDATE products SET active=0 WHERE id=@id`, { id: gone.id });
  const lines = await cartReminderLines([
    { id: live.id, name: 'stale name', price: 100, qty: 2 },
    { id: gone.id, name: 'gone', price: 500, qty: 1 },
  ]);
  ok("today's price and name, not what the browser saved", lines.length === 1 && lines[0].price === 999
    && lines[0].name === live.name && lines[0].qty === 2, JSON.stringify(lines));
  ok('…and a product no longer for sale is left out', !lines.some((l) => l.id === gone.id));

  const uid = newId('usr');
  const email = `cart-${Date.now()}@example.test`;
  await run(`INSERT INTO users (id, email, display_name, lang, preferences, created_at, updated_at)
             VALUES (@id, @e, 'Kim', 'de', @p, @at, @at)`,
    { id: uid, e: email, p: JSON.stringify({ emailMarketing: true }), at: nowIso() });
  const old = new Date(Date.now() - 6 * 3_600_000).toISOString();
  await run(`INSERT INTO saved_carts (user_id, items, updated_at) VALUES (@u, @i, @at)`,
    { u: uid, i: JSON.stringify([{ id: live.id, name: 'stale', price: 1, currency: 'EUR', qty: 1 }]), at: old });
  await sendCartReminders({ afterHours: 4 });
  const logged = await get(`SELECT subject, context FROM email_log WHERE template_id='cart_reminder' AND to_email=@e ORDER BY created_at DESC LIMIT 1`, { e: email });
  ok('the reminder goes out in the buyer\'s language', logged?.subject === TEMPLATE_TRANSLATIONS.de.cart_reminder.subject, logged?.subject);
  ok('…with the price in that language and at today\'s price (9,99 €, not 0,01)',
    /9,99\s?€/.test(logged?.context || '') && !/0,01/.test(logged?.context || ''), (logged?.context || '').slice(0, 200));
}

console.log(`\n${fail ? '❌' : '✅'} email-templates-polish: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
