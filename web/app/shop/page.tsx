import type { Metadata } from 'next';
import { getProducts } from '../../lib/api';
import ShopGrid from '../../components/ShopGrid';

export const metadata: Metadata = {
  title: 'Shop — ForgeMarket',
  description: 'Browse game currency, top-ups and gift cards with instant delivery.',
};

export default async function ShopPage() {
  const products = await getProducts();
  return (
    <div className="container-x pt-28 pb-20">
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] p-8 sm:p-10 mb-8">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="orb w-72 h-72 bg-primary/20 -top-24 right-10" />
        <div className="relative">
          <span className="eyebrow">Marketplace</span>
          <h1 className="text-3xl sm:text-5xl mt-4">Shop</h1>
          <p className="text-slate-400 mt-2">Instant, buyer-protected delivery on every order.</p>
        </div>
      </div>
      <ShopGrid products={products} />
    </div>
  );
}
