import { SAMPLE_PRODUCTS, type Product } from './data';

const API = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Fetch live products from the ForgeMarket API when NEXT_PUBLIC_API_URL is set;
 * otherwise (or on any failure) return the bundled sample catalog so the UI is
 * always complete. Server-rendered with a short revalidate.
 */
export async function getProducts(): Promise<Product[]> {
  if (!API) return SAMPLE_PRODUCTS;
  try {
    const res = await fetch(`${API}/api/products`, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const list = (data.products || []) as any[];
    if (!list.length) return SAMPLE_PRODUCTS;
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || 'other',
      price: p.price,
      image: p.image || p.metadata?.image || '/products/robux.svg',
      rating: 4.8,
      reviews: 0,
      delivery: 'Instant',
      badge: p.featured ? 'Bestseller' : undefined,
    }));
  } catch {
    return SAMPLE_PRODUCTS;
  }
}
