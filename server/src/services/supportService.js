/** Support tickets + customer refund requests. */
import { run, get, all, nowIso, tx } from '../db/index.js';
import { newId, newTicketNumber } from '../utils/ids.js';
import { notFound, badRequest } from '../utils/errors.js';
import { notify } from './notificationService.js';
import { getOrder, orderUrlFor } from './orderService.js';
import { sendEmailAsync } from './emailService.js';
import { emailCopy } from './emailCopy.js';
import { requestNoteHtml } from './emailBlocks.js';
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
  const ticket = await getTicket(id);
  /* The translated ticket_opened mail existed and was never sent: the
     customer's only proof their message arrived was a screen they had left. */
  await emailTicketOpened(ticket).catch((e) => console.error('[support] opened email:', e.message));
  return ticket;
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

/**
 * The ticket fields every ticket mail needs, in the reader's language.
 *
 * `orderLine` was hardcoded English (" about order FM-…") inside a Dutch
 * sentence, and the button always went to /account/tickets — a login wall for
 * a guest, in a mail that says it works "without an account". A guest is sent
 * to their order's track page instead.
 */
async function ticketFields(t, to) {
  const order = t.order_id ? await getOrder(t.order_id).catch(() => null) : null;
  const lang = to.lang || 'nl';
  return {
    number: t.number,
    subject: t.subject,
    // Rendered as text, so it carries its own leading space or nothing at all.
    orderLine: order ? emailCopy(lang).orderLine(order.number) : '',
    url: t.user_id ? `${config.appUrl}/account/tickets/${t.id}`
      : (order ? orderUrlFor(order) : `${config.appUrl}/track`),
  };
}

async function emailTicketReply(t, body) {
  const to = await ticketRecipient(t);
  if (!to) return;
  await sendEmailAsync('support_reply', to.email, {
    lang: to.lang || undefined,
    user: { name: to.name },
    reply: body,
    ticket: await ticketFields(t, to),
  });
}

async function emailTicketOpened(t) {
  const to = await ticketRecipient(t);
  if (!to) return;
  await sendEmailAsync('ticket_opened', to.email, {
    lang: to.lang || undefined,
    user: { name: to.name },
    ticket: await ticketFields(t, to),
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

/**
 * A buyer asks for a refund — and says how: `money` back the way they paid, or
 * `credit` in their account. Credit is only offered on an order placed with an
 * account (it lives in a wallet); asked for on a guest order it is refused
 * rather than quietly turned into money, so the buyer is never told one thing
 * and given another. The amount shown for credit is everything the order took,
 * store credit used on it included — the same figure refundOrder will credit.
 */
export async function requestRefund({ orderId, userId, reason, amount, method = 'money' } = {}) {
  const order = await getOrder(orderId);
  if (!order) throw notFound('Order not found');
  if (!['money', 'credit'].includes(method)) throw badRequest('Choose money back or store credit');
  if (method === 'credit' && !order.userId) {
    throw badRequest('Store credit needs an account — this order was placed without one.');
  }
  const { creditRefundAmount, moneyRefundAmount } = await import('./refundService.js');
  const id = newId('ref');
  const at = nowIso();
  await run(`INSERT INTO refund_requests (id, order_id, user_id, reason, amount, method, created_at, updated_at)
       VALUES (@id, @oid, @uid, @reason, @amt, @method, @at, @at)`,
      { id, oid: orderId, uid: userId || null, reason: reason || null,
        /* What is still refundable: after a partial refund in the Stripe or
           Mollie dashboard, order.total overstates it (moneyRefundAmount
           subtracts what the provider already sent back). */
        amt: amount ?? (method === 'credit' ? await creditRefundAmount(order) : await moneyRefundAmount(order)), method, at });
  /* An online withdrawal form must be acknowledged on a durable medium (CRD
     art. 11(3)). The translated mail existed and was never sent. */
  await emailRefundRequest('refund_request_received', order, reason)
    .catch((e) => console.error('[support] refund received email:', e.message));
  return get('SELECT * FROM refund_requests WHERE id=@id', { id });
}

async function emailRefundRequest(templateId, order, note) {
  const lang = order.billing?.lang || 'nl';
  await sendEmailAsync(templateId, order.email, {
    lang,
    user: { name: order.billing?.full_name || order.email.split('@')[0] },
    order: { number: order.number, url: orderUrlFor(order) },
    request: { reasonHtml: requestNoteHtml(note, lang) },
  });
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

export function getRefundRequest(id) {
  return get('SELECT * FROM refund_requests WHERE id=@id', { id });
}

export function listRefundRequests({ status } = {}) {
  const clause = status ? 'WHERE rr.status=@status' : '';
  return all(`SELECT rr.*, o.number AS order_number, o.email AS customer
                FROM refund_requests rr JOIN orders o ON o.id = rr.order_id
                ${clause} ORDER BY rr.created_at DESC LIMIT 200`,
             status ? { status } : {});
}

export async function decideRefund(id, { status, decidedBy, method } = {}) {
  if (!['approved', 'rejected', 'processed'].includes(status)) {
    throw badRequest('Invalid refund decision');
  }
  const before = await get('SELECT status, order_id FROM refund_requests WHERE id=@id', { id });
  await run(`UPDATE refund_requests SET status=@st, decided_by=@by, method=COALESCE(@m, method), updated_at=@at WHERE id=@id`,
      { st: status, by: decidedBy || null, m: method || null, at: nowIso(), id });
  /* A rejection only changed this row — the buyer was never told. Sent once,
     on the change to rejected, not again if the decision is saved twice. */
  if (status === 'rejected' && before && before.status !== 'rejected') {
    const order = await getOrder(before.order_id).catch(() => null);
    if (order) {
      await emailRefundRequest('refund_request_rejected', order, null)
        .catch((e) => console.error('[support] refund rejected email:', e.message));
    }
  }
  return get('SELECT * FROM refund_requests WHERE id=@id', { id });
}
