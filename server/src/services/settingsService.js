/**
 * Tiny persisted settings store on the generic `kv` table. Values are JSON.
 * Used for owner-configurable bits that aren't worth their own table — e.g. the
 * per-category logo map the storefront renders.
 */
import { run, get, nowIso } from '../db/index.js';

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

/** Set (image truthy) or clear (image falsy) one category's logo. */
export async function setCategoryLogo(slug, image) {
  const logos = await getCategoryLogos();
  if (image) logos[slug] = image; else delete logos[slug];
  return setSetting(CATEGORY_LOGOS, logos);
}
