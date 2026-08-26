/**
 * Built-in showcase catalog used as a graceful fallback for the storefront.
 *
 * When the API returns no products (e.g. the database isn't connected yet, or the
 * demo catalog hasn't been seeded), the shop and home page fall back to this list
 * so the store never looks empty. Prices mirror the server demo catalog
 * (Eldorado-style top-ups + small margin). Real products from the API always
 * take precedence — this only fills in when the live catalog is empty.
 */
const P = [
  // Robux
  ['ROBUX-1000', '1,000 Robux', 'robux', 999, true, 'robux-1000', 'Instant Robux top-up to your Roblox account.'],
  ['ROBUX-2000', '2,000 Robux', 'robux', 1799, false, 'robux-2000', '2,000 Robux delivered fast and securely.'],
  ['ROBUX-4500', '4,500 Robux', 'robux', 3899, true, 'robux-4500', 'Popular value pack for serious builders.'],
  ['ROBUX-10000', '10,000 Robux', 'robux', 7999, false, 'robux-10000', 'Big Robux bundle — best price per Robux.'],
  ['ROBUX-22500', '22,500 Robux', 'robux', 17499, false, 'robux-22500', 'Maximum Robux top-up for power users.'],
  // V-Bucks
  ['VBUCKS-1000', '1,000 V-Bucks', 'v-bucks', 599, false, 'vbucks-1000', 'Fortnite V-Bucks for skins and the Battle Pass.'],
  ['VBUCKS-2800', '2,800 V-Bucks', 'v-bucks', 1299, true, 'vbucks-2800', 'Great-value V-Bucks bundle, instant delivery.'],
  ['VBUCKS-5000', '5,000 V-Bucks', 'v-bucks', 2399, false, 'vbucks-5000', '5,000 V-Bucks delivered to your account.'],
  ['VBUCKS-13500', '13,500 V-Bucks', 'v-bucks', 3999, true, 'vbucks-13500', 'The biggest V-Bucks stack at the best rate.'],
  // Call of Duty
  ['COD-2400', '2,400 CP — Call of Duty', 'cod', 1599, false, 'cod-2400', 'Call of Duty Points for skins, bundles and Battle Pass.'],
  ['COD-5000', '5,000 CP — Call of Duty', 'cod', 2999, true, 'cod-5000', 'Best-value CoD Points bundle, instant delivery.'],
  ['COD-9500', '9,500 CP — Call of Duty', 'cod', 5499, false, 'cod-9500', 'Large CoD Points top-up.'],
  ['COD-21000', '21,000 CP — Call of Duty', 'cod', 11499, false, 'cod-21000', 'Maximum CoD Points stack.'],
  // Brawl Stars
  ['BRAWL-360', '360 Gems — Brawl Stars', 'brawl', 1499, false, 'brawl-360', 'Brawl Stars gems for brawlers, skins and the Pass.'],
  ['BRAWL-950', '950 Gems — Brawl Stars', 'brawl', 3699, true, 'brawl-950', 'Popular Brawl Stars gem bundle.'],
  ['BRAWL-2000', '2,000 Gems — Brawl Stars', 'brawl', 7499, false, 'brawl-2000', 'Big Brawl Stars gem stack.'],
  // Apex
  ['APEX-1000', '1,000 Apex Coins', 'apex', 799, false, 'apex-1000', 'Apex Coins for skins, the Battle Pass and packs.'],
  ['APEX-2150', '2,150 Apex Coins', 'apex', 1599, false, 'apex-2150', 'Apex Coins bundle, instant delivery.'],
  ['APEX-4350', '4,350 Apex Coins', 'apex', 3099, true, 'apex-4350', 'Great-value Apex Coins pack.'],
  ['APEX-11500', '11,500 Apex Coins', 'apex', 7499, false, 'apex-11500', 'Maximum Apex Coins top-up.'],
  // Valorant
  ['VAL-1000', '1,000 VP — Valorant', 'valorant', 799, false, 'valorant-1000', 'Valorant Points for skins and the Battle Pass.'],
  ['VAL-2050', '2,050 VP — Valorant', 'valorant', 1449, false, 'valorant-2050', 'Valorant Points bundle.'],
  ['VAL-3650', '3,650 VP — Valorant', 'valorant', 2399, true, 'valorant-3650', 'Popular Valorant Points pack.'],
  ['VAL-5350', '5,350 VP — Valorant', 'valorant', 3499, false, 'valorant-5350', 'Large Valorant Points top-up.'],
  // Genshin
  ['GEN-980', '980 Genesis Crystals — Genshin', 'genshin', 1199, false, 'genshin-980', 'Genesis Crystals for wishes and the Battle Pass.'],
  ['GEN-1980', '1,980 Genesis Crystals — Genshin', 'genshin', 2299, true, 'genshin-1980', 'Popular Genshin crystals bundle.'],
  ['GEN-3280', '3,280 Genesis Crystals — Genshin', 'genshin', 3799, false, 'genshin-3280', 'Large Genesis Crystals pack.'],
  ['GEN-6480', '6,480 Genesis Crystals — Genshin', 'genshin', 7499, false, 'genshin-6480', 'Maximum Genesis Crystals top-up.'],
  // Clash of Clans
  ['COC-500', '500 Gems — Clash of Clans', 'clash', 449, false, 'clash-500', 'Clash of Clans gems to speed up your village.'],
  ['COC-1200', '1,200 Gems — Clash of Clans', 'clash', 849, false, 'clash-1200', 'Clash of Clans gem bundle.'],
  ['COC-2500', '2,500 Gems — Clash of Clans', 'clash', 1699, true, 'clash-2500', 'Popular Clash of Clans gem pack.'],
  ['COC-6500', '6,500 Gems — Clash of Clans', 'clash', 3999, false, 'clash-6500', 'Big Clash of Clans gem stack.'],
  // League of Legends (RP)
  ['LOL-1380', '1,380 RP — League of Legends', 'league', 899, false, null, 'Riot Points for champions, skins and the Battle Pass.'],
  ['LOL-3500', '3,500 RP — League of Legends', 'league', 2099, true, null, 'Best-value RP bundle, instant delivery.'],
  ['LOL-8000', '8,000 RP — League of Legends', 'league', 4299, false, null, 'Large Riot Points top-up.'],
  // Free Fire (Diamonds)
  ['FF-530', '530 Diamonds — Free Fire', 'freefire', 449, false, null, 'Free Fire Diamonds for skins, characters and the Pass.'],
  ['FF-1080', '1,080 Diamonds — Free Fire', 'freefire', 849, true, null, 'Popular Free Fire diamond bundle.'],
  ['FF-2200', '2,200 Diamonds — Free Fire', 'freefire', 1699, false, null, 'Big Free Fire diamond stack.'],
  // PUBG Mobile (UC)
  ['PUBG-660', '660 UC — PUBG Mobile', 'pubg', 849, false, null, 'Unknown Cash for crates, skins and the Royale Pass.'],
  ['PUBG-1800', '1,800 UC — PUBG Mobile', 'pubg', 2099, true, null, 'Great-value PUBG Mobile UC bundle.'],
  ['PUBG-3850', '3,850 UC — PUBG Mobile', 'pubg', 4199, false, null, 'Large PUBG Mobile UC top-up.'],
  // Mobile Legends (Diamonds)
  ['MLBB-275', '275 Diamonds — Mobile Legends', 'mlbb', 449, false, null, 'MLBB Diamonds for heroes, skins and the Pass.'],
  ['MLBB-565', '565 Diamonds — Mobile Legends', 'mlbb', 799, true, null, 'Popular Mobile Legends diamond bundle.'],
  ['MLBB-1155', '1,155 Diamonds — Mobile Legends', 'mlbb', 1699, false, null, 'Big Mobile Legends diamond stack.'],
  // EA FC / FIFA Points
  ['EAFC-1600', '1,600 FC Points — EA FC', 'eafc', 1299, false, null, 'FC Points for Ultimate Team packs and drafts.'],
  ['EAFC-4600', '4,600 FC Points — EA FC', 'eafc', 3399, true, null, 'Best-value FC Points bundle.'],
  ['EAFC-12000', '12,000 FC Points — EA FC', 'eafc', 7999, false, null, 'Maximum FC Points stack.'],
  // GTA Online (Shark Cards)
  ['GTA-GREAT', 'Great White Shark Card — GTA', 'gta', 1299, false, null, '$1,250,000 in-game cash for GTA Online.'],
  ['GTA-WHALE', 'Whale Shark Card — GTA', 'gta', 2999, true, null, '$3,500,000 in-game cash for GTA Online.'],
  ['GTA-MEGALODON', 'Megalodon Shark Card — GTA', 'gta', 5499, false, null, '$8,000,000 in-game cash for GTA Online.'],
  // Minecraft (Minecoins)
  ['MC-1720', '1,720 Minecoins — Minecraft', 'minecraft', 849, false, null, 'Minecoins for skins, worlds and texture packs.'],
  ['MC-3500', '3,500 Minecoins — Minecraft', 'minecraft', 1649, true, null, 'Popular Minecoins bundle.'],
  // Clash Royale (Gems)
  ['CR-500', '500 Gems — Clash Royale', 'clashroyale', 449, false, null, 'Clash Royale gems for chests and the Pass Royale.'],
  ['CR-1200', '1,200 Gems — Clash Royale', 'clashroyale', 849, true, null, 'Popular Clash Royale gem bundle.'],
  ['CR-2500', '2,500 Gems — Clash Royale', 'clashroyale', 1699, false, null, 'Big Clash Royale gem stack.'],
  // Pokémon GO (PokéCoins)
  ['PGO-550', '550 PokéCoins — Pokémon GO', 'pokemongo', 449, false, null, 'PokéCoins for items, storage and raids.'],
  ['PGO-1200', '1,200 PokéCoins — Pokémon GO', 'pokemongo', 849, true, null, 'Popular PokéCoins bundle.'],
  // Subscriptions
  ['NITRO-1M', 'Discord Nitro — 1 Month', 'discord-nitro', 899, false, null, 'Full Nitro for a month: HD streaming, emojis, boosts.'],
  ['NITRO-1Y', 'Discord Nitro — 1 Year', 'discord-nitro', 8499, true, null, 'A full year of Discord Nitro.'],
  ['SPOTIFY-3M', 'Spotify Premium — 3 Months', 'spotify', 2499, false, null, 'Ad-free music, offline listening and better quality.'],
  ['NETFLIX-25', 'Netflix Gift Card €25', 'giftcard', 2599, true, null, 'Redeemable towards any Netflix plan.'],
  ['GAMEPASS-3M', 'Xbox Game Pass Ultimate — 3 Months', 'gamepass', 3499, true, null, '100+ games, EA Play and online multiplayer.'],
  // Gift cards & wallets
  ['STEAM-10', 'Steam Wallet €10', 'giftcard', 1199, false, null, 'Add €10 to your Steam Wallet via redeem code.'],
  ['STEAM-25', 'Steam Wallet €25', 'giftcard', 2699, false, null, 'Add €25 to your Steam Wallet via redeem code.'],
  ['STEAM-50', 'Steam Wallet €50', 'giftcard', 5199, false, null, 'Add €50 to your Steam Wallet via redeem code.'],
  ['PSN-25', 'PlayStation Store €25', 'giftcard', 2699, false, null, 'PSN gift card for games, DLC and PS Plus.'],
  ['XBOX-25', 'Xbox Gift Card €25', 'giftcard', 2699, false, null, 'Spend on games and add-ons across Xbox & PC.'],
  ['NINTENDO-25', 'Nintendo eShop €25', 'giftcard', 2699, false, null, 'Switch games, DLC and Nintendo Switch Online.'],
  ['AMAZON-25', 'Amazon Gift Card €25', 'giftcard', 2599, false, null, 'Spend on millions of products on Amazon.'],
  ['GPLAY-25', 'Google Play €25', 'giftcard', 2599, false, null, 'Apps, games and in-app purchases on Android.'],
  ['ITUNES-25', 'App Store & iTunes €25', 'giftcard', 2599, false, null, 'Apps, games, music and iCloud storage on Apple.'],
];

// Premium 3D icon tiles (public/products/icons) — one unique icon per category.
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
export const CATEGORY_ICON = Object.fromEntries(CATS_WITH_ICON.map((c) => [c, c]));
/**
 * Categories whose art is the owner's own 3D renders (raster) rather than a
 * generated icon. Keep in sync with the server list in db/demoSeed.js: the two
 * decide the same thing, and a disagreement means the storefront asks for a file
 * the catalogue was never pointed at.
 */
export const RASTER_ICONS = new Set([
  'cod', 'discord-nitro', 'eafc', 'giftcard', 'playstation', 'robux', 'steam', 'v-bucks',
  'valorant', 'xbox',
]);
/**
 * Path to the built-in icon for a category name (not the file's own slug).
 *
 * The raster icons are WebP. As PNGs they were 481KB across ten files — a
 * single 256px icon weighed 95KB — and they downloaded in parallel with the
 * JavaScript the page cannot paint without, on a connection that has to carry
 * both. Same pixels, 83% fewer bytes.
 */
export const iconPath = (name) => `/products/icons/${name}.${RASTER_ICONS.has(name) ? 'webp' : 'svg'}`;
export const iconFor = (category) => (CATEGORY_ICON[category] ? iconPath(CATEGORY_ICON[category]) : null);

// Products whose own brand differs from their category — the gift cards all
// live under 'giftcard' but should still show Steam, PlayStation, Xbox, …
const BRAND_ICON = {
  'STEAM-10': 'steam', 'STEAM-25': 'steam', 'STEAM-50': 'steam',
  'PSN-25': 'playstation', 'XBOX-25': 'xbox', 'NINTENDO-25': 'nintendo',
  'AMAZON-25': 'amazon', 'GPLAY-25': 'googleplay', 'ITUNES-25': 'itunes',
  'NETFLIX-25': 'netflix',
};

export const SAMPLE_PRODUCTS = P.map(([sku, name, category, price, featured, pack, description]) => ({
  id: sku.toLowerCase(),
  sku,
  name,
  category,
  price,
  currency: 'EUR',
  description,
  featured,
  // Gift cards share one category but keep their own brand mark; everything
  // else uses its category icon. null → gradient + lucide icon on the card.
  image: BRAND_ICON[sku] ? iconPath(BRAND_ICON[sku]) : iconFor(category),
  sample: true,
}));

/**
 * The API answered and the shop has nothing on the shelf yet — show the
 * showcase so a brand-new deployment is not a blank page.
 *
 * ONLY for that case. It used to be reached from `.catch()` as well, which
 * conflated two completely different situations: "this shop has no products"
 * and "this shop cannot be reached". During a real outage the storefront
 * therefore rendered a full catalogue of products that may not exist, with
 * working-looking tiles, while every API call behind it was returning 500 — so
 * the failure was invisible from the front page and a visitor could click into
 * a product that was never there.
 *
 * A request that FAILED must say so. See `catalogUnavailable` below.
 */
export function withFallback(list) {
  return Array.isArray(list) && list.length > 0 ? list : SAMPLE_PRODUCTS;
}

/**
 * What to show when the catalogue could not be loaded at all.
 *
 * Deliberately not a product list. This shop's whole position is that it does
 * not make things up, and a fabricated shelf during an outage is the most
 * expensive place to break that: the visitor believes they can buy.
 */
export const CATALOG_UNAVAILABLE = {
  title: { en: 'We cannot load the shop right now', nl: 'We kunnen de winkel nu niet laden' },
  hint: {
    en: 'This is on our side, not yours. Nothing is wrong with your connection — please try again in a few minutes.',
    nl: 'Dit ligt aan ons, niet aan jou. Er is niets mis met je verbinding — probeer het over een paar minuten opnieuw.',
  },
};
