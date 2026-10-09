/**
 * Product image helpers — what counts as a safe image value, an SSRF guard for
 * server-side fetches, and a resolver that turns a page link (e.g. a Pinterest
 * pin) into the real image URL behind it.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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
    res = await publicFetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ForgeMarketBot/1.0; +https://forgemarket.nl)',
        Accept: 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8',
      },
    }, fetchImpl);
  } catch (e) {
    if (e?.status === 400) throw e;
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

/* ── Server-side fetches of links someone typed in ─────────────────────────
   The hostname check above is only text: `metadata.example.com` can resolve to
   169.254.169.254, and a public page can redirect to http://127.0.0.1. These
   resolve the name and check every hop of a redirect. */

/* An IPv6 address as its eight 16-bit groups, or null. */
function ipv6Groups(a) {
  if (isIP(a) !== 6) return null;
  let s = a;
  // A dotted IPv4 tail (::ffff:127.0.0.1) becomes its two hex groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const [p, q, r, t] = tail[1].split('.').map(Number);
    s = s.slice(0, -tail[1].length) + `${((p << 8) | q).toString(16)}:${((r << 8) | t).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const h = head ? head.split(':') : [];
  const r = rest !== undefined ? (rest ? rest.split(':') : []) : null;
  const groups = r === null ? h : [...h, ...Array(8 - h.length - r.length).fill('0'), ...r];
  return groups.length === 8 ? groups.map((g) => parseInt(g || '0', 16)) : null;
}

/* The IPv4 address an IPv6 one carries, if it is one of the forms that reach
   an IPv4 host: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d) and NAT64
   (64:ff9b::a.b.c.d). A URL parser writes [::ffff:127.0.0.1] as
   [::ffff:7f00:1], which a dotted-only check reads as a public address — the
   cloud metadata service at [::ffff:a9fe:a9fe] included. */
function embeddedIPv4(g) {
  const zero5 = g.slice(0, 5).every((x) => x === 0);
  const mapped = zero5 && g[5] === 0xffff;
  const compatible = zero5 && g[5] === 0 && (g[6] || g[7] > 1); // not :: or ::1
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (!mapped && !compatible && !nat64) return null;
  return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
}

export function isPrivateAddress(ip) {
  const a = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (isIP(a) === 4) {
    const [x, y] = a.split('.').map(Number);
    return x === 0 || x === 10 || x === 127 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31)
      || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || x >= 224;
  }
  const g = ipv6Groups(a);
  if (g) {
    const v4 = embeddedIPv4(g);
    if (v4) return isPrivateAddress(v4);
    if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1)) return true; // :: and ::1
    const first = g[0];
    return (first & 0xfe00) === 0xfc00 // fc00::/7 unique local
      || (first & 0xffc0) === 0xfe80 // fe80::/10 link-local
      || (first & 0xffc0) === 0xfec0 // fec0::/10 old site-local
      || (first & 0xff00) === 0xff00 // multicast
      || (first === 0x2001 && g[1] === 0x0db8); // documentation
  }
  return true; // not an address at all — refuse rather than guess
}

/** Throws unless the link is http(s) AND its host resolves only to public addresses. */
export async function assertPublicTarget(input) {
  const u = assertPublicHttpUrl(input);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw badRequest('That host could not be found.');
  if (addrs.some((x) => isPrivateAddress(x.address))) throw badRequest('That host is not allowed.');
  return u;
}

/**
 * fetch() for a user-supplied link: every hop (max 4 redirects) is checked
 * with assertPublicTarget. A test double passed as fetchImpl is trusted as is —
 * the guard is about the real network.
 */
export async function publicFetch(url, init = {}, fetchImpl = fetch) {
  if (fetchImpl !== globalThis.fetch) return fetchImpl(url, init);
  let current = String(url);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicTarget(current);
    const res = await fetchImpl(current, { ...init, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return res;
    /* What fetch itself would do: a 303, or a 301/302 after a POST, continues
       as a GET without the body — never the same POST again at a new address. */
    const method = String(init.method || 'GET').toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      const { body: _drop, ...rest } = init;
      init = { ...rest, method: 'GET' };
    }
    current = new URL(loc, current).toString();
  }
  throw badRequest('Too many redirects.');
}
