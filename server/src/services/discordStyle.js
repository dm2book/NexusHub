/**
 * The shop's Discord style for the embeds the STORE writes — sale pings, drops,
 * reviews, delivery proof, the DMs a buyer gets.
 *
 * These were hand-built objects with a dozen different colours, a footer on
 * most but not all, and nothing between a long product name and Discord's size
 * limits. They now go through brandEmbed(): one colour per meaning, the same
 * footer the bot uses ("ForgeMarket · …" with the shop icon), a timestamp, at
 * most one emoji in a title, and every part trimmed to Discord's limits.
 *
 * The values mirror discord/src/palette.js (the bot's side);
 * discord/test/embed-style.test.mjs fails if the two drift apart.
 */
import { config } from '../config/env.js';

export const PALETTE = Object.freeze({
  brand: 0x7c5cff,
  info: 0x7c5cff,
  highlight: 0xd946ef,
  success: 0x10b981,
  warning: 0xf59e0b,
  error: 0xef4444,
  neutral: 0x64748b,
});

export const LIMITS = Object.freeze({
  title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024,
  footer: 2048, author: 256, total: 6000,
});

export const SHOP_NAME = 'ForgeMarket';

export const clip = (s, max) => {
  const str = String(s ?? '');
  return str.length <= max ? str : `${str.slice(0, Math.max(0, max - 1))}…`;
};

const EMOJI = /\p{Extended_Pictographic}(?:️|⃣)?(?:‍\p{Extended_Pictographic}(?:️)?)*/gu;

export function oneEmoji(title) {
  let seen = false;
  return String(title ?? '')
    .replace(EMOJI, (m) => { if (seen) return ''; seen = true; return m; })
    .replace(/\s{2,}/g, ' ').trim();
}

const shopHost = () => {
  try { return new URL(config.appUrl).host || 'www.forgemarket.nl'; } catch { return 'www.forgemarket.nl'; }
};

export const footerText = (extra) => {
  const e = String(extra ?? '').trim();
  if (!e) return `${SHOP_NAME} · ${shopHost()}`;
  return e.startsWith(SHOP_NAME) ? e : `${SHOP_NAME} · ${e}`;
};

const clipField = (f) => ({
  ...f,
  name: clip(f?.name || '​', LIMITS.fieldName),
  value: clip(f?.value === '' || f?.value == null ? '—' : f.value, LIMITS.fieldValue),
});

/** Every part within Discord's limits; the last fields give way first, then the description. */
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
  let over = size() - LIMITS.total;
  while (over > 0 && e.fields?.length) { e.fields.pop(); over = size() - LIMITS.total; }
  if (over > 0 && e.description) e.description = clip(e.description, Math.max(1, e.description.length - over));
  return e;
}

/**
 * A finished embed in the shop's style.
 *   brandEmbed('success', { title, description, fields }, { footer: 'delivery proof' })
 */
export function brandEmbed(state, data = {}, { footer } = {}) {
  const e = {
    ...data,
    ...(data.title != null ? { title: oneEmoji(data.title) } : {}),
    color: PALETTE[state] ?? PALETTE.info,
    footer: { text: footerText(footer), icon_url: `${config.appUrl}/icon-512.png` },
    timestamp: new Date().toISOString(),
  };
  if (Array.isArray(e.fields) && !e.fields.length) delete e.fields;
  return clampEmbed(e);
}

/**
 * A row of link buttons, as raw message components. Only the bot can send
 * these (a plain webhook cannot), so deliver() strips them on the webhook path.
 */
export function linkButtons(...buttons) {
  const ok = buttons.flat().filter((b) => b && /^https?:\/\//.test(String(b.url || ''))).slice(0, 5);
  if (!ok.length) return [];
  return [{ type: 1, components: ok.map((b) => ({ type: 2, style: 5, label: clip(b.label, 80), url: b.url })) }];
}
