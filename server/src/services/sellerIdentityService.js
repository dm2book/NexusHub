/**
 * Who is selling — filled in by the owner, not by a deploy.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The seller's name, address, KvK and BTW number lived in VITE_* environment
 * variables, which Vite bakes into the browser bundle at BUILD time. That put a
 * redeploy between the owner and the one piece of information Dutch law
 * requires before a consumer may buy (Art. 6:230m BW). It is also a trap with a
 * date on it: the owner registers at the KvK on 15 October, types six values
 * into Vercel, sees them saved, and nothing changes on the site — because
 * nothing rebuilt. They would have every reason to believe it was done.
 *
 * So the values live in the database, the owner edits them in the admin, and
 * they are live on the next page load. The environment variables still work and
 * are still read: they are the fallback, and they are what the prerendered
 * pages are built from. A shop that has set neither is exactly as it was.
 *
 * ── WHY IT MUTATES THE SHARED OBJECT ──────────────────────────────────────
 * `src/lib/legalIdentity.js` exports LEGAL as one object that the invoice
 * builder, the VAT statement, the compliance audit, the launch check, the
 * legal pages and the prerenderer all read. Handing each of them a new source
 * would be six edits and six chances for one of them to keep reading the old
 * one — which, on this particular subject, means the invoice and the terms
 * disagreeing about who the seller is. One object, updated in place, cannot
 * split that way.
 */
import { getSetting, setSetting } from './settingsService.js';
import { audit } from './auditService.js';
import { LEGAL, legalComplete, LEGAL_ENV } from '../../../src/lib/legalIdentity.js';

const KEY = 'seller_identity';

/** Everything an owner can set, and what it is for. */
export const FIELDS = {
  tradeName: { label: 'Trading name', max: 80 },
  legalName: { label: 'Legal name', max: 120, required: true },
  address: { label: 'Street and number', max: 160, required: true },
  postcode: { label: 'Postcode', max: 20, required: true },
  city: { label: 'City', max: 80, required: true },
  country: { label: 'Country', max: 80 },
  kvk: { label: 'KvK number', max: 20 },
  vat: { label: 'BTW-identificatienummer', max: 24 },
};

/** The four the law will not do without. */
export const REQUIRED = Object.entries(FIELDS)
  .filter(([, f]) => f.required).map(([k]) => k);

/**
 * What the environment alone says — the values this build was made with.
 *
 * Snapshotted at import, BEFORE anything stored has been applied. Reading LEGAL
 * later would read whatever was last written into it: clearing a stored field
 * would then fall back to the value that was just cleared, and `source` would
 * call an owner's own entry "from the build". Both were real, and both are the
 * same mistake — treating a mutable object as a record of where it came from.
 */
const ENV_BASELINE = Object.freeze(Object.fromEntries(
  Object.keys(FIELDS).map((k) => [k, String(LEGAL[k] ?? '').trim()])));
const fromEnv = () => ({ ...ENV_BASELINE });

/** What the owner has typed in, if anything. */
export async function storedIdentity() {
  const v = await getSetting(KEY, null).catch(() => null);
  if (!v || typeof v !== 'object') return {};
  return Object.fromEntries(Object.entries(v)
    .filter(([k, val]) => k in FIELDS && typeof val === 'string' && val.trim())
    .map(([k, val]) => [k, val.trim()]));
}

/**
 * The identity in force, and where each field came from.
 *
 * `source` is not decoration. An owner looking at a KvK number needs to know
 * whether changing it here will do anything, or whether it is coming from an
 * environment variable that will overwrite their idea of it on the next build.
 */
export async function sellerIdentity() {
  const env = fromEnv();
  const stored = await storedIdentity();
  const values = { ...env, ...stored };
  const source = Object.fromEntries(Object.keys(FIELDS).map((k) => [
    k, stored[k] ? 'admin' : (env[k] ? 'environment' : 'unset'),
  ]));
  return {
    values,
    source,
    env: LEGAL_ENV,
    missing: REQUIRED.filter((k) => !values[k]),
    /* The same list in the owner's words. "legalName, postcode" is a field
       name; "Legal name, Postcode" is what the form they are about to open
       calls them. */
    missingLabels: REQUIRED.filter((k) => !values[k]).map((k) => FIELDS[k].label),
    complete: REQUIRED.every((k) => !!values[k]),
    registered: !!values.kvk,
  };
}

/**
 * Put the stored values into the object the rest of the shop reads.
 *
 * Called once at startup and again after every save, so the invoice PDF, the
 * VAT sentence in the terms, the compliance audit and the launch check all
 * answer from the same values the legal pages show. Failure is swallowed on
 * purpose: a database hiccup at boot must not take the shop down over a field
 * that has an environment fallback.
 */
export async function applyStoredIdentity() {
  try {
    const stored = await storedIdentity();
    /* Back to the build's values first. Assigning only the stored ones would
       leave a field the owner has just emptied showing what it used to hold,
       for the life of the process — the shop would keep publishing a VAT number
       that was deliberately taken down. */
    Object.assign(LEGAL, ENV_BASELINE, stored);
    return stored;
  } catch { return {}; }
}

/**
 * Save what the owner typed.
 *
 * An empty string clears a field back to the environment value rather than
 * storing emptiness — "I want this blank" and "I have not set this" are the
 * same thing here, and storing the first would hide an environment variable
 * with no way to see why.
 */
export async function setSellerIdentity(patch = {}, { actor = null } = {}) {
  const before = await storedIdentity();
  const next = { ...before };

  for (const [key, spec] of Object.entries(FIELDS)) {
    if (!(key in patch)) continue;
    const raw = patch[key] == null ? '' : String(patch[key]).trim();
    if (!raw) { delete next[key]; continue; }
    if (raw.length > spec.max) {
      const err = new Error(`${spec.label} is too long (max ${spec.max} characters).`);
      err.status = 400;
      throw err;
    }
    next[key] = raw;
  }

  await setSetting(KEY, next);
  await applyStoredIdentity();

  /* Audited with both sides. Who the seller is appears on invoices and in the
     terms a customer agreed to, so "the KvK number changed on the 3rd" has to
     be answerable later, with what it changed from. */
  await audit({
    actor, action: 'legal.identity_set', targetType: 'settings', targetId: KEY,
    metadata: { before, after: next },
  });

  return sellerIdentity();
}

/** True once the law's minimum set is present, stored values included. */
export async function identityComplete() {
  const { complete } = await sellerIdentity();
  return complete || legalComplete();
}

/**
 * The public block, for /api/config.
 *
 * Values only. The source map and the environment-variable names are the
 * owner's business — a page that has to state who is selling does not have to
 * state where that string was configured.
 */
export async function sellerLegalBlock() {
  const { values } = await sellerIdentity();
  const out = {};
  for (const [k, v] of Object.entries(values)) if (v) out[k] = v;
  return out;
}
