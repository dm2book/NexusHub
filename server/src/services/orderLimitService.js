/**
 * Hard ceilings on ordering.
 *
 * These are not risk signals and they do not accumulate into a score — they are
 * walls. Scoring answers "how suspicious is this?", which is a judgement that
 * can be wrong in both directions. A limit answers "is this even plausible?",
 * and for a shop run by one person the answer for a fifteenth order in a day is
 * no, whatever the score says.
 *
 * They exist because scoring alone bounds nothing. A stolen card that trips no
 * rule can still place forty orders overnight, and every one of them would be
 * delivered before anybody woke up. The limits are what make the worst night
 * survivable; the score is what makes the normal ones smart.
 *
 * Deliberately generous. Every one of them should be invisible to a real
 * customer — a limit that a genuine buyer hits is a lost sale, and lost sales
 * do not show up in any fraud statistic. Each can be turned off with a 0.
 */
import { config } from '../config/env.js';
import { get } from '../db/index.js';
import { badRequest, tooMany } from '../utils/errors.js';
import { formatMoney } from '../utils/money.js';

const DAY = 86_400_000;

/**
 * Refuse an order that breaches a ceiling, before anything is written.
 *
 * Throws with a message the buyer will actually read, because these fire on
 * real people often enough to matter: someone buying gifts for a whole clan hits
 * the daily value cap, and "Something went wrong" would send them to a
 * competitor rather than to support.
 *
 * Only counts orders that were actually placed — cancelled and failed ones are
 * excluded, so a buyer whose payment kept failing is not locked out for a day
 * because of it.
 */
export async function assertOrderLimits({ email, ip, total, currency = 'EUR' }) {
  const L = config.security.orderLimits;
  const since = new Date(Date.now() - DAY).toISOString();
  const addr = String(email || '').toLowerCase();

  if (L.maxOrderValue > 0 && total > L.maxOrderValue) {
    throw badRequest(
      `This order is larger than we accept in one go (max ${formatMoney(L.maxOrderValue, currency)}). `
      + 'Split it into smaller orders, or email us and we will arrange it by hand.');
  }

  if (L.perEmailPerDay > 0) {
    const r = await get(
      `SELECT COUNT(*) AS n FROM orders
        WHERE email=@e AND created_at>@since AND status NOT IN ('cancelled','failed')`,
      { e: addr, since });
    if (Number(r?.n || 0) >= L.perEmailPerDay) {
      throw tooMany(
        `That is ${L.perEmailPerDay} orders in 24 hours, which is as many as we take from one address. `
        + 'Your existing orders are unaffected — email us if you need another today.');
    }
  }

  if (L.valuePerEmailPerDay > 0) {
    const r = await get(
      `SELECT COALESCE(SUM(total), 0) AS sum FROM orders
        WHERE email=@e AND created_at>@since AND status NOT IN ('cancelled','failed')`,
      { e: addr, since });
    if (Number(r?.sum || 0) + total > L.valuePerEmailPerDay) {
      throw badRequest(
        `This would take you over ${formatMoney(L.valuePerEmailPerDay, currency)} of orders in 24 hours, `
        + 'which is our daily ceiling per customer. Email us and we will sort out anything larger by hand.');
    }
  }

  // Last, and only when we actually have an address. A household, a school or a
  // mobile network all share one, so this is the loosest of the four.
  if (L.perIpPerDay > 0 && ip) {
    const r = await get(
      `SELECT COUNT(*) AS n FROM orders
        WHERE ip=@ip AND created_at>@since AND status NOT IN ('cancelled','failed')`,
      { ip, since });
    if (Number(r?.n || 0) >= L.perIpPerDay) {
      throw tooMany(
        'We have had an unusual number of orders from your connection today. '
        + 'Email us and a person will place your order for you.');
    }
  }
}

/** What the limits currently are, for the admin panel and for tests. */
export const currentLimits = () => ({ ...config.security.orderLimits });
