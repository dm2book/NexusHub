/**
 * Tiny persisted settings store on the generic `kv` table. Values are JSON.
 * Used for owner-configurable bits that aren't worth their own table — e.g. the
 * per-category logo map the storefront renders.
 */
import { run, get, nowIso } from '../db/index.js';
import { normalizeImageValue } from './imageStoreService.js';

export async function getSetting(key, fallback = null) {
  const row = await get('SELECT value FROM kv WHERE key = @k', { k: key });
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

export async function setSetting(key, value) {
  await run(
    `INSERT INTO kv (key, value, updated_at) VALUES (@k, @v, @at)
     ON CONFLICT (key) DO UPDATE SET value = @v, updated_at = @at`,
    { k: key, v: JSON.stringify(value), at: nowIso() });
  return value;
}

const CATEGORY_LOGOS = 'category_logos';

/** Map of { categorySlug: imageValue } the owner has set (never null). */
export async function getCategoryLogos() {
  const v = await getSetting(CATEGORY_LOGOS, {});
  return v && typeof v === 'object' ? v : {};
}

/**
 * Set (image truthy) or clear (image falsy) one category's logo.
 *
 * An uploaded picture arrives as a base64 data: URI, and this used to store it
 * that way. Product photos stopped doing that a long time ago — they go into
 * product_images and keep a URL — but the category logos were never moved, and
 * they are read from a hotter place than any product: /api/config, which the
 * storefront fetches on EVERY page load.
 *
 * Measured on the live site: /api/config was 1 328 996 bytes, of which
 * 1 328 498 were sixteen base64 logos, served `cache-control: max-age=0`. So a
 * visitor on a phone downloaded 1.3 MB of pictures — again on the next page,
 * because JSON embedding them cannot be cached per image — to render sixteen
 * 24-pixel icons.
 *
 * Through the image store the same bytes get a content-addressed URL and a
 * one-year immutable cache header, and the config shrinks to the size of the
 * sixteen paths.
 */
export async function setCategoryLogo(slug, image) {
  const logos = await getCategoryLogos();
  if (image) {
    const { value } = await normalizeImageValue(image, { source: 'category-logo' });
    logos[slug] = value;
  } else delete logos[slug];
  return setSetting(CATEGORY_LOGOS, logos);
}

/**
 * Move logos that are still data: URIs into the image store.
 *
 * For the ones already saved — writing the new code does nothing for a shop
 * whose sixteen logos went in last month. Idempotent twice over: the image
 * store is addressed by content, so a repeat resolves to the same row and the
 * same URL, and a map with nothing left to move is not written at all.
 */
export async function migrateCategoryLogos() {
  const logos = await getCategoryLogos();
  const next = { ...logos };
  let moved = 0;
  let freedBytes = 0;
  for (const [slug, value] of Object.entries(logos)) {
    if (typeof value !== 'string' || !value.startsWith('data:')) continue;
    try {
      const stored = await normalizeImageValue(value, { source: 'category-logo' });
      if (!stored.stored) continue;
      next[slug] = stored.value;
      freedBytes += value.length;
      moved += 1;
    } catch { /* one unreadable logo must not stop the other fifteen */ }
  }
  if (moved) await setSetting(CATEGORY_LOGOS, next);
  return { moved, freedBytes };
}
