/**
 * The server's pinned panels, as plain data.
 *
 * Why this exists: setup.js posts each panel exactly once (`postOnce` returns
 * "exists" on every later run), so once a server is built, editing the copy in
 * config.js changed NOTHING on the live server — the owner had to remember
 * `REPOST=1 npm run setup`, which also deletes and re-pins every panel. Copy
 * corrections therefore silently never arrived.
 *
 * Both setup.js (first post) and bot.js (boot-time copy sync) now build their
 * embeds from here, so there is one source of truth and a text change reaches
 * the server by itself.
 *
 * No discord.js import on purpose: this stays pure so it can be tested.
 */
import { MESSAGES, FAQ } from './config.js';

/**
 * Discord only renders `<#123456789>` as a channel link. The panels are written
 * with readable `<#open-a-ticket>` placeholders, which would otherwise show up
 * as literal text in the most-read messages on the server.
 */
export function linkChannels(text, channelIdByName = {}) {
  return String(text ?? '').replace(/<#([a-z0-9-]+)>/gi, (_whole, name) => {
    const id = channelIdByName[name];
    return id ? `<#${id}>` : `#${name}`;
  });
}

/** Build every panel's final copy. Returns { channelName: {title, description, color, image} }. */
export function buildPanels({
  storeUrl, guildName = 'ForgeMarket', channelIdByName = {}, trustpilotUrl = '',
} = {}) {
  const tp = String(trustpilotUrl || '').trim();
  const sub = (s) => String(s ?? '').replaceAll('{STORE_URL}', storeUrl);
  const copy = (s) => linkChannels(sub(s), channelIdByName);
  const P = (m) => ({
    title: copy(m.title),
    description: copy(m.description),
    ...(m.color != null ? { color: m.color } : {}),
    ...(m.image ? { image: sub(m.image) } : {}),
    ...(m.thumbnail ? { thumbnail: sub(m.thumbnail) } : {}),
  });

  return {
    welcome: P(MESSAGES.welcome(guildName)),
    'start-here': P(MESSAGES.startHere),
    rules: P(MESSAGES.rules),
    verify: P(MESSAGES.verify),
    links: P(MESSAGES.links({ trustpilotUrl: tp })),
    announcements: P(MESSAGES.announcement),
    status: P(MESSAGES.status),
    products: P(MESSAGES.products),
    'price-list': P(MESSAGES.priceList),
    'how-to-buy': P(MESSAGES.howToBuy),
    deals: P(MESSAGES.deals),
    faq: {
      title: '❓ Frequently Asked Questions',
      description: copy(FAQ.map((f) => `**${f.q}**\n${f.a}`).join('\n\n')),
      color: 0x6366f1,
    },
    'support-info': P(MESSAGES.supportInfo),
    'report-a-scam': P(MESSAGES.reportScam),
    'open-a-ticket': P(MESSAGES.ticketPanel),
    reviews: P(MESSAGES.reviewsIntro({ trustpilotUrl: tp })),
    vouches: P(MESSAGES.vouchersIntro),
    'proof-of-delivery': P(MESSAGES.proofIntro),
    'discount-codes': P(MESSAGES.discountCodes),
    suggestions: P(MESSAGES.suggestionsIntro),
    starboard: P(MESSAGES.starboardIntro),
    giveaways: P(MESSAGES.giveawaysIntro),
    partners: P(MESSAGES.partnersIntro),
    'staff-announcements': P(MESSAGES.staffIntro),
    roles: P(MESSAGES.rolesPanel),
  };
}

/**
 * Has the copy changed? Compares only what a member can read — the bot's own
 * banner sync owns the image, so an image difference must NOT trigger a copy
 * rewrite (and vice versa).
 */
export function panelNeedsUpdate(existingEmbed, panel) {
  if (!existingEmbed || !panel) return false;
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  return norm(existingEmbed.title) !== norm(panel.title)
    || norm(existingEmbed.description) !== norm(panel.description);
}
