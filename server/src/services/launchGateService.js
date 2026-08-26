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
 * Are we still before the launch, ACCORDING TO THE CLOCK ALONE?
 *
 * `now` is a parameter rather than a call to the clock so the behaviour either
 * side of the moment can be tested without waiting for it — and because a gate
 * that cannot be tested at its boundary is a gate nobody trusts.
 *
 * This is not the gate. It answers only "has LAUNCH_DATE passed", which is the
 * right question for a countdown and the wrong one for the checkout: with
 * LAUNCH_DATE unset it returns false, meaning open, for a shop that may never
 * have opened. `launchState()` below is what decides whether to take money.
 */
export function isPrelaunch(now = Date.now()) {
  const t = launchAtMs();
  return t !== null && now < t;
}

/**
 * ── THE SAFE DEFAULT, AND WHY IT CHANGED ──────────────────────────────────
 *
 * This gate used to be exactly one environment variable deep: LAUNCH_DATE set
 * meant closed until the date, LAUNCH_DATE unset meant open. The reasoning was
 * sound — a default that ships closed would shut a LIVE shop the moment it
 * deploys, and the fix for that is another deploy.
 *
 * But it made the pre-launch protection conditional on somebody having
 * remembered. Measured on this repository, with the variable in the state it is
 * in production: an anonymous request created a real order. Every readiness
 * report was saying LAUNCH_DATE was unset, and what that actually meant was
 * that the shop was open to the public and nobody had noticed.
 *
 * Both failure modes are real, and they are not symmetrical in time:
 *
 *   before a shop has ever sold anything, defaulting OPEN is the dangerous one
 *   after it has, defaulting CLOSED is the dangerous one
 *
 * So the default follows the evidence instead of a coin flip. A shop with a
 * paid order in its history has plainly launched and is left alone; one with
 * none has plainly not, and is not going to start by accident.
 *
 *   LAUNCH_MODE=open        open, whatever else says      (deliberate override)
 *   LAUNCH_MODE=prelaunch   closed, whatever else says    (deliberate override)
 *   LAUNCH_DATE set         the clock decides
 *   neither                 open only if this shop has ever taken money
 *
 * The override exists because a rule with no manual release is a rule that
 * eventually traps someone at the worst moment.
 */

const OPENED_KEY = 'launch.opened_at';

/* Per-instance memo of "this shop has opened". It only ever goes from unknown
   to true — a shop does not un-launch — so a stale cache cannot close a live
   shop, which is the direction that matters. */
let openedAtMemo = null;

async function hasEverOpened() {
  if (openedAtMemo) return openedAtMemo;
  try {
    const { getSetting, setSetting } = await import('./settingsService.js');
    const stored = await getSetting(OPENED_KEY, null);
    if (stored) { openedAtMemo = stored; return stored; }

    /* No marker yet. Before concluding that this shop has never opened — which
       would close it — look for the one piece of evidence that settles it.
       A paid order means real money has changed hands here, and a shop that has
       taken money is a shop that launched, whoever forgot to write it down.

       This is what makes the new default safe to deploy onto a running shop. */
    const { get } = await import('../db/index.js');
    const row = await get(
      `SELECT created_at FROM orders
        WHERE status IN ('payment_received','processing','awaiting_fulfillment','completed')
        ORDER BY created_at ASC LIMIT 1`);
    if (row?.created_at) {
      openedAtMemo = row.created_at;
      await setSetting(OPENED_KEY, row.created_at).catch(() => {});
      return openedAtMemo;
    }
    return null;
  } catch (err) {
    /* The database is unreachable. Refusing to sell because the bookkeeping is
       down would turn an outage into a closed shop, so this falls back to the
       old behaviour: the clock, and open when there is no clock. Loud, because
       it is the one path where the safe default is not in force. */
    console.error('[launch] could not read launch state, falling back to LAUNCH_DATE only:', err.message);
    return 'unknown';
  }
}

/** Write down that the shop is open, once, so the answer survives a restart. */
async function markOpened() {
  if (openedAtMemo) return;
  openedAtMemo = new Date().toISOString();
  try {
    const { getSetting, setSetting } = await import('./settingsService.js');
    if (!(await getSetting(OPENED_KEY, null))) await setSetting(OPENED_KEY, openedAtMemo);
  } catch { /* memo still holds for this instance */ }
}

/**
 * The gate's actual verdict, with the reason it reached it.
 *
 * @returns {Promise<{prelaunch: boolean, reason: string, openedAt: string|null}>}
 */
export async function launchState() {
  const mode = String(config.launch.mode || '').toLowerCase();
  if (mode === 'open') return { prelaunch: false, reason: 'LAUNCH_MODE=open', openedAt: null };
  if (mode === 'prelaunch') return { prelaunch: true, reason: 'LAUNCH_MODE=prelaunch', openedAt: null };

  const t = launchAtMs();
  if (t !== null) {
    const before = Date.now() < t;
    if (!before) await markOpened();
    return {
      prelaunch: before,
      reason: before ? `LAUNCH_DATE ${new Date(t).toISOString()} has not passed`
        : `LAUNCH_DATE ${new Date(t).toISOString()} has passed`,
      openedAt: openedAtMemo,
    };
  }

  const opened = await hasEverOpened();
  if (opened === 'unknown') {
    return { prelaunch: false, reason: 'launch state unreadable — defaulting to the old behaviour', openedAt: null };
  }
  if (opened) return { prelaunch: false, reason: `this shop has been open since ${opened}`, openedAt: opened };
  return {
    prelaunch: true,
    reason: 'no LAUNCH_DATE, no LAUNCH_MODE, and this shop has never taken a payment',
    openedAt: null,
  };
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
export async function assertLaunched(user, what = 'This', opts = {}) {
  // Staff first: the check is free, and it means a shop whose database is
  // struggling still lets its owner in to look at it.
  if (isStaff(user)) return;
  const { prelaunch } = await launchState();
  if (!prelaunch) return;
  throw new ApiError(503, closedMessage(what, opts), 'prelaunch');
}

/** Express middleware form, for routes that should simply not exist yet. */
export function requireLaunched(what = 'This', opts = {}) {
  return async (req, _res, next) => {
    try { await assertLaunched(req.user, what, opts); next(); } catch (err) { next(err); }
  };
}
