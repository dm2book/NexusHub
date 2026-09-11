/**
 * The hostname the shop is ACTUALLY served on, compared to the one it thinks it is.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 * `config.appUrl` is the single origin almost everything public is built from:
 * every canonical tag, the sitemap, OG urls, the CORS allow-list, and every
 * link in every email. Its production default is `https://forgemarket.nl`.
 *
 * Nothing verified it. A shop whose DNS points `www.forgemarket.nl` at the
 * deployment while APP_URL says the apex has no visible symptom on the shop's
 * own pages — it renders fine — and four invisible ones:
 *
 *   · every canonical names a host search engines are told is the real one
 *   · the sitemap lists URLs on that host
 *   · CORS allows that origin and rejects the one buyers arrive on
 *   · the login code and the delivery email link there
 *
 * The server is the only thing that knows the answer, because it is the only
 * thing that sees the Host header. So it records what it is served on, and the
 * launch check compares.
 *
 * ── TRUST ─────────────────────────────────────────────────────────────────
 * `Host` is supplied by the client. Everything below treats it as such: it is
 * validated against a strict hostname shape, lowercased, capped to a handful of
 * entries, and used for NOTHING except this diagnostic. It never becomes an
 * origin, a redirect, a link, or a security decision. Poisoning it gets you one
 * extra line in an owner-only readiness list.
 */
import { getSetting, setSetting } from './settingsService.js';
import { config } from '../config/env.js';

const KEY = 'served_hosts';
const MAX = 6;
/* Once per host per six hours. This runs on a request path, and a write on
   every request to record a value that changes about once a year is a database
   round trip nobody asked for. */
const WRITE_EVERY_MS = 6 * 60 * 60 * 1000;
const lastWrite = new Map();

/** A hostname, or null. Ports stripped; anything unusual refused outright. */
export function cleanHost(raw) {
  const t = String(raw || '').trim().toLowerCase();
  /* Refused BEFORE the port is stripped. "http://x.nl".split(':')[0] is "http",
     which is a perfectly valid hostname shape — so a URL handed in as a Host
     header would have been recorded as the host `http`. */
  if (/[\/\\@\s?#]/.test(t)) return null;
  const s = t.split(':')[0];
  if (!s || s.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(s)) return null;
  return s;
}

/** The host part of a configured URL. */
export const hostOf = (url) => {
  try { return cleanHost(new URL(String(url)).hostname); } catch { return null; }
};

/**
 * What kind of host this is.
 *
 * `custom` is the only kind that answers "is the domain right" — a deployment
 * URL and a laptop are both legitimately not the canonical host.
 */
export function classifyHost(host) {
  if (!host) return 'unknown';
  if (host === 'localhost' || /^127\./.test(host) || host.endsWith('.local')) return 'local';
  if (host.endsWith('.vercel.app')) return 'vercel';
  return 'custom';
}

/** Record a host we were asked for. Cheap, debounced, and never throws. */
export async function noteServedHost(raw) {
  const host = cleanHost(raw);
  if (!host) return;
  const now = Date.now();
  const last = lastWrite.get(host) || 0;
  if (now - last < WRITE_EVERY_MS) return;
  lastWrite.set(host, now);
  try {
    const seen = await getSetting(KEY, []);
    const list = Array.isArray(seen) ? seen.filter((x) => cleanHost(x?.host)) : [];
    const rest = list.filter((x) => x.host !== host);
    // Most recent first, and bounded — a poisoned Host cannot grow this.
    await setSetting(KEY, [{ host, at: new Date(now).toISOString() }, ...rest].slice(0, MAX));
  } catch { /* a diagnostic is never worth failing a request for */ }
}

/** Every host the shop has been asked for, most recent first. */
export async function servedHosts() {
  try {
    const seen = await getSetting(KEY, []);
    return (Array.isArray(seen) ? seen : []).filter((x) => cleanHost(x?.host));
  } catch { return []; }
}

/**
 * Is APP_URL the host buyers actually arrive on?
 *
 * Returns the same shape the launch checks use, so the dashboard and the
 * command line cannot disagree about it.
 */
export async function appUrlVerdict({ appUrl = config.appUrl } = {}) {
  const appHost = hostOf(appUrl);
  const seen = await servedHosts();
  const hosts = seen.map((x) => x.host);
  const custom = hosts.filter((h) => classifyHost(h) === 'custom');

  if (!appHost) {
    return { status: 'fail', detail: `APP_URL is not a URL: ${appUrl}`,
      fix: 'Set APP_URL in Vercel to the address buyers type, including https://.' };
  }
  if (!hosts.length) {
    return { status: 'warn', detail: `APP_URL is ${appHost}, and no request has been recorded yet to compare it with.`,
      fix: 'Open the shop once on its real domain, then check again.' };
  }
  if (custom.includes(appHost)) {
    return { status: 'ok', detail: `APP_URL is ${appHost}, which is what the shop is served on.` };
  }
  /* A laptop pointed at a laptop. Consistent, and not something to nag about on
     every development run — the check exists for the deployed shop. */
  if (classifyHost(appHost) === 'local' && hosts.every((h) => classifyHost(h) === 'local')) {
    return { status: 'ok', detail: `APP_URL is ${appHost} and so is the host being served — development.` };
  }
  if (!custom.length) {
    return { status: 'warn',
      detail: `APP_URL is ${appHost}, but the only hosts seen so far are ${hosts.join(', ')} — `
        + 'the real domain has not served a request yet.',
      fix: 'Open the shop on its own domain so this can be confirmed before launch.' };
  }

  /* The specific mismatch this shop has. www and the apex are different hosts,
     and a domain attached as one while APP_URL names the other is the exact
     shape of the bug: the pages render, and every canonical, the sitemap, the
     CORS origin and every email link point somewhere else. */
  const wwwPair = custom.find((h) => h === `www.${appHost}` || `www.${h}` === appHost);
  return {
    status: 'fail',
    detail: wwwPair
      ? `APP_URL says ${appHost} but buyers arrive on ${wwwPair}. Those are different hosts: `
        + 'every canonical, the sitemap, the CORS origin and every email link name the wrong one.'
      : `APP_URL says ${appHost} but the shop is served on ${custom.join(', ')}.`,
    fix: wwwPair
      ? `Either set APP_URL=https://${wwwPair} in Vercel, or attach ${appHost} to the project and redirect one to the other.`
      : `Set APP_URL to https://${custom[0]}, or attach ${appHost} to the project.`,
  };
}
