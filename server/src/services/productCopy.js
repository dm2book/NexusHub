/**
 * Product descriptions for the API.
 *
 * The copy itself lives in src/lib/productCopy.js, which the storefront also
 * imports — the same arrangement brandMarks.js already uses. It was written
 * twice before, once here and once in the client's fallback catalogue, and the
 * two had drifted: the client had no `gta` entry, so a Shark Card served from
 * the fallback described itself as a generic top-up while the same product
 * from the API said what it actually was.
 */
import { describeProduct, COPY_LANGS, describedField } from '../../../src/lib/productCopy.js';

export { describeProduct };

/**
 * Attach a description in every language the shop is read in.
 *
 * A description typed in the admin stays authoritative and is read from
 * metadata per language, so a product can carry hand-written German without
 * carrying hand-written anything else; the generated copy fills each gap on
 * its own. Nothing here overwrites `description`, which is the English one the
 * row itself holds.
 */
export function withCopy(product) {
  const meta = product?.metadata || {};
  const typed = {};
  for (const lang of COPY_LANGS) {
    const field = describedField(lang);
    typed[field] = meta[field] ?? (lang === 'en' ? product?.description : null);
  }
  const out = { ...product };
  for (const lang of COPY_LANGS) {
    if (lang === 'en') continue;
    out[describedField(lang)] = describeProduct({ ...product, ...typed }, lang);
  }
  return out;
}
