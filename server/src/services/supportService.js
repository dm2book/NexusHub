/** Support tickets + customer refund requests. */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId, newTicketNumber } from '../utils/ids.js';
import { notFound, badRequest } from '../utils/errors.js';
import { notify } from './notificationService.js';
import { getOrder } from './orderService.js';

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
  if (authorKind === 'staff' && t.user_id) {
    await notify(t.user_id, { type: 'support', title: `Reply on ticket ${t.number}`,
      body: 'Support replied to your ticket.', link: `/account/tickets/${ticketId}` });
  }
  return getTicket(ticketId);
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
