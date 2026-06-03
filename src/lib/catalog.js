import {
  Gamepad2, Gift, Coins, Crown, Sparkles, Ticket, CreditCard, Package,
} from 'lucide-react';

// Visual treatment per category — gradient + icon used across the storefront.
const MAP = {
  robux: { icon: Coins, grad: 'from-emerald-500 to-teal-500', label: 'Robux' },
  'discord-nitro': { icon: Crown, grad: 'from-indigo-500 to-violet-500', label: 'Discord Nitro' },
  nitro: { icon: Crown, grad: 'from-indigo-500 to-violet-500', label: 'Nitro' },
  playstation: { icon: Gamepad2, grad: 'from-blue-500 to-cyan-500', label: 'PlayStation' },
  xbox: { icon: Gamepad2, grad: 'from-green-500 to-emerald-500', label: 'Xbox' },
  steam: { icon: Gamepad2, grad: 'from-sky-500 to-blue-600', label: 'Steam' },
  'v-bucks': { icon: Sparkles, grad: 'from-purple-500 to-fuchsia-500', label: 'V-Bucks' },
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
