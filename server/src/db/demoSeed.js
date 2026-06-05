/**
 * OPTIONAL demo catalog seeder — run explicitly with `npm run seed:demo` (or set
 * SEED_DEMO=true to run it on first boot).
 *
 * Prices: Robux & V-Bucks are based on real Eldorado.gg "from" prices (cheapest
 * seller, converted USD→EUR ≈ 0.92) plus a +€2 margin, rounded to .99. Eldorado
 * prices fluctuate per seller, so treat these as a starting point and adjust in
 * Admin → Products. Gift cards / Nitro aren't sold on Eldorado, so those are
 * priced at face value + a small margin.
 *
 * Each pack has its own cover image (amount printed on it) under /public/products.
 */
import { run, get, nowIso } from './index.js';
import { migrate } from './migrate.js';
import { newId } from '../utils/ids.js';

// price in minor units (cents). image = static asset shipped in /public.
const CATALOG = [
  // ── Robux (Eldorado top-up + €2) ─────────────────────────────────────────
  { sku: 'ROBUX-1000', name: '1,000 Robux', category: 'robux', price: 999, featured: true,
    image: '/products/packs/robux-1000.svg', description: 'Instant Robux top-up to your Roblox account.' },
  { sku: 'ROBUX-2000', name: '2,000 Robux', category: 'robux', price: 1799,
    image: '/products/packs/robux-2000.svg', description: '2,000 Robux delivered fast and securely.' },
  { sku: 'ROBUX-4500', name: '4,500 Robux', category: 'robux', price: 3599, featured: true,
    image: '/products/packs/robux-4500.svg', description: 'Popular value pack for serious builders.' },
  { sku: 'ROBUX-10000', name: '10,000 Robux', category: 'robux', price: 7399,
    image: '/products/packs/robux-10000.svg', description: 'Big Robux bundle — best price per Robux.' },
  { sku: 'ROBUX-22500', name: '22,500 Robux', category: 'robux', price: 15699,
    image: '/products/packs/robux-22500.svg', description: 'Maximum Robux top-up for power users.' },

  // ── Fortnite V-Bucks (Eldorado + €2) ─────────────────────────────────────
  { sku: 'VBUCKS-1000', name: '1,000 V-Bucks', category: 'v-bucks', price: 699,
    image: '/products/packs/vbucks-1000.svg', description: 'Fortnite V-Bucks for skins and the Battle Pass.' },
  { sku: 'VBUCKS-2800', name: '2,800 V-Bucks', category: 'v-bucks', price: 1399, featured: true,
    image: '/products/packs/vbucks-2800.svg', description: 'Great-value V-Bucks bundle, instant delivery.' },
  { sku: 'VBUCKS-5000', name: '5,000 V-Bucks', category: 'v-bucks', price: 2399,
    image: '/products/packs/vbucks-5000.svg', description: '5,000 V-Bucks delivered to your account.' },
  { sku: 'VBUCKS-13500', name: '13,500 V-Bucks', category: 'v-bucks', price: 3699, featured: true,
    image: '/products/packs/vbucks-13500.svg', description: 'The biggest V-Bucks stack at the best rate.' },

  // ── Call of Duty Points (estimate; verify) ───────────────────────────────
  { sku: 'COD-2400', name: '2,400 CP — Call of Duty', category: 'cod', price: 2399,
    image: '/products/packs/cod-2400.svg', description: 'Call of Duty Points for skins, bundles and Battle Pass.' },
  { sku: 'COD-5000', name: '5,000 CP — Call of Duty', category: 'cod', price: 4499, featured: true,
    image: '/products/packs/cod-5000.svg', description: 'Best-value CoD Points bundle, instant delivery.' },
  { sku: 'COD-9500', name: '9,500 CP — Call of Duty', category: 'cod', price: 7999,
    image: '/products/packs/cod-9500.svg', description: 'Large CoD Points top-up.' },
  { sku: 'COD-21000', name: '21,000 CP — Call of Duty', category: 'cod', price: 15999,
    image: '/products/packs/cod-21000.svg', description: 'Maximum CoD Points stack.' },

  // ── Brawl Stars Gems (estimate; verify) ──────────────────────────────────
  { sku: 'BRAWL-360', name: '360 Gems — Brawl Stars', category: 'brawl', price: 699,
    image: '/products/packs/brawl-360.svg', description: 'Brawl Stars gems for brawlers, skins and the Pass.' },
  { sku: 'BRAWL-950', name: '950 Gems — Brawl Stars', category: 'brawl', price: 1799, featured: true,
    image: '/products/packs/brawl-950.svg', description: 'Popular Brawl Stars gem bundle.' },
  { sku: 'BRAWL-2000', name: '2,000 Gems — Brawl Stars', category: 'brawl', price: 3499,
    image: '/products/packs/brawl-2000.svg', description: 'Big Brawl Stars gem stack.' },

  // ── Apex Coins (estimate; verify) ────────────────────────────────────────
  { sku: 'APEX-1000', name: '1,000 Apex Coins', category: 'apex', price: 999,
    image: '/products/packs/apex-1000.svg', description: 'Apex Coins for skins, the Battle Pass and packs.' },
  { sku: 'APEX-2150', name: '2,150 Apex Coins', category: 'apex', price: 1899,
    image: '/products/packs/apex-2150.svg', description: 'Apex Coins bundle, instant delivery.' },
  { sku: 'APEX-4350', name: '4,350 Apex Coins', category: 'apex', price: 3699, featured: true,
    image: '/products/packs/apex-4350.svg', description: 'Great-value Apex Coins pack.' },
  { sku: 'APEX-11500', name: '11,500 Apex Coins', category: 'apex', price: 8999,
    image: '/products/packs/apex-11500.svg', description: 'Maximum Apex Coins top-up.' },

  // ── Valorant Points (estimate; verify) ───────────────────────────────────
  { sku: 'VAL-1000', name: '1,000 VP — Valorant', category: 'valorant', price: 999,
    image: '/products/packs/valorant-1000.svg', description: 'Valorant Points for skins and the Battle Pass.' },
  { sku: 'VAL-2050', name: '2,050 VP — Valorant', category: 'valorant', price: 1799,
    image: '/products/packs/valorant-2050.svg', description: 'Valorant Points bundle.' },
  { sku: 'VAL-3650', name: '3,650 VP — Valorant', category: 'valorant', price: 3199, featured: true,
    image: '/products/packs/valorant-3650.svg', description: 'Popular Valorant Points pack.' },
  { sku: 'VAL-5350', name: '5,350 VP — Valorant', category: 'valorant', price: 4499,
    image: '/products/packs/valorant-5350.svg', description: 'Large Valorant Points top-up.' },

  // ── Genshin Genesis Crystals (estimate; verify) ──────────────────────────
  { sku: 'GEN-980', name: '980 Genesis Crystals — Genshin', category: 'genshin', price: 1599,
    image: '/products/packs/genshin-980.svg', description: 'Genesis Crystals for wishes and the Battle Pass.' },
  { sku: 'GEN-1980', name: '1,980 Genesis Crystals — Genshin', category: 'genshin', price: 2999, featured: true,
    image: '/products/packs/genshin-1980.svg', description: 'Popular Genshin crystals bundle.' },
  { sku: 'GEN-3280', name: '3,280 Genesis Crystals — Genshin', category: 'genshin', price: 4999,
    image: '/products/packs/genshin-3280.svg', description: 'Large Genesis Crystals pack.' },
  { sku: 'GEN-6480', name: '6,480 Genesis Crystals — Genshin', category: 'genshin', price: 9499,
    image: '/products/packs/genshin-6480.svg', description: 'Maximum Genesis Crystals top-up.' },

  // ── Clash of Clans Gems (estimate; verify) ───────────────────────────────
  { sku: 'COC-500', name: '500 Gems — Clash of Clans', category: 'clash', price: 499,
    image: '/products/packs/clash-500.svg', description: 'Clash of Clans gems to speed up your village.' },
  { sku: 'COC-1200', name: '1,200 Gems — Clash of Clans', category: 'clash', price: 999,
    image: '/products/packs/clash-1200.svg', description: 'Clash of Clans gem bundle.' },
  { sku: 'COC-2500', name: '2,500 Gems — Clash of Clans', category: 'clash', price: 1999, featured: true,
    image: '/products/packs/clash-2500.svg', description: 'Popular Clash of Clans gem pack.' },
  { sku: 'COC-6500', name: '6,500 Gems — Clash of Clans', category: 'clash', price: 4999,
    image: '/products/packs/clash-6500.svg', description: 'Big Clash of Clans gem stack.' },

  // ── Discord Nitro (market price; not on Eldorado) ────────────────────────
  { sku: 'NITRO-1M', name: 'Discord Nitro — 1 Month', category: 'discord-nitro', price: 999,
    image: '/products/nitro.svg', description: 'Full Nitro for a month: HD streaming, emojis, boosts.' },
  { sku: 'NITRO-1Y', name: 'Discord Nitro — 1 Year', category: 'discord-nitro', price: 9999, featured: true,
    image: '/products/nitro.svg', description: 'A full year of Discord Nitro.' },

  // ── Gift cards (face value + small margin; not on Eldorado) ──────────────
  { sku: 'STEAM-10', name: 'Steam Wallet €10', category: 'steam', price: 1199,
    image: '/products/steam.svg', description: 'Add €10 to your Steam Wallet via redeem code.' },
  { sku: 'STEAM-25', name: 'Steam Wallet €25', category: 'steam', price: 2699,
    image: '/products/steam.svg', description: 'Add €25 to your Steam Wallet via redeem code.' },
  { sku: 'STEAM-50', name: 'Steam Wallet €50', category: 'steam', price: 5199,
    image: '/products/steam.svg', description: 'Add €50 to your Steam Wallet via redeem code.' },
  { sku: 'PSN-25', name: 'PlayStation Store €25', category: 'playstation', price: 2699,
    image: '/products/playstation.svg', description: 'PSN gift card for games, DLC and PS Plus.' },
  { sku: 'XBOX-25', name: 'Xbox Gift Card €25', category: 'xbox', price: 2699,
    image: '/products/xbox.svg', description: 'Spend on games and add-ons across Xbox & PC.' },
];

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

export async function seedDemoCatalog() {
  await migrate();
  let created = 0;
  let updated = 0;
  for (const p of CATALOG) {
    const existing = await get('SELECT id, metadata FROM products WHERE sku = @sku', { sku: p.sku });
    const at = nowIso();

    if (existing) {
      // Backfill the cover image if the product doesn't have one yet.
      const meta = parse(existing.metadata);
      if (p.image && !meta.image) {
        meta.image = p.image;
        await run('UPDATE products SET metadata = @m, updated_at = @at WHERE id = @id',
          { m: JSON.stringify(meta), at, id: existing.id });
        updated++;
      }
      continue;
    }

    await run(`INSERT INTO products
        (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
       VALUES (@id, @sku, @name, @cat, @desc, @price, 'EUR', 'digital', 1, @meta, @at, @at)`, {
      id: newId('prd'), sku: p.sku, name: p.name, cat: p.category, desc: p.description,
      price: p.price, meta: JSON.stringify({ featured: !!p.featured, image: p.image }), at,
    });
    created++;
  }
  console.log(`Demo catalog: ${created} created, ${updated} image-backfilled ` +
    `(${CATALOG.length - created - updated} unchanged).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemoCatalog().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
