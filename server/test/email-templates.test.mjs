/**
 * Email layout + per-category content.
 *
 * Two things are pinned:
 *  1. Each template renders with its OWN identity (eyebrow, accent) and only the
 *     promises that hold for that mail. A login code must carry no marketing.
 *  2. The delivery mail explains how to redeem what was actually bought — Robux
 *     and a Steam gift card are redeemed in completely different places, and a
 *     code with no instructions is a support ticket waiting to happen.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_emails';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

await (await import('../src/app.js')).ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { createOrder, renderOrderEmail, markPaymentReceived, sendReviewRequests } = await import('../src/services/orderService.js');
const { EMAIL_THEMES, renderTemplate, baseContext } = await import('../src/services/templateService.js');
const { LEGACY_TEMPLATE_BODIES, DEFAULT_TEMPLATES } = await import('../src/services/defaultTemplates.js');
const { syncEmailTemplates } = await import('../src/db/seed.js');
const { get, run } = await import('../src/db/index.js');
const tag = Date.now() % 1000000;

// ── 1. Every template has its own identity ──────────────────────────────────
console.log('— Per-mail identity —');
{
  const seen = new Set();
  let allThemed = true;
  for (const t of DEFAULT_TEMPLATES) {
    const theme = EMAIL_THEMES[t.id];
    if (!theme) { allThemed = false; console.log(`     missing theme: ${t.id}`); continue; }
    seen.add(theme.eyebrow);
  }
  ok('every template has a theme', allThemed);
  ok('eyebrows are distinct per mail', seen.size === DEFAULT_TEMPLATES.length, `${seen.size}/${DEFAULT_TEMPLATES.length}`);

  const render = async (id) => {
    const tpl = await get('SELECT * FROM email_templates WHERE id=@id', { id });
    return renderTemplate(tpl, baseContext({
      user: { name: 'Sam' }, order: { number: 'FM-1', total: '€9.99', url: 'https://forgemarket.nl/track?number=FM-1' },
      otp: { code: '123456', ttl: 10 }, refund: { amount: '€9.99' }, giftCard: { amount: '€10' },
      subject: 'Hi', message: 'Test', cart: { url: 'https://forgemarket.nl/cart' }, review: { url: 'https://x' },
    }));
  };

  const otp = await render('login_otp');
  ok('security mail carries no marketing pills', !/Money back|No hidden fees|Support on Discord/.test(otp.html));
  ok('security mail says what it is', /SECURITY CODE|Security code/i.test(otp.html));

  const delivered = await render('order_completed');
  ok('delivery mail uses the delivered eyebrow', /Delivered/.test(delivered.html));
  ok('delivery mail is green, not the default purple', /#34d399/.test(delivered.html), 'accent missing');

  const waiting = await render('payment_reminder');
  ok('waiting-for-payment mail is amber', /#f5b324/.test(waiting.html));
  ok('no mail claims instant delivery any more',
    ![otp, delivered, waiting].some((m) => /Instant delivery|delivered in seconds/i.test(m.html)));
}

// ── 2. Redeem instructions follow the product category ──────────────────────
console.log('\n— Redeem steps per category —');
{
  const robux = await createProduct({ name: `Robux ${tag}`, category: 'robux', price: 999, announce: false });
  const card = await createProduct({ name: `Steam ${tag}`, category: 'giftcard', price: 1199, announce: false });
  const odd = await createProduct({ name: `Mystery ${tag}`, category: 'freefire', price: 499, announce: false });

  const deliver = async (items, codes) => {
    const o = await createOrder({ email: `redeem${tag}-${Math.random().toString(36).slice(2, 7)}@x.dev`, items });
    for (const [pid, code] of codes) await addProductCodes(pid, [code]);
    await markPaymentReceived(o.id, `tx${Math.random().toString(36).slice(2, 9)}`, { actorId: 'test' });
    await new Promise((r) => setTimeout(r, 500));
    return (await renderOrderEmail(o.id, 'order_completed')).html;
  };

  const rbxMail = await deliver([{ productId: robux.id, quantity: 1 }], [[robux.id, `RBX-${tag}`]]);
  ok('Robux order explains roblox.com/redeem', /roblox\.com\/redeem/.test(rbxMail));
  ok('Robux order does NOT show gift-card steps', !/PlayStation, Xbox/.test(rbxMail));

  const cardMail = await deliver([{ productId: card.id, quantity: 1 }], [[card.id, `STEAM-${tag}`]]);
  ok('gift card explains the store redeem flow', /Add funds/.test(cardMail));
  ok('gift card does NOT show Roblox steps', !/roblox\.com\/redeem/.test(cardMail));

  const mixed = await deliver(
    [{ productId: robux.id, quantity: 1 }, { productId: card.id, quantity: 1 }],
    [[robux.id, `RBX2-${tag}`], [card.id, `STEAM2-${tag}`]]);
  ok('a mixed order explains BOTH', /roblox\.com\/redeem/.test(mixed) && /Add funds/.test(mixed));

  const fallback = await deliver([{ productId: odd.id, quantity: 1 }], [[odd.id, `FF-${tag}`]]);
  ok('a category with no recipe still gets usable guidance', /How to use your code/.test(fallback));
  ok('the fallback offers a human, not a dead end', /reply to this email/i.test(fallback));
}

// ── 3. Account top-ups have nothing to redeem ───────────────────────────────
{
  const topup = await createProduct({ name: `Direct ${tag}`, category: 'robux', price: 999, announce: false, deliveryField: 'Roblox username' });
  const o = await createOrder({
    email: `acct${tag}@x.dev`, items: [{ productId: topup.id, quantity: 1 }],
    billing: { deliveryMethod: 'account', deliveryDetails: 'coolgamer123', deliveryLabel: 'Roblox username' },
  });
  await addProductCodes(topup.id, [`DIR-${tag}`]);
  await markPaymentReceived(o.id, `txacct${tag}`, { actorId: 'test' });
  await new Promise((r) => setTimeout(r, 500));
  const html = (await renderOrderEmail(o.id, 'order_completed')).html;
  ok('direct top-up shows no redeem steps (we already did it)', !/How to redeem|How to use your code/.test(html));
  ok('direct top-up confirms the target account', /coolgamer123/.test(html));
}

// ── 4. Upgrades never clobber an admin's own copy ───────────────────────────
console.log('\n— Template upgrades —');
{
  await run('UPDATE email_templates SET body_html=@b WHERE id=@i',
    { b: LEGACY_TEMPLATE_BODIES.payment_confirmed[0], i: 'payment_confirmed' });
  await syncEmailTemplates();
  const upgraded = await get("SELECT body_html FROM email_templates WHERE id='payment_confirmed'");
  ok('an untouched old default is upgraded', /What happens next/.test(upgraded.body_html));

  const mine = '<h1>Eigen tekst</h1><p>{{order.number}}</p>';
  await run('UPDATE email_templates SET body_html=@b WHERE id=@i', { b: mine, i: 'payment_confirmed' });
  await syncEmailTemplates();
  const kept = await get("SELECT body_html FROM email_templates WHERE id='payment_confirmed'");
  ok('an admin-edited body is left alone', kept.body_html === mine);
}

// ── 5. The review mail links Trustpilot only when there is a profile ────────
console.log('\n— Trustpilot in the review request —');
{
  const tpl = DEFAULT_TEMPLATES.find((t) => t.id === 'review_request');
  const ctx = (trustpilotHtml) => baseContext({
    user: { name: 'Sam' }, order: { number: 'FM-1' },
    review: { url: 'https://forgemarket.nl/track?number=FM-1', trustpilotHtml },
  });
  const TP = '<p><a href="https://nl.trustpilot.com/review/forgemarket.nl">Trustpilot</a></p>';

  const off = renderTemplate(tpl, ctx('')).html;
  ok('no profile configured → the mail never mentions Trustpilot', !/trustpilot/i.test(off));
  ok('the own-review button survives either way', /forgemarket\.nl\/track/.test(off));

  const on = renderTemplate(tpl, ctx(TP)).html;
  ok('a configured profile is linked', /nl\.trustpilot\.com\/review\/forgemarket\.nl/.test(on));
  // A *Html token that got escaped would ship literal &lt;a&gt; to the inbox.
  ok('the html token is not escaped into visible markup', !/&lt;a /.test(on));

  // A live database seeded before this change must pick the new copy up.
  await run('UPDATE email_templates SET body_html=@b WHERE id=@i',
    { b: LEGACY_TEMPLATE_BODIES.review_request[0], i: 'review_request' });
  await syncEmailTemplates();
  const upgraded = await get("SELECT body_html FROM email_templates WHERE id='review_request'");
  ok('an untouched review mail gains the Trustpilot slot on boot',
    /\{\{review\.trustpilotHtml\}\}/.test(upgraded.body_html));

  // The whole point of the ask is that it lands ON the form. Checked through
  // the real path — a completed order actually run through sendReviewRequests
  // — rather than by re-stating the template, because the bug this guards
  // against is the wiring handing over the profile URL instead.
  const { config } = await import('../src/config/env.js');
  const before = config.shop.trustpilotReviewUrl;
  config.shop.trustpilotReviewUrl = 'https://nl.trustpilot.com/evaluate/forgemarket.nl';
  try {
    const p = await createProduct({ name: `Ask ${tag}`, category: 'robux', price: 500, announce: false });
    await addProductCodes(p.id, [`ASK-${tag}`]);
    const o = await createOrder({ email: `ask${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }] });
    await markPaymentReceived(o.id, `txask${tag}`, { actorId: 'test' });
    await new Promise((r) => setTimeout(r, 600));
    // afterHours 0 so the order just completed still qualifies.
    await sendReviewRequests({ afterHours: 0 });
    const logged = await get(
      "SELECT context FROM email_log WHERE template_id='review_request' AND to_email=@to ORDER BY created_at DESC LIMIT 1",
      { to: `ask${tag}@x.dev` });
    const ctx = typeof logged?.context === 'string' ? JSON.parse(logged.context) : logged?.context;
    const html = String(ctx?.review?.trustpilotHtml || '');
    ok('the review request actually goes out', !!logged);
    ok('the ask links the /evaluate/ form, not the profile',
      html.includes('/evaluate/forgemarket.nl') && !html.includes('/review/forgemarket.nl'), html.slice(0, 160));
  } finally { config.shop.trustpilotReviewUrl = before; }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
