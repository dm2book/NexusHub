/**
 * Gift cards. Staff issue a code carrying store value; a customer redeems it and
 * the full balance is credited to their wallet (idempotent via a wallet tag).
 */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId } from '../utils/ids.js';
import { credit } from './walletService.js';
import { badRequest, notFound } from '../utils/errors.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let s = '';
  for (let i = 0; i < 16; i++) s += ALPHABET[Math.floor((Date.now() * (i + 7) + i * 31) % ALPHABET.length)];
  return `GIFT-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}
const up = (c) => String(c || '').trim().toUpperCase();

const shape = (r) => r && ({
  id: r.id, code: r.code, initialBalance: Number(r.initial_balance), balance: Number(r.balance),
  currency: r.currency, status: r.status, note: r.note, recipientEmail: r.recipient_email,
  redeemedBy: r.redeemed_by, redeemedAt: r.redeemed_at, createdAt: r.created_at,
});

// ── Admin: issue / manage ────────────────────────────────────────────────────
export async function issueGiftCard({ amount, currency = 'EUR', note = null, recipientEmail = null }, issuedBy = null) {
  const cents = Math.round(Number(amount));
  if (!cents || cents < 1) throw badRequest('Enter a gift-card amount');
  let code;
  for (let i = 0; i < 6; i++) { code = makeCode(); if (!(await get('SELECT id FROM gift_cards WHERE code=@c', { c: code }))) break; }
  const id = newId('gft');
  await run(
    `INSERT INTO gift_cards (id, code, initial_balance, balance, currency, status, note, recipient_email, issued_by, created_at)
     VALUES (@id, @code, @amt, @amt, @cur, 'active', @note, @rec, @by, @at)`,
    { id, code, amt: cents, cur: currency, note, rec: recipientEmail ? String(recipientEmail).toLowerCase() : null, by: issuedBy, at: nowIso() });
  return getGiftCard(id);
}

export async function setGiftCardStatus(id, status) {
  if (!['active', 'disabled'].includes(status)) throw badRequest('Bad status');
  const g = await get('SELECT status FROM gift_cards WHERE id=@id', { id });
  if (!g) throw notFound('Gift card not found');
  if (g.status === 'redeemed') throw badRequest('Already redeemed');
  await run('UPDATE gift_cards SET status=@s WHERE id=@id', { s: status, id });
  return getGiftCard(id);
}

export async function getGiftCard(id) { return shape(await get('SELECT * FROM gift_cards WHERE id=@id', { id })); }
export async function listGiftCards() {
  return (await all('SELECT * FROM gift_cards ORDER BY created_at DESC LIMIT 500')).map(shape);
}

// ── Customer: check + redeem ─────────────────────────────────────────────────
/** Public balance check (no redemption). */
export async function peekGiftCard(code) {
  const g = await get('SELECT code, balance, currency, status FROM gift_cards WHERE code=@c', { c: up(code) });
  if (!g) return null;
  return { code: g.code, balance: Number(g.balance), currency: g.currency, status: g.status };
}

/** Redeem the full remaining balance into the user's wallet. Atomic + idempotent. */
export async function redeemGiftCard(code, userId) {
  const c = up(code);
  if (!userId) throw badRequest('Sign in to redeem a gift card');
  return tx(async () => {
    const g = await get('SELECT * FROM gift_cards WHERE code=@c FOR UPDATE', { c });
    if (!g) throw notFound('Gift card not found');
    if (g.status === 'disabled') throw badRequest('This gift card has been disabled');
    if (g.status === 'redeemed' || Number(g.balance) <= 0) throw badRequest('This gift card has already been redeemed');
    const amount = Number(g.balance);
    await run('UPDATE gift_cards SET balance=0, status=\'redeemed\', redeemed_by=@u, redeemed_at=@at WHERE id=@id',
      { u: userId, at: nowIso(), id: g.id });
    await credit(userId, amount, 'grant', `Gift card ${g.code} redeemed`, { tag: `giftcard:${g.id}` });
    return { amount, currency: g.currency };
  });
}
