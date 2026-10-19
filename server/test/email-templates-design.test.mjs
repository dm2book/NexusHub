/**
 * The email design pass: what a buyer actually sees, checked on real renders.
 *
 *   (a) a long code breaks between its groups, never inside one, and is
 *       selectable as one block — "STEAM-AB12-C / D34" on a phone is a code
 *       broken in the middle of a group;
 *   (b) the withdrawal note says what is true for THIS mail: before delivery
 *       "you can still cancel", once delivered that the right has lapsed — the
 *       delivery mail said "until delivery you can still cancel" under the
 *       code it had just handed over;
 *   plus the frame: a bulletproof button (VML for desktop Outlook) wherever
 *   there is a button, readable sizes, a placed → paid → delivered strip on
 *   order mails only, no emoji in the trust row, no unfilled tokens in any of
 *   the 23 templates × 4 languages, and the replaced delivery-mail bodies
 *   registered so untouched live templates upgrade.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_email_design';
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

const { DEFAULT_TEMPLATES, LEGACY_TEMPLATE_HASHES } = await import('../src/services/defaultTemplates.js');
const { TEMPLATE_TRANSLATIONS } = await import('../src/services/templateTranslations.js');
const { renderTemplate, baseContext } = await import('../src/services/templateService.js');
const { emailCopy } = await import('../src/services/emailCopy.js');

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
  subject: 'Over je levering', message: 'Hallo',
  ticket: { subject: 'Code werkt niet', number: 'T-12', orderLine: '', url: `${APP}/track?ticket=T-12` },
  reply: 'Opgelost.',
  cart: { itemsHtml: '<table class="summary"><tr><td>Robux</td><td class="r">€ 9,99</td></tr></table>', url: `${APP}/cart` },
  unsubscribe: { url: `${APP}/unsubscribe?t=x` },
  product: { name: 'App Store €25', url: `${APP}/product/p1` },
  price: { current: '€ 22,50', previous: '€ 25,00', diff: '€ 2,50', saved: '€ 25,00' },
  wishlist: { url: `${APP}/wishlist`, alertsOffUrl: `${APP}/wishlist/alerts-off?t=x` },
  review: { url: `${APP}/review?o=1`, trustpilotHtml: '' },
  shop: { name: 'ForgeMarket', url: APP },
  giftCard: { amount: '€ 25,00', code: 'GIFT-AAAA-BBBB', noteHtml: '' },
  otp: { code: '123456', minutes: 10 },
  login: { detailsHtml: 'Chrome op Windows' },
  proof: { reasonHtml: '' }, request: { reasonHtml: '' },
  newsletter: { confirmUrl: `${APP}/newsletter/confirm?t=x` },
});

const LANGS = ['nl', 'en', 'de', 'fr'];
const rowsFor = (lang) => DEFAULT_TEMPLATES.map((t) => (lang === 'nl'
  ? { id: t.id, lang, subject: t.subject, body_html: t.body_html }
  : { id: t.id, lang, ...TEMPLATE_TRANSLATIONS[lang][t.id] }));
const ORDER_STEP_MAILS = new Set(['order_received', 'payment_reminder', 'payment_not_verified',
  'payment_confirmed', 'order_processing', 'order_on_hold', 'order_completed']);
const EMOJI = /\p{Extended_Pictographic}/u;

console.log('— The frame, on all 23 templates × 4 languages —');
const bad = { unfilled: [], vml: [], steps: [], tiny: [], trust: [] };
for (const lang of LANGS) {
  for (const row of rowsFor(lang)) {
    const tag = `${row.id}/${lang}`;
    const realWarn = console.warn;
    console.warn = () => {};
    const out = renderTemplate(row, { ...ctx, lang });
    console.warn = realWarn;
    if (/\{\{|\}\}/.test(out.subject + out.html) || /\bundefined\b|\bNaN\b/.test(out.html.replace(/<[^>]+>/g, ' '))) bad.unfilled.push(tag);
    const btns = (out.html.match(/<a class="btn"/g) || []).length;
    const vml = (out.html.match(/<v:roundrect\b/g) || []).length;
    const sameHref = [...out.html.matchAll(/<v:roundrect[^>]*href="([^"]*)"/g)].every((m) => out.html.includes(`<a class="btn" href="${m[1]}"`));
    if (btns !== vml || !sameHref || (btns && !/<!--\[if !mso\]><!-->\s*<a class="btn"/.test(out.html))) bad.vml.push(`${tag} btn=${btns} vml=${vml}`);
    const hasSteps = /class="steps"/.test(out.html);
    if (hasSteps !== ORDER_STEP_MAILS.has(row.id)) bad.steps.push(`${tag}:${hasSteps}`);
    const sizes = [...out.html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    const fonts = [...out.html.matchAll(/font:\s*\d+\s+(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    if ([...sizes, ...fonts].some((n) => n < 11)) bad.tiny.push(tag);
    const trust = (out.html.match(/class="trust"[\s\S]*?<\/table>/) || [''])[0];
    if (EMOJI.test(trust.replace(/&#10003;/g, ''))) bad.trust.push(tag);
  }
}
ok('nothing renders unfilled, undefined or NaN', !bad.unfilled.length, bad.unfilled.join(', '));
ok('every button has an Outlook (VML) fallback with the same link, the real link hidden from Outlook',
  !bad.vml.length, bad.vml.slice(0, 4).join(' | '));
ok('a placed → paid → delivered strip on order mails, and only there', !bad.steps.length, bad.steps.slice(0, 4).join(', '));
ok('no text smaller than 11px anywhere', !bad.tiny.length, bad.tiny.slice(0, 4).join(', '));
ok('the trust row carries no emoji', !bad.trust.length, bad.trust.slice(0, 4).join(', '));

{
  const out = renderTemplate(rowsFor('nl').find((r) => r.id === 'payment_confirmed'), { ...ctx, lang: 'nl' });
  ok('body copy is at least 15px', /<p style="color:#b9bfcd;font-size:15\.5px/.test(out.html));
  ok('the heading is at least 24px', /<h1 style="color:#ffffff;font-size:25px/.test(out.html));
  ok('the button cell carries its colour as bgcolor (no-CSS clients still draw it)',
    /<td align="center" bgcolor="#7c5cff"/.test(out.html));
  ok('the button is a 50px target: 15px padding around a 20px line',
    /<a class="btn"[^>]*style="[^"]*padding:15px[^"]*line-height:20px/.test(out.html));
}

/* ── Against a real database: real orders, real blocks ──────────────────── */
const { ensureReady } = await import('../src/app.js');
await ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { createOrder, renderOrderEmail, markPaymentReceived } = await import('../src/services/orderService.js');
const stamp = Date.now();

console.log('\n— (a) a long code breaks between its groups —');
const CODE = 'STEAM-AB12-CD34-EF56-GH78-JK90-LM12';
const p = await createProduct({ name: `Design ${stamp}`, category: 'steam', price: 2000, currency: 'EUR', active: true, announce: false });
await addProductCodes(p.id, [CODE]);
const orders = {};
for (const lang of LANGS) {
  orders[lang] = await createOrder({ email: `design-${lang}-${stamp}@example.test`, consent: true, consentText: 'x',
    items: [{ productId: p.id, quantity: 1 }], billing: { full_name: 'Sam', lang } });
}
const before = {};
for (const lang of LANGS) before[lang] = await renderOrderEmail(orders[lang].id, 'order_received');
await addProductCodes(p.id, [`${CODE}-B`, `${CODE}-C`, `${CODE}-D`]);
for (const lang of LANGS) await markPaymentReceived(orders[lang].id, `tx-${lang}-${stamp}`, { actorId: 'test' });
await new Promise((r) => setTimeout(r, 900));
const after = {};
for (const lang of LANGS) after[lang] = await renderOrderEmail(orders[lang].id, 'order_completed');
{
  const html = after.nl.html;
  const val = (html.match(/<div class="code-val"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
  const style = (html.match(/<div class="code-val" style="([^"]*)"/) || [])[1] || '';
  ok('the code is in the delivery mail', val.replace(/<wbr>/g, '').startsWith('STEAM-AB12'), val.slice(0, 60));
  ok('…with a break opportunity after every dash, and nowhere inside a group',
    /STEAM-<wbr>AB12-<wbr>CD34-<wbr>/.test(val) && !/[A-Z0-9]<wbr>[A-Z0-9]/.test(val), val.slice(0, 80));
  ok('…not split anywhere it likes (no word-break:break-all)', !/break-all/.test(style), style);
  ok('…selectable as one block, monospace', /user-select:all/.test(style) && /monospace/.test(style), style);
  ok('…a size down on phones', /\.code-val\{font-size:19px/.test(html));
}

console.log('\n— (b) the withdrawal note follows the order —');
for (const lang of LANGS) {
  const c = emailCopy(lang);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  const pre = before[lang].html;
  const post = after[lang].html;
  ok(`${lang}: before delivery it says the buyer can still cancel`,
    pre.includes(esc(c.withdrawalCancel)) && !pre.includes(esc(c.withdrawalDelivered || '\u0000')));
  ok(`${lang}: in the delivery mail it says the right has lapsed — not "you can still cancel"`,
    !!c.withdrawalDelivered && post.includes(esc(c.withdrawalDelivered)) && !post.includes(esc(c.withdrawalCancel)));
}

console.log('\n— The delivery mail —');
{
  const html = after.nl.html;
  ok('the order number is in the letter, not only in the subject', html.includes(`<strong style="color:#ffffff">${orders.nl.number}</strong>`));
  ok('one status line: no second "Geleverd" chip under the header', !/● Geleverd/.test(html));
  ok('the progress strip shows all three steps done', (html.match(/&#10003;<\/td>/g) || []).length === 3);
}

console.log('\n— Upgrade path —');
{
  /* The delivery-mail bodies this replaces, fingerprinted the way seed.js
     does, so a live row nobody edited upgrades on the next boot. */
  const prev = { nl: '78dd3d7e51e63edd', en: 'f19e2ad89a01299f', de: 'ad64a6d07b5a8463', fr: '201a54dc102c19ee' };
  ok('the replaced delivery-mail bodies are registered as legacy in all four languages',
    LANGS.every((l) => LEGACY_TEMPLATE_HASHES[l].order_completed.body.includes(prev[l])));
  const { syncEmailTemplates } = await import('../src/db/seed.js');
  const { run, get } = await import('../src/db/index.js');
  await run(`UPDATE email_templates SET body_html='<p>Mine</p>' WHERE id='order_completed' AND lang='de'`);
  await syncEmailTemplates();
  const de = await get(`SELECT body_html FROM email_templates WHERE id='order_completed' AND lang='de'`);
  ok('an owner-edited delivery mail is left exactly as written', de.body_html === '<p>Mine</p>');
}

console.log(`\n${fail ? '❌' : '✅'} email-templates-design: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
