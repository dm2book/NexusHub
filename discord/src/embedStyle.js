/**
 * One look for every embed the bot sends.
 *
 * bot.js built its embeds one by one: fourteen different colours for the same
 * four meanings, footers on some and not others, timestamps on a few, and no
 * protection against Discord's size limits — a long product name in a title or
 * a long review in a description made discord.js throw, and the message was
 * simply never sent. Every embed now starts here:
 *
 *   styled('success').setTitle(…)   — brand colour for the state, a footer that
 *                                     always says whose shop this is, a
 *                                     timestamp, and setters that trim to
 *                                     Discord's limits instead of throwing.
 *
 * The palette is the shop's own: violet for "the shop says", magenta for
 * promotions, and the usual green / amber / red / grey for done / your move /
 * wrong / closed. server/src/services/discordStyle.js mirrors these values for
 * the embeds the store queues; discord/test/embed-style.test.mjs keeps the two
 * identical.
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { PALETTE, LIMITS, clip, oneEmoji, footerText, getBrandIcon, clampEmbed, clipField } from './palette.js';

export { PALETTE, LIMITS, clip, oneEmoji, countEmoji, footerText, clampEmbed, configureEmbedStyle, SHOP_NAME } from './palette.js';

/**
 * EmbedBuilder with the shop's style built in. Its setters trim instead of
 * throwing, so an over-long name or review cannot stop a message being sent.
 */
export class BrandEmbed extends EmbedBuilder {
  constructor(state = 'info', { timestamp = true } = {}) {
    super();
    super.setColor(PALETTE[state] ?? PALETTE.info);
    const icon = getBrandIcon();
    super.setFooter({ text: footerText(), ...(icon ? { iconURL: icon } : {}) });
    if (timestamp) super.setTimestamp();
  }

  setState(state) { return super.setColor(PALETTE[state] ?? PALETTE.info); }

  setTitle(title) { return super.setTitle(title == null ? null : clip(oneEmoji(title), LIMITS.title)); }

  setDescription(d) { return super.setDescription(d == null || d === '' ? null : clip(d, LIMITS.description)); }

  setFooter(f) {
    const text = footerText(f?.text);
    const iconURL = f?.iconURL || getBrandIcon();
    return super.setFooter({ text: clip(text, LIMITS.footer), ...(iconURL ? { iconURL } : {}) });
  }

  setAuthor(a) { return super.setAuthor(a ? { ...a, name: clip(a.name, LIMITS.author) } : a); }

  addFields(...fields) {
    const room = LIMITS.fields - (this.data.fields?.length || 0);
    return super.addFields(...fields.flat().slice(0, Math.max(0, room)).map(clipField));
  }

  setFields(...fields) { return super.setFields(...fields.flat().slice(0, LIMITS.fields).map(clipField)); }

  toJSON() { return clampEmbed(super.toJSON()); }
}

/** A styled embed: `styled('warning').setTitle(…)`. */
export const styled = (state = 'info', opts) => new BrandEmbed(state, opts);

/**
 * A row of link buttons — the one thing the message asks the reader to do.
 * Anything that is not an http(s) URL is left out rather than failing the send.
 */
export function linkRow(...buttons) {
  const ok = buttons.flat().filter((b) => b && /^https?:\/\//.test(String(b.url || ''))).slice(0, 5);
  if (!ok.length) return null;
  return new ActionRowBuilder().addComponents(ok.map((b) => {
    const btn = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(b.url).setLabel(clip(b.label, 80));
    return b.emoji ? btn.setEmoji(b.emoji) : btn;
  }));
}

/**
 * /order's answer: the status embed and its one button — "pay" while the
 * buyer still owes the payment under a provider, the live status page
 * otherwise. `view` is orderStatusView()'s output.
 */
export function orderStatusMessage(view, { trackUrl } = {}) {
  const icon = getBrandIcon();
  const embed = styled('info').setColor(view.color)
    .setAuthor({ name: view.author, ...(icon ? { iconURL: icon } : {}) })
    .setTitle(view.title).setDescription(view.description || null)
    .addFields(...(view.fields || []))
    .setFooter({ text: view.footer });
  const row = linkRow({ label: view.action, url: trackUrl });
  return { embeds: [embed], components: row ? [row] : [] };
}
