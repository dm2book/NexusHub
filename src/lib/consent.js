/**
 * Cookie/storage consent.
 *
 * Dutch and EU law (Art. 11.7a Telecommunicatiewet, ePrivacy + GDPR) require
 * permission BEFORE anything non-essential is written to a visitor's device.
 * Strictly necessary storage — staying signed in, the cart, the chosen language
 * — is exempt and never asked about. Everything else must wait for a yes.
 *
 * What this replaces was worse than nothing. There was a banner, but:
 *
 *   - it lived in SiteLayout, which App.jsx never renders, so it was dead code;
 *   - it offered only "Accept", and refusing has to be as easy as agreeing or
 *     the consent is not valid;
 *   - it said "we use essential cookies", which was untrue — the analytics
 *     visitor id and the referral code are neither;
 *   - it said "by using ForgeMarket you agree", and implied consent is
 *     explicitly not consent;
 *   - and nothing was actually gated on it. `fm_sid` was written on the first
 *     page view regardless. Measured: a fresh visit stored it before the banner
 *     had rendered.
 *
 * A banner that does not stop the writing is not protection. It is a written
 * record that you knew the rule and stored the data anyway.
 *
 * The categories are deliberately coarse. Three real choices a person can
 * understand beat eleven toggles nobody reads.
 */

const KEY = 'fm_consent';
/** Bump when the categories change: an old choice no longer covers new uses. */
export const CONSENT_VERSION = 1;

/** Keys that are exempt — the site cannot function without them. */
const ESSENTIAL_KEYS = ['fm_token', 'fm_cart', 'fm_lang', 'fm_consent'];

/** Storage written per non-essential category, purged when that category is refused. */
const CATEGORY_KEYS = {
  analytics: ['fm_sid'],
  marketing: ['fm_ref'],
};

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    // A choice made against an older set of categories is not a choice about
    // the current one, so ask again rather than assume.
    return c && c.v === CONSENT_VERSION ? c : null;
  } catch { return null; }
};

/** The stored choice, or null when the visitor has not answered yet. */
export function getConsent() { return read(); }

/** Has this visitor answered at all? */
export function hasAnswered() { return read() !== null; }

/**
 * May we use this category right now?
 *
 * Defaults to NO for everything non-essential. An unanswered banner means no
 * permission, not "not yet refused".
 */
export function allowed(category) {
  if (category === 'essential') return true;
  const c = read();
  return !!c && c[category] === true;
}

/** Record a choice, drop anything it refuses, and tell the live page. */
export function setConsent({ analytics = false, marketing = false } = {}) {
  const choice = { v: CONSENT_VERSION, at: new Date().toISOString(), analytics, marketing };
  try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* private mode */ }
  purgeRefused(choice);
  try { window.dispatchEvent(new CustomEvent('forge:consent', { detail: choice })); } catch { /* SSR */ }
  return choice;
}

/** Forget the answer so the banner asks again (used by "change my choice"). */
export function resetConsent() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  purgeRefused({ analytics: false, marketing: false });
  try { window.dispatchEvent(new CustomEvent('forge:consent', { detail: null })); } catch { /* SSR */ }
}

/**
 * Withdrawing has to be as easy as giving, and it has to actually remove what
 * was collected on this device — otherwise "refuse" only stops future writes
 * and leaves yesterday's identifier in place.
 */
function purgeRefused(choice) {
  for (const [cat, keys] of Object.entries(CATEGORY_KEYS)) {
    if (choice[cat]) continue;
    for (const k of keys) {
      if (ESSENTIAL_KEYS.includes(k)) continue;
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  }
}

/** Subscribe to changes; returns an unsubscribe. */
export function onConsentChange(fn) {
  const h = (e) => fn(e.detail);
  window.addEventListener('forge:consent', h);
  return () => window.removeEventListener('forge:consent', h);
}
