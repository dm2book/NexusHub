/**
 * OPTIONAL demo catalog seeder — run explicitly with `npm run seed:demo` (or set
 * SEED_DEMO=true to run it on first boot; with SEED_DEMO=true existing seeded
 * products also get their PRICE re-synced to these defaults — handy after a
 * repricing like this one. Products you renamed/repriced by hand keep your
 * price unless SEED_DEMO is set).
 *
 * PRICING (July 2026): anchored on real Eldorado.gg "from" prices (cheapest
 * offer, USD→EUR ≈ 0.92) plus a healthy margin, always below the official store
 * price so every listing is a genuine deal:
 *   · Robux top-up: ~$8.75/1k on Eldorado (2,000 from $17.50)
 *   · V-Bucks: 4,500 from $16.50 · 5,000 from $23.42 · 13,500 from $37.50
 *   · Valorant: 2,050 VP from $12.99 (~$6.34/1k)
 *   · Nitro: 1 month from $8.49 · 1 year ≈ $79 market
 * Categories without Eldorado listings are priced ~15-25% under the official
 * in-game store. Adjust anytime in Admin → Products.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, get, nowIso } from './index.js';
import { migrate } from './migrate.js';
import { newId } from '../utils/ids.js';

// price in minor units (cents). image = static asset shipped in /public.
/* Exported so the pricing-sanity suite can check the shipped prices without a
   database — the shape of a ladder is a property of this list, not of a row. */
export const CATALOG = [
  // ── Robux (Eldorado top-up + €2) ─────────────────────────────────────────
  { sku: 'ROBUX-1000', name: '1,000 Robux', category: 'robux', price: 999, featured: true,
    image: '/products/packs/robux-1000.svg', description: 'Instant Robux top-up to your Roblox account.' },
  { sku: 'ROBUX-2000', name: '2,000 Robux', category: 'robux', price: 1799,
    image: '/products/packs/robux-2000.svg', description: '2,000 Robux delivered fast and securely.' },
  { sku: 'ROBUX-4500', name: '4,500 Robux', category: 'robux', price: 3899, featured: true,
    image: '/products/packs/robux-4500.svg', description: 'Popular value pack for serious builders.' },
  { sku: 'ROBUX-10000', name: '10,000 Robux', category: 'robux', price: 7999,
    image: '/products/packs/robux-10000.svg', description: 'Big Robux bundle — best price per Robux.' },
  { sku: 'ROBUX-22500', name: '22,500 Robux', category: 'robux', price: 17499,
    image: '/products/packs/robux-22500.svg', description: 'Maximum Robux top-up for power users.' },

  // ── Fortnite V-Bucks (Eldorado + €2) ─────────────────────────────────────
  { sku: 'VBUCKS-1000', name: '1,000 V-Bucks', category: 'v-bucks', price: 599,
    image: '/products/packs/vbucks-1000.svg', description: 'Fortnite V-Bucks for skins and the Battle Pass.' },
  { sku: 'VBUCKS-2800', name: '2,800 V-Bucks', category: 'v-bucks', price: 1299, featured: true,
    image: '/products/packs/vbucks-2800.svg', description: 'Great-value V-Bucks bundle, instant delivery.' },
  { sku: 'VBUCKS-5000', name: '5,000 V-Bucks', category: 'v-bucks', price: 2299,
    image: '/products/packs/vbucks-5000.svg', description: '5,000 V-Bucks delivered to your account.' },
  { sku: 'VBUCKS-13500', name: '13,500 V-Bucks', category: 'v-bucks', price: 3999, featured: true,
    image: '/products/packs/vbucks-13500.svg', description: 'The biggest V-Bucks stack at the best rate.' },

  // ── Call of Duty Points (estimate; verify) ───────────────────────────────
  { sku: 'COD-2400', name: '2,400 CP — Call of Duty', category: 'cod', price: 1599,
    image: '/products/packs/cod-2400.svg', description: 'Call of Duty Points for skins, bundles and Battle Pass.' },
  { sku: 'COD-5000', name: '5,000 CP — Call of Duty', category: 'cod', price: 2999, featured: true,
    image: '/products/packs/cod-5000.svg', description: 'Best-value CoD Points bundle, instant delivery.' },
  { sku: 'COD-9500', name: '9,500 CP — Call of Duty', category: 'cod', price: 5499,
    image: '/products/packs/cod-9500.svg', description: 'Large CoD Points top-up.' },
  { sku: 'COD-21000', name: '21,000 CP — Call of Duty', category: 'cod', price: 11499,
    image: '/products/packs/cod-21000.svg', description: 'Maximum CoD Points stack.' },

  // ── Brawl Stars Gems (estimate; verify) ──────────────────────────────────
  { sku: 'BRAWL-360', name: '360 Gems — Brawl Stars', category: 'brawl', price: 1499,
    image: '/products/packs/brawl-360.svg', description: 'Brawl Stars gems for brawlers, skins and the Pass.' },
  { sku: 'BRAWL-950', name: '950 Gems — Brawl Stars', category: 'brawl', price: 3699, featured: true,
    image: '/products/packs/brawl-950.svg', description: 'Popular Brawl Stars gem bundle.' },
  { sku: 'BRAWL-2000', name: '2,000 Gems — Brawl Stars', category: 'brawl', price: 7499,
    image: '/products/packs/brawl-2000.svg', description: 'Big Brawl Stars gem stack.' },

  // ── Apex Coins (estimate; verify) ────────────────────────────────────────
  { sku: 'APEX-1000', name: '1,000 Apex Coins', category: 'apex', price: 799,
    image: '/products/packs/apex-1000.svg', description: 'Apex Coins for skins, the Battle Pass and packs.' },
  { sku: 'APEX-2150', name: '2,150 Apex Coins', category: 'apex', price: 1599,
    image: '/products/packs/apex-2150.svg', description: 'Apex Coins bundle, instant delivery.' },
  { sku: 'APEX-4350', name: '4,350 Apex Coins', category: 'apex', price: 3099, featured: true,
    image: '/products/packs/apex-4350.svg', description: 'Great-value Apex Coins pack.' },
  { sku: 'APEX-11500', name: '11,500 Apex Coins', category: 'apex', price: 7499,
    image: '/products/packs/apex-11500.svg', description: 'Maximum Apex Coins top-up.' },

  // ── Valorant Points (estimate; verify) ───────────────────────────────────
  { sku: 'VAL-1000', name: '1,000 VP — Valorant', category: 'valorant', price: 799,
    image: '/products/packs/valorant-1000.svg', description: 'Valorant Points for skins and the Battle Pass.' },
  { sku: 'VAL-2050', name: '2,050 VP — Valorant', category: 'valorant', price: 1449,
    image: '/products/packs/valorant-2050.svg', description: 'Valorant Points bundle.' },
  { sku: 'VAL-3650', name: '3,650 VP — Valorant', category: 'valorant', price: 2399, featured: true,
    image: '/products/packs/valorant-3650.svg', description: 'Popular Valorant Points pack.' },
  { sku: 'VAL-5350', name: '5,350 VP — Valorant', category: 'valorant', price: 3499,
    image: '/products/packs/valorant-5350.svg', description: 'Large Valorant Points top-up.' },

  // ── Genshin Genesis Crystals (estimate; verify) ──────────────────────────
  { sku: 'GEN-980', name: '980 Genesis Crystals — Genshin', category: 'genshin', price: 1199,
    image: '/products/packs/genshin-980.svg', description: 'Genesis Crystals for wishes and the Battle Pass.' },
  { sku: 'GEN-1980', name: '1,980 Genesis Crystals — Genshin', category: 'genshin', price: 2299, featured: true,
    image: '/products/packs/genshin-1980.svg', description: 'Popular Genshin crystals bundle.' },
  { sku: 'GEN-3280', name: '3,280 Genesis Crystals — Genshin', category: 'genshin', price: 3799,
    image: '/products/packs/genshin-3280.svg', description: 'Large Genesis Crystals pack.' },
  { sku: 'GEN-6480', name: '6,480 Genesis Crystals — Genshin', category: 'genshin', price: 7499,
    image: '/products/packs/genshin-6480.svg', description: 'Maximum Genesis Crystals top-up.' },

  // ── Clash of Clans Gems (estimate; verify) ───────────────────────────────
  { sku: 'COC-500', name: '500 Gems — Clash of Clans', category: 'clash', price: 449,
    image: '/products/packs/clash-500.svg', description: 'Clash of Clans gems to speed up your village.' },
  { sku: 'COC-1200', name: '1,200 Gems — Clash of Clans', category: 'clash', price: 849,
    image: '/products/packs/clash-1200.svg', description: 'Clash of Clans gem bundle.' },
  { sku: 'COC-2500', name: '2,500 Gems — Clash of Clans', category: 'clash', price: 1699, featured: true,
    image: '/products/packs/clash-2500.svg', description: 'Popular Clash of Clans gem pack.' },
  { sku: 'COC-6500', name: '6,500 Gems — Clash of Clans', category: 'clash', price: 3999,
    image: '/products/packs/clash-6500.svg', description: 'Big Clash of Clans gem stack.' },

  // ── Discord Nitro (market price; not on Eldorado) ────────────────────────
  { sku: 'NITRO-1M', name: 'Discord Nitro — 1 Month', category: 'discord-nitro', price: 899,
    image: '/products/packs/discord-nitro-1-month.svg', description: 'Full Nitro for a month: HD streaming, emojis, boosts.' },
  { sku: 'NITRO-1Y', name: 'Discord Nitro — 1 Year', category: 'discord-nitro', price: 8499, featured: true,
    image: '/products/packs/discord-nitro-1-year.svg', description: 'A full year of Discord Nitro.' },

  // ── Gift cards (face value + small margin; not on Eldorado) ──────────────
  // The price floor here is arithmetic, not taste. A card is only worth selling
  // if what the shop keeps after payment fees still beats the card's own face
  // value by the configured minimum profit:
  //
  //     price − (price × feePct + feeFixed) ≥ face + minProfit
  //
  // At the shipped 2.9% + €0.29 and a €0.50 minimum that puts a €25 card at
  // €26.56 and a €50 card at €52.31 — which is why these sit at €26.99 / €52.99
  // and not a euro lower. catalog-pricing-sanity.test.mjs enforces it, so a
  // future "let's undercut by a euro" cannot quietly sell at a loss.
  { sku: 'STEAM-10', name: 'Steam Wallet €10', category: 'giftcard', price: 1199,
    image: '/products/packs/steam-10.svg', description: 'Add €10 to your Steam Wallet via redeem code.' },
  { sku: 'STEAM-25', name: 'Steam Wallet €25', category: 'giftcard', price: 2699,
    image: '/products/packs/steam-25.svg', description: 'Add €25 to your Steam Wallet via redeem code.' },
  { sku: 'STEAM-50', name: 'Steam Wallet €50', category: 'giftcard', price: 5299,
    image: '/products/packs/steam-50.svg', description: 'Add €50 to your Steam Wallet via redeem code.' },
  { sku: 'PSN-25', name: 'PlayStation Store €25', category: 'giftcard', price: 2699,
    image: '/products/icons/playstation.webp', description: 'PSN gift card for games, DLC and PS Plus.' },
  { sku: 'XBOX-25', name: 'Xbox Gift Card €25', category: 'giftcard', price: 2699,
    image: '/products/icons/xbox.webp', description: 'Spend on games and add-ons across Xbox & PC.' },

  // ── More games (no per-pack art yet → storefront shows a category tile) ───
  { sku: 'LOL-1380', name: '1,380 RP — League of Legends', category: 'league', price: 899, image: '/products/packs/league-1380.svg', description: 'Riot Points for champions, skins and the Battle Pass.' },
  { sku: 'LOL-3500', name: '3,500 RP — League of Legends', category: 'league', price: 2099, featured: true, image: '/products/packs/league-3500.svg', description: 'Best-value RP bundle, instant delivery.' },
  { sku: 'LOL-8000', name: '8,000 RP — League of Legends', category: 'league', price: 4299, image: '/products/packs/league-8000.svg', description: 'Large Riot Points top-up.' },
  { sku: 'FF-530', name: '530 Diamonds — Free Fire', category: 'freefire', price: 449, image: '/products/packs/freefire-530.svg', description: 'Free Fire Diamonds for skins, characters and the Pass.' },
  { sku: 'FF-1080', name: '1,080 Diamonds — Free Fire', category: 'freefire', price: 849, featured: true, image: '/products/packs/freefire-1080.svg', description: 'Popular Free Fire diamond bundle.' },
  { sku: 'FF-2200', name: '2,200 Diamonds — Free Fire', category: 'freefire', price: 1699, image: '/products/packs/freefire-2200.svg', description: 'Big Free Fire diamond stack.' },
  { sku: 'PUBG-660', name: '660 UC — PUBG Mobile', category: 'pubg', price: 849, image: '/products/packs/pubg-660.svg', description: 'Unknown Cash for crates, skins and the Royale Pass.' },
  { sku: 'PUBG-1800', name: '1,800 UC — PUBG Mobile', category: 'pubg', price: 2099, featured: true, image: '/products/packs/pubg-1800.svg', description: 'Great-value PUBG Mobile UC bundle.' },
  { sku: 'PUBG-3850', name: '3,850 UC — PUBG Mobile', category: 'pubg', price: 4199, image: '/products/packs/pubg-3850.svg', description: 'Large PUBG Mobile UC top-up.' },
  { sku: 'MLBB-275', name: '275 Diamonds — Mobile Legends', category: 'mlbb', price: 449, image: '/products/packs/mlbb-275.svg', description: 'MLBB Diamonds for heroes, skins and the Pass.' },
  { sku: 'MLBB-565', name: '565 Diamonds — Mobile Legends', category: 'mlbb', price: 799, featured: true, image: '/products/packs/mlbb-565.svg', description: 'Popular Mobile Legends diamond bundle.' },
  { sku: 'MLBB-1155', name: '1,155 Diamonds — Mobile Legends', category: 'mlbb', price: 1599, image: '/products/packs/mlbb-1155.svg', description: 'Big Mobile Legends diamond stack.' },
  { sku: 'EAFC-1600', name: '1,600 FC Points — EA FC', category: 'eafc', price: 1299, image: '/products/packs/eafc-1600.svg', description: 'FC Points for Ultimate Team packs and drafts.' },
  { sku: 'EAFC-4600', name: '4,600 FC Points — EA FC', category: 'eafc', price: 3399, featured: true, image: '/products/packs/eafc-4600.svg', description: 'Best-value FC Points bundle.' },
  { sku: 'EAFC-12000', name: '12,000 FC Points — EA FC', category: 'eafc', price: 7999, image: '/products/packs/eafc-12000.svg', description: 'Maximum FC Points stack.' },
  { sku: 'GTA-GREAT', name: 'Great White Shark Card — GTA', category: 'gta', price: 1299, image: '/products/packs/gta-great-white.svg', description: '$1,250,000 in-game cash for GTA Online.' },
  { sku: 'GTA-WHALE', name: 'Whale Shark Card — GTA', category: 'gta', price: 2999, featured: true, image: '/products/packs/gta-whale.svg', description: '$3,500,000 in-game cash for GTA Online.' },
  { sku: 'GTA-MEGALODON', name: 'Megalodon Shark Card — GTA', category: 'gta', price: 5499, image: '/products/packs/gta-megalodon.svg', description: '$8,000,000 in-game cash for GTA Online.' },
  { sku: 'MC-1720', name: '1,720 Minecoins — Minecraft', category: 'minecraft', price: 849, image: '/products/packs/minecraft-1720.svg', description: 'Minecoins for skins, worlds and texture packs.' },
  { sku: 'MC-3500', name: '3,500 Minecoins — Minecraft', category: 'minecraft', price: 1649, featured: true, image: '/products/packs/minecraft-3500.svg', description: 'Popular Minecoins bundle.' },
  { sku: 'CR-500', name: '500 Gems — Clash Royale', category: 'clashroyale', price: 449, image: '/products/packs/clashroyale-500.svg', description: 'Clash Royale gems for chests and the Pass Royale.' },
  { sku: 'CR-1200', name: '1,200 Gems — Clash Royale', category: 'clashroyale', price: 849, featured: true, image: '/products/packs/clashroyale-1200.svg', description: 'Popular Clash Royale gem bundle.' },
  { sku: 'CR-2500', name: '2,500 Gems — Clash Royale', category: 'clashroyale', price: 1699, image: '/products/packs/clashroyale-2500.svg', description: 'Big Clash Royale gem stack.' },
  { sku: 'PGO-550', name: '550 PokéCoins — Pokémon GO', category: 'pokemongo', price: 449, image: '/products/packs/pokemongo-550.svg', description: 'PokéCoins for items, storage and raids.' },
  { sku: 'PGO-1200', name: '1,200 PokéCoins — Pokémon GO', category: 'pokemongo', price: 849, featured: true, image: '/products/packs/pokemongo-1200.svg', description: 'Popular PokéCoins bundle.' },

  // ── Subscriptions ────────────────────────────────────────────────────────
  { sku: 'SPOTIFY-3M', name: 'Spotify Premium — 3 Months', category: 'spotify', price: 2499, description: 'Ad-free music, offline listening and better quality.' },
  { sku: 'NETFLIX-25', name: 'Netflix Gift Card €25', category: 'giftcard', price: 2699, featured: true,
    image: '/products/icons/netflix.svg', description: 'Redeemable towards any Netflix plan.' },
  { sku: 'GAMEPASS-3M', name: 'Xbox Game Pass Ultimate — 3 Months', category: 'gamepass', price: 3499, featured: true, description: '100+ games, EA Play and online multiplayer.' },

  // ── More gift cards ──────────────────────────────────────────────────────
  { sku: 'NINTENDO-25', name: 'Nintendo eShop €25', category: 'giftcard', price: 2699,
    image: '/products/icons/nintendo.svg', description: 'Switch games, DLC and Nintendo Switch Online.' },
  { sku: 'AMAZON-25', name: 'Amazon Gift Card €25', category: 'giftcard', price: 2699,
    image: '/products/icons/amazon.svg', description: 'Spend on millions of products on Amazon.' },
  { sku: 'GPLAY-25', name: 'Google Play €25', category: 'giftcard', price: 2699,
    image: '/products/icons/googleplay.svg', description: 'Apps, games and in-app purchases on Android.' },
  { sku: 'ITUNES-25', name: 'App Store & iTunes €25', category: 'giftcard', price: 2699,
    image: '/products/icons/itunes.svg', description: 'Apps, games, music and iCloud storage on Apple.' },
];

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// Premium 3D icon tiles per category (public/products/icons) — one unique icon each.
const CATS_WITH_ICON = [
  'albion', 'amazon', 'amongus', 'apex', 'battlenet', 'battlepass', 'bloodstrike', 'brawl',
  'bundle', 'chest', 'clash', 'clashroyale', 'cod', 'coin', 'crunchyroll', 'csgo',
  'deltaforce', 'discord-nitro', 'disneyplus', 'dota', 'eafc', 'eaplay', 'epicgames',
  'fallguys', 'favourite', 'freefire', 'gamepass', 'gem', 'genshin', 'giftcard', 'googleplay',
  'gta', 'honkai', 'itunes', 'league', 'marvelrivals', 'minecraft', 'mlbb', 'mystery',
  'netflix', 'nintendo', 'paysafecard', 'playstation', 'pokemongo', 'psplus', 'pubg', 'robux',
  'rocketleague', 'rust', 'spotify', 'standoff', 'steam', 'telegram', 'tiktok', 'twitch',
  'ubisoft', 'v-bucks', 'valorant', 'voucher', 'wildrift', 'wow', 'xbox', 'youtube', 'zenless',
];
// Categories whose art is the owner's own 3D renders rather than a generated
// icon. These are raster (WEBP) and they carry their own background, which is
// what the tile has to accommodate — see the raster branch in
// LightProductCard.jsx. Keep in sync with RASTER_ICONS in src/lib/sampleCatalog.js.
const RASTER_ICONS = [
  'cod', 'discord-nitro', 'eafc', 'giftcard', 'playstation', 'robux', 'steam', 'v-bucks',
  'valorant', 'xbox',
];
// Raster brand art is WEBP, not PNG. The PNGs were converted during the
// performance pass (481KB across ten files became 83KB) and this copy of the
// rule was never updated — so every product in a raster category was pointed at
// a file that has not existed since. There are zero .png files under
// public/products/icons; the frontend's iconPath() has said .webp all along.
export const iconFor = (cat) => (CATS_WITH_ICON.includes(cat)
  ? `/products/icons/${cat}.${RASTER_ICONS.includes(cat) ? 'webp' : 'svg'}` : null);

/**
 * The generated ForgeMarket artboard, when one exists for this SKU.
 *
 * scripts/art/generate.mjs writes /products/art/<sku>.svg for every product:
 * one dark, purple/blue, ForgeMarket-branded system authored at 7:6 — exactly
 * the ratio of the card that displays it. Preferring it here means a fresh
 * deployment seeds the current art rather than the two older systems (480x300
 * pack covers and 512x512 logos) that never matched the tile and left the grid
 * with three different painted sizes.
 *
 * Falls back to the old art when the file is absent, so a checkout that has not
 * run the generator still seeds a complete catalogue rather than a blank one.
 */
/* Relative to THIS file, not to cwd: the API runs from server/, so
   process.cwd() + public/ pointed at a directory that does not exist and the
   lookup silently found nothing. Measured by seeding a fresh database and
   counting how many products landed on the new art: 0 of 72. */
const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
  'public', 'products', 'art');
const generatedArt = (sku) => {
  if (!sku) return null;
  const file = `${String(sku).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.svg`;
  try { return fs.existsSync(path.join(ART_DIR, file)) ? `/products/art/${file}` : null; }
  catch { return null; }
};

// Generated artboard first, then per-PACK art, then the category icon — so
// every product gets its own visual whichever of the three is available.
const imageFor = (p) => generatedArt(p.sku) || p.image || iconFor(p.category) || null;

/**
 * Keep product covers in sync on every boot: any seeded product whose stored
 * image differs from the current best art gets updated. Cheap (one select per
 * catalog SKU) and never touches products the admin created manually.
 */
// Store credit / gift cards used to sit in a category each — nine of them with
// a single product. They now share one 'giftcard' category; each product keeps
// its own brand art, so grouping them doesn't flatten them to one icon.
const GIFTCARD_SKUS = CATALOG.filter((p) => p.category === 'giftcard').map((p) => p.sku);

export async function syncCatalogImages() {
  // Move any of those products still sitting in their old single-brand category.
  const moved = await run(
    `UPDATE products SET category = 'giftcard', updated_at = @at
      WHERE sku = ANY(@skus) AND category <> 'giftcard'`,
    { at: nowIso(), skus: GIFTCARD_SKUS }).catch(() => null);
  if (moved?.changes) console.log(`[catalog] ${moved.changes} product(s) regrouped under giftcard`);

  // Built-in icons are a mix of raster brand art (.png) and generated 3D icons
  // (.svg), and a category can switch between the two. Repoint any product
  // stored against the wrong extension so it never renders a broken image.
  // Only rewrites our own icon paths — owner uploads and links are untouched.
  let repointed = 0;
  for (const cat of CATS_WITH_ICON) {
    const right = iconFor(cat);
    if (!right) continue;
    // Every extension this icon has ever been stored as, so a row written by an
    // older build heals instead of rendering a broken image forever. The .png
    // entry matters most: those files are gone, and the previous version of this
    // loop actively rewrote WORKING .svg paths into that dead .png.
    const stale = ['.svg', '.png', '.webp']
      .map((ext) => `/products/icons/${cat}${ext}`)
      .filter((u) => u !== right);
    for (const wrong of stale) {
      const r = await run(
        `UPDATE products SET metadata = REPLACE(metadata, @wrong, @right), updated_at = @at
          WHERE metadata LIKE @like`,
        { wrong, right, at: nowIso(), like: `%${wrong}%` }).catch(() => null);
      repointed += r?.changes || 0;
    }
  }
  if (repointed) console.log(`[catalog] icon paths repointed on ${repointed} product(s)`);

  /* Retire the six flat banners under /products/.
     They predate the icon set and are not part of it: a gradient rectangle with
     the brand name typeset small in a corner, sitting in a grid of shaded 3D art.
     Every product still pointing at one has a proper piece of art waiting under
     /products/icons/, so this is a rename rather than a redesign — and the
     extension repointer above never touched them, because it only knows about
     paths that already live in the icons folder.
     Owner uploads and external links are untouched: only these six exact paths
     are rewritten, and only to art that exists. */
  const LEGACY_ART = {
    '/products/playstation.svg': '/products/icons/playstation.webp',
    '/products/xbox.svg': '/products/icons/xbox.webp',
    '/products/steam.svg': '/products/icons/steam.webp',
    '/products/robux.svg': '/products/icons/robux.webp',
    '/products/vbucks.svg': '/products/icons/v-bucks.webp',
    '/products/nitro.svg': '/products/icons/discord-nitro.webp',
  };
  let retired = 0;
  for (const [was, now] of Object.entries(LEGACY_ART)) {
    const r = await run(
      `UPDATE products SET metadata = REPLACE(metadata, @was, @now), updated_at = @at
        WHERE metadata LIKE @like`,
      { was, now, at: nowIso(), like: `%"${was}"%` }).catch(() => null);
    retired += r?.changes || 0;
  }
  if (retired) console.log(`[catalog] ${retired} product(s) moved off the old flat banners`);

  let updated = 0;
  for (const p of CATALOG) {
    const img = imageFor(p);
    if (!img) continue;
    const existing = await get('SELECT id, metadata FROM products WHERE sku = @sku', { sku: p.sku });
    if (!existing) continue;
    const meta = parse(existing.metadata);
    // Backfill only: never overwrite an image the owner set in the admin (clear
    // the Image URL field to fall back to the default icon on the next boot).
    if (meta.image) continue;
    meta.image = img;
    await run('UPDATE products SET metadata = @m, updated_at = @at WHERE id = @id',
      { m: JSON.stringify(meta), at: nowIso(), id: existing.id });
    updated++;
  }
  if (updated) console.log(`[catalog] product art synced on ${updated} product(s)`);
}

export async function seedDemoCatalog() {
  await migrate();
  let created = 0;
  let updated = 0;
  for (const p of CATALOG) {
    const img = imageFor(p);
    const existing = await get('SELECT id, metadata FROM products WHERE sku = @sku', { sku: p.sku });
    const at = nowIso();

    if (existing) {
      // Backfill the default cover ONLY when the product has no image — never
      // clobber an image the owner set in the admin.
      const meta = parse(existing.metadata);
      let dirty = false;
      if (img && !meta.image) { meta.image = img; dirty = true; }
      if (dirty) {
        await run('UPDATE products SET metadata = @m, updated_at = @at WHERE id = @id',
          { m: JSON.stringify(meta), at, id: existing.id });
        updated++;
      }
      // Explicit re-seed (SEED_DEMO=true / npm run seed:demo): also re-sync the
      // PRICE to the current defaults — used after a repricing pass. Products
      // keep admin-set prices on normal boots because this branch only runs
      // when the seeder was explicitly invoked.
      const row = await get('SELECT price FROM products WHERE id = @id', { id: existing.id });
      if (Number(row?.price) !== p.price) {
        await run('UPDATE products SET price = @p, updated_at = @at WHERE id = @id',
          { p: p.price, at, id: existing.id });
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
