import {
  Gamepad2, Gift, Coins, Crown, Sparkles, Ticket, CreditCard, Package,
  Crosshair, Gem, Swords, Trophy, Music, Film, Smartphone, ShoppingBag, Diamond,
} from 'lucide-react';

// Visual treatment per category — gradient + icon used across the storefront.
const MAP = {
  // ── Game currency ──────────────────────────────────────────────
  robux: { icon: Coins, grad: 'from-emerald-500 to-teal-500', label: 'Robux' },
  'v-bucks': { icon: Sparkles, grad: 'from-purple-500 to-fuchsia-500', label: 'V-Bucks' },
  cod: { icon: Crosshair, grad: 'from-orange-500 to-red-600', label: 'Call of Duty' },
  brawl: { icon: Gem, grad: 'from-amber-400 to-yellow-500', label: 'Brawl Stars' },
  apex: { icon: Crosshair, grad: 'from-red-500 to-rose-800', label: 'Apex Legends' },
  valorant: { icon: Crosshair, grad: 'from-rose-500 to-red-600', label: 'Valorant' },
  genshin: { icon: Sparkles, grad: 'from-cyan-400 to-indigo-500', label: 'Genshin Impact' },
  clash: { icon: Gem, grad: 'from-violet-500 to-blue-600', label: 'Clash of Clans' },
  clashroyale: { icon: Crown, grad: 'from-blue-500 to-indigo-600', label: 'Clash Royale' },
  league: { icon: Swords, grad: 'from-amber-400 to-yellow-600', label: 'League of Legends' },
  freefire: { icon: Diamond, grad: 'from-orange-400 to-amber-600', label: 'Free Fire' },
  pubg: { icon: Crosshair, grad: 'from-yellow-500 to-orange-600', label: 'PUBG Mobile' },
  mlbb: { icon: Diamond, grad: 'from-sky-400 to-blue-600', label: 'Mobile Legends' },
  eafc: { icon: Trophy, grad: 'from-green-500 to-emerald-600', label: 'EA FC / FIFA' },
  gta: { icon: Coins, grad: 'from-lime-400 to-green-600', label: 'GTA Online' },
  minecraft: { icon: Package, grad: 'from-emerald-600 to-green-800', label: 'Minecraft' },
  pokemongo: { icon: Coins, grad: 'from-yellow-400 to-red-500', label: 'Pokémon GO' },
  wow: { icon: Swords, grad: 'from-amber-500 to-yellow-700', label: 'World of Warcraft' },
  // ── Subscriptions ──────────────────────────────────────────────
  'discord-nitro': { icon: Crown, grad: 'from-indigo-500 to-violet-500', label: 'Discord Nitro' },
  nitro: { icon: Crown, grad: 'from-indigo-500 to-violet-500', label: 'Nitro' },
  spotify: { icon: Music, grad: 'from-green-400 to-green-600', label: 'Spotify' },
  netflix: { icon: Film, grad: 'from-red-600 to-rose-700', label: 'Netflix' },
  gamepass: { icon: Gamepad2, grad: 'from-green-500 to-emerald-700', label: 'Xbox Game Pass' },
  // ── Gift cards & wallets ───────────────────────────────────────
  steam: { icon: Gamepad2, grad: 'from-sky-500 to-blue-600', label: 'Steam' },
  playstation: { icon: Gamepad2, grad: 'from-blue-500 to-cyan-500', label: 'PlayStation' },
  xbox: { icon: Gamepad2, grad: 'from-green-500 to-emerald-500', label: 'Xbox' },
  nintendo: { icon: Gamepad2, grad: 'from-red-500 to-rose-600', label: 'Nintendo eShop' },
  amazon: { icon: ShoppingBag, grad: 'from-amber-400 to-orange-600', label: 'Amazon' },
  googleplay: { icon: Smartphone, grad: 'from-emerald-400 to-teal-600', label: 'Google Play' },
  itunes: { icon: Smartphone, grad: 'from-pink-500 to-fuchsia-600', label: 'App Store & iTunes' },
  giftcard: { icon: Gift, grad: 'from-pink-500 to-rose-500', label: 'Gift Cards' },
  subscription: { icon: Ticket, grad: 'from-amber-500 to-orange-500', label: 'Subscriptions' },
};

export function categoryVisual(category) {
  const key = String(category || '').toLowerCase();
  return MAP[key] || { icon: Package, grad: 'from-slate-500 to-slate-700', label: category || 'Other' };
}

export const money = (cents, cur = 'EUR') =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format((cents || 0) / 100);

export { CreditCard };
