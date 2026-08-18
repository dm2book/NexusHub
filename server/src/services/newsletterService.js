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
import { run, get, all, nowIso } from '../db/index.js';
import { newId } from '../utils/ids.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function subscribe(email, { source = 'prelaunch', consentText = null } = {}) {
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
    `INSERT INTO newsletter_signups (id, email, source, consent_text, created_at)
     VALUES (@id, @e, @s, @c, @at) ON CONFLICT (email) DO NOTHING`,
    { id: newId('nws'), e, s: source, c: consentText, at: nowIso() });
  return { ok: true, alreadySubscribed: false };
}

export async function unsubscribe(email) {
  const e = String(email || '').trim().toLowerCase();
  const r = await run('UPDATE newsletter_signups SET unsubscribed_at = @at WHERE email = @e AND unsubscribed_at IS NULL',
    { at: nowIso(), e });
  return { ok: true, changed: !!r?.changes };
}

/** How many people are waiting. Used by the owner's readiness dashboard. */
export async function subscriberCount() {
  const r = await get('SELECT COUNT(*) AS n FROM newsletter_signups WHERE unsubscribed_at IS NULL');
  return Number(r?.n || 0);
}

export async function listSubscribers({ limit = 500 } = {}) {
  return all(`SELECT email, source, created_at FROM newsletter_signups
               WHERE unsubscribed_at IS NULL ORDER BY created_at DESC LIMIT @l`, { l: limit });
}
