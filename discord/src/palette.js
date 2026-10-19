/**
 * The shop's Discord palette, limits and text helpers — no discord.js here, so
 * pure modules (orderStatus.js) and tests can use them. embedStyle.js builds
 * the actual embeds on top of this; server/src/services/discordStyle.js mirrors
 * the same values for the embeds the store queues.
 */
export const PALETTE = Object.freeze({
  brand: 0x7c5cff, // violet — the shop speaking
  info: 0x7c5cff,
  highlight: 0xd946ef, // magenta — deals, drops, giveaways
  success: 0x10b981,
  warning: 0xf59e0b, // your move
  error: 0xef4444,
  neutral: 0x64748b, // closed, ended, informational
});

/** Discord's own ceilings (https://discord.com/developers/docs/resources/message#embed-object-embed-limits). */
export const LIMITS = Object.freeze({
  title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024,
  footer: 2048, author: 256, total: 6000,
});

export const SHOP_NAME = 'ForgeMarket';
let shopHost = 'www.forgemarket.nl';
let brandIcon = null;

/** Called once by bot.js with the store's own address and icon. */
export function configureEmbedStyle({ storeUrl, icon } = {}) {
  try { if (storeUrl) shopHost = new URL(storeUrl).host || shopHost; } catch { /* keep the default */ }
  if (icon) brandIcon = icon;
}

/** The icon shown next to every footer, once bot.js has said what it is. */
export const getBrandIcon = () => brandIcon;

/** Trim to `max` characters, marking the cut. */
export const clip = (s, max) => {
  const str = String(s ?? '');
  return str.length <= max ? str : `${str.slice(0, Math.max(0, max - 1))}…`;
};

/* A pictographic emoji with its variation selector and ZWJ sequence. */
const EMOJI = /\p{Extended_Pictographic}(?:️|⃣)?(?:‍\p{Extended_Pictographic}(?:️)?)*/gu;

/** At most one emoji in a title: the first stays, any later one goes. */
export function oneEmoji(title) {
  let seen = false;
  return String(title ?? '')
    .replace(EMOJI, (m) => { if (seen) return ''; seen = true; return m; })
    .replace(/\s{2,}/g, ' ').trim();
}

export const countEmoji = (s) => (String(s ?? '').match(EMOJI) || []).length;

/** "ForgeMarket · <what this is>", or the shop's address when there is nothing to add. */
export const footerText = (extra) => {
  const e = String(extra ?? '').trim();
  if (!e) return `${SHOP_NAME} · ${shopHost}`;
  return e.startsWith(SHOP_NAME) ? e : `${SHOP_NAME} · ${e}`;
};

export const clipField = (f) => ({
  ...f,
  name: clip(f?.name || '​', LIMITS.fieldName),
  value: clip(f?.value === '' || f?.value == null ? '—' : f.value, LIMITS.fieldValue),
});

/**
 * Plain embed data within every Discord limit: each part trimmed, at most 25
 * fields, and the whole under 6000 characters (the last fields give way
 * first, then the description).
 */
export function clampEmbed(data = {}) {
  const e = { ...data };
  if (e.title != null) e.title = clip(e.title, LIMITS.title);
  if (e.description != null) e.description = clip(e.description, LIMITS.description);
  if (e.footer?.text != null) e.footer = { ...e.footer, text: clip(e.footer.text, LIMITS.footer) };
  if (e.author?.name != null) e.author = { ...e.author, name: clip(e.author.name, LIMITS.author) };
  if (Array.isArray(e.fields)) e.fields = e.fields.slice(0, LIMITS.fields).map(clipField);
  const size = () => (e.title?.length || 0) + (e.description?.length || 0) + (e.footer?.text?.length || 0)
    + (e.author?.name?.length || 0)
    + (e.fields || []).reduce((n, f) => n + f.name.length + f.value.length, 0);
  // The description carries the message; the last fields give way first.
  let over = size() - LIMITS.total;
  while (over > 0 && e.fields?.length) { e.fields.pop(); over = size() - LIMITS.total; }
  if (over > 0 && e.description) e.description = clip(e.description, Math.max(1, e.description.length - over));
  return e;
}
