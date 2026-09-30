/**
 * The wishlist on the account, and its price alerts.
 *
 * Saving is the easy half. Most of this is about what an alert must NOT say:
 * a price that went up and came back down is not a deal, the same drop is not
 * news twice, a target price means "not before then", and a shopper who turned
 * alerts off — or never turned them on — hears nothing. When one does go out,
 * email and Discord both carry the same three numbers: the previous price, the
 * current price, and the difference.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_audit';
process.env.NODE_ENV ||= 'development';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const { createApp, ensureReady } = await import('../src/app.js');
await ensureReady();
const { run, get, all, nowIso } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { createProduct, updateProduct } = await import('../src/services/productService.js');
const { finalizeLogin } = await import('../src/services/authService.js');
const wl = await import('../src/services/wishlistService.js');

const stamp = Date.now();
const mkUser = async (name, locale = 'nl') => {
  const id = newId('usr');
  await run(`INSERT INTO users (id, email, display_name, preferences, created_at, updated_at)
             VALUES (@id, @e, @n, @p, @at, @at)`,
  { id, e: `${name}-${stamp}@test.local`, n: name, p: JSON.stringify({ locale }), at: nowIso() });
  return get(`SELECT * FROM users WHERE id=@id`, { id });
};
const mkProduct = (name, price) => createProduct({ name, sku: `WL-${name.replace(/\W+/g, '')}-${stamp}`,
  category: 'robux', price, currency: 'EUR', active: true, announce: false, metadata: {} });

/* What an alert produced, read where it lands: the email log and the bot's queue. */
const mailsTo = async (email) => (await all(
  `SELECT template_id, context FROM email_log WHERE to_email=@e AND template_id='price_drop' ORDER BY created_at`,
  { e: email })).map((r) => ({ ...r, ctx: JSON.parse(r.context || '{}') }));
/* Waits rather than counts once. The first request of a run also starts the
   maintenance sweep in the background, and that sweep sends pending alerts
   too: when it claims one first, the alert is sent by the sweep a moment
   later — correct, and invisible to a count taken the instant the price
   changed. Seen in the full suite, never alone. */
const waitMails = async (email, n, ms = 8000) => {
  const until = Date.now() + ms;
  let got = await mailsTo(email);
  while (got.length < n && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 150));
    got = await mailsTo(email);
  }
  return got;
};
const dmsTo = async (uid) => (await all(`SELECT payload FROM discord_outbox WHERE kind='dm' ORDER BY created_at`))
  .map((r) => JSON.parse(r.payload)).filter((p) => p.discordUserId === uid);

const ana = await mkUser('ana');
const { accessToken } = await finalizeLogin(ana, {});
const srv = createApp().listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const call = (method, path, body, token = accessToken) => fetch(`${base}${path}`, {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), text: '' }));

console.log('\n— Saving —');
const robux = await mkProduct('1,000 Robux', 1000);
{
  ok('a guest cannot read an account wishlist', (await call('GET', '/api/account/wishlist', null, null)).status === 401);
  const add = await call('POST', '/api/account/wishlist', { productId: robux.id });
  const item = add.body.items.find((i) => i.productId === robux.id);
  ok('a product is saved', add.status === 201 && !!item, JSON.stringify(add.body).slice(0, 200));
  ok('…at the price it had', item.savedPrice === 1000 && item.currentPrice === 1000);
  await updateProduct(robux.id, { price: 1100 });
  await call('POST', '/api/account/wishlist', { productId: robux.id });
  const again = (await call('GET', '/api/account/wishlist')).body.items.find((i) => i.productId === robux.id);
  ok('saving it again keeps the price it was first saved at', again.savedPrice === 1000, String(again.savedPrice));
  ok('the list shows the difference since it was saved', again.diffSinceSaved === 100);
  ok('…and the previous price', again.previousPrice === 1000, String(again.previousPrice));
  await updateProduct(robux.id, { price: 1000 });

  const other = await mkProduct('500 Coins', 500);
  const imp = await call('POST', '/api/account/wishlist/import', { productIds: [other.id, 'prd_does_not_exist', robux.id] });
  ok('a browser list is imported at sign-in, unknown ids skipped', imp.body.added === 1, JSON.stringify(imp.body.added));
  const del = await call('DELETE', `/api/account/wishlist/${other.id}`);
  ok('a product can be removed', !del.body.items.some((i) => i.productId === other.id));
}

console.log('\n— A drop is announced by email and Discord —');
{
  await run(`INSERT INTO oauth_accounts (id, user_id, provider, provider_uid, created_at)
             VALUES (@id, @u, 'discord', 'discord-ana', @at)`, { id: newId('oa'), u: ana.id, at: nowIso() });
  const on = await call('PATCH', `/api/account/wishlist/${robux.id}/alert`, { enabled: true });
  ok('an alert is turned on', on.body.items.find((i) => i.productId === robux.id).alert.enabled === true);

  await updateProduct(robux.id, { price: 800 });
  const mails = await waitMails(ana.email, 1);
  ok('one email goes out', mails.length === 1, String(mails.length));
  const p = mails[0]?.ctx.price || {};
  ok('…with the previous price', /10,00/.test(p.previous), JSON.stringify(p));
  ok('…the current price', /8,00/.test(p.current));
  ok('…and the difference', /2,00/.test(p.diff));
  ok('…in the shopper\'s language', mails[0]?.ctx.lang === 'nl');
  ok('…with a link that turns alerts off', /\/api\/wishlist\/alerts\/off\?u=/.test(mails[0]?.ctx.wishlist?.alertsOffUrl || ''));

  let dms = await dmsTo('discord-ana');
  for (let i = 0; i < 50 && !dms.length; i++) { await new Promise((r) => setTimeout(r, 150)); dms = await dmsTo('discord-ana'); }
  const text = JSON.stringify(dms[0] || {});
  ok('a Discord DM goes out to the linked account', dms.length === 1, String(dms.length));
  ok('…showing the same three numbers', /10,00/.test(text) && /8,00/.test(text) && /2,00/.test(text), text.slice(0, 240));
}

console.log('\n— And what is not news —');
{
  /* Up and back down to the price already announced: nothing new. */
  await updateProduct(robux.id, { price: 900 });
  await updateProduct(robux.id, { price: 800 });
  ok('back down to the announced price is not announced again', (await mailsTo(ana.email)).length === 1);

  /* A further drop inside the cooldown waits; the sweep sends it later. */
  await updateProduct(robux.id, { price: 700 });
  ok('a second drop within hours is held back', (await mailsTo(ana.email)).length === 1);
  await run(`UPDATE wishlist_items SET last_notified_at = @old WHERE user_id=@u`,
    { old: new Date(Date.now() - 7 * 3_600_000).toISOString(), u: ana.id });
  const swept = await wl.sendPendingAlerts();
  const mails = await mailsTo(ana.email);
  ok('…and sent once the cooldown has passed', swept.sent === 1 && mails.length === 2, JSON.stringify(swept));
  ok('…from the price last announced, not from a price in between', /8,00/.test(mails[1].ctx.price.previous)
    && /7,00/.test(mails[1].ctx.price.current), JSON.stringify(mails[1].ctx.price));

  /* Armed, then the price went back up before the sender ran. */
  const bo = await mkUser('bo');
  const card = await mkProduct('Gift Card €25', 2699);
  await wl.setAlert(bo.id, card.id, { enabled: true });
  await run(`UPDATE wishlist_items SET last_notified_at = @recent, last_notified_price = 2699 WHERE user_id=@u`,
    { recent: nowIso(), u: bo.id });
  await updateProduct(card.id, { price: 2499 });
  await updateProduct(card.id, { price: 2799 });
  await run(`UPDATE wishlist_items SET last_notified_at = NULL WHERE user_id=@u`, { u: bo.id });
  await wl.sendPendingAlerts();
  ok('a drop that was undone before sending is never sent', (await mailsTo(bo.email)).length === 0);

  /* Up then partly down: cheaper than a moment ago, dearer than when saved. */
  const cy = await mkUser('cy');
  const coins = await mkProduct('2,000 Coins', 1000);
  await wl.setAlert(cy.id, coins.id, { enabled: true });
  await updateProduct(coins.id, { price: 1200 });
  await updateProduct(coins.id, { price: 1100 });
  ok('a drop that is still above the saved price is not a deal', (await mailsTo(cy.email)).length === 0);

  /* A target price means "not before then". */
  const di = await mkUser('di', 'en');
  const pass2 = await mkProduct('Game Pass 3 Months', 3499);
  await wl.setAlert(di.id, pass2.id, { enabled: true, targetPrice: 2999 });
  await updateProduct(pass2.id, { price: 3199 });
  ok('a drop that misses the target is not sent', (await mailsTo(di.email)).length === 0);
  await updateProduct(pass2.id, { price: 2899 });
  const diMail = await mailsTo(di.email);
  ok('…the one that reaches it is', diMail.length === 1);
  ok('…in English, formatted for English', diMail[0]?.ctx.lang === 'en' && /€28\.99/.test(diMail[0]?.ctx.price.current),
    JSON.stringify(diMail[0]?.ctx.price));

  /* Saved without an alert: nothing, ever. */
  const ed = await mkUser('ed');
  const quiet = await mkProduct('4,500 Gems', 2999);
  await wl.addItem(ed.id, quiet.id);
  await updateProduct(quiet.id, { price: 1999 });
  ok('a product saved without an alert sends nothing', (await mailsTo(ed.email)).length === 0);
}

console.log('\n— Turning alerts off from the email —');
{
  const bad = await fetch(`${base}/api/wishlist/alerts/off?u=${ana.id}&t=${'0'.repeat(32)}`);
  ok('a wrong token answers the same way', bad.status === 200);
  ok('…and changes nothing', !!(await get(`SELECT alert_enabled FROM wishlist_items WHERE user_id=@u`, { u: ana.id })).alert_enabled);
  const good = await fetch(wl.alertsOffUrl(ana.id).replace(/^https?:\/\/[^/]+/, base));
  ok('the real link turns every alert off', good.status === 200
    && !(await get(`SELECT alert_enabled FROM wishlist_items WHERE user_id=@u`, { u: ana.id })).alert_enabled);
  await updateProduct(robux.id, { price: 500 });
  ok('…after which a drop sends nothing', (await mailsTo(ana.email)).length === 2);
}

console.log('\n— A price published by the pricing engine counts too —');
{
  const fi = await mkUser('fi');
  const vb = await mkProduct('1,000 V-Bucks', 899);
  await wl.setAlert(fi.id, vb.id, { enabled: true });
  const mpId = newId('mp');
  await run(`INSERT INTO market_products (id, canonical_key, product_type, game, platform, region, title, created_at, updated_at)
             VALUES (@id, @k, 'currency', 'fortnite', 'any', 'global', '1000 V-Bucks', @at, @at)`,
  { id: mpId, k: `fortnite-vbucks-1000-${stamp}`, at: nowIso() });
  const recId = newId('mpr');
  await run(`INSERT INTO market_price_recommendations (id, market_product_id, forge_product_id, competitor_count,
               confidence, recommended_cents, status, blockers, inputs, created_at)
             VALUES (@id, @mp, @p, 3, 1, 799, 'approved', '[]', '{}', @at)`,
  { id: recId, mp: mpId, p: vb.id, at: nowIso() });
  const { publishRecommendation } = await import('../src/services/market/engine.js');
  await publishRecommendation(recId, { actor: 'owner@test.local' });
  ok('an engine price drop sends the alert', (await mailsTo(fi.email)).length === 1);
  /* The chart on the product page was blind to every engine price. */
  const hist = await get(`SELECT price FROM price_history WHERE product_id=@p ORDER BY created_at DESC LIMIT 1`, { p: vb.id });
  ok('…and is on the product\'s price history now', Number(hist?.price) === 799, String(hist?.price));
}

console.log('\n— A product with no price history still knows its previous price —');
{
  /* Found by looking at the page: the seeded catalogue has no history rows,
     so its first price change recorded only the new price and "previous" was
     blank for every real product. */
  const gi = await mkUser('gi');
  const seeded = await mkProduct('Seeded Card', 1500);
  await run(`DELETE FROM price_history WHERE product_id = @p`, { p: seeded.id });
  await wl.addItem(gi.id, seeded.id);
  await updateProduct(seeded.id, { price: 1300 });
  const row = (await wl.listItems(gi.id)).find((i) => i.productId === seeded.id);
  ok('the previous price is the price it had before the change', row.previousPrice === 1500, String(row.previousPrice));
  const hist = await all(`SELECT price FROM price_history WHERE product_id=@p ORDER BY created_at`, { p: seeded.id });
  ok('…and the history reads old, then new', hist.map((h) => Number(h.price)).join(',') === '1500,1300',
    hist.map((h) => h.price).join(','));
}

console.log('\n— The email itself —');
{
  const { DEFAULT_TEMPLATES } = await import('../src/services/defaultTemplates.js').then((m) => ({
    DEFAULT_TEMPLATES: Object.values(m).find(Array.isArray) }));
  const { TEMPLATE_TRANSLATIONS } = await import('../src/services/templateTranslations.js');
  const nl = DEFAULT_TEMPLATES.find((t) => t.id === 'price_drop');
  const tokens = (t) => [...new Set(`${t.subject}${t.body_html}`.match(/{{[^}]+}}/g))].sort().join(' ');
  ok('there is a price-drop email', !!nl);
  for (const l of ['en', 'de', 'fr']) {
    ok(`…in ${l}, with the same fields`, tokens(TEMPLATE_TRANSLATIONS[l].price_drop) === tokens(nl));
  }
  ok('it shows previous, current and difference',
    ['{{price.previous}}', '{{price.current}}', '{{price.diff}}'].every((t) => nl.body_html.includes(t)));
  ok('…and always carries the way to turn it off', nl.body_html.includes('{{wishlist.alertsOffUrl}}'));
}

srv.close();
console.log(`\n${fail ? '❌' : '✅'} wishlist: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
