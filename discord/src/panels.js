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
import { MESSAGES, FAQ, LANGUAGE_ROLES, GAME_ROLES, NOTIFY_ROLES } from './config.js';

/**
 * The footer under every pinned panel.
 *
 * It read `forgemarket-setup` — an internal marker, in small grey type, under
 * the welcome message, the rules, the price list and the support panel: the
 * most-read messages on the server, each signed with the name of the script
 * that posted them.
 *
 * It cannot simply be deleted, because that string is also how setup.js and the
 * bot's copy sync recognise their own panels among other messages in a channel.
 * So it becomes a footer worth reading that happens to be just as unique. The
 * old value stays recognised (and only recognised) so the panels already posted
 * on the live server are found and rewritten rather than duplicated.
 */
export const PANEL_FOOTER = 'ForgeMarket · forgemarket.nl';
const LEGACY_FOOTERS = ['forgemarket-setup'];

/** Is this one of our own pinned panels? */
export const isPanelFooter = (text) =>
  text === PANEL_FOOTER || LEGACY_FOOTERS.includes(String(text ?? ''));

/**
 * Is this panel still signed with the old internal marker?
 *
 * Deliberately not folded into panelNeedsUpdate. That function answers "has
 * the copy changed", and a panel whose copy is identical must still be edited
 * once to replace its footer — two different questions, and merging them would
 * have made "identical copy does not churn the API" false.
 */
export const panelFooterIsStale = (existingEmbed) =>
  !!existingEmbed && existingEmbed.footer?.text !== PANEL_FOOTER;

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


/* —— The controls under the #roles panel ——————————————————————————— */

/** Discord's component type numbers, so the rows below read as what they are. */
const ROW = 1, BUTTON = 2, SELECT = 3, SECONDARY = 2;

/** The one custom_id the language picker answers to, in both files that use it. */
export const LANGUAGE_PICKER_ID = 'lang:set';

/**
 * Every control under the #roles panel, as raw Discord component JSON.
 *
 * Raw JSON rather than discord.js builders for the same reason the copy above
 * is plain data: this module stays importable without a Discord client, so the
 * shape can be asserted in a test instead of on a live server. discord.js
 * accepts API component objects wherever it accepts builders, and the test
 * round-trips these through ActionRowBuilder to prove the shape is one Discord
 * will take.
 *
 * It lives here because setup.js posts these once and then never again
 * (`postOnce` answers "exists" on every later run). A picker added only in
 * setup.js would therefore never appear on a server that was already built —
 * the exact failure this module was created to end for panel COPY. bot.js
 * repairs the row at boot from this same function.
 */
/** Just the picker, on its own row — also shown the moment somebody verifies. */
export const languagePickerRow = () => ({
  type: ROW,
  components: [{
    type: SELECT,
    custom_id: LANGUAGE_PICKER_ID,
    /* Both languages in the placeholder on purpose: a Dutch-only prompt is
       unreadable to exactly the members this picker exists for. */
    placeholder: '🌍 Kies je taal — choose your language',
    min_values: 1,
    max_values: 1,
    options: LANGUAGE_ROLES.map((l) => ({
      value: l.key, label: l.label, description: l.blurb, emoji: { name: l.emoji },
    })),
  }],
});

export function rolesPanelComponents() {
  const button = (r) => ({
    type: BUTTON, style: SECONDARY, custom_id: `role:${r.key}`,
    label: r.label, emoji: { name: r.emoji },
  });
  const rows = [languagePickerRow()];
  for (let i = 0; i < GAME_ROLES.length; i += 5) {
    rows.push({ type: ROW, components: GAME_ROLES.slice(i, i + 5).map(button) });
  }
  rows.push({ type: ROW, components: NOTIFY_ROLES.map(button) });
  return rows;
}

/**
 * Does a message already carry the language picker?
 *
 * Reads both shapes a component can arrive in — discord.js's wrapper
 * (`customId`) and the raw API object (`custom_id`) — because a message
 * fetched from the gateway and one built here are not the same object, and
 * checking only one of them is how the repair either never runs or runs on
 * every boot forever.
 */
export const hasLanguagePicker = (components = []) =>
  (components || []).some((rowData) => (rowData?.components || []).some(
    (c) => (c?.customId ?? c?.custom_id ?? c?.data?.custom_id) === LANGUAGE_PICKER_ID));
