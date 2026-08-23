/**
 * What a ticket can be about, and how urgently staff should look at it.
 *
 * One table, shared by the panel that renders the picker and the bot that
 * creates the channel — they used to hold two copies of a four-item list, and
 * #report-a-scam pointed at a fifth id that only existed in one of them.
 *
 * A note on priority: it orders the queue, it does not promise a time. This
 * shop deliberately makes no response-time claims anywhere (there is a test),
 * and a "high priority" badge that a customer reads as "within the hour" is the
 * same promise wearing a different hat. What high priority means here is that
 * money is in flight — an order that never arrived, a payment that went wrong,
 * a bank reversal — so it sorts above a question about which pack to buy.
 */

export const PRIORITY = {
  high: { key: 'high', dot: '🔴', label: 'Money in flight', rank: 0 },
  normal: { key: 'normal', dot: '🟡', label: 'Needs a person', rank: 1 },
  low: { key: 'low', dot: '⚪', label: 'No rush', rank: 2 },
};

/**
 * `order` asks for an order number in the form. `ping` pings the Support role
 * on creation — reserved for the ones where waiting costs the buyer money, so
 * the ping keeps meaning something.
 */
export const TICKET_TYPES = [
  { key: 'purchase', emoji: '🛒', label: 'Help buying something',
    blurb: 'Which product, how payment works, what you get.',
    priority: 'normal', order: false, ping: false },
  { key: 'delivery', emoji: '📦', label: 'My order never arrived',
    blurb: 'Paid, but nothing came through yet.',
    priority: 'high', order: true, ping: true },
  { key: 'payment', emoji: '💳', label: 'Payment problem',
    blurb: 'Payment failed, was taken twice, or the amount looks wrong.',
    priority: 'high', order: true, ping: true },
  { key: 'refund', emoji: '↩️', label: 'Refund request',
    blurb: 'You want your money back on an order.',
    priority: 'normal', order: true, ping: false },
  { key: 'chargeback', emoji: '🏦', label: 'My bank reversed a payment',
    blurb: 'A chargeback was raised — let us sort it out with you directly.',
    priority: 'high', order: true, ping: true },
  { key: 'product', emoji: '🎮', label: 'Problem with what I received',
    blurb: 'Code does not work, wrong item, already redeemed.',
    priority: 'normal', order: true, ping: false },
  { key: 'partner', emoji: '🤝', label: 'Partnership',
    blurb: 'Creator, community owner or reseller.',
    priority: 'low', order: false, ping: false },
  { key: 'general', emoji: '❓', label: 'Something else',
    blurb: 'Anything that does not fit the rest.',
    priority: 'low', order: false, ping: false },
];

/**
 * Ids the old four-button panel used.
 *
 * A server that has not re-run setup still has those buttons pinned in
 * #open-a-ticket, and #report-a-scam links `ticket:other` directly. Dropping
 * them would turn a live support panel into four buttons that answer nothing.
 */
const ALIASES = { order: 'delivery', other: 'general' };

export const ticketType = (key) => TICKET_TYPES.find((t) => t.key === (ALIASES[key] || key)) || null;

/** Label for a type, falling back to something sane for an unknown id. */
export const ticketLabel = (key) => {
  const t = ticketType(key);
  return t ? `${t.emoji} ${t.label}` : '🎫 Support';
};

export const priorityOf = (key) => PRIORITY[ticketType(key)?.priority || 'normal'];

/**
 * The channel name for a ticket.
 *
 * The priority dot leads so the ticket list sorts itself by eye: everything
 * with money in flight sits together at the top of the category. The member's
 * name follows, which is what staff actually scan for.
 */
export function ticketChannelName(typeKey, username) {
  const p = priorityOf(typeKey);
  const t = ticketType(typeKey);
  const who = String(username || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'member';
  return `${p.dot}${t ? t.key : 'ticket'}-${who}`.slice(0, 95);
}

/** Everything encoded in a ticket channel's topic, parsed back out. */
export function parseTopic(topic = '') {
  const s = String(topic || '');
  if (!s.startsWith('ticket-owner:')) return null;
  return {
    ownerId: s.match(/ticket-owner:(\d+)/)?.[1] || null,
    type: s.match(/·\s*type:([a-z]+)/)?.[1] || null,
    openedAt: Number(s.match(/·\s*opened:(\d+)/)?.[1]) || null,
    claimedBy: s.match(/·\s*claimed:(\d+)/)?.[1] || null,
    idleWarned: /·\s*idlewarned/.test(s),
  };
}

/** The topic a new ticket carries. Parsed by parseTopic, so keep them together. */
export const buildTopic = ({ ownerId, type, openedAt }) =>
  `ticket-owner:${ownerId} · type:${type} · opened:${openedAt}`;

/**
 * Does this channel belong to this member?
 *
 * Matched on the parsed owner id rather than a substring of the topic. The
 * substring form needed a trailing space to stop `…owner:123` matching
 * `…owner:1234`, which is the kind of guard that works until someone appends
 * something to the topic.
 */
export const isOwnedBy = (topic, userId) => parseTopic(topic)?.ownerId === String(userId);
