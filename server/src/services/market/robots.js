/**
 * robots.txt, honoured rather than mentioned.
 *
 * This module exists so that "we respect robots.txt" is a property of the code
 * and not a sentence in a README. Nothing in this system may fetch a page from
 * a competitor without asking here first, and the answer is FAIL CLOSED: if the
 * file cannot be read, cannot be parsed, or the request errors, the answer is
 * no. A permissive default would mean one flaky DNS lookup is the difference
 * between polite and not.
 *
 * It implements the parts of the original robots.txt convention that carry
 * meaning for a crawler like this one: User-agent groups (most specific match
 * wins over `*`), Allow and Disallow with longest-match-wins, and Crawl-delay.
 * Wildcards `*` and end-anchors `$` are supported because real files use them.
 *
 * What this module is NOT is permission. robots.txt allowing a path says the
 * site's operator did not machine-forbid it; it does not grant a licence to
 * copy their content, and it does not override their terms of service. That
 * second question is answered per source in sources.js, by a human, in writing.
 */
import { config } from '../../config/env.js';

const TTL_MS = 6 * 60 * 60 * 1000;      // re-read robots.txt every six hours
const cache = new Map();                 // origin → { rules, fetchedAt, ok, error }

/** Turn a robots.txt path pattern into an anchored regular expression. */
function toRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

export function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group of rules.
      if (!current || current.rules.length || current.crawlDelay != null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) {
      // "Disallow:" with an empty value means "nothing is disallowed".
      if (field === 'disallow' && value === '') continue;
      current.rules.push({ allow: field === 'allow', path: value, re: toRegex(value) });
    } else if (current && field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }
  return groups;
}

/** The group that applies to us: an exact agent match beats the `*` group. */
function groupFor(groups, userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  let star = null, best = null, bestLen = -1;
  for (const g of groups) {
    for (const a of g.agents) {
      if (a === '*') { star = star || g; continue; }
      if (ua.includes(a) && a.length > bestLen) { best = g; bestLen = a.length; }
    }
  }
  return best || star || null;
}

/** Longest matching rule wins; Allow wins a tie. That is the documented order. */
export function decide(groups, path, userAgent) {
  const g = groupFor(groups, userAgent);
  if (!g) return { allowed: true, rule: null, crawlDelay: null };
  let winner = null;
  for (const r of g.rules) {
    if (!r.re.test(path)) continue;
    if (!winner
      || r.path.length > winner.path.length
      || (r.path.length === winner.path.length && r.allow && !winner.allow)) winner = r;
  }
  return { allowed: winner ? winner.allow : true, rule: winner?.path || null, crawlDelay: g.crawlDelay };
}

/**
 * May we fetch this URL?
 *
 * @returns {Promise<{allowed: boolean, reason: string, crawlDelay: number|null}>}
 */
export async function isAllowed(url, { userAgent = config.market.userAgent, fetchImpl = fetch } = {}) {
  let u;
  try { u = new URL(url); } catch { return { allowed: false, reason: 'not a URL', crawlDelay: null }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { allowed: false, reason: `unsupported protocol ${u.protocol}`, crawlDelay: null };
  }

  const origin = u.origin;
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    if (!hit.ok) return { allowed: false, reason: hit.error, crawlDelay: null };
    const d = decide(hit.groups, u.pathname + u.search, userAgent);
    return { allowed: d.allowed, reason: d.allowed ? 'allowed by robots.txt' : `robots.txt disallows ${d.rule}`,
      crawlDelay: d.crawlDelay };
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetchImpl(`${origin}/robots.txt`, {
      headers: { 'user-agent': userAgent, accept: 'text/plain' }, signal: ctrl.signal,
    });
    clearTimeout(timer);

    /* A 404 genuinely means "no rules published", which the convention reads as
       allow-all. Any other non-OK status is a robots.txt we could not read, and
       we do not proceed on a file we could not read. */
    if (res.status === 404 || res.status === 410) {
      cache.set(origin, { ok: true, groups: [], fetchedAt: Date.now() });
      return { allowed: true, reason: 'no robots.txt published', crawlDelay: null };
    }
    if (!res.ok) {
      const error = `robots.txt returned HTTP ${res.status}`;
      cache.set(origin, { ok: false, error, fetchedAt: Date.now() });
      return { allowed: false, reason: error, crawlDelay: null };
    }
    const groups = parseRobots(await res.text());
    cache.set(origin, { ok: true, groups, fetchedAt: Date.now() });
    const d = decide(groups, u.pathname + u.search, userAgent);
    return { allowed: d.allowed, reason: d.allowed ? 'allowed by robots.txt' : `robots.txt disallows ${d.rule}`,
      crawlDelay: d.crawlDelay };
  } catch (err) {
    const error = `could not read robots.txt: ${err.message}`;
    cache.set(origin, { ok: false, error, fetchedAt: Date.now() });
    return { allowed: false, reason: error, crawlDelay: null };
  }
}

/** Test seam and operational reset. */
export function clearRobotsCache() { cache.clear(); }
