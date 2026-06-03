/**
 * OPTIONAL demo catalog seeder — run explicitly with `npm run seed:demo`.
 *
 * This is NOT part of the normal setup and is never run automatically. It just
 * gives a fresh install a realistic-looking storefront to show off. Safe to run
 * repeatedly (skips SKUs that already exist). Delete the products anytime from
 * the admin console.
 */
import { run, get, nowIso } from './index.js';
import { migrate } from './migrate.js';
import { newId } from '../utils/ids.js';

// price is in minor units (cents).
const CATALOG = [
  { sku: 'ROBUX-800', name: '800 Robux', category: 'robux', price: 999, featured: true,
    description: 'Top up 800 Robux to your Roblox account instantly.' },
  { sku: 'ROBUX-1700', name: '1,700 Robux', category: 'robux', price: 1999,
    description: 'Get 1,700 Robux delivered as a redeemable code.' },
  { sku: 'ROBUX-4500', name: '4,500 Robux', category: 'robux', price: 4999, featured: true,
    description: 'Best value Robux pack for serious builders.' },

  { sku: 'NITRO-1M', name: 'Discord Nitro — 1 Month', category: 'discord-nitro', price: 999,
    description: 'Full Nitro for a month: HD streaming, emojis, boosts.' },
  { sku: 'NITRO-1Y', name: 'Discord Nitro — 1 Year', category: 'discord-nitro', price: 9999, featured: true,
    description: 'A full year of Discord Nitro at the best price.' },

  { sku: 'STEAM-10', name: 'Steam Wallet €10', category: 'steam', price: 1099,
    description: 'Add €10 to your Steam Wallet via redeem code.' },
  { sku: 'STEAM-25', name: 'Steam Wallet €25', category: 'steam', price: 2599, featured: true,
    description: 'Add €25 to your Steam Wallet via redeem code.' },
  { sku: 'STEAM-50', name: 'Steam Wallet €50', category: 'steam', price: 5099,
    description: 'Add €50 to your Steam Wallet via redeem code.' },

  { sku: 'PSN-25', name: 'PlayStation Store €25', category: 'playstation', price: 2599,
    description: 'PSN gift card for games, DLC and PS Plus.' },
  { sku: 'XBOX-25', name: 'Xbox Gift Card €25', category: 'xbox', price: 2599,
    description: 'Spend on games and add-ons across Xbox & PC.' },

  { sku: 'VBUCKS-2800', name: '2,800 V-Bucks', category: 'v-bucks', price: 1999, featured: true,
    description: 'Fortnite V-Bucks for skins, the Battle Pass and more.' },
  { sku: 'VBUCKS-5000', name: '5,000 V-Bucks', category: 'v-bucks', price: 3499,
    description: 'A big stack of V-Bucks delivered instantly.' },
];

export async function seedDemoCatalog() {
  await migrate();
  let created = 0;
  for (const p of CATALOG) {
    const exists = await get('SELECT id FROM products WHERE sku = @sku', { sku: p.sku });
    if (exists) continue;
    const at = nowIso();
    await run(`INSERT INTO products
        (id, sku, name, category, description, price, currency, kind, active, metadata, created_at, updated_at)
       VALUES (@id, @sku, @name, @cat, @desc, @price, 'EUR', 'digital', 1, @meta, @at, @at)`, {
      id: newId('prd'), sku: p.sku, name: p.name, cat: p.category, desc: p.description,
      price: p.price, meta: JSON.stringify({ featured: !!p.featured }), at,
    });
    created++;
  }
  console.log(`Demo catalog: ${created} products created (${CATALOG.length - created} already existed).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemoCatalog().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
