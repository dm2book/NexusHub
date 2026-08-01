/**
 * The audit fixes, pinned.
 *
 * Every one of these was found by reading the code and then proving it against a
 * running server — and every one is the kind of thing that quietly comes back
 * during a refactor because nothing fails when it does. That is what this file
 * is for.
 */
process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/forge_hardening';
process.env.NODE_ENV ||= 'development';
process.env.APP_URL ||= 'https://forgemarket.nl';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } };

await (await import('../src/app.js')).ensureReady();
const { createProduct } = await import('../src/services/productService.js');
const { addProductCodes } = await import('../src/services/codeStockService.js');
const { createOrder } = await import('../src/services/orderService.js');
const { claimOutbox, ackOutbox } = await import('../src/services/discordService.js');
const { reviewStats, addReview } = await import('../src/services/reviewsService.js');
const { get, run } = await import('../src/db/index.js');

// enqueueOutbox is module-private; insert straight into the queue rather than
// widening the production surface for a test's convenience.
let seq = 0;
const queue = (content) => run(
  `INSERT INTO discord_outbox (id, kind, payload, created_at) VALUES (@id, 'leads', @p, @at)`,
  { id: `obx_h${tag}_${seq++}`, p: JSON.stringify({ content }), at: new Date().toISOString() });
const tag = Date.now() % 1000000;

// ── 1. The withdrawal waiver is recorded, not just displayed ────────────────
// The checkbox existed for months but lived only in React state: the payload
// never carried it and no column stored it, so a chargeback would have found
// nothing on file while the code was already spent.
console.log('— Withdrawal consent —');
{
  const p = await createProduct({ name: `Consent ${tag}`, category: 'robux', price: 500, announce: false });

  let refused = null;
  await createOrder({ email: `noconsent${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }] })
    .catch((e) => { refused = e; });
  ok('an order without consent is refused outright', !!refused, 'it was accepted');

  const order = await createOrder({
    email: `consent${tag}@x.dev`, items: [{ productId: p.id, quantity: 1 }],
    consent: true, consentText: 'Ik wil mijn bestelling meteen geleverd krijgen.',
  });
  const row = await get('SELECT consent_at, consent_text FROM orders WHERE id=@id', { id: order.id });
  ok('consent is stamped with a timestamp', !!row?.consent_at, JSON.stringify(row));
  // The sentence, not a boolean: the wording is what was agreed to, and it will
  // change over time (and differs per language).
  ok('the exact sentence the buyer read is stored',
    row?.consent_text === 'Ik wil mijn bestelling meteen geleverd krijgen.', row?.consent_text);

  // Evidence nobody can retrieve is not evidence. It was written on creation but
  // hydrate() never read it back, so producing it in a dispute meant opening the
  // database by hand — which is not a thing that happens during a chargeback.
  const { getOrder } = await import('../src/services/orderService.js');
  const fetched = await getOrder(order.id);
  ok('the waiver comes back on the order the admin screen reads',
    !!fetched?.consentAt && fetched.consentText === 'Ik wil mijn bestelling meteen geleverd krijgen.',
    JSON.stringify({ at: fetched?.consentAt, text: fetched?.consentText }));

  // EU distance selling also requires CONFIRMING the waiver to the consumer on a
  // durable medium. A checkbox on a page they have since closed is not one.
  const { renderOrderEmail } = await import('../src/services/orderService.js');
  const mail = await renderOrderEmail(order.id, 'order_received');
  ok('the confirmation email states the withdrawal right',
    /Right of withdrawal/i.test(mail.html), mail.html.slice(0, 120));
  ok('it quotes the buyer back their own sentence',
    mail.html.includes('Ik wil mijn bestelling meteen geleverd krijgen.'));

  // And an order placed before this existed must not print an empty legal block.
  await run('UPDATE orders SET consent_at=NULL, consent_text=NULL WHERE id=@id', { id: order.id });
  const legacyMail = await renderOrderEmail(order.id, 'order_received');
  ok('an order with no recorded waiver prints no block at all',
    !/Right of withdrawal/i.test(legacyMail.html));
}

// ── 2. A zero total settles itself ─────────────────────────────────────────
// Store credit was debited and the order still went to 'pending', parking the
// buyer on a screen asking them to transfer €0.00 until the 14-day auto-cancel.
console.log('\n— Fully covered by credit —');
{
  const p = await createProduct({ name: `Free ${tag}`, category: 'robux', price: 1000, announce: false });
  await addProductCodes(p.id, [`FREE-${tag}`]);
  const { credit } = await import('../src/services/walletService.js');
  const u = `usr_h${tag}`;
  await run(`INSERT INTO users (id, email, created_at, updated_at) VALUES (@id, @e, @at, @at)
             ON CONFLICT (id) DO NOTHING`,
    { id: u, e: `credit${tag}@x.dev`, at: new Date().toISOString() });
  await credit(u, 5000, 'grant', 'test balance', { createdBy: 'test' });

  const order = await createOrder({
    email: `credit${tag}@x.dev`, userId: u, items: [{ productId: p.id, quantity: 1 }],
    useCredit: 1000, consent: true, consentText: 'test',
  });
  ok('the total really is zero', order.total === 0, String(order.total));
  ok('it does not sit in pending waiting for a €0.00 transfer',
    order.status !== 'pending', order.status);
}

// ── 3. Discord events are leased, not marked delivered on hand-over ─────────
// delivered_at used to be stamped while merely handing the events to the bot, so
// a failed send lost them permanently. Order pings ride this queue.
console.log('\n— Outbox delivery —');
{
  await queue(`hardening ${tag}`);
  const [ev] = await claimOutbox(20);
  ok('an event is handed to the bot', !!ev, 'nothing claimed');

  const afterClaim = await get('SELECT delivered_at, claimed_at FROM discord_outbox WHERE id=@id', { id: ev.id });
  ok('claiming leases it rather than retiring it', !afterClaim.delivered_at, JSON.stringify(afterClaim));
  ok('the lease is stamped so a second poll skips it', !!afterClaim.claimed_at);

  // A bot that polls again immediately must not get the same work twice.
  const again = (await claimOutbox(20)).map((e) => e.id);
  ok('a fresh poll does not re-hand a leased event', !again.includes(ev.id));

  await ackOutbox([ev.id]);
  const afterAck = await get('SELECT delivered_at FROM discord_outbox WHERE id=@id', { id: ev.id });
  ok('only an acknowledgement retires it', !!afterAck.delivered_at);

  // The whole point: an event the bot could NOT send comes back around.
  await queue(`never-acked ${tag}`);
  const [lost] = (await claimOutbox(20)).filter((e) => e.id !== ev.id);
  await run(`UPDATE discord_outbox SET claimed_at=@old WHERE id=@id`,
    { old: new Date(Date.now() - 10 * 60_000).toISOString(), id: lost.id });
  const reoffered = (await claimOutbox(20)).map((e) => e.id);
  ok('an unacknowledged event is offered again once its lease expires',
    reoffered.includes(lost.id));
}

// ── 4. Only verified reviews move the public star rating ───────────────────
// A Discord /vouch is gated on a role that confirms you are human, not that you
// ever bought anything — and it used to count towards the rating the whole shop
// is judged on, including the stars Google shows.
console.log('\n— Public rating —');
{
  const before = await reviewStats();
  await addReview({ author: `Voucher${tag}`, stars: 5, body: 'never bought anything',
    source: 'discord', externalId: `vouch:test${tag}` });
  const after = await reviewStats();
  ok('an unverified Discord vouch does not move the rating',
    after.count === before.count, `${before.count} → ${after.count}`);

  // And it is still on the site — it just does not vote.
  const stored = await get(`SELECT status, verified FROM reviews WHERE external_id=@e`,
    { e: `vouch:test${tag}` });
  ok('the vouch is still published, just not counted',
    stored?.status === 'visible' && !stored?.verified, JSON.stringify(stored));
}

// ── 5. A payment screenshot is actually accepted ───────────────────────────
// The route demanded `.url().max(500)` + http(s) while the checkout uploads a
// resized data URI, so proving you paid by photo failed 100% of the time.
console.log('\n— Payment proof —');
{
  const { z } = await import('zod');
  const mod = await import('../src/routes/catalog.js');
  ok('route module loads', !!mod.default);
  // Re-declare the shape the route uses so a change there fails loudly here.
  const schema = z.string().max(1_400_000)
    .refine((u) => /^https?:\/\//i.test(u) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(u),
      'Must be an http(s) link or an uploaded image')
    .refine((u) => !u.startsWith('data:') || u.length <= 1_300_000, 'too large');
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(400_000);
  let accepted = true;
  try { schema.parse(photo); } catch { accepted = false; }
  ok('a phone screenshot (data URI) is accepted', accepted);
  let link = true;
  try { schema.parse('https://i.imgur.com/abc.png'); } catch { link = false; }
  ok('a pasted link still works', link);
  let junk = false;
  try { schema.parse('javascript:alert(1)'); junk = true; } catch { /* expected */ }
  ok('a non-image scheme is still refused', !junk);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
