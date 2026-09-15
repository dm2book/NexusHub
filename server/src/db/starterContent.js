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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setRewards } from '../services/mysteryBoxService.js';
import { createBundle } from '../services/bundleService.js';

// Fixed primary key → concurrent cold starts can never create duplicates
// (plain "check then create" raced when Vercel booted several instances at
// once, which is exactly how two identical €49.99 boxes appeared).
const BOX_ID = 'prd_starter_mystery_box';

const boxArt = () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
    'public', 'products', 'art', `${BOX_ID.replace(/_/g, '-')}.svg`);
  try { return fs.existsSync(file) ? `/products/art/${BOX_ID.replace(/_/g, '-')}.svg`
    : '/products/icons/mystery.svg'; } catch { return '/products/icons/mystery.svg'; }
};

export async function seedStarterContent() {
  await dedupeMysteryBoxes().catch((e) => console.error('[starter] dedupe:', e.message));
  await dedupeBundles().catch((e) => console.error('[starter] bundle dedupe:', e.message));
  await mysteryBox().catch((e) => console.error('[starter] mystery box:', e.message));
  await starterBundle().catch((e) => console.error('[starter] bundle:', e.message));
}

/**
 * Heal the earlier bundle race: the old seeder created a random-id bundle per
 * concurrent cold start, leaving N identical 'FPS Duo Pack' rows. Keep the
 * oldest copy of any same-named bundle, delete the rest (bundles have no
 * dependent rows, so plain DELETE is safe).
 */
async function dedupeBundles() {
  const dupes = await all(
    `SELECT id FROM bundles b
      WHERE EXISTS (
        SELECT 1 FROM bundles b2
         WHERE b2.name = b.name
           AND (b2.created_at, b2.id) < (b.created_at, b.id))`);
  for (const d of dupes) {
    await run('DELETE FROM bundles WHERE id=@id', { id: d.id });
    console.log(`[starter] removed duplicate bundle ${d.id}`);
  }
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

/**
 * The mystery box's own words, in all four languages.
 *
 * Every other product in the shop describes itself from a per-category recipe
 * (src/lib/productCopy.js). This one cannot: its description is the terms of
 * the product — that every box pays out, what the ceiling is, that more boxes
 * in one order improve the odds, and that a free reroll is included. A
 * generated line loses all four, and a buyer who reads the shop in German
 * should not be agreeing to terms they were shown in English.
 */
const BOX_COPY = {
  description:
    'Every box wins a real prize, paid out instantly as store credit — up to a €150 jackpot. ' +
    'Buy more boxes in one order for better odds, and every box comes with one free risk-free reroll.',
  translations: {
    descriptionNl:
      'Elke box wint een echte prijs, direct uitbetaald als winkeltegoed — tot een jackpot van €150. ' +
      'Meer boxen in één bestelling geeft betere kansen, en bij elke box zit één gratis reroll zonder risico.',
    descriptionDe:
      'Jede Box gewinnt einen echten Preis, sofort ausgezahlt als Shop-Guthaben — bis zu einem Jackpot von 150 €. ' +
      'Mehr Boxen in einer Bestellung verbessern die Chancen, und zu jeder Box gehört ein kostenloser Reroll ohne Risiko.',
    descriptionFr:
      'Chaque boîte gagne un vrai lot, versé immédiatement en crédit boutique — jusqu’à un jackpot de 150 €. ' +
      'Plus de boîtes dans une même commande améliorent les chances, et chaque boîte inclut un relancement gratuit et sans risque.',
  },
};

/**
 * Give a box that already exists the words it was created without.
 *
 * The seeder only runs for a shop that has no box, so a shop created before
 * the translations existed would keep the English terms in every language
 * forever. It fills gaps only: anything typed in the admin is left alone,
 * because the owner's wording outranks this file's.
 */
async function backfillBoxCopy(row) {
  let meta;
  try { meta = JSON.parse(row.metadata || '{}'); } catch { return; }
  const missing = Object.entries(BOX_COPY.translations)
    .filter(([field]) => !String(meta[field] || '').trim());
  if (!missing.length) return;
  for (const [field, text] of missing) meta[field] = text;
  await run('UPDATE products SET metadata = @m, updated_at = @at WHERE id = @id',
    { m: JSON.stringify(meta), at: nowIso(), id: row.id });
  console.log(`[starter] mystery box: added ${missing.map(([f]) => f).join(', ')}`);
}

async function mysteryBox() {
  const existing = await get(`SELECT id, metadata FROM products WHERE kind = 'mystery' AND active = 1 LIMIT 1`);
  if (existing) return backfillBoxCopy(existing);
  const at = nowIso();
  const inserted = await run(
    `INSERT INTO products (id, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
     VALUES (@id, @name, 'mystery', @desc, 4999, 'EUR', 'mystery', 1, @meta, @at, @at)
     ON CONFLICT (id) DO NOTHING`,
    {
      id: BOX_ID,
      name: 'Forge Mystery Box',
      desc: BOX_COPY.description,
      // The one seeded product that shipped without a cover, so it rendered the
      // generic gradient placeholder while all 71 others had real art — on the
      // highest-margin item in the shop. mystery.svg has been sitting in
      // public/products/icons the whole time.
      /* The generated artboard when it exists, the plain icon otherwise. Same
         rule as demoSeed's imageFor — without it this one product was the only
         thing in a 72-product grid still on the old art. */
      /* The three other languages carried as typed copy, because this is the
         one product whose description is not decoration: it states the odds,
         the payout and the free reroll. The generated per-category sentence
         says only "every box pays out real store credit", which is true and
         drops every term that matters — and a Dutch reader was already getting
         that shorter line on the shop's highest-margin item. */
      meta: JSON.stringify({ featured: true, image: boxArt(), ...BOX_COPY.translations }),
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
