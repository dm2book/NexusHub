/**
 * A person's data, on request: everything the shop holds about one email
 * address (AVG art. 15/20), or all of it erased (art. 17).
 *
 * The privacy policy promises both "within a month, by email", and until now
 * the only way to keep that promise was a database console.
 *
 * Erasing is anonymising where the law requires the shop to keep the record:
 * an order is bookkeeping (the Dutch fiscal retention period is seven years),
 * so the order stays with its amounts, products and dates — but without the
 * name, address, email, IP or delivery target. Everything that exists only
 * because of the person (sessions, devices, carts, wishlists, notifications,
 * login codes, the newsletter row, linked logins) is deleted. Chargebacks are
 * kept: evidence for a legal claim is an exception the AVG itself names.
 */
import { all, get, run, tx, nowIso } from '../db/index.js';
import { audit } from './auditService.js';
import { badRequest, notFound } from '../utils/errors.js';

const norm = (e) => String(e || '').trim().toLowerCase();
const tryAll = (sql, p) => all(sql, p).catch(() => []);
const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

/** Everything held about this address, as one JSON-able object. */
export async function exportPersonalData(email) {
  const e = norm(email);
  if (!e) throw badRequest('An email address is needed');
  const user = await get(`SELECT id, email, display_name, phone, lang, preferences, email_verified, phone_verified,
                                 membership_tier, membership_until, created_at, last_login_at,
                                 (totp_enabled_at IS NOT NULL) AS two_factor
                            FROM users WHERE lower(email) = @e`, { e });
  const uid = user?.id || '__none__';
  const orders = await tryAll(`SELECT id, number, status, currency, subtotal, total, billing, created_at, updated_at
                                 FROM orders WHERE user_id = @u OR lower(email) = @e ORDER BY created_at`, { u: uid, e });
  const ids = orders.map((o) => o.id);
  const items = ids.length ? await tryAll(`SELECT order_id, name, quantity, unit_price FROM order_items WHERE order_id = ANY(@ids)`, { ids }) : [];
  const data = {
    exportedAt: nowIso(),
    email: e,
    account: user ? { ...user, preferences: parse(user.preferences) } : null,
    orders: orders.map((o) => ({ ...o, billing: parse(o.billing), items: items.filter((i) => i.order_id === o.id) })),
    walletLedger: await tryAll(`SELECT amount, type, description, order_id, created_at FROM credit_transactions WHERE user_id = @u ORDER BY created_at`, { u: uid }),
    forgeCoins: await tryAll(`SELECT * FROM forge_coin_ledger WHERE user_id = @u ORDER BY created_at`, { u: uid }),
    reviews: await tryAll(`SELECT author, stars, body, created_at FROM reviews WHERE user_id = @u OR lower(email) = @e`, { u: uid, e }),
    tickets: await tryAll(`SELECT t.number, t.subject, t.status, t.created_at,
                                  (SELECT json_agg(json_build_object('body', m.body, 'at', m.created_at) ORDER BY m.created_at)
                                     FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages
                             FROM support_tickets t WHERE t.user_id = @u`, { u: uid }),
    refundRequests: await tryAll(`SELECT * FROM refund_requests WHERE user_id = @u`, { u: uid }),
    wishlist: await tryAll(`SELECT * FROM wishlist_items WHERE user_id = @u`, { u: uid }),
    newsletter: await tryAll(`SELECT source, consent_text, created_at, unsubscribed_at FROM newsletter_signups WHERE lower(email) = @e`, { e }),
    unsubscribedFrom: await tryAll(`SELECT scope, created_at FROM email_suppressions WHERE email = @e`, { e }),
    linkedLogins: await tryAll(`SELECT provider, created_at FROM oauth_accounts WHERE user_id = @u`, { u: uid }),
    loginHistory: await tryAll(`SELECT channel, success, reason, created_at FROM login_attempts WHERE user_id = @u OR lower(identifier) = @e ORDER BY created_at DESC LIMIT 200`, { u: uid, e }),
    emailsSent: await tryAll(`SELECT template_id, subject, status, created_at FROM email_log WHERE lower(to_email) = @e ORDER BY created_at DESC LIMIT 500`, { e }),
  };
  return data;
}

/** Billing fields that are only money (kept on an anonymised order). */
const MONEY_KEYS = ['coupon', 'discount', 'memberDiscount', 'memberPercent', 'bundle', 'bundleDiscount', 'creditApplied', 'lang', 'deliveryMethod'];

/**
 * Erase this address. Refuses the owner (the shop cannot erase itself) and
 * any staff account (remove the role first — that is a decision, not a side
 * effect). Returns counts of what was deleted and anonymised.
 */
export async function erasePersonalData(email, { actor = null } = {}) {
  const e = norm(email);
  if (!e) throw badRequest('An email address is needed');
  const user = await get(`SELECT id FROM users WHERE lower(email) = @e`, { e });
  if (user) {
    const staff = await get(`SELECT 1 FROM user_roles WHERE user_id = @u AND role_id <> 'customer' LIMIT 1`, { u: user.id });
    if (staff) throw badRequest('This is a staff account — remove its roles first');
  }
  const orders = await tryAll(`SELECT id, billing FROM orders WHERE lower(email) = @e ${user ? 'OR user_id = @u' : ''}`, { e, u: user?.id });
  if (!user && !orders.length) {
    const any = await get(`SELECT 1 FROM newsletter_signups WHERE lower(email) = @e`, { e }).catch(() => null);
    if (!any) throw notFound('Nothing is held for that address');
  }
  const anon = user ? `erased-${user.id}@erased.invalid` : `erased-${Date.now().toString(36)}@erased.invalid`;
  const counts = { orders: orders.length };

  await tx(async () => {
    for (const o of orders) {
      const b = parse(o.billing);
      const kept = Object.fromEntries(MONEY_KEYS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
      await run(`UPDATE orders SET email = @a, billing = @b, ip = NULL WHERE id = @id`, { a: anon, b: JSON.stringify(kept), id: o.id });
    }
    const del = async (name, sql, p) => { const r = await run(sql, p).catch(() => null); counts[name] = r?.changes ?? 0; };
    await del('newsletter', `DELETE FROM newsletter_signups WHERE lower(email) = @e`, { e });
    await del('loginCodes', `DELETE FROM otp_codes WHERE lower(email) = @e`, { e });
    await del('emailLog', `UPDATE email_log SET to_email = @a, context = NULL WHERE lower(to_email) = @e`, { e, a: anon });
    await del('couponUses', `UPDATE coupon_redemptions SET email = NULL, ip = NULL WHERE lower(email) = @e`, { e });
    await del('reviews', `UPDATE reviews SET author = 'Anonieme koper', email = NULL, discord_uid = NULL WHERE lower(email) = @e ${user ? 'OR user_id = @u' : ''}`, { e, u: user?.id });
    await del('loginHistory', `DELETE FROM login_attempts WHERE lower(identifier) = @e ${user ? 'OR user_id = @u' : ''}`, { e, u: user?.id });
    if (user) {
      const u = { u: user.id };
      for (const [name, table] of [['sessions', 'sessions'], ['devices', 'trusted_devices'], ['linkedLogins', 'oauth_accounts'],
        ['linkIntents', 'oauth_link_intents'], ['cart', 'saved_carts'], ['wishlist', 'wishlist_items'],
        ['notifications', 'notifications'], ['billingDetails', 'billing_details']]) {
        await del(name, `DELETE FROM ${table} WHERE user_id = @u`, u);
      }
      await run(`UPDATE page_views SET user_id = NULL WHERE user_id = @u`, u).catch(() => {});
      await run(`UPDATE users SET email = @a, display_name = 'Verwijderd', avatar_url = NULL, phone = NULL,
                   totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL,
                   preferences = '{}', email_verified = 0, phone_verified = 0, updated_at = @at
                 WHERE id = @id`, { a: anon, at: nowIso(), id: user.id });
      counts.account = 1;
    }
  });

  /* The audit row names the anonymised id, never the address that was erased. */
  await audit({ actor, action: 'privacy.erase', targetType: 'user', targetId: user?.id || anon, metadata: counts }).catch(() => {});
  return { erased: true, counts };
}
