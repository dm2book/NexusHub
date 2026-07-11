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
import { get, all } from './index.js';
import { createProduct } from '../services/productService.js';
import { setRewards } from '../services/mysteryBoxService.js';
import { createBundle } from '../services/bundleService.js';

export async function seedStarterContent() {
  await mysteryBox().catch((e) => console.error('[starter] mystery box:', e.message));
  await starterBundle().catch((e) => console.error('[starter] bundle:', e.message));
}

async function mysteryBox() {
  const existing = await get(`SELECT id FROM products WHERE kind = 'mystery' LIMIT 1`);
  if (existing) return;
  const box = await createProduct({
    name: 'Forge Mystery Box',
    category: 'mystery',
    kind: 'mystery',
    price: 4999,
    description:
      'Every box wins a real prize, paid out instantly as store credit — up to a €150 jackpot. ' +
      'Buy more boxes in one order for better odds, and every box comes with one free risk-free reroll.',
    announce: false,
    metadata: { featured: true },
  });
  // Expected payout ≈ €38.75 per €49.99 box (≈22% margin, credit-based).
  await setRewards(box.id, [
    { label: '€20 store credit', weight: 40, credit: 2000 },
    { label: '€35 store credit', weight: 30, credit: 3500 },
    { label: '€50 store credit', weight: 18, credit: 5000 },
    { label: '€75 store credit', weight: 9, credit: 7500 },
    { label: '€150 JACKPOT 💎', weight: 3, credit: 15000 },
  ]);
  console.log('[starter] created the €49.99 Forge Mystery Box + reward pool');
}

async function starterBundle() {
  const existing = await get('SELECT id FROM bundles LIMIT 1');
  if (existing) return;
  // Cheapest active pack from two shooter categories → a believable duo deal.
  const pick = (cat) => get(
    `SELECT id, name FROM products WHERE category = @c AND active = 1 ORDER BY price ASC LIMIT 1`, { c: cat });
  const [apex, valorant] = await Promise.all([pick('apex'), pick('valorant')]);
  if (!apex || !valorant) return; // catalog doesn't have both — skip quietly
  await createBundle({
    name: 'FPS Duo Pack — Apex + Valorant',
    description: 'Top up both your shooters in one go and save 10%.',
    productIds: [apex.id, valorant.id],
    discountPercent: 10,
    announce: false,
  });
  console.log('[starter] created the FPS Duo starter bundle (10% off)');
}
