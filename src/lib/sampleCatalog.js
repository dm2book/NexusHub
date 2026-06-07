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
  ['ROBUX-4500', '4,500 Robux', 'robux', 3599, true, 'robux-4500', 'Popular value pack for serious builders.'],
  ['ROBUX-10000', '10,000 Robux', 'robux', 7399, false, 'robux-10000', 'Big Robux bundle — best price per Robux.'],
  ['ROBUX-22500', '22,500 Robux', 'robux', 15699, false, 'robux-22500', 'Maximum Robux top-up for power users.'],
  // V-Bucks
  ['VBUCKS-1000', '1,000 V-Bucks', 'v-bucks', 699, false, 'vbucks-1000', 'Fortnite V-Bucks for skins and the Battle Pass.'],
  ['VBUCKS-2800', '2,800 V-Bucks', 'v-bucks', 1399, true, 'vbucks-2800', 'Great-value V-Bucks bundle, instant delivery.'],
  ['VBUCKS-5000', '5,000 V-Bucks', 'v-bucks', 2399, false, 'vbucks-5000', '5,000 V-Bucks delivered to your account.'],
  ['VBUCKS-13500', '13,500 V-Bucks', 'v-bucks', 3699, true, 'vbucks-13500', 'The biggest V-Bucks stack at the best rate.'],
  // Call of Duty
  ['COD-2400', '2,400 CP — Call of Duty', 'cod', 2399, false, 'cod-2400', 'Call of Duty Points for skins, bundles and Battle Pass.'],
  ['COD-5000', '5,000 CP — Call of Duty', 'cod', 4499, true, 'cod-5000', 'Best-value CoD Points bundle, instant delivery.'],
  ['COD-9500', '9,500 CP — Call of Duty', 'cod', 7999, false, 'cod-9500', 'Large CoD Points top-up.'],
  ['COD-21000', '21,000 CP — Call of Duty', 'cod', 15999, false, 'cod-21000', 'Maximum CoD Points stack.'],
  // Brawl Stars
  ['BRAWL-360', '360 Gems — Brawl Stars', 'brawl', 699, false, 'brawl-360', 'Brawl Stars gems for brawlers, skins and the Pass.'],
  ['BRAWL-950', '950 Gems — Brawl Stars', 'brawl', 1799, true, 'brawl-950', 'Popular Brawl Stars gem bundle.'],
  ['BRAWL-2000', '2,000 Gems — Brawl Stars', 'brawl', 3499, false, 'brawl-2000', 'Big Brawl Stars gem stack.'],
  // Apex
  ['APEX-1000', '1,000 Apex Coins', 'apex', 999, false, 'apex-1000', 'Apex Coins for skins, the Battle Pass and packs.'],
  ['APEX-2150', '2,150 Apex Coins', 'apex', 1899, false, 'apex-2150', 'Apex Coins bundle, instant delivery.'],
  ['APEX-4350', '4,350 Apex Coins', 'apex', 3699, true, 'apex-4350', 'Great-value Apex Coins pack.'],
  ['APEX-11500', '11,500 Apex Coins', 'apex', 8999, false, 'apex-11500', 'Maximum Apex Coins top-up.'],
  // Valorant
  ['VAL-1000', '1,000 VP — Valorant', 'valorant', 999, false, 'valorant-1000', 'Valorant Points for skins and the Battle Pass.'],
  ['VAL-2050', '2,050 VP — Valorant', 'valorant', 1799, false, 'valorant-2050', 'Valorant Points bundle.'],
  ['VAL-3650', '3,650 VP — Valorant', 'valorant', 3199, true, 'valorant-3650', 'Popular Valorant Points pack.'],
  ['VAL-5350', '5,350 VP — Valorant', 'valorant', 4499, false, 'valorant-5350', 'Large Valorant Points top-up.'],
  // Genshin
  ['GEN-980', '980 Genesis Crystals — Genshin', 'genshin', 1599, false, 'genshin-980', 'Genesis Crystals for wishes and the Battle Pass.'],
  ['GEN-1980', '1,980 Genesis Crystals — Genshin', 'genshin', 2999, true, 'genshin-1980', 'Popular Genshin crystals bundle.'],
  ['GEN-3280', '3,280 Genesis Crystals — Genshin', 'genshin', 4999, false, 'genshin-3280', 'Large Genesis Crystals pack.'],
  ['GEN-6480', '6,480 Genesis Crystals — Genshin', 'genshin', 9499, false, 'genshin-6480', 'Maximum Genesis Crystals top-up.'],
  // Clash of Clans
  ['COC-500', '500 Gems — Clash of Clans', 'clash', 499, false, 'clash-500', 'Clash of Clans gems to speed up your village.'],
  ['COC-1200', '1,200 Gems — Clash of Clans', 'clash', 999, false, 'clash-1200', 'Clash of Clans gem bundle.'],
  ['COC-2500', '2,500 Gems — Clash of Clans', 'clash', 1999, true, 'clash-2500', 'Popular Clash of Clans gem pack.'],
  ['COC-6500', '6,500 Gems — Clash of Clans', 'clash', 4999, false, 'clash-6500', 'Big Clash of Clans gem stack.'],
  // League of Legends (RP)
  ['LOL-1380', '1,380 RP — League of Legends', 'league', 999, false, null, 'Riot Points for champions, skins and the Battle Pass.'],
  ['LOL-3500', '3,500 RP — League of Legends', 'league', 2499, true, null, 'Best-value RP bundle, instant delivery.'],
  ['LOL-8000', '8,000 RP — League of Legends', 'league', 4999, false, null, 'Large Riot Points top-up.'],
  // Free Fire (Diamonds)
  ['FF-530', '530 Diamonds — Free Fire', 'freefire', 599, false, null, 'Free Fire Diamonds for skins, characters and the Pass.'],
  ['FF-1080', '1,080 Diamonds — Free Fire', 'freefire', 1099, true, null, 'Popular Free Fire diamond bundle.'],
  ['FF-2200', '2,200 Diamonds — Free Fire', 'freefire', 2199, false, null, 'Big Free Fire diamond stack.'],
  // PUBG Mobile (UC)
  ['PUBG-660', '660 UC — PUBG Mobile', 'pubg', 999, false, null, 'Unknown Cash for crates, skins and the Royale Pass.'],
  ['PUBG-1800', '1,800 UC — PUBG Mobile', 'pubg', 2599, true, null, 'Great-value PUBG Mobile UC bundle.'],
  ['PUBG-3850', '3,850 UC — PUBG Mobile', 'pubg', 4999, false, null, 'Large PUBG Mobile UC top-up.'],
  // Mobile Legends (Diamonds)
  ['MLBB-275', '275 Diamonds — Mobile Legends', 'mlbb', 699, false, null, 'MLBB Diamonds for heroes, skins and the Pass.'],
  ['MLBB-565', '565 Diamonds — Mobile Legends', 'mlbb', 1399, true, null, 'Popular Mobile Legends diamond bundle.'],
  ['MLBB-1155', '1,155 Diamonds — Mobile Legends', 'mlbb', 2799, false, null, 'Big Mobile Legends diamond stack.'],
  // EA FC / FIFA Points
  ['EAFC-1600', '1,600 FC Points — EA FC', 'eafc', 1499, false, null, 'FC Points for Ultimate Team packs and drafts.'],
  ['EAFC-4600', '4,600 FC Points — EA FC', 'eafc', 3999, true, null, 'Best-value FC Points bundle.'],
  ['EAFC-12000', '12,000 FC Points — EA FC', 'eafc', 9999, false, null, 'Maximum FC Points stack.'],
  // GTA Online (Shark Cards)
  ['GTA-GREAT', 'Great White Shark Card — GTA', 'gta', 1599, false, null, '$1,250,000 in-game cash for GTA Online.'],
  ['GTA-WHALE', 'Whale Shark Card — GTA', 'gta', 3499, true, null, '$3,500,000 in-game cash for GTA Online.'],
  ['GTA-MEGALODON', 'Megalodon Shark Card — GTA', 'gta', 6999, false, null, '$8,000,000 in-game cash for GTA Online.'],
  // Minecraft (Minecoins)
  ['MC-1720', '1,720 Minecoins — Minecraft', 'minecraft', 999, false, null, 'Minecoins for skins, worlds and texture packs.'],
  ['MC-3500', '3,500 Minecoins — Minecraft', 'minecraft', 1899, true, null, 'Popular Minecoins bundle.'],
  // Clash Royale (Gems)
  ['CR-500', '500 Gems — Clash Royale', 'clashroyale', 499, false, null, 'Clash Royale gems for chests and the Pass Royale.'],
  ['CR-1200', '1,200 Gems — Clash Royale', 'clashroyale', 999, true, null, 'Popular Clash Royale gem bundle.'],
  ['CR-2500', '2,500 Gems — Clash Royale', 'clashroyale', 1999, false, null, 'Big Clash Royale gem stack.'],
  // Pokémon GO (PokéCoins)
  ['PGO-550', '550 PokéCoins — Pokémon GO', 'pokemongo', 599, false, null, 'PokéCoins for items, storage and raids.'],
  ['PGO-1200', '1,200 PokéCoins — Pokémon GO', 'pokemongo', 1199, true, null, 'Popular PokéCoins bundle.'],
  // Subscriptions
  ['NITRO-1M', 'Discord Nitro — 1 Month', 'discord-nitro', 999, false, null, 'Full Nitro for a month: HD streaming, emojis, boosts.'],
  ['NITRO-1Y', 'Discord Nitro — 1 Year', 'discord-nitro', 9999, true, null, 'A full year of Discord Nitro.'],
  ['SPOTIFY-3M', 'Spotify Premium — 3 Months', 'spotify', 2999, false, null, 'Ad-free music, offline listening and better quality.'],
  ['NETFLIX-25', 'Netflix Gift Card €25', 'netflix', 2599, true, null, 'Redeemable towards any Netflix plan.'],
  ['GAMEPASS-3M', 'Xbox Game Pass Ultimate — 3 Months', 'gamepass', 3899, true, null, '100+ games, EA Play and online multiplayer.'],
  // Gift cards & wallets
  ['STEAM-10', 'Steam Wallet €10', 'steam', 1199, false, null, 'Add €10 to your Steam Wallet via redeem code.'],
  ['STEAM-25', 'Steam Wallet €25', 'steam', 2699, false, null, 'Add €25 to your Steam Wallet via redeem code.'],
  ['STEAM-50', 'Steam Wallet €50', 'steam', 5199, false, null, 'Add €50 to your Steam Wallet via redeem code.'],
  ['PSN-25', 'PlayStation Store €25', 'playstation', 2699, false, null, 'PSN gift card for games, DLC and PS Plus.'],
  ['XBOX-25', 'Xbox Gift Card €25', 'xbox', 2699, false, null, 'Spend on games and add-ons across Xbox & PC.'],
  ['NINTENDO-25', 'Nintendo eShop €25', 'nintendo', 2699, false, null, 'Switch games, DLC and Nintendo Switch Online.'],
  ['AMAZON-25', 'Amazon Gift Card €25', 'amazon', 2599, false, null, 'Spend on millions of products on Amazon.'],
  ['GPLAY-25', 'Google Play €25', 'googleplay', 2599, false, null, 'Apps, games and in-app purchases on Android.'],
  ['ITUNES-25', 'App Store & iTunes €25', 'itunes', 2599, false, null, 'Apps, games, music and iCloud storage on Apple.'],
];

// Categories that ship a real cover image under /public/products.
const CATEGORY_IMG = { steam: 'steam', playstation: 'playstation', xbox: 'xbox', 'discord-nitro': 'nitro' };

export const SAMPLE_PRODUCTS = P.map(([sku, name, category, price, featured, pack, description]) => ({
  id: sku.toLowerCase(),
  sku,
  name,
  category,
  price,
  currency: 'EUR',
  description,
  featured,
  // Pack art when we have it, else a known category image, else null → the card
  // renders a clean category gradient + icon (never a broken image).
  image: pack ? `/products/packs/${pack}.svg` : (CATEGORY_IMG[category] ? `/products/${CATEGORY_IMG[category]}.svg` : null),
  sample: true,
}));

/** Return the API list when it has products, otherwise the built-in showcase. */
export function withFallback(list) {
  return Array.isArray(list) && list.length > 0 ? list : SAMPLE_PRODUCTS;
}
