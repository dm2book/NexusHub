/**
 * Where market data may come from, and on what basis.
 *
 * ── THE POSITION THIS FILE TAKES ──────────────────────────────────────────
 * Scraping a marketplace's listings is not a technical question with a legal
 * footnote; it is a legal question with a technical footnote. Nearly every
 * marketplace in this space forbids automated collection of its listings in its
 * terms of service, and several publish a robots.txt that says so as well.
 * Those two facts are independent: robots.txt allowing a path does not grant a
 * licence to copy what is on it, and a permissive robots.txt on a site whose
 * terms forbid crawling means the terms win.
 *
 * So every source below declares:
 *
 *   legalBasis          what actually permits this, in one sentence
 *   requiresCredentials whether it needs an agreement/API key from the owner
 *   status              available | unavailable | disabled
 *   statusReason        why, in words a non-lawyer can act on
 *
 * and a source with no credentials configured reports UNAVAILABLE. It does not
 * fall back to fetching the public site. There is no code path in this system
 * that scrapes a marketplace's HTML, because that is the code path that would
 * have to be reviewed by somebody who cannot review it.
 *
 * ── WHAT IS ACTUALLY AVAILABLE TODAY ──────────────────────────────────────
 * Eldorado and G2A both operate partner APIs behind an agreement. This shop
 * already has connector plumbing for both (services/supplier/), so if the owner
 * holds those credentials the same keys are reused here — and if not, the source
 * says UNAVAILABLE rather than reaching for the public website.
 *
 * The always-available source is `manual`: prices a human looked up and typed
 * in, or a CSV export a marketplace gave the owner for their own account. It is
 * the least glamorous input and the only one that is unambiguously permitted
 * for any site, which is why the whole engine is built to work from it alone.
 *
 * Publisher stores (EA, Roblox, Microsoft, Sony, Nintendo) publish recommended
 * retail prices on pages whose terms forbid automated collection. They are
 * defined here as `official` reference sources so a human-entered RRP has a
 * proper home in the model, and they are NOT auto-fetched.
 */
import { config } from '../../config/env.js';
import { all, get, run, nowIso } from '../../db/index.js';
import { isAllowed } from './robots.js';

/** Thrown when a source may not be queried. Carries the reason for the report. */
export class SourceUnavailable extends Error {
  constructor(key, reason) { super(`${key}: ${reason}`); this.key = key; this.reason = reason; }
}

/**
 * A source adapter.
 *
 * fetchOffers() returns raw offers; it never writes to the database and never
 * normalizes — that is discovery's job — so an adapter stays small enough to be
 * read in one sitting and swapped when a partner changes their API.
 */
export const SOURCES = [
  {
    key: 'manual',
    label: 'Manual / owner-supplied',
    kind: 'manual',
    requiresCredentials: false,
    legalBasis:
      'Prices a person looked up by hand, or an export a marketplace provided for '
      + 'the owner\'s own account. No automated collection, so no site\'s terms are engaged.',
    termsUrl: null,
    robotsUrl: null,
    /* Nothing to fetch: observations arrive through POST /api/admin/market/observations
       or a CSV import. Always available, and the reason the rest of the system
       is useful before any partner agreement exists. */
    available: () => ({ ok: true, reason: 'always available — entries are supplied, not collected' }),
    fetchOffers: async () => [],
  },

  {
    key: 'eldorado',
    label: 'Eldorado.gg (partner API)',
    kind: 'api',
    requiresCredentials: true,
    legalBasis:
      'Eldorado operates an access-gated partner API. Use is permitted by the API '
      + 'agreement the account holder signs — not by anything on the public website.',
    termsUrl: 'https://www.eldorado.gg/terms-of-service',
    robotsUrl: 'https://www.eldorado.gg/robots.txt',
    available: (creds) => (creds?.apiKey
      ? { ok: true, reason: 'partner API key configured' }
      : { ok: false, reason: 'no Eldorado partner API key. The public site is NOT a fallback — its terms forbid automated collection.' }),
    /**
     * The offer shape is deliberately whatever the partner API returns, mapped
     * to this system's fields and nothing more. Field names follow Eldorado's
     * documented listing contract and are centralised here so an account whose
     * response differs can be tuned without touching discovery or pricing.
     */
    fetchOffers: async ({ creds, query, fetchImpl = fetch }) => {
      const base = (creds.baseUrl || 'https://api.eldorado.gg').replace(/\/$/, '');
      const url = `${base}/v1/marketplace/offers?query=${encodeURIComponent(query)}&pageSize=100`;
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${creds.apiKey}`, Accept: 'application/json',
          'User-Agent': config.market.userAgent },
      });
      if (!res.ok) throw new Error(`Eldorado API HTTP ${res.status}`);
      const data = await res.json();
      return (data?.results || data?.items || []).map((o) => ({
        sourceProductId: String(o.id ?? o.offerId ?? ''),
        title: String(o.title ?? o.name ?? ''),
        priceCents: Math.round(Number(o.price?.amount ?? o.price ?? 0) * 100),
        currency: String(o.price?.currency ?? o.currency ?? 'USD').toUpperCase(),
        availability: o.inStock === false ? 'out_of_stock' : (o.quantity > 0 ? 'in_stock' : 'unknown'),
        url: o.url || `${base}/offer/${o.id ?? ''}`,
        hints: { platformRaw: o.platform || '', region: (o.region || '').toLowerCase() || undefined },
      }));
    },
  },

  {
    key: 'g2a',
    label: 'G2A (Import API)',
    kind: 'api',
    requiresCredentials: true,
    legalBasis:
      'G2A publishes a documented Import API for accounts that have signed its '
      + 'integration agreement. That agreement is the permission; the public storefront is not.',
    termsUrl: 'https://www.g2a.com/terms-and-conditions',
    robotsUrl: 'https://www.g2a.com/robots.txt',
    available: (creds) => ((creds?.apiHash && creds?.apiKey && creds?.email)
      ? { ok: true, reason: 'Import API credentials configured' }
      : { ok: false, reason: 'no G2A Import API credentials (apiHash, apiKey, email). Public pages are NOT a fallback.' }),
    fetchOffers: async ({ creds, query, fetchImpl = fetch }) => {
      const { createHash } = await import('node:crypto');
      const token = createHash('sha256').update(`${creds.apiHash}${creds.email}${creds.apiKey}`).digest('hex');
      const base = (creds.baseUrl || 'https://api.g2a.com').replace(/\/$/, '');
      const res = await fetchImpl(`${base}/v1/products?minQty=1&title=${encodeURIComponent(query)}`, {
        headers: { Authorization: `${creds.apiHash}, ${token}`, Accept: 'application/json',
          'User-Agent': config.market.userAgent },
      });
      if (!res.ok) throw new Error(`G2A API HTTP ${res.status}`);
      const data = await res.json();
      return (data?.docs || data?.items || []).map((p) => ({
        sourceProductId: String(p.id ?? ''),
        title: String(p.name ?? ''),
        priceCents: Math.round(Number(p.minPrice ?? p.retail_min_price ?? 0) * 100),
        currency: String(p.currency || 'EUR').toUpperCase(),
        availability: Number(p.qty ?? 0) > 0 ? 'in_stock' : 'out_of_stock',
        url: p.slug ? `https://www.g2a.com/${p.slug}` : (p.url || 'https://www.g2a.com/'),
        hints: { platformRaw: p.platform || '', region: (p.region || '').toLowerCase() || undefined },
      }));
    },
  },

  /* ── Publisher reference prices ──────────────────────────────────────────
     Defined so an official RRP has a home in the data model, and marked as
     never-automated so nobody later mistakes the absence of a fetcher for an
     oversight. A human types the publisher's own listed price; the engine then
     has a reference that is not a competitor. */
  ...['ea', 'roblox', 'microsoft', 'sony', 'nintendo', 'mojang', 'niantic'].map((vendor) => ({
    key: `official:${vendor}`,
    label: `${vendor.toUpperCase()} store (reference price, entered by hand)`,
    kind: 'manual',
    requiresCredentials: false,
    isOfficial: true,
    legalBasis:
      'Publisher storefronts do not offer a public price API and their terms forbid '
      + 'automated collection. Reference prices are entered by a person.',
    termsUrl: null,
    robotsUrl: null,
    available: () => ({ ok: true, reason: 'reference prices are entered by hand' }),
    fetchOffers: async () => [],
    neverAutomated: true,
  })),
];

export const bySourceKey = (key) => SOURCES.find((s) => s.key === key) || null;

/**
 * Credentials for a source, taken from the supplier the owner already
 * configured where one exists — so an Eldorado key is entered once, not twice.
 */
export async function credentialsFor(key) {
  if (key === 'eldorado' || key === 'g2a') {
    const row = await get(
      `SELECT config FROM suppliers WHERE connector_kind=@k AND status='active' ORDER BY created_at LIMIT 1`,
      { k: key }).catch(() => null);
    if (!row) return null;
    try { return JSON.parse(row.config || '{}'); } catch { return null; }
  }
  return null;
}

/**
 * The live state of every source: may we use it, and why not.
 *
 * This is what the admin dashboard renders and what the discovery job obeys. A
 * source is usable only when ALL of these hold — the owner enabled it, it has
 * credentials, and (for anything that touches the open web) robots.txt allows
 * it. Any one missing produces UNAVAILABLE with the reason attached.
 */
export async function sourceStatuses({ checkRobots = false } = {}) {
  const enabled = new Set(config.market.enabledSources);
  const out = [];
  for (const s of SOURCES) {
    const creds = s.requiresCredentials ? await credentialsFor(s.key) : null;
    const avail = s.available(creds);
    let status = 'unavailable';
    let reason = avail.reason;

    if (!avail.ok) status = 'unavailable';
    else if (s.requiresCredentials && !enabled.has(s.key)) {
      status = 'disabled';
      reason = `credentials are present but ${s.key} is not in MARKET_SOURCES — switch it on deliberately`;
    } else status = 'available';

    let robots = null;
    if (checkRobots && s.robotsUrl && status === 'available') {
      robots = await isAllowed(s.robotsUrl.replace(/\/robots\.txt$/, '/'));
      if (!robots.allowed) { status = 'unavailable'; reason = `robots.txt: ${robots.reason}`; }
    }

    out.push({
      key: s.key, label: s.label, kind: s.kind, isOfficial: !!s.isOfficial,
      neverAutomated: !!s.neverAutomated,
      requiresCredentials: s.requiresCredentials, legalBasis: s.legalBasis,
      termsUrl: s.termsUrl, robotsUrl: s.robotsUrl,
      robotsAllows: robots ? robots.allowed : null,
      status, statusReason: reason,
    });
  }
  return out;
}

/** Mirror the computed state into market_sources so the dashboard has history. */
export async function persistSourceStatuses(statuses) {
  const at = nowIso();
  for (const s of statuses) {
    await run(
      `INSERT INTO market_sources (key, label, kind, legal_basis, terms_url, robots_url,
                                   robots_allows, robots_checked_at, requires_credentials,
                                   status, status_reason, enabled, created_at, updated_at)
       VALUES (@key,@label,@kind,@legal,@terms,@robots,@allows,@checked,@needs,@status,@reason,@enabled,@at,@at)
       ON CONFLICT (key) DO UPDATE SET
         label=@label, kind=@kind, legal_basis=@legal, terms_url=@terms, robots_url=@robots,
         robots_allows=COALESCE(@allows, market_sources.robots_allows),
         robots_checked_at=COALESCE(@checked, market_sources.robots_checked_at),
         requires_credentials=@needs, status=@status, status_reason=@reason,
         enabled=@enabled, updated_at=@at`,
      { key: s.key, label: s.label, kind: s.kind, legal: s.legalBasis,
        terms: s.termsUrl, robots: s.robotsUrl,
        allows: s.robotsAllows == null ? null : (s.robotsAllows ? 1 : 0),
        checked: s.robotsAllows == null ? null : at,
        needs: s.requiresCredentials ? 1 : 0,
        status: s.status, reason: s.statusReason,
        enabled: s.status === 'available' ? 1 : 0, at });
  }
  return statuses.length;
}

/** Fetch offers from one source, refusing rather than improvising. */
export async function fetchFromSource(key, query, { fetchImpl = fetch } = {}) {
  const src = bySourceKey(key);
  if (!src) throw new SourceUnavailable(key, 'unknown source');
  if (src.neverAutomated) throw new SourceUnavailable(key, 'this source is never fetched automatically — enter prices by hand');
  const creds = src.requiresCredentials ? await credentialsFor(key) : null;
  const avail = src.available(creds);
  if (!avail.ok) throw new SourceUnavailable(key, avail.reason);
  if (src.requiresCredentials && !config.market.enabledSources.includes(key)) {
    throw new SourceUnavailable(key, `not listed in MARKET_SOURCES`);
  }
  return src.fetchOffers({ creds: creds || {}, query, fetchImpl });
}
