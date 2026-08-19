/**
 * The pre-launch gate: browsable now, buyable on the day.
 *
 * Until the launch date the shop shows everything and sells nothing. Three
 * decisions shape the whole thing, and each one is a trade-off worth stating.
 *
 * **The server is the gate; the storefront is only the courtesy.** Hiding the
 * checkout button is not a gate — anyone can post to the API. So the refusal
 * lives at the choke points every purchase and every new account must pass
 * through (`createOrder`, `upsertUserBy*`), not at the buttons. The UI changes
 * are there so nobody is invited to do something that will fail.
 *
 * **The deadline is shipped, not the verdict.** `/api/config` sends the launch
 * TIMESTAMP rather than a `prelaunch: true` flag, and that response is cached at
 * the edge for a minute. A cached verdict would keep a stale "not open yet" on
 * screen after the shop opened; a cached deadline cannot go wrong, because the
 * browser compares it to its own clock. The same reasoning applies on the
 * server: the comparison happens per request, never at boot, which is what makes
 * the gate lift on the day with no redeploy.
 *
 * **A broken setting must not close the shop.** An unparseable LAUNCH_DATE fails
 * OPEN and says so loudly in the log. The opposite — a typo silently locking a
 * live shop out of its own checkout, with no way to fix it but a deploy — is the
 * failure this codebase has already been bitten by once.
 */
import { config } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

const STAFF_ROLES = ['owner', 'admin'];

/** The configured launch moment in ms, or null when there is nothing to wait for. */
export function launchAtMs() {
  const raw = config.launch.date;
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) {
    console.error(`[launch] LAUNCH_DATE is not a date I can read ("${raw}") — selling normally.`);
    return null;
  }
  return t;
}

/** The launch moment as an ISO string, or null. Sent to the storefront. */
export function launchAtIso() {
  const t = launchAtMs();
  return t === null ? null : new Date(t).toISOString();
}

/**
 * Are we still before the launch?
 *
 * `now` is a parameter rather than a call to the clock so the behaviour either
 * side of the moment can be tested without waiting for it — and because a gate
 * that cannot be tested at its boundary is a gate nobody trusts.
 */
export function isPrelaunch(now = Date.now()) {
  const t = launchAtMs();
  return t !== null && now < t;
}

/**
 * Staff walk through the gate.
 *
 * Takes the user object the auth middleware already attached, so this asks the
 * same question the rest of the app does rather than inventing a second answer.
 */
export function isStaff(user) {
  return !!user && Array.isArray(user.roles) && user.roles.some((r) => STAFF_ROLES.includes(r));
}

/**
 * An address the owner controls, which is allowed to become an account even
 * before launch.
 *
 * Without this the gate can lock the owner out of their own shop: on a fresh
 * deployment nobody has signed in yet, so there is no admin account to bypass
 * anything, and blocking registration would block the very sign-in that creates
 * it. The first thing a pre-launch shop needs is its owner able to get in.
 */
export function isAdminEmail(email) {
  return config.auth.adminEmails.includes(String(email || '').toLowerCase());
}

/** The launch day in words, as a visitor would say it: "24 September". */
export function launchDayLabel() {
  const iso = launchAtIso();
  return iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    : 'launch day';
}

/**
 * The message a visitor sees. Never mentions a setting or a variable name.
 *
 * The reassurance is only added where money was on the table: telling someone
 * that nothing has been charged for trying to sign up reads as though something
 * nearly went wrong, when nothing did.
 */
export function closedMessage(what = 'This', { money = false } = {}) {
  return `${what} opens when ForgeMarket launches on ${launchDayLabel()}.`
    + (money ? ' Nothing has been charged.' : '');
}

/**
 * Refuse unless the shop is open — or the person asking is staff.
 *
 * Throws a 503 with a machine-readable code so the storefront can tell "not yet"
 * apart from "something broke", and show a countdown rather than an error.
 */
export function assertLaunched(user, what = 'This', opts = {}) {
  if (!isPrelaunch()) return;
  if (isStaff(user)) return;
  throw new ApiError(503, closedMessage(what, opts), 'prelaunch');
}

/** Express middleware form, for routes that should simply not exist yet. */
export function requireLaunched(what = 'This', opts = {}) {
  return (req, _res, next) => {
    try { assertLaunched(req.user, what, opts); next(); } catch (err) { next(err); }
  };
}
