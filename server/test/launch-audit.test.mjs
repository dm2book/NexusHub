/**
 * Three ways this shop could have opened and cost money on day one.
 *
 * Each of these was measured against the running shop before it was fixed, not
 * reasoned about. What they have in common is that none of them errors: the
 * order is taken, the page renders, the mail sends. They only show up later, as
 * a support conversation, a dispute, or a buyer who never comes back.
 */
// This suite is a shop that sells; the gate has its own file. Set before the
// first import of config/env.js, which reads process.env once — hence the
// dynamic imports below rather than static ones, which hoist above this line.
process.env.LAUNCH_MODE = 'open';

const { migrate } = await import('../src/db/migrate.js');
const { run, get } = await import('../src/db/index.js');
const { newId } = await import('../src/utils/ids.js');
const { createOrder } = await import('../src/services/orderService.js');
const { seedDemoCatalog } = await import('../src/db/demoSeed.js');
const { seed } = await import('../src/db/seed.js');
const { DEFAULT_TEMPLATES, LEGACY_TEMPLATE_BODIES } = await import('../src/services/defaultTemplates.js');
const { deliveryField } = await import('../../src/lib/deliveryInfo.js');
const { config } = await import('../src/config/env.js');
const { readFileSync } = await import('node:fs');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
await seed();
await seedDemoCatalog();
const at = new Date().toISOString();
const buyer = { email: 'audit@example.com', consent: true, consentText: 'ja', currency: 'EUR' };
const productIn = async (cat) =>
  get(`SELECT id, name, price FROM products WHERE category=@c AND active=1 ORDER BY price LIMIT 1`, { c: cat });

console.log('— A top-up we cannot address is a paid order nobody can deliver —');
{
  /* Robux goes onto an account. The product page says "geef ons je
     Roblox-gebruikersnaam door (in je bestelling…)" — and the checkout read
     only `metadata.deliveryField`, which is set on none of the 72 products, so
     that field never rendered. Every Robux order arrived with nothing to
     deliver it to: a conversation per sale, and a refund whenever the buyer
     stopped replying. */
  ok('the shop knows Robux needs a username', deliveryField('robux', 'nl') === 'Roblox-gebruikersnaam');
  ok('…and that a gift card does not', deliveryField('giftcard', 'nl') === null);

  const robux = await productIn('robux');
  const stalled = await createOrder({ ...buyer, items: [{ productId: robux.id, quantity: 1 }],
    billing: { full_name: 'A', city: 'A', email: buyer.email } });
  /* Not refused. The product page offers a ticket as an equally valid way to
     hand the username over, so an order without it is incomplete rather than
     invalid — and refusing the payment would lose the sale outright. */
  ok('an account top-up without one is still taken', !!stalled?.number);
  const row = await get('SELECT billing FROM orders WHERE id=@i', { i: stalled.id });
  const billing = JSON.parse(row.billing || '{}');
  ok('…but the order records what it is waiting for',
    billing.needsFromBuyer === 'Roblox-gebruikersnaam', JSON.stringify(billing.needsFromBuyer));

  const withTarget = await createOrder({ ...buyer, items: [{ productId: robux.id, quantity: 1 }],
    billing: { full_name: 'A', city: 'A', email: buyer.email,
      deliveryMethod: 'account', deliveryLabel: 'Roblox-gebruikersnaam', deliveryDetails: 'CoolBuilder123' } });
  const withRow = JSON.parse((await get('SELECT billing FROM orders WHERE id=@i', { i: withTarget.id })).billing);
  ok('a buyer who supplied it is never asked again', !withRow.needsFromBuyer);

  const card = await productIn('giftcard');
  const cardOrder = await createOrder({ ...buyer, items: [{ productId: card.id, quantity: 1 }],
    billing: { full_name: 'A', city: 'A', email: buyer.email } });
  const cardBilling = JSON.parse((await get('SELECT billing FROM orders WHERE id=@i', { i: cardOrder.id })).billing);
  ok('a code product is never asked for one', !cardBilling.needsFromBuyer);

  /* The buyer has to be able to see it. It was recorded on the order and shown
     nowhere: the track page said "payment confirmed — we're on it" for an order
     that could not move until the buyer acted. */
  const routes = readFileSync(new URL('../src/routes/catalog.js', import.meta.url), 'utf8');
  ok('the track endpoint tells the buyer what is missing', /needsFromBuyer:/.test(routes));
  const track = readFileSync(new URL('../../src/pages/Track.jsx', import.meta.url), 'utf8');
  ok('…and the page renders it instead of "we\u2019re on it"',
    /result\.needsFromBuyer/.test(track) && /!result\.needsFromBuyer && \[/.test(track));
  const templates = readFileSync(new URL('../src/services/defaultTemplates.js', import.meta.url), 'utf8');
  ok('…and the confirmation mail asks for it',
    (templates.match(/\{\{order\.needsFromBuyerHtml\}\}/g) || []).length >= 2);
}

console.log('\n— The cart and the charge have to be the same number —');
{
  /* The checkout summed coupon + Forge+ + bundle and clamped only at the
     subtotal. createOrder clamps the whole stack at MAX_TOTAL_DISCOUNT_PERCENT.
     Measured: a 50% coupon on €9.99 showed −€5.00 and a €4.99 total in the
     cart, and the order charged €5.99. */
  const card = await productIn('giftcard');
  const ceilingPct = config.market.maxTotalDiscountPercent;
  ok('the ceiling is a real number the shop applies', ceilingPct > 0 && ceilingPct <= 100, String(ceilingPct));

  for (const pct of [10, ceilingPct, ceilingPct + 25]) {
    const code = `AUDIT${pct}`;
    await run(`INSERT INTO coupons (id, code, kind, value, active, created_at)
      VALUES (@id,@c,'percent',@v,1,@a)`, { id: newId('cpn'), c: code, v: pct, a: at });
    const order = await createOrder({ ...buyer, items: [{ productId: card.id, quantity: 1 }],
      coupon: code, billing: { full_name: 'A', city: 'A', email: buyer.email } });
    /* What the checkout now computes: the server's own evaluated discount,
       clamped by the server's own ceiling. Same two inputs, same arithmetic. */
    const ceiling = Math.round(card.price * ceilingPct / 100);
    const shown = card.price - Math.min(card.price, Math.round(card.price * pct / 100), ceiling);
    ok(`a ${pct}% coupon quotes what it charges`, shown === order.total,
      `cart ${shown} vs charged ${order.total}`);
  }
}

console.log('\n— A Dutch shop sends Dutch email —');
{
  /* All thirteen templates were English, on a shop whose storefront, checkout
     and legal pages are Dutch — including the login code and the delivery mail,
     the two messages every buyer reads. An English mail from a Dutch shop is
     also what a phishing mail looks like. */
  const DUTCH = /\b(je|jouw|bestelling|betaling|geleverd|bedankt|hoi|inlogcode|code|klaar)\b/i;
  const ENGLISH_ONLY = /\b(your order|thanks for|we have received|sign in|welcome back|refund issued|redeem your)\b/i;

  const bad = DEFAULT_TEMPLATES.filter((t) => ENGLISH_ONLY.test(t.subject) || ENGLISH_ONLY.test(t.body_html));
  ok('no template still carries the English copy', bad.length === 0, bad.map((t) => t.id).join(', '));
  const notDutch = DEFAULT_TEMPLATES.filter((t) => !DUTCH.test(`${t.subject} ${t.body_html}`));
  ok('…and every one of them reads as Dutch', notDutch.length === 0, notDutch.map((t) => t.id).join(', '));

  /* A live database seeded with the English copy has to pick the Dutch one up,
     while anything the owner edited by hand is left alone — which is what the
     legacy list is for. */
  ok('every template has its English body registered as legacy',
    DEFAULT_TEMPLATES.every((t) => (LEGACY_TEMPLATE_BODIES[t.id] || []).length > 0),
    DEFAULT_TEMPLATES.filter((t) => !(LEGACY_TEMPLATE_BODIES[t.id] || []).length).map((t) => t.id).join(', '));

  // The seeded rows, not just the source: this is what actually gets sent.
  const stored = await get(`SELECT subject, body_html FROM email_templates WHERE id='order_completed'`);
  ok('the seeded delivery mail is Dutch', /klaar|geleverd/i.test(stored?.subject || ''), stored?.subject);
  const otp = await get(`SELECT subject FROM email_templates WHERE id='login_otp'`);
  ok('…and so is the login code', /inlogcode/i.test(otp?.subject || ''), otp?.subject);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} launch-audit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
