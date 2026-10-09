/**
 * How the supplier connectors reach the outside world.
 *
 * Two things every supplier call needs, kept in one place so no connector can
 * leave one out:
 *
 *   A time limit. A supplier that never answers must not hold a paid order —
 *   or the function — until the platform kills it mid-purchase. The limit is
 *   the connector's own timeout, or less when the caller has a deadline: the
 *   supplier queue also runs inside a payment webhook, whose whole invocation
 *   Vercel ends at 30 seconds, and a purchase that outlives the invocation is
 *   killed half made.
 *
 *   A public destination. A supplier's base URL or feed URL is typed in by an
 *   admin and then fetched by this server. Unchecked, the "supplier" could be
 *   the cloud metadata service, a database port on localhost or anything else
 *   on the private network, read back through the test-connection button.
 *   The host is checked before the request and again on every redirect hop.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { assertPublicHttpUrl, isPrivateAddress } from '../../utils/imageUrl.js';
import { badRequest } from '../../utils/errors.js';

export const SUPPLIER_TIMEOUT_MS = Number(process.env.SUPPLIER_TIMEOUT_MS || 15_000);
const MAX_REDIRECTS = 4;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

/* IPv4 written as IPv6. A URL spells [::ffff:127.0.0.1] as [::ffff:7f00:1] once
   it is parsed, and isPrivateAddress only reads the dotted form — so to it the
   metadata service at [::ffff:a9fe:a9fe] was a public address. Read back as the
   IPv4 address it reaches. */
function asIPv4(ip) {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!m) return ip;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}
const isInside = (ip) => isPrivateAddress(asIPv4(String(ip).toLowerCase().replace(/^\[|\]$/g, '')));

/** A promise that fails when `signal` fires, so a slow DNS answer cannot outlast the call's time limit. */
const whenAborted = (signal) => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

/**
 * Throws unless `url` is an http(s) link to a public host: not by its name
 * (localhost, 10.x, 169.254.x, *.internal — assertPublicHttpUrl), not as an
 * address written in the URL, and not by any address the name resolves to.
 *
 * A name that does not resolve at all is let through, where assertPublicTarget
 * refuses it: there is nothing behind it to reach, so the request fails by
 * itself, a supplier saved before its DNS is live is not turned away, and the
 * made-up hosts the test doubles answer for keep working.
 */
export async function assertSupplierUrl(url, { signal } = {}) {
  const u = assertPublicHttpUrl(url);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addresses = [host];
  if (!isIP(host)) {
    const found = lookup(host, { all: true }).then((r) => r.map((a) => a.address), () => []);
    addresses = await (signal ? Promise.race([found, whenAborted(signal)]) : found);
  }
  if (addresses.some(isInside)) throw badRequest('That host is not allowed.');
  return u;
}

const LINK = /^(?:[a-z][a-z\d+.-]*:)?\/\/\S+$/i;
const LINK_KEY = /(url|uri)$/i;

/**
 * Every link in a supplier's config, checked before it is saved: a base URL,
 * a feed URL, and anything else written as a link (an absolute endpoint).
 * Throws badRequest naming the field. supplierFetch checks again at every
 * request — this is so the mistake is refused where it is made, rather than
 * at the first order.
 */
export async function assertSupplierConfigUrls(config, at = 'config') {
  for (const [key, value] of Object.entries(config || {})) {
    const where = `${at}.${key}`;
    if (value && typeof value === 'object') { await assertSupplierConfigUrls(value, where); continue; }
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || (!LINK.test(text) && !LINK_KEY.test(key))) continue;
    try { await assertSupplierUrl(text); } catch (e) { throw badRequest(`${where}: ${e.message}`); }
  }
}

const without = (headers, name) => Object.fromEntries(
  Object.entries(headers || {}).filter(([k]) => !name.test(k)));

/**
 * fetch() for a supplier call.
 *
 * `deadline` (epoch ms) cuts the call off when the caller's time is up, if
 * that comes before the connector's own `timeoutMs`. `checkHost` is for a host
 * that came from the supplier's config rather than from this code: it is then
 * checked (assertSupplierUrl) before the request and on every redirect, and
 * redirects are followed here, hop by hop, with the rules fetch itself applies
 * — after a 303, or a 301/302 answering a POST, the next request is a GET
 * without the body. publicFetch re-sends the body on every hop, which for a
 * purchase means placing it again.
 */
export async function supplierFetch(url, init = {}, { deadline = null, timeoutMs = SUPPLIER_TIMEOUT_MS, checkHost = true } = {}) {
  const limit = deadline ? Math.min(timeoutMs, deadline - Date.now()) : timeoutMs;
  const signal = AbortSignal.timeout(Math.max(1, limit));
  if (!checkHost) return fetch(url, { ...init, signal });

  let current = String(url);
  let { method = 'GET', headers = {}, body } = init;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSupplierUrl(current, { signal });
    const res = await fetch(current, { ...init, method, headers, body, signal, redirect: 'manual' });
    const location = REDIRECT.has(res.status) ? res.headers?.get?.('location') : null;
    if (!location) return res;
    try { await res.body?.cancel(); } catch { /* nothing left to free */ }
    const next = new URL(location, current);
    if (res.status === 303 ? method !== 'HEAD' : [301, 302].includes(res.status) && method === 'POST') {
      method = 'GET';
      body = undefined;
      headers = without(headers, /^content-/i);
    }
    // A supplier's credentials are for the supplier, not for wherever it points.
    if (next.origin !== new URL(current).origin) headers = without(headers, /^authorization$/i);
    current = next.toString();
  }
  throw badRequest('Too many redirects.');
}
