/**
 * "Tell me when you open" — the only thing a pre-launch visitor can actually do.
 *
 * Signing up twice is the normal case, not an error: someone who is not sure it
 * worked presses the button again, and answering that with a failure teaches
 * them the site is broken. So it is idempotent per address and says the same
 * friendly thing either way, without ever revealing whether an address was
 * already on the list — that would turn this into a way to ask "has this person
 * signed up here?".
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { config } from '../config/env.js';
import { sendEmailAsync } from './emailService.js';
import { launchAtIso, launchDayLabel } from './launchGateService.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The unsubscribe link's proof, without a second table.
 *
 * An HMAC of the address, so a link works forever for the person who received
 * it and cannot be guessed for anybody else's. A bare `?email=` would make the
 * route a way to unsubscribe strangers — and, worse, to find out whether an
 * address is on the list, which is exactly what `subscribe` is careful never
 * to reveal.
 */
export function unsubscribeToken(email) {
  return createHmac('sha256', config.auth.jwtSecret)
    .update(`newsletter:${String(email || '').trim().toLowerCase()}`)
    .digest('hex').slice(0, 32);
}

/** Constant-time, because a token check that leaks timing is not a check. */
export function tokenMatches(email, token) {
  const want = Buffer.from(unsubscribeToken(email));
  const got = Buffer.from(String(token || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The link that goes in the mail. */
export function unsubscribeUrl(email) {
  const e = encodeURIComponent(String(email || '').trim().toLowerCase());
  return `${config.appUrl.replace(/\/+$/, '')}/api/newsletter/unsubscribe`
    + `?e=${e}&t=${unsubscribeToken(email)}`;
}

export async function subscribe(email, { source = 'prelaunch', consentText = null, lang = null } = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 200) {
    const err = new Error('That does not look like an email address.');
    err.status = 400;
    throw err;
  }
  const existing = await get('SELECT id, unsubscribed_at FROM newsletter_signups WHERE email = @e', { e });
  if (existing) {
    // Someone re-subscribing after opting out is asking to come back.
    if (existing.unsubscribed_at) {
      await run('UPDATE newsletter_signups SET unsubscribed_at = NULL WHERE id = @id', { id: existing.id });
    }
    return { ok: true, alreadySubscribed: true };
  }
  await run(
    `INSERT INTO newsletter_signups (id, email, source, consent_text, lang, created_at)
     VALUES (@id, @e, @s, @c, @lang, @at) ON CONFLICT (email) DO NOTHING`,
    /* The language the banner was in when they read the consent sentence. A
       Dutch shop with English and German visitors would otherwise have to guess
       at launch, and a mail in the wrong language from a shop you have never
       bought from reads like spam. */
    { id: newId('nws'), e, s: source, c: consentText, lang: lang || null, at: nowIso() });
  return { ok: true, alreadySubscribed: false };
}

export async function unsubscribe(email) {
  const e = String(email || '').trim().toLowerCase();
  const r = await run('UPDATE newsletter_signups SET unsubscribed_at = @at WHERE email = @e AND unsubscribed_at IS NULL',
    { at: nowIso(), e });
  return { ok: true, changed: !!r?.changes };
}

/** How many people are waiting. Used by the owner's readiness dashboard. */
/**
 * The mail the banner promised, sent once the shop is actually open.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The pre-launch banner says "we will email you on the day" and nothing could
 * keep that. This service could subscribe, unsubscribe, count and list, and
 * send nothing at all — so every address collected before launch was a promise
 * that would quietly break at midnight unless somebody remembered to export a
 * list and write the mail by hand, on the one night they will be busiest.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *  · NOT BEFORE THE SHOP OPENS. Announcing a launch that has not happened is
 *    the single worst thing this function could do, so it asks the same gate
 *    the checkout asks rather than a date of its own.
 *  · ONLY PEOPLE WHO ASKED. Anyone who subscribed after the shop opened never
 *    wanted "we are open now" — they were already looking at an open shop.
 *  · STAMPED BEFORE SENDING, like review requests: a crash between the send and
 *    the bookkeeping costs one missed mail, the other order costs a duplicate,
 *    and mailing a stranger twice on launch night is how you get marked as
 *    spam on day one.
 *  · IN BATCHES, because the provider has a rate limit and a launch list is
 *    the one moment it is all sent at once.
 */
export async function sendLaunchAnnouncements({ limit = 40, now = Date.now() } = {}) {
  const at = launchAtIso();
  if (!at || now < Date.parse(at)) return { sent: 0, reason: 'not open yet' };

  const rows = await all(
    `SELECT id, email, lang FROM newsletter_signups
      WHERE announced_at IS NULL AND unsubscribed_at IS NULL
        AND created_at < @at
      ORDER BY created_at ASC LIMIT @limit`,
    { at, limit });

  let sent = 0;
  for (const r of rows) {
    /* Stamp first, and only send if this process was the one that won the
       stamp — two sweeps racing both read the same row otherwise. */
    const claim = await run(
      `UPDATE newsletter_signups SET announced_at = @now
        WHERE id = @id AND announced_at IS NULL`, { now: nowIso(), id: r.id });
    if (!claim?.changes) continue;

    await sendEmailAsync('launch_announcement', r.email, {
      lang: r.lang || 'nl',
      shop: { name: config.email.fromName, url: config.appUrl, day: launchDayLabel() },
      newsletter: { unsubscribeUrl: unsubscribeUrl(r.email) },
    });
    sent += 1;
  }
  return { sent, remaining: rows.length - sent };
}

export async function subscriberCount() {
  const r = await get('SELECT COUNT(*) AS n FROM newsletter_signups WHERE unsubscribed_at IS NULL');
  return Number(r?.n || 0);
}

export async function listSubscribers({ limit = 500 } = {}) {
  return all(`SELECT email, source, created_at FROM newsletter_signups
               WHERE unsubscribed_at IS NULL ORDER BY created_at DESC LIMIT @l`, { l: limit });
}
