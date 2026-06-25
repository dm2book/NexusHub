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

  // ── More games (no per-pack art yet → storefront shows a category tile) ───
  { sku: 'LOL-1380', name: '1,380 RP — League of Legends', category: 'league', price: 999, description: 'Riot Points for champions, skins and the Battle Pass.' },
  { sku: 'LOL-3500', name: '3,500 RP — League of Legends', category: 'league', price: 2499, featured: true, description: 'Best-value RP bundle, instant delivery.' },
  { sku: 'LOL-8000', name: '8,000 RP — League of Legends', category: 'league', price: 4999, description: 'Large Riot Points top-up.' },
  { sku: 'FF-530', name: '530 Diamonds — Free Fire', category: 'freefire', price: 599, description: 'Free Fire Diamonds for skins, characters and the Pass.' },
  { sku: 'FF-1080', name: '1,080 Diamonds — Free Fire', category: 'freefire', price: 1099, featured: true, description: 'Popular Free Fire diamond bundle.' },
  { sku: 'FF-2200', name: '2,200 Diamonds — Free Fire', category: 'freefire', price: 2199, description: 'Big Free Fire diamond stack.' },
  { sku: 'PUBG-660', name: '660 UC — PUBG Mobile', category: 'pubg', price: 999, description: 'Unknown Cash for crates, skins and the Royale Pass.' },
  { sku: 'PUBG-1800', name: '1,800 UC — PUBG Mobile', category: 'pubg', price: 2599, featured: true, description: 'Great-value PUBG Mobile UC bundle.' },
  { sku: 'PUBG-3850', name: '3,850 UC — PUBG Mobile', category: 'pubg', price: 4999, description: 'Large PUBG Mobile UC top-up.' },
  { sku: 'MLBB-275', name: '275 Diamonds — Mobile Legends', category: 'mlbb', price: 699, description: 'MLBB Diamonds for heroes, skins and the Pass.' },
  { sku: 'MLBB-565', name: '565 Diamonds — Mobile Legends', category: 'mlbb', price: 1399, featured: true, description: 'Popular Mobile Legends diamond bundle.' },
  { sku: 'MLBB-1155', name: '1,155 Diamonds — Mobile Legends', category: 'mlbb', price: 2799, description: 'Big Mobile Legends diamond stack.' },
  { sku: 'EAFC-1600', name: '1,600 FC Points — EA FC', category: 'eafc', price: 1499, description: 'FC Points for Ultimate Team packs and drafts.' },
  { sku: 'EAFC-4600', name: '4,600 FC Points — EA FC', category: 'eafc', price: 3999, featured: true, description: 'Best-value FC Points bundle.' },
  { sku: 'EAFC-12000', name: '12,000 FC Points — EA FC', category: 'eafc', price: 9999, description: 'Maximum FC Points stack.' },
  { sku: 'GTA-GREAT', name: 'Great White Shark Card — GTA', category: 'gta', price: 1599, description: '$1,250,000 in-game cash for GTA Online.' },
  { sku: 'GTA-WHALE', name: 'Whale Shark Card — GTA', category: 'gta', price: 3499, featured: true, description: '$3,500,000 in-game cash for GTA Online.' },
  { sku: 'GTA-MEGALODON', name: 'Megalodon Shark Card — GTA', category: 'gta', price: 6999, description: '$8,000,000 in-game cash for GTA Online.' },
  { sku: 'MC-1720', name: '1,720 Minecoins — Minecraft', category: 'minecraft', price: 999, description: 'Minecoins for skins, worlds and texture packs.' },
  { sku: 'MC-3500', name: '3,500 Minecoins — Minecraft', category: 'minecraft', price: 1899, featured: true, description: 'Popular Minecoins bundle.' },
  { sku: 'CR-500', name: '500 Gems — Clash Royale', category: 'clashroyale', price: 499, description: 'Clash Royale gems for chests and the Pass Royale.' },
  { sku: 'CR-1200', name: '1,200 Gems — Clash Royale', category: 'clashroyale', price: 999, featured: true, description: 'Popular Clash Royale gem bundle.' },
  { sku: 'CR-2500', name: '2,500 Gems — Clash Royale', category: 'clashroyale', price: 1999, description: 'Big Clash Royale gem stack.' },
  { sku: 'PGO-550', name: '550 PokéCoins — Pokémon GO', category: 'pokemongo', price: 599, description: 'PokéCoins for items, storage and raids.' },
  { sku: 'PGO-1200', name: '1,200 PokéCoins — Pokémon GO', category: 'pokemongo', price: 1199, featured: true, description: 'Popular PokéCoins bundle.' },

  // ── Subscriptions ────────────────────────────────────────────────────────
  { sku: 'SPOTIFY-3M', name: 'Spotify Premium — 3 Months', category: 'spotify', price: 2999, description: 'Ad-free music, offline listening and better quality.' },
  { sku: 'NETFLIX-25', name: 'Netflix Gift Card €25', category: 'netflix', price: 2599, featured: true, description: 'Redeemable towards any Netflix plan.' },
  { sku: 'GAMEPASS-3M', name: 'Xbox Game Pass Ultimate — 3 Months', category: 'gamepass', price: 3899, featured: true, description: '100+ games, EA Play and online multiplayer.' },

  // ── More gift cards ──────────────────────────────────────────────────────
  { sku: 'NINTENDO-25', name: 'Nintendo eShop €25', category: 'nintendo', price: 2699, description: 'Switch games, DLC and Nintendo Switch Online.' },
  { sku: 'AMAZON-25', name: 'Amazon Gift Card €25', category: 'amazon', price: 2599, description: 'Spend on millions of products on Amazon.' },
  { sku: 'GPLAY-25', name: 'Google Play €25', category: 'googleplay', price: 2599, description: 'Apps, games and in-app purchases on Android.' },
  { sku: 'ITUNES-25', name: 'App Store & iTunes €25', category: 'itunes', price: 2599, description: 'Apps, games, music and iCloud storage on Apple.' },
];

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// Premium 3D icon tiles per category (public/products/icons) — one unique icon each.
const CATS_WITH_ICON = ['robux', 'v-bucks', 'valorant', 'cod', 'genshin', 'brawl', 'apex',
  'clash', 'clashroyale', 'league', 'freefire', 'pubg', 'mlbb', 'eafc', 'gta', 'minecraft',
  'pokemongo', 'discord-nitro', 'spotify', 'netflix', 'gamepass', 'steam', 'playstation',
  'xbox', 'nintendo', 'amazon', 'googleplay', 'itunes', 'giftcard', 'chest'];
const iconFor = (cat) => CATS_WITH_ICON.includes(cat) ? `/products/icons/${cat}.png` : null;

export async function seedDemoCatalog() {
  await migrate();
  let created = 0;
  let updated = 0;
  for (const p of CATALOG) {
    const img = iconFor(p.category) || p.image || null;
    const existing = await get('SELECT id, metadata FROM products WHERE sku = @sku', { sku: p.sku });
    const at = nowIso();

    if (existing) {
      // Keep the premium 3D icon in sync (also backfills missing covers).
      const meta = parse(existing.metadata);
      if (img && meta.image !== img) {
        meta.image = img;
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
      price: p.price, meta: JSON.stringify({ featured: !!p.featured, image: img }), at,
    });
    created++;
  }
  console.log(`Demo catalog: ${created} created, ${updated} image-backfilled ` +
    `(${CATALOG.length - created - updated} unchanged).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemoCatalog().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
