/**
 * One-time starter content, so the store is fully stocked with the engagement
 * features the moment it deploys — zero admin work needed:
 *
 *  - ONE mystery box (€49.99) whose reward pool pays out clearly less than
 *    the box costs, counted the way a buyer can best play it — see
 *    STARTER_POOL.
 *  - ONE starter bundle (two shooter top-ups at 10% off) as a live example.
 *
 * Strictly idempotent and respectful of the admin: each piece is only created
 * if NOTHING of its kind exists yet, so it never overwrites real config. The
 * one correction (healStarterPool) touches only a pool still exactly as this
 * file once seeded it. Best-effort: a failure here never blocks boot.
 */
import { get, all, run, nowIso, tx } from './index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setRewards, poolVerdict } from '../services/mysteryBoxService.js';
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

/*
 * The starter reward pool, and the one it replaced.
 *
 * The old pool's comment said "≈ €38.75 per €49.99 box" — the first roll
 * alone. But every box also has a free reroll that keeps the higher prize, and
 * an order of 14+ boxes rolls at double luck. Counted that way it paid out
 * €50.32 for a single box and €53.10 at the cap: more than the box costs, so
 * store credit spent on boxes came back with interest and bought real codes.
 *
 * This one pays €29.50 on the first roll, €37.20 with the reroll and €39.54 at
 * the cap — 79% of the price at worst. Every box still wins at least €20 and
 * the jackpot is still €150, so the box's description stays true.
 */
const STARTER_POOL = [
  { label: '€20 store credit', weight: 65, credit: 2000 },
  { label: '€30 store credit', weight: 20, credit: 3000 },
  { label: '€50 store credit', weight: 9, credit: 5000 },
  { label: '€75 store credit', weight: 4, credit: 7500 },
  { label: '€150 JACKPOT 💎', weight: 2, credit: 15000 },
];
const OLD_STARTER_POOL = [
  { label: '€20 store credit', weight: 40, credit: 2000 },
  { label: '€35 store credit', weight: 30, credit: 3500 },
  { label: '€50 store credit', weight: 18, credit: 5000 },
  { label: '€75 store credit', weight: 9, credit: 7500 },
  { label: '€150 JACKPOT 💎', weight: 3, credit: 15000 },
];

export async function seedStarterContent() {
  await dedupeMysteryBoxes().catch((e) => console.error('[starter] dedupe:', e.message));
  await dedupeBundles().catch((e) => console.error('[starter] bundle dedupe:', e.message));
  await mysteryBox().catch((e) => console.error('[starter] mystery box:', e.message));
  await healStarterPool().catch((e) => console.error('[starter] mystery pool:', e.message));
  await starterBundle().catch((e) => console.error('[starter] bundle:', e.message));
}

/**
 * Replace the old starter pool where a shop still has it exactly as seeded.
 *
 * Every label, weight and prize has to match, and the pool has to pay out as
 * much as the box costs at today's price — a pool the owner has touched is
 * theirs, and is left for the launch check to name. Not only the fixed-id box:
 * before it existed the seeder gave boxes random ids, and the dedupe keeps the
 * oldest, so the surviving box may be one of those.
 */
async function healStarterPool() {
  const key = (pool) => JSON.stringify(pool
    .map((r) => [String(r.label), Number(r.weight), Number(r.credit)])
    .sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0].localeCompare(b[0])));
  const old = key(OLD_STARTER_POOL);
  const boxes = await all(`SELECT id, name, price FROM products WHERE kind = 'mystery'`);
  for (const box of boxes) {
    const pool = () => all(
      `SELECT label, weight, credit_cents AS credit FROM mystery_box_rewards WHERE box_id=@b`, { b: box.id });
    if (key(await pool()) !== old) continue;
    // Locked and read again: two cold starts must not both rewrite the same pool.
    // A box priced below even the new pool is refused by setRewards; it keeps
    // its pool, the launch check names it, and the next box is still looked at.
    const healed = await tx(async () => {
      await get('SELECT id FROM products WHERE id=@b FOR UPDATE', { b: box.id });
      const now = await pool();
      if (key(now) !== old || poolVerdict(now, box.price).safe) return false;
      await setRewards(box.id, STARTER_POOL);
      return true;
    }).catch((e) => { console.error(`[starter] ${box.name}: reward pool not replaced:`, e.message); return false; });
    if (healed) console.log(`[starter] ${box.name}: replaced the original reward pool, which paid out more than the box costs`);
  }
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
  await setRewards(BOX_ID, STARTER_POOL);
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
