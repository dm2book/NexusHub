/** Support tickets + customer refund requests. */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId, newTicketNumber } from '../utils/ids.js';
import { notFound, badRequest } from '../utils/errors.js';
import { notify } from './notificationService.js';
import { getOrder } from './orderService.js';
import { sendEmailAsync } from './emailService.js';
import { config } from '../config/env.js';

// ── Tickets ──────────────────────────────────────────────────────────────

export async function openTicket({ userId, orderId, subject, category, message } = {}) {
  if (!subject) throw badRequest('A subject is required');
  if (!message) throw badRequest('A message is required');
  const id = newId('tkt');
  const number = newTicketNumber();
  const at = nowIso();
  await tx(async () => {
    await run(`INSERT INTO support_tickets (id, number, user_id, order_id, subject, category, created_at, updated_at)
         VALUES (@id, @num, @uid, @oid, @subj, @cat, @at, @at)`,
        { id, num: number, uid: userId || null, oid: orderId || null,
          subj: subject, cat: category || 'general', at });
    await run(`INSERT INTO ticket_messages (id, ticket_id, author_id, author_kind, body, created_at)
         VALUES (@id, @tid, @aid, 'customer', @body, @at)`,
        { id: newId('msg'), tid: id, aid: userId || null, body: message, at });
  });
  return getTicket(id);
}

export async function replyTicket(ticketId, { authorId, authorKind = 'staff', body } = {}) {
  const t = await get('SELECT * FROM support_tickets WHERE id=@id', { id: ticketId });
  if (!t) throw notFound('Ticket not found');
  if (!body) throw badRequest('Message body required');
  await run(`INSERT INTO ticket_messages (id, ticket_id, author_id, author_kind, body, created_at)
       VALUES (@id, @tid, @aid, @kind, @body, @at)`,
      { id: newId('msg'), tid: ticketId, aid: authorId || null, kind: authorKind,
        body, at: nowIso() });
  await run(`UPDATE support_tickets SET status=@st, updated_at=@at WHERE id=@id`,
      { st: authorKind === 'staff' ? 'pending' : 'open', at: nowIso(), id: ticketId });
  if (authorKind === 'staff') {
    if (t.user_id) {
      await notify(t.user_id, { type: 'support', title: `Reply on ticket ${t.number}`,
        body: 'Support replied to your ticket.', link: `/account/tickets/${ticketId}` });
    }
    /* And by email, which is the only route that reaches everyone.
       This used to be the in-app notification alone: a customer had to log back
       in and go looking to discover they had been answered, and a guest — who
       ordered by email and has no account at all — could not be told at any
       price. The reply simply sat in the shop's own database. */
    await emailTicketReply(t, body).catch((e) => console.error('[support] reply email:', e.message));
  }
  return getTicket(ticketId);
}

/**
 * Where a ticket's owner can actually be reached.
 *
 * An account address if there is an account, otherwise the address the order
 * was placed with — which is the whole point: a guest ticket has no user row
 * and is exactly the case that was silently unreachable.
 */
async function ticketRecipient(t) {
  if (t.user_id) {
    const u = await get('SELECT email, display_name, lang FROM users WHERE id=@id', { id: t.user_id });
    if (u?.email) return { email: u.email, name: u.display_name || u.email.split('@')[0], lang: u.lang };
  }
  if (t.order_id) {
    /* A guest ticket has no user row, so the language comes off the order the
       ticket is about — which is the one this person is writing in. */
    const o = await get('SELECT email, billing FROM orders WHERE id=@id', { id: t.order_id });
    if (o?.email) {
      let lang;
      try { lang = JSON.parse(o.billing || '{}').lang; } catch { /* not JSON — no language */ }
      return { email: o.email, name: o.email.split('@')[0], lang };
    }
  }
  return null;
}

async function emailTicketReply(t, body) {
  const to = await ticketRecipient(t);
  if (!to) return;
  const order = t.order_id
    ? await get('SELECT number FROM orders WHERE id=@id', { id: t.order_id }) : null;
  await sendEmailAsync('support_reply', to.email, {
    lang: to.lang || undefined,
    user: { name: to.name },
    reply: body,
    ticket: {
      number: t.number,
      subject: t.subject,
      // Rendered as text, so it carries its own leading space or nothing at all.
      orderLine: order ? ` about order ${order.number}` : '',
      url: `${config.appUrl}/account/tickets/${t.id}`,
    },
  });
}

export async function setTicketStatus(ticketId, status, assignedTo) {
  await run(`UPDATE support_tickets SET status=@st, assigned_to=COALESCE(@by, assigned_to),
        updated_at=@at WHERE id=@id`,
      { st: status, by: assignedTo || null, at: nowIso(), id: ticketId });
  return getTicket(ticketId);
}

export async function getTicket(id) {
  const t = await get('SELECT * FROM support_tickets WHERE id=@id', { id });
  if (!t) return null;
  const messages = await all('SELECT * FROM ticket_messages WHERE ticket_id=@id ORDER BY created_at ASC',
                       { id });
  return { ...t, messages };
}

export function listTickets({ userId, status } = {}) {
  const where = [];
  const params = {};
  if (userId) { where.push('user_id=@userId'); params.userId = userId; }
  if (status) { where.push('status=@status'); params.status = status; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(`SELECT * FROM support_tickets ${clause} ORDER BY updated_at DESC LIMIT 200`, params);
}

// ── Refund requests ────────────────────────────────────────────────────────

export async function requestRefund({ orderId, userId, reason, amount } = {}) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  const id = newId('ref');
  const at = nowIso();
  await run(`INSERT INTO refund_requests (id, order_id, user_id, reason, amount, created_at, updated_at)
       VALUES (@id, @oid, @uid, @reason, @amt, @at, @at)`,
      { id, oid: orderId, uid: userId || null, reason: reason || null,
        amt: amount ?? order.total, at });
  return get('SELECT * FROM refund_requests WHERE id=@id', { id });
}

/**
 * The refund request already on an order, if any.
 *
 * Asking twice must not create two rows in the queue: a buyer who does not see
 * an instant confirmation presses the button again, and the owner should not
 * have to work out which of three identical requests is real.
 */
export function getRefundRequestForOrder(orderId) {
  return get('SELECT * FROM refund_requests WHERE order_id=@o ORDER BY created_at DESC LIMIT 1',
    { o: orderId });
}

export function listRefundRequests({ status } = {}) {
  const clause = status ? 'WHERE rr.status=@status' : '';
  return all(`SELECT rr.*, o.number AS order_number, o.email AS customer
                FROM refund_requests rr JOIN orders o ON o.id = rr.order_id
                ${clause} ORDER BY rr.created_at DESC LIMIT 200`,
             status ? { status } : {});
}

export async function decideRefund(id, { status, decidedBy } = {}) {
  if (!['approved', 'rejected', 'processed'].includes(status)) {
    throw badRequest('Invalid refund decision');
  }
  await run(`UPDATE refund_requests SET status=@st, decided_by=@by, updated_at=@at WHERE id=@id`,
      { st: status, by: decidedBy || null, at: nowIso(), id });
  return get('SELECT * FROM refund_requests WHERE id=@id', { id });
}
