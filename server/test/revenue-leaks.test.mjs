/**
 * The ways this shop could give money away, closed.
 *
 * Each of these was found by arithmetic or by following a code path to its end,
 * and each one had passed every other suite because nothing was looking at the
 * total. They are grouped by what they cost rather than by which file they live
 * in, because that is the question that was being asked.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/db/migrate.js';
import { run, get, all } from '../src/db/index.js';
import { newId } from '../src/utils/ids.js';
import { getOrCreateCode, attributeSignup, recordOrderCommission, reverseOrderCommission }
  from '../src/services/affiliateService.js';
import { balanceOf, debit } from '../src/services/walletService.js';
import { config } from '../src/config/env.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

await migrate();
const now = new Date().toISOString();
const mkUser = async (email) => {
  const id = newId('usr');
  await run(`INSERT INTO users (id,email,status,created_at,updated_at) VALUES (@id,@e,'active',@a,@a)`,
    { id, e: email, a: now });
  return id;
};
const mkOrder = async (userId, total) => {
  const id = newId('ord');
  await run(`INSERT INTO orders (id,number,user_id,email,status,subtotal,total,currency,created_at,updated_at)
    VALUES (@id,@n,@u,'b@x.dev','pending',@t,@t,'EUR',@a,@a)`,
    { id, n: `FM-${id.slice(-6)}`, u: userId, t: total, a: now });
  return id;
};

console.log('— A discount stack cannot reach 100% —');
{
  /* A coupon caps at 90%, a bundle caps at 90%, Forge+ adds 5%. Each is sane on
     its own; the checkout ADDED them and capped the total at the subtotal. So
     90 + 20 + 5 was a €0 order on which the shop still handed over a code it
     had paid for. */
  const src = read('server', 'src', 'services', 'orderService.js');
  ok('the ceiling is applied to the whole stack',
    /const stacked = couponDiscount \+ memberDiscount \+ bundleDiscount;/.test(src)
    && /Math\.min\(subtotal, stacked, discountCeiling\)/.test(src));
  ok('and it is configurable', /maxTotalDiscountPercent/.test(read('server', 'src', 'config', 'env.js')));
  ok('with a ceiling well under a free order',
    config.market.maxTotalDiscountPercent > 0 && config.market.maxTotalDiscountPercent <= 60,
    String(config.market.maxTotalDiscountPercent));
  // The clamp, run on the real numbers rather than asserted about.
  const cap = (subtotal, stack) => Math.min(subtotal, stack,
    Math.round(subtotal * config.market.maxTotalDiscountPercent / 100));
  ok('a 90% coupon plus a 20% bundle plus Forge+ cannot zero an order',
    cap(17499, Math.round(17499 * 1.15)) < 17499,
    `${cap(17499, Math.round(17499 * 1.15))} of 17499`);
  ok('and a legitimate small discount is untouched', cap(17499, 500) === 500);
}

console.log('\n— A commission does not survive the sale being undone —');
{
  const ref = await mkUser(`r-${newId('x')}@x.dev`);
  const buy = await mkUser(`b-${newId('x')}@x.dev`);
  await attributeSignup(buy, await getOrCreateCode(ref, 'r@x.dev'));
  const oid = await mkOrder(buy, 17499);

  await recordOrderCommission({ id: oid, userId: buy, total: 17499, number: 'FM-T' });
  const paid = await balanceOf(ref);
  ok('the commission is credited on the sale', paid === 875, `${paid}`);

  await reverseOrderCommission(oid, 'refunded');
  ok('and taken back when the order is refunded', (await balanceOf(ref)) === 0);
  const ev = await get(`SELECT status FROM referral_events WHERE order_id=@o AND kind='order'`, { o: oid });
  ok('the event says so rather than staying "paid"', ev?.status === 'reversed', ev?.status);

  /* A refund and then a chargeback on the same order is one reversal. */
  await reverseOrderCommission(oid, 'charged back');
  ok('a second reversal on the same order is a no-op', (await balanceOf(ref)) === 0);

  /* The referrer may have spent it. They owe it, and clamping at zero would
     mean the shop quietly eats the difference. */
  const ref2 = await mkUser(`r2-${newId('x')}@x.dev`);
  const buy2 = await mkUser(`b2-${newId('x')}@x.dev`);
  await attributeSignup(buy2, await getOrCreateCode(ref2, 'r2@x.dev'));
  const o2 = await mkOrder(buy2, 17499);
  await recordOrderCommission({ id: o2, userId: buy2, total: 17499, number: 'FM-T2' });
  await debit(ref2, 875, 'spend', 'spent it');
  await reverseOrderCommission(o2, 'charged back');
  ok('an already-spent commission leaves the wallet owing it', (await balanceOf(ref2)) === -875,
    String(await balanceOf(ref2)));

  const orders = read('server', 'src', 'services', 'orderService.js');
  ok('a refund, a cancel and a failure all reverse it',
    /if \(to === 'refunded' \|\| to === 'cancelled' \|\| to === 'failed'\) \{[\s\S]{0,200}reverseOrderCommission/.test(orders));
  ok('and so does a chargeback',
    /reverseOrderCommission\(order\.id, 'charged back'\)/.test(read('server', 'src', 'services', 'chargebackService.js')));
}

console.log('\n— A failed delivery does not become a silent one —');
{
  /* The sweep is the net under the pipeline, and it excluded any order that had
     a fulfillment_request row — including a FAILED one. So an order whose
     automatic delivery failed was paid, undelivered, and invisible to the one
     thing whose job is to find exactly that. The customer's next move is a
     chargeback. */
  const f = read('server', 'src', 'services', 'fulfillmentService.js');
  ok('the sweep looks past a failed request',
    /WHERE fr\.order_id = o\.id AND fr\.status <> 'failed'/.test(f));
  ok('and knows which orders got there by failing', /"hadFailure"/.test(f));
  /* Not back through the automatic path — that is the one that just failed. */
  ok('a failure goes straight to a person',
    /if \(r\.hadFailure\) \{[\s\S]{0,160}ensureManualFulfillment/.test(f));
  ok('and the queue no longer treats a failed row as handled',
    (f.match(/SELECT id FROM fulfillment_requests WHERE order_id=@o AND status <> 'failed'/g) || []).length >= 2);
}

console.log('\n— Revenue already won is chased where the buyer is —');
{
  const orders = read('server', 'src', 'services', 'orderService.js');
  const dsvc = read('server', 'src', 'services', 'discordService.js');
  const notify = read('server', 'src', 'services', 'notifyService.js');
  ok('an unpaid order is chased in Discord too', /postPaymentReminder\(uid/.test(orders)
    && /export async function postPaymentReminder/.test(dsvc));
  /* The order is not going anywhere for fourteen days; a countdown here would
     be counting nothing. */
  ok('and the chase applies no pressure it cannot justify',
    !/hurry|last chance|expires? (today|soon)|act now/i.test(
      (dsvc.match(/export async function postPaymentReminder[\s\S]*?\n\}/) || [''])[0]));

  ok('a placed order reaches the owner, not just a channel', /alertOwner\('order\.placed'/.test(orders));
  ok('the event is registered', /'order\.placed':/.test(notify));
  /* A phone that rings for every order is a phone that gets silenced before the
     chargeback lands. */
  const ev = (notify.match(/'order\.placed':\s*\{[^}]*\}/) || [''])[0];
  ok('and it is quieter than a paid one', /priority: -1/.test(ev), ev);
}

console.log('\n— The live catalogue is repaired without overruling the owner —');
{
  const m = read('server', 'src', 'db', 'migrations.js');
  ok('the price repair ships as a migration', /035_price_repair/.test(m));
  const sql = (m.match(/id: '035_price_repair'[\s\S]*?\n  \},/) || [''])[0];
  const updates = (sql.match(/UPDATE products SET price/g) || []).length;
  ok('it corrects all seven prices', updates === 7, `${updates}`);
  /* Prices are a commercial decision. Every statement is guarded on the exact
     old value, so a price the owner has since changed is left alone and a
     re-run does nothing. */
  const guarded = (sql.match(/WHERE sku = '[A-Z0-9-]+'\s*AND price = \d+;/g) || []).length;
  ok('and every one is guarded on the price it is replacing', guarded === updates, `${guarded}/${updates}`);

  const seeded = await all(`SELECT sku, price FROM products WHERE sku IN
    ('VBUCKS-5000','MLBB-1155','STEAM-50','NETFLIX-25','AMAZON-25','GPLAY-25','ITUNES-25')`);
  const wrong = seeded.filter((p) => [2399, 1699, 5199, 2599].includes(Number(p.price)));
  ok('no shipped product is left at a price that loses money', wrong.length === 0,
    wrong.map((p) => `${p.sku}:${p.price}`).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
