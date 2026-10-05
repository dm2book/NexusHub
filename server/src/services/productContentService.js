/**
 * Product content: a short and a long description, an FAQ, an SEO title, an
 * SEO description and keywords for every product — and a score for what a
 * product has now.
 *
 * ── WHAT IT IS WRITTEN FROM ───────────────────────────────────────────────
 * Only what the shop knows for certain: the product name (and the amount and
 * region in it), the category, the platform the category belongs to, how it is
 * delivered (a code by email, or a top-up onto the account by username), and
 * the shop's own written policies (guest checkout, /track, "not delivered,
 * money back" on /refunds). No delivery times, no speed, no "cheapest", no
 * guarantees beyond that refund rule, no ratings or counts. Every generated
 * string passes the shared claim gate plus a list of the words a delivery-time
 * promise or an unproven guarantee needs, or the product gets nothing.
 *
 * ── THE SCORE (0–100) ─────────────────────────────────────────────────────
 *   description   30  present (10), at least 120 characters (10), 300+ (10)
 *   SEO title     15  present and 30–60 characters
 *   SEO desc.     15  present and 70–160 characters
 *   FAQ           15  three or more questions
 *   keywords      10  five or more
 *   unique        15  a real description (40+) no other product shares
 * Flags: missing_description, weak_seo, duplicate_content.
 */
import { all } from '../db/index.js';
import { validateText } from '../../../scripts/ad/claims.mjs';
import { GENERIC } from './adScriptService.js';
import { deliveryField } from '../../../src/lib/deliveryInfo.js';
import { audit } from './auditService.js';

export const LANGS = ['nl', 'en'];
const SHOP = 'ForgeMarket';

/* The platform a category belongs to, and what its currency is called. */
const PLATFORMS = {
  robux: { platform: 'Roblox', unit: 'Robux' },
  'v-bucks': { platform: 'Fortnite', unit: 'V-Bucks', redeem: 'fortnite.com/vbuckscard' },
  valorant: { platform: 'Valorant', unit: 'Valorant Points (VP)' },
  league: { platform: 'League of Legends', unit: 'Riot Points (RP)' },
  genshin: { platform: 'Genshin Impact', unit: 'Genesis Crystals' },
  cod: { platform: 'Call of Duty', unit: 'COD Points' },
  apex: { platform: 'Apex Legends', unit: 'Apex Coins' },
  pubg: { platform: 'PUBG Mobile', unit: 'UC' },
  mlbb: { platform: 'Mobile Legends: Bang Bang', unit: 'Diamonds' },
  freefire: { platform: 'Free Fire', unit: 'Diamonds' },
  clash: { platform: 'Clash of Clans', unit: 'Gems' },
  clashroyale: { platform: 'Clash Royale', unit: 'Gems' },
  brawl: { platform: 'Brawl Stars', unit: 'Gems' },
  eafc: { platform: 'EA SPORTS FC', unit: 'FC Points' },
  gta: { platform: 'GTA Online', unit: 'Shark Card' },
  minecraft: { platform: 'Minecraft', unit: 'Minecoins' },
  pokemongo: { platform: 'Pokémon GO', unit: 'PokéCoins' },
  'discord-nitro': { platform: 'Discord', unit: 'Nitro' },
  spotify: { platform: 'Spotify', unit: 'Premium' },
  gamepass: { platform: 'Xbox', unit: 'Game Pass' },
};
/* A gift card's platform is in its name. */
const GIFT_BRANDS = [['steam', 'Steam'], ['playstation', 'PlayStation'], ['psn', 'PlayStation'], ['xbox', 'Xbox'],
  ['nintendo', 'Nintendo eShop'], ['netflix', 'Netflix'], ['amazon', 'Amazon'], ['google play', 'Google Play'],
  ['itunes', 'App Store & iTunes'], ['app store', 'App Store & iTunes'], ['spotify', 'Spotify']];

/** What the shop knows about a product, for writing. */
export function factsOf(product) {
  const name = String(product.name || '').trim();
  const category = String(product.category || '').toLowerCase();
  const known = PLATFORMS[category] || {};
  const lower = name.toLowerCase();
  const brand = category === 'giftcard' ? (GIFT_BRANDS.find(([k]) => lower.includes(k))?.[1] || null) : null;
  const platform = known.platform || brand || null;
  const amount = (/(\d{1,3}(?:[.,]\d{3})+|\d+)/.exec(name) || [])[1] || null;
  const region = (/\b(EU|Global|Worldwide|NL|BE|DE|UK|US)\b/i.exec(name) || [])[1] || null;
  const field = { nl: deliveryField(category, 'nl'), en: deliveryField(category, 'en') };
  return { name, category, platform, unit: known.unit || null, redeem: known.redeem || null,
    amount, region, account: !!field.nl, field, giftcard: category === 'giftcard' };
}

/* What no generated line may say: a delivery time or speed, or a guarantee
   beyond the shop's written refund rule. */
const FORBIDDEN = /\b(direct|meteen|onmiddellijk|instant\w*|snel\w*|binnen\s+\d+|binnen (een paar|enkele)|minuten|uur|seconden|fast|quick\w*|within|minutes|hours|seconds|immediately|right away|gegarandeerd|garantie|guarantee\w*|100\s?%|goedkoopst\w*|cheapest|best(e)?\s+(prijs|price|shop|webshop)|nummer\s?1|#1)\b/i;
export const refusesClaim = (text) => !validateText(text).ok || GENERIC.some((g) => g.re.test(text)) || FORBIDDEN.test(text);

const cut = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

/** The content for one product in one language. */
export function generateContent(product, lang = 'nl') {
  const f = factsOf(product);
  const nl = lang === 'nl';
  const what = f.platform && !f.name.toLowerCase().includes(f.platform.toLowerCase()) ? `${f.name} voor ${f.platform}` : f.name;
  const whatEn = f.platform && !f.name.toLowerCase().includes(f.platform.toLowerCase()) ? `${f.name} for ${f.platform}` : f.name;
  const how = f.account
    ? (nl ? `We zetten het op je account met alleen je ${f.field.nl} — nooit je wachtwoord.`
      : `We add it to your account with just your ${f.field.en} — never your password.`)
    : (nl ? 'Je krijgt een code per e-mail en op je bestelpagina, die je zelf inwisselt.'
      : 'You get a code by email and on your order page, which you redeem yourself.');
  const redeem = f.redeem ? (nl ? ` Inwisselen doe je op ${f.redeem}.` : ` You redeem it at ${f.redeem}.`) : '';
  const region = f.region ? (nl ? ` Let op: deze code is voor regio ${f.region}.` : ` Note: this code is for region ${f.region}.`) : '';

  const short = nl
    ? cut(`${what} bij ${SHOP}. ${how}`, 160)
    : cut(`${whatEn} at ${SHOP}. ${how}`, 160);
  const long = nl
    ? [
      `${what}. ${how}${redeem}${region}`,
      'Afrekenen kan als gast, zonder account. Je bestelling volg je op forgemarket.nl/track met je bestelnummer.',
      'Wordt je bestelling niet geleverd, dan krijg je je geld terug — zo staat het in ons terugbetaalbeleid op forgemarket.nl/refunds.',
      `${SHOP} is niet gelieerd aan ${f.platform || 'de uitgever'}; merknamen zijn van hun eigenaars.`,
    ].join('\n\n')
    : [
      `${whatEn}. ${how}${redeem}${region}`,
      'You can check out as a guest, without an account. Follow your order at forgemarket.nl/track with your order number.',
      'If your order is not delivered, you get your money back — as our refund policy at forgemarket.nl/refunds says.',
      `${SHOP} is not affiliated with ${f.platform || 'the publisher'}; brand names belong to their owners.`,
    ].join('\n\n');

  const faq = nl ? [
    [`Wat krijg ik bij ${f.name}?`, f.amount && f.unit && !f.name.toLowerCase().includes(f.unit.toLowerCase().split(' ')[0]) ? `${f.name}: ${f.amount} ${f.unit}${f.platform ? ` voor ${f.platform}` : ''}.` : `${what}.`],
    ['Hoe wordt het geleverd?', `${how}${redeem}`],
    ...(f.account ? [['Hebben jullie mijn wachtwoord nodig?', `Nee. Alleen je ${f.field.nl}. Vraagt iemand om je wachtwoord, geef het dan nooit.`]] : []),
    ['Heb ik een account nodig?', 'Nee, je kunt als gast afrekenen. Je bestelling volg je met je bestelnummer op forgemarket.nl/track.'],
    ...(f.region ? [['Werkt dit in mijn land?', `Deze code is voor regio ${f.region}. Controleer dat je account bij die regio hoort.`]] : []),
    ['Wat als het niet geleverd wordt?', 'Dan krijg je je geld terug. Zie forgemarket.nl/refunds.'],
  ] : [
    [`What do I get with ${f.name}?`, f.amount && f.unit && !f.name.toLowerCase().includes(f.unit.toLowerCase().split(' ')[0]) ? `${f.name}: ${f.amount} ${f.unit}${f.platform ? ` for ${f.platform}` : ''}.` : `${whatEn}.`],
    ['How is it delivered?', `${how}${redeem}`],
    ...(f.account ? [['Do you need my password?', `No. Only your ${f.field.en}. If anyone asks for your password, never give it.`]] : []),
    ['Do I need an account?', 'No, you can check out as a guest. Follow your order with your order number at forgemarket.nl/track.'],
    ...(f.region ? [['Does this work in my country?', `This code is for region ${f.region}. Check that your account belongs to that region.`]] : []),
    ['What if it is not delivered?', 'Then you get your money back. See forgemarket.nl/refunds.'],
  ];

  /* The shop name always survives: the product part is shortened, never the brand. */
  const suffix = ` | ${SHOP}`;
  const titleHead = nl ? `${f.name} kopen${f.platform && !f.name.includes(f.platform) ? ` voor ${f.platform}` : ''}`
    : `Buy ${f.name}${f.platform && !f.name.includes(f.platform) ? ` for ${f.platform}` : ''}`;
  const seoTitle = `${titleHead.length + suffix.length <= 60 ? titleHead : (nl ? `${f.name} kopen` : `Buy ${f.name}`).slice(0, 60 - suffix.length).trim()}${suffix}`;
  const seoDescription = cut(nl
    ? `${f.name} kopen bij ${SHOP}. ${f.account ? `Alleen je ${f.field.nl} nodig, nooit je wachtwoord.` : 'Code per e-mail.'} Afrekenen als gast. Niet geleverd? Geld terug.`
    : `Buy ${f.name} at ${SHOP}. ${f.account ? `Only your ${f.field.en} needed, never your password.` : 'Code by email.'} Guest checkout. Not delivered? Money back.`, 160);

  const keywords = [...new Set([
    f.name.toLowerCase(),
    ...(f.platform ? [f.platform.toLowerCase(), `${f.platform.toLowerCase()} ${nl ? 'kopen' : 'buy'}`] : []),
    ...(f.unit ? [f.unit.toLowerCase(), `${f.unit.toLowerCase()} ${nl ? 'kopen' : 'buy'}`] : []),
    ...(f.giftcard ? [nl ? `${(f.platform || '').toLowerCase()} cadeaukaart` : `${(f.platform || '').toLowerCase()} gift card`] : []),
    ...(f.account ? [nl ? `${(f.unit || f.platform || '').toLowerCase()} zonder wachtwoord` : `${(f.unit || f.platform || '').toLowerCase()} without password`] : [nl ? 'code per e-mail' : 'code by email']),
    nl ? 'afrekenen als gast' : 'guest checkout',
  ].map((k) => k.replace(/\s+/g, ' ').trim()).filter((k) => k.length > 2))].slice(0, 12);

  return { short, long, faq, seoTitle, seoDescription, keywords };
}

/** Every string a generated set would publish. */
const stringsOf = (c) => [c.short, c.long, c.seoTitle, c.seoDescription, ...c.faq.flat(), ...c.keywords];

/** Generate for all languages; refuse the whole set if any line makes a claim. */
export function generateAll(product) {
  const out = {};
  for (const l of LANGS) {
    const c = generateContent(product, l);
    const bad = stringsOf(c).filter(refusesClaim);
    if (bad.length) return { ok: false, refused: bad };
    out[l] = c;
  }
  return { ok: true, content: out };
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m || '{}') : (m || {}); } catch { return {}; } };

/** Score what a product HAS now (its description and stored content). */
export function scoreContent(product, { duplicate = false } = {}) {
  const meta = parse(product.metadata);
  const c = meta.content?.nl || {};
  const desc = String(product.description || '').trim();
  let score = 0;
  if (desc) score += 10;
  if (desc.length >= 120) score += 10;
  if (desc.length >= 300) score += 10;
  const t = String(c.seoTitle || ''), d = String(c.seoDescription || '');
  const titleOk = t.length >= 30 && t.length <= 60, descOk = d.length >= 70 && d.length <= 160;
  if (titleOk) score += 15;
  if (descOk) score += 15;
  if ((c.faq || []).length >= 3) score += 15;
  if ((c.keywords || []).length >= 5) score += 10;
  if (!duplicate && desc.length >= 40) score += 15;
  const flags = [];
  if (desc.length < 40) flags.push('missing_description');
  if (!titleOk || !descOk) flags.push('weak_seo');
  if (duplicate) flags.push('duplicate_content');
  return { score, flags };
}

/** Every active product with its score and flags, worst first. */
export async function contentReport() {
  const rows = await all(`SELECT id, name, category, description, metadata FROM products WHERE active = 1 ORDER BY name`);
  const seen = new Map();
  for (const r of rows) {
    const k = norm(r.description);
    if (k.length >= 40) seen.set(k, (seen.get(k) || 0) + 1);
  }
  const items = rows.map((r) => {
    const dup = (seen.get(norm(r.description)) || 0) > 1;
    const { score, flags } = scoreContent(r, { duplicate: dup });
    return { id: r.id, name: r.name, category: r.category, score, flags,
      generatedAt: parse(r.metadata).content?.generatedAt || null };
  }).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  const count = (f) => items.filter((i) => i.flags.includes(f)).length;
  return {
    total: items.length,
    average: items.length ? Math.round(items.reduce((a, i) => a + i.score, 0) / items.length) : 0,
    flags: { missing_description: count('missing_description'), weak_seo: count('weak_seo'), duplicate_content: count('duplicate_content') },
    items,
  };
}

/**
 * Write the generated content onto products: the Dutch long description
 * becomes the product description, and everything (both languages) is kept in
 * metadata.content. `onlyMissing` leaves products the owner wrote alone.
 */
export async function applyContent(productIds, { actor = null, onlyMissing = false } = {}) {
  const { getProduct, updateProduct } = await import('./productService.js');
  const rows = [];
  /* A description shared with another product is not "the owner's own": it is
     the duplicate the report flags, so it is rewritten too. */
  const shared = new Set();
  if (onlyMissing) {
    const counts = new Map();
    for (const r of await all(`SELECT description FROM products WHERE active = 1`)) {
      const k = norm(r.description);
      if (k.length >= 40) counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const [k, n] of counts) if (n > 1) shared.add(k);
  }
  for (const id of productIds) {
    const p = await getProduct(id); // eslint-disable-line no-await-in-loop
    if (!p) continue;
    if (onlyMissing && String(p.description || '').trim().length >= 40 && !p.metadata?.content?.generated && !shared.has(norm(p.description))) {
      rows.push({ id, name: p.name, status: 'kept', detail: 'has its own description' });
      continue;
    }
    const g = generateAll(p);
    if (!g.ok) { rows.push({ id, name: p.name, status: 'refused', detail: g.refused.slice(0, 2).join(' | ') }); continue; }
    // eslint-disable-next-line no-await-in-loop
    /* `description` is the ENGLISH text — the storefront reads it for English
       and keeps Dutch, German and French in descriptionNl/De/Fr (productCopy.js).
       Writing Dutch here showed Dutch on the English site. German and French
       fall back to the storefront's own copy for the category. */
    await updateProduct(id, { description: g.content.en.long,
      metadata: { ...p.metadata, descriptionNl: g.content.nl.long, content: { ...g.content, generated: true, generatedAt: new Date().toISOString() } } });
    rows.push({ id, name: p.name, status: 'applied' });
  }
  const applied = rows.filter((r) => r.status === 'applied').length;
  if (applied) await audit({ actor, action: 'catalog.content_generated', targetType: 'products', targetId: String(applied), metadata: { applied } }).catch(() => {});
  return { rows, applied };
}
