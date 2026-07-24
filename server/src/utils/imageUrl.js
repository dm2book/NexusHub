/**
 * Product image helpers — what counts as a safe image value, an SSRF guard for
 * server-side fetches, and a resolver that turns a page link (e.g. a Pinterest
 * pin) into the real image URL behind it.
 */
import { badRequest } from './errors.js';

// Raster data URIs only (an <img> renders these inertly). SVG is intentionally
// excluded — it can carry scripts. Capped so an upload can't bloat a DB row.
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i;
const MAX_DATA_URI = 2_500_000; // stays under the 3mb JSON body limit (with room for other fields)

/** True for values we allow as a product image `src`. */
export function isSafeImageValue(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (v.startsWith('/') && !v.startsWith('//')) return true;          // same-origin path
  if (/^https?:\/\/.+/i.test(v)) return true;                          // remote link
  if (v.length <= MAX_DATA_URI && DATA_IMAGE_RE.test(v)) return true;  // uploaded image
  return false;
}

export function assertSafeImageValue(value) {
  if (!isSafeImageValue(value)) {
    throw badRequest('Image must be a http(s) link, an uploaded image, or a site path.');
  }
}

// Block obvious internal/loopback targets so the resolver can't be pointed at
// the metadata service or a private host (defence in depth — admin only).
const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|\[?::1\]?|fc00:|fe80:)/i;

export function assertPublicHttpUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { throw badRequest('That is not a valid link.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest('Link must start with http(s)://');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (PRIVATE_HOST.test(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    throw badRequest('That host is not allowed.');
  }
  return u;
}

/** Pull the sharing image out of a page's HTML (og:image / twitter:image). */
export function extractOgImage(html) {
  const s = String(html || '');
  const pick = (re) => { const m = s.match(re); return m ? m[1].trim() : null; };
  return (
    pick(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["']/i) ||
    pick(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i) ||
    null
  );
}

/**
 * Resolve an arbitrary link to a direct image URL. If the link is already an
 * image it is returned as-is; if it's an HTML page (Pinterest pin, tweet, …)
 * the og:image is returned. Best-effort: falls back to the original on miss.
 */
export async function resolveImageUrl(input, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  assertPublicHttpUrl(input);
  const url = String(input).trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ForgeMarketBot/1.0; +https://forgemarket.nl)',
        Accept: 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8',
      },
    });
  } catch {
    throw badRequest('Could not open that link. Paste a direct image URL or upload the image.');
  } finally {
    clearTimeout(timer);
  }

  const finalUrl = res.url || url;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.startsWith('image/')) return finalUrl; // already a direct image

  if (!ct || ct.includes('html') || ct.includes('xml')) {
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > 5_000_000) throw badRequest('That page is too large to read.');
    let html = '';
    try { html = (await res.text()).slice(0, 1_000_000); } catch { html = ''; }
    let og = extractOgImage(html);
    if (og) {
      try { og = new URL(og, finalUrl).toString(); } catch { og = null; }
      if (og) { assertPublicHttpUrl(og); return og; }
    }
    throw badRequest('No image found on that page. Paste a direct image URL or upload the image.');
  }
  return finalUrl;
}
