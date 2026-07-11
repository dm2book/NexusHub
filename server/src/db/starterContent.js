/**
 * One-time starter content, so the store is fully stocked with the engagement
 * features the moment it deploys — zero admin work needed:
 *
 *  - ONE mystery box (€49.99) with a balanced, profitable reward pool
 *    (expected payout ≈ €38.75 in store credit → ~22% margin, and the payout
 *    is store credit so it comes back as future orders).
 *  - ONE starter bundle (two shooter top-ups at 10% off) as a live example.
 *
 * Strictly idempotent and respectful of the admin: each piece is only created
 * if NOTHING of its kind exists yet, so it never overwrites real config.
 * Best-effort: a failure here never blocks boot.
 */
import { get, all, run, nowIso } from './index.js';
import { setRewards } from '../services/mysteryBoxService.js';
import { createBundle } from '../services/bundleService.js';

// Fixed primary key → concurrent cold starts can never create duplicates
// (plain "check then create" raced when Vercel booted several instances at
// once, which is exactly how two identical €49.99 boxes appeared).
const BOX_ID = 'prd_starter_mystery_box';

export async function seedStarterContent() {
  await dedupeMysteryBoxes().catch((e) => console.error('[starter] dedupe:', e.message));
  await mysteryBox().catch((e) => console.error('[starter] mystery box:', e.message));
  await starterBundle().catch((e) => console.error('[starter] bundle:', e.message));
}

/** Heal the earlier race: keep the oldest 'Forge Mystery Box', remove extras. */
async function dedupeMysteryBoxes() {
  const dupes = await all(
    `SELECT id FROM products
      WHERE kind = 'mystery' AND name = 'Forge Mystery Box'
      ORDER BY created_at ASC OFFSET 1`);
  for (const d of dupes) {
    // Delete when nothing references it; otherwise just hide it from the shop.
    try {
      const used = await get('SELECT id FROM order_items WHERE product_id=@p LIMIT 1', { p: d.id });
      if (used) await run('UPDATE products SET active=0 WHERE id=@p', { p: d.id });
      else await run('DELETE FROM products WHERE id=@p', { p: d.id });
      console.log(`[starter] removed duplicate mystery box ${d.id}`);
    } catch {
      await run('UPDATE products SET active=0 WHERE id=@p', { p: d.id }).catch(() => {});
    }
  }
}

async function mysteryBox() {
  const existing = await get(`SELECT id FROM products WHERE kind = 'mystery' AND active = 1 LIMIT 1`);
  if (existing) return;
  const at = nowIso();
  const inserted = await run(
    `INSERT INTO products (id, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
     VALUES (@id, @name, 'mystery', @desc, 4999, 'EUR', 'mystery', 1, @meta, @at, @at)
     ON CONFLICT (id) DO NOTHING`,
    {
      id: BOX_ID,
      name: 'Forge Mystery Box',
      desc: 'Every box wins a real prize, paid out instantly as store credit — up to a €150 jackpot. ' +
        'Buy more boxes in one order for better odds, and every box comes with one free risk-free reroll.',
      meta: JSON.stringify({ featured: true }),
      at,
    });
  if (!inserted.changes) return; // another instance just created it
  // Expected payout ≈ €38.75 per €49.99 box (≈22% margin, credit-based).
  await setRewards(BOX_ID, [
    { label: '€20 store credit', weight: 40, credit: 2000 },
    { label: '€35 store credit', weight: 30, credit: 3500 },
    { label: '€50 store credit', weight: 18, credit: 5000 },
    { label: '€75 store credit', weight: 9, credit: 7500 },
    { label: '€150 JACKPOT 💎', weight: 3, credit: 15000 },
  ]);
  await run(`INSERT INTO price_history (id, product_id, price, currency, created_at)
             VALUES (@id, @p, 4999, 'EUR', @at) ON CONFLICT (id) DO NOTHING`,
    { id: `ph_${BOX_ID}`, p: BOX_ID, at }).catch(() => {});
  console.log('[starter] created the €49.99 Forge Mystery Box + reward pool');
}

async function starterBundle() {
  // Fixed id → race-proof, same as the mystery box.
  const existing = await get('SELECT id FROM bundles LIMIT 1');
  if (existing) return;
  // Cheapest active pack from two shooter categories → a believable duo deal.
  const pick = (cat) => get(
    `SELECT id, name FROM products WHERE category = @c AND active = 1 ORDER BY price ASC LIMIT 1`, { c: cat });
  const [apex, valorant] = await Promise.all([pick('apex'), pick('valorant')]);
  if (!apex || !valorant) return; // catalog doesn't have both — skip quietly
  const inserted = await run(
    `INSERT INTO bundles (id, name, description, product_ids, discount_percent, active, created_at)
     VALUES ('bnd_starter_fps_duo', @name, @desc, @pids, 10, 1, @at)
     ON CONFLICT (id) DO NOTHING`,
    { name: 'FPS Duo Pack — Apex + Valorant',
      desc: 'Top up both your shooters in one go and save 10%.',
      pids: JSON.stringify([apex.id, valorant.id]), at: nowIso() });
  if (inserted.changes) console.log('[starter] created the FPS Duo starter bundle (10% off)');
}
