/**
 * One-time starter content, so a new shop opens with deals worth showing next
 * to the catalogue — zero admin work needed: a small curated set of bundles
 * (STARTER_BUNDLES), game-currency packs that belong together at 10% off.
 *
 * The mystery box this file used to create is retired (migration 065): paid
 * random prizes are very likely a game of chance under the Dutch Wet op de
 * kansspelen. Bundles took its place in the shop.
 *
 * Respectful of the admin: the set is seeded once per version of the list (a
 * flag in kv), each bundle under a fixed id with ON CONFLICT DO NOTHING — so a
 * bundle the owner edited keeps the edit, and one they deleted stays deleted.
 * Best-effort: a failure here never blocks boot.
 */
import { get, all, run, nowIso } from './index.js';

/* Bump the version when the list below gains a bundle that existing shops
   should get too. Bundles already made are never touched again either way. */
const STARTER_BUNDLES_FLAG = 'starter_bundles:v2';

/*
 * The starter set. Each one is a price promise, so:
 *  - Game currency only. Never a face-value card (Steam, PSN, Xbox, Nintendo,
 *    Netflix, Spotify, Amazon, Google Play, iTunes…) or a subscription: 10%
 *    off a €25 card sells it below the €25 it is worth everywhere else.
 *  - Packs that belong together: one publisher (Riot, Supercell), or what the
 *    same player buys (two shooters).
 *  - The cheapest active pack of each game that works on an EU account, so
 *    the set stays the entry price.
 *  - 10% off, worked out by the server on complete sets only (pricedBundles,
 *    bestBundleDiscount) — nothing here states a price.
 *  - Made only when every member exists and is on sale.
 * Names are short, and translated where the words are not the same in every
 * language (the `copy` the storefront picks a language from). Descriptions
 * are left to src/lib/bundleCopy.js, which writes them per language from the
 * members and the discount, so they stay true whatever the owner changes.
 */
const STARTER_BUNDLES = [
  /* The first starter bundle, exactly as earlier releases made it: existing
     shops already have this row, and a new one gets the same. Earlier releases
     made it only in a shop with no bundle at all, so a shop that has bundles
     but not this one deleted it — `firstSeed` keeps it deleted. */
  { id: 'bnd_starter_fps_duo', name: 'FPS Duo Pack — Apex + Valorant',
    description: 'Top up both your shooters in one go and save 10%.',
    categories: ['apex', 'valorant'], firstSeed: true },
  { id: 'bnd_starter_riot', name: 'Riot Pack — Valorant + League',
    copy: { nameNl: 'Riot-pakket — Valorant + League', nameDe: 'Riot-Paket — Valorant + League',
      nameFr: 'Pack Riot — Valorant + League' },
    categories: ['valorant', 'league'] },
  { id: 'bnd_starter_supercell', name: 'Supercell Pack — Clash of Clans, Clash Royale & Brawl Stars',
    copy: { nameNl: 'Supercell-pakket — Clash of Clans, Clash Royale & Brawl Stars',
      nameDe: 'Supercell-Paket — Clash of Clans, Clash Royale & Brawl Stars',
      nameFr: 'Pack Supercell — Clash of Clans, Clash Royale et Brawl Stars' },
    categories: ['clash', 'clashroyale', 'brawl'] },
];
const STARTER_DISCOUNT = 10;

/* Shelves that hold cards and subscriptions, never game currency. */
const CARD_CATEGORIES = new Set(['giftcard', 'steam', 'playstation', 'psn', 'psplus', 'xbox', 'gamepass',
  'nintendo', 'netflix', 'spotify', 'amazon', 'googleplay', 'itunes', 'paysafecard', 'discord-nitro']);

/**
 * Is this product game currency — the only thing a starter bundle discounts?
 * Read from what the product says about itself, because an owner can file a
 * card on any shelf: discovery records the unit (EUR for a card, months for a
 * subscription) and the type, and a card made by hand names its euros.
 */
export function isGameCurrency(row) {
  if (!row || CARD_CATEGORIES.has(String(row.category || '').toLowerCase())) return false;
  let meta = row.metadata;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta || '{}'); } catch { meta = {}; } }
  meta = meta || {};
  if (['EUR', 'months'].includes(meta.denomUnit)) return false;
  if (meta.productType && meta.productType !== 'points') return false;
  return !/€\s?\d|\d\s?€|\d\s?(?:eur|euros?)\b|gift\s*card|wallet/i.test(String(row.name || ''));
}

/* A pack locked to another region (TR, BR, US…) cannot be topped up onto the
   EU accounts this shop's buyers have; no region, or 'unknown', means the
   product does not say, which is how the catalogue's own packs are filed. */
const USABLE_REGIONS = new Set(['eu', 'nl', 'global', 'any', 'unknown']);
const usableHere = (row) => {
  let meta = row.metadata;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta || '{}'); } catch { meta = {}; } }
  return !meta?.region || USABLE_REGIONS.has(String(meta.region).toLowerCase());
};

/** The cheapest pack on sale in a category that is game currency, or null. */
async function entryPack(category) {
  const rows = await all(
    `SELECT id, name, category, price, metadata FROM products
      WHERE category = @c AND active = 1 AND price > 0 AND kind = 'digital'
      ORDER BY price ASC, created_at ASC, id ASC`, { c: category });
  return rows.find((r) => isGameCurrency(r) && usableHere(r)) || null;
}

export async function seedStarterContent() {
  await dedupeBundles().catch((e) => console.error('[starter] bundle dedupe:', e.message));
  await starterBundles().catch((e) => console.error('[starter] bundles:', e.message));
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

/**
 * Make the starter set, once per version of it.
 *
 * The flag is written after the attempt whether or not every bundle could be
 * made: one whose game is missing from the catalogue is skipped, not retried
 * on every deploy — otherwise a bundle the owner deleted would come back the
 * next time the catalogue happened to have that game. Fixed ids make two cold
 * starts running this at once harmless.
 */
async function starterBundles() {
  if (await get('SELECT key FROM kv WHERE key = @k', { k: STARTER_BUNDLES_FLAG })) return;
  const hadBundles = !!(await get('SELECT id FROM bundles LIMIT 1'));
  const made = [];
  for (const def of STARTER_BUNDLES) {
    if (def.firstSeed && hadBundles) continue;
    // An owner's bundle (or an old copy) by the same name: one is enough.
    if (await get('SELECT id FROM bundles WHERE name = @n', { n: def.name })) continue;
    const packs = await Promise.all(def.categories.map(entryPack));
    if (packs.some((p) => !p)) {
      console.log(`[starter] ${def.name}: skipped — not every game has a currency pack on sale`);
      continue;
    }
    const inserted = await run(
      `INSERT INTO bundles (id, name, description, copy, product_ids, discount_percent, active, created_at)
       VALUES (@id, @name, @desc, @copy, @pids, @pct, 1, @at)
       ON CONFLICT (id) DO NOTHING`,
      { id: def.id, name: def.name, desc: def.description || null,
        copy: def.copy ? JSON.stringify(def.copy) : null,
        pids: JSON.stringify(packs.map((p) => p.id)), pct: STARTER_DISCOUNT, at: nowIso() });
    if (inserted.changes) made.push(def.id);
  }
  await run(
    `INSERT INTO kv (key, value, updated_at) VALUES (@k, @v, @at) ON CONFLICT (key) DO NOTHING`,
    { k: STARTER_BUNDLES_FLAG, v: JSON.stringify(made), at: nowIso() });
  if (made.length) console.log(`[starter] created starter bundles: ${made.join(', ')} (${STARTER_DISCOUNT}% off)`);
}

/* Exported for the tests: the list and its flag are the contract. */
export { STARTER_BUNDLES, STARTER_BUNDLES_FLAG };
