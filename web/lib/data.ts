export type Product = {
  id: string;
  name: string;
  category: string;
  price: number; // EUR cents
  image: string;
  rating: number;
  reviews: number;
  delivery: string;
  badge?: 'Bestseller' | 'Hot' | 'New' | 'Value';
};

export const CATEGORIES = [
  { key: 'robux', label: 'Robux', color: 'from-emerald-500 to-teal-500' },
  { key: 'v-bucks', label: 'V-Bucks', color: 'from-violet-500 to-blue-600' },
  { key: 'cod', label: 'Call of Duty', color: 'from-orange-500 to-red-600' },
  { key: 'valorant', label: 'Valorant', color: 'from-rose-500 to-red-600' },
  { key: 'apex', label: 'Apex Legends', color: 'from-red-500 to-rose-800' },
  { key: 'genshin', label: 'Genshin', color: 'from-cyan-400 to-indigo-500' },
  { key: 'brawl', label: 'Brawl Stars', color: 'from-amber-400 to-yellow-500' },
  { key: 'clash', label: 'Clash of Clans', color: 'from-violet-500 to-blue-600' },
];

// Bundled sample catalog — keeps the storefront looking complete even before the
// live API is wired in. Prices mirror the main app (Eldorado-aligned, +€2).
export const SAMPLE_PRODUCTS: Product[] = [
  { id: 'robux-1000', name: '1,000 Robux', category: 'robux', price: 999, image: '/products/packs/robux-1000.svg', rating: 4.9, reviews: 2143, delivery: 'Instant', badge: 'Bestseller' },
  { id: 'robux-4500', name: '4,500 Robux', category: 'robux', price: 3599, image: '/products/packs/robux-4500.svg', rating: 4.9, reviews: 1380, delivery: 'Instant', badge: 'Value' },
  { id: 'robux-10000', name: '10,000 Robux', category: 'robux', price: 7399, image: '/products/packs/robux-10000.svg', rating: 4.8, reviews: 712, delivery: 'Instant' },
  { id: 'vbucks-2800', name: '2,800 V-Bucks', category: 'v-bucks', price: 1399, image: '/products/packs/vbucks-2800.svg', rating: 4.9, reviews: 1890, delivery: 'Instant', badge: 'Hot' },
  { id: 'vbucks-13500', name: '13,500 V-Bucks', category: 'v-bucks', price: 3699, image: '/products/packs/vbucks-13500.svg', rating: 4.8, reviews: 640, delivery: 'Instant' },
  { id: 'cod-5000', name: '5,000 CP — Call of Duty', category: 'cod', price: 4499, image: '/products/packs/cod-5000.svg', rating: 4.8, reviews: 521, delivery: 'Instant', badge: 'Hot' },
  { id: 'cod-21000', name: '21,000 CP — Call of Duty', category: 'cod', price: 15999, image: '/products/packs/cod-21000.svg', rating: 4.9, reviews: 188, delivery: 'Instant' },
  { id: 'valorant-3650', name: '3,650 VP — Valorant', category: 'valorant', price: 3199, image: '/products/packs/valorant-3650.svg', rating: 4.9, reviews: 933, delivery: 'Instant', badge: 'Bestseller' },
  { id: 'apex-4350', name: '4,350 Apex Coins', category: 'apex', price: 3699, image: '/products/packs/apex-4350.svg', rating: 4.7, reviews: 410, delivery: 'Instant' },
  { id: 'genshin-1980', name: '1,980 Genesis Crystals', category: 'genshin', price: 2999, image: '/products/packs/genshin-1980.svg', rating: 4.9, reviews: 1204, delivery: 'Instant', badge: 'Hot' },
  { id: 'genshin-6480', name: '6,480 Genesis Crystals', category: 'genshin', price: 9499, image: '/products/packs/genshin-6480.svg', rating: 4.8, reviews: 333, delivery: 'Instant' },
  { id: 'brawl-950', name: '950 Gems — Brawl Stars', category: 'brawl', price: 1799, image: '/products/packs/brawl-950.svg', rating: 4.8, reviews: 760, delivery: 'Instant', badge: 'New' },
  { id: 'clash-2500', name: '2,500 Gems — Clash of Clans', category: 'clash', price: 1999, image: '/products/packs/clash-2500.svg', rating: 4.7, reviews: 288, delivery: 'Instant' },
  { id: 'valorant-5350', name: '5,350 VP — Valorant', category: 'valorant', price: 4499, image: '/products/packs/valorant-5350.svg', rating: 4.8, reviews: 209, delivery: 'Instant' },
  { id: 'apex-11500', name: '11,500 Apex Coins', category: 'apex', price: 8999, image: '/products/packs/apex-11500.svg', rating: 4.9, reviews: 96, delivery: 'Instant', badge: 'Value' },
  { id: 'robux-22500', name: '22,500 Robux', category: 'robux', price: 15699, image: '/products/packs/robux-22500.svg', rating: 4.9, reviews: 144, delivery: 'Instant' },
];

export const money = (cents: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
