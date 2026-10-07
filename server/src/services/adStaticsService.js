/**
 * Static ads: the still images Meta and TikTok run beside video — square
 * (1:1), feed (4:5) and story (9:16) — per product, in four languages.
 *
 * This shop had none. Every image it produced was a Discord banner or the link
 * preview, while the marketplaces it is measured against run most of their
 * paid social on exactly this: the product's card, big, in its brand's
 * colours, the price, one line, the address.
 *
 * Here the server decides WHAT an image may say; the admin page draws it
 * (src/lib/adStudio/statics.js — a serverless function has no browser to
 * render in). Every line is from the product and catalogue, every line passes
 * the same claim gate as the video ads, and a template whose line is refused
 * is left out with the reason, not softened into something vague.
 */
import { all, get } from '../db/index.js';
import { factsFor, gate, packOf } from './adScriptService.js';
import { localRefusals } from './ugcStudioService.js';
import { adImage, adTheme, adPlatform } from './ads/adArt.js';
import { brandSlug } from './productFitService.js';
import { priceText, countText } from '../../../src/lib/adStudio/speak.js';
import { DISCLAIMER } from './adStudioService.js';
import { config } from '../config/env.js';

export const STATIC_LANGS = ['nl', 'en', 'de', 'fr'];
export const STATIC_FORMATS = {
  square: { w: 1080, h: 1080, label: '1:1 · Feed', safeTop: 0.06, safeBottom: 0.06 },
  feed: { w: 1080, h: 1350, label: '4:5 · Feed', safeTop: 0.06, safeBottom: 0.06 },
  story: { w: 1080, h: 1920, label: '9:16 · Story / Reels / TikTok', safeTop: 0.13, safeBottom: 0.21 },
};

const T = {
  ladder: { nl: 'Kies je bedrag', en: 'Pick your amount', de: 'Wähle deinen Betrag', fr: 'Choisis ton montant' },
  mythStamp: { nl: 'NEP', en: 'FAKE', de: 'FAKE', fr: 'FAUX' },
  myth: { nl: (u) => `"Gratis ${u}"?`, en: (u) => `"Free ${u}"?`, de: (u) => `"Gratis ${u}"?`, fr: (u) => `"${u} gratuits" ?` },
  mythSub: { nl: 'Ze willen je wachtwoord.', en: 'They want your password.', de: 'Die wollen dein Passwort.', fr: 'Ils veulent ton mot de passe.' },
  pw1: { nl: 'Alleen je gebruikersnaam.', en: 'Just your username.', de: 'Nur dein Benutzername.', fr: 'Juste ton pseudo.' },
  pw2: { nl: 'Nooit je wachtwoord.', en: 'Never your password.', de: 'Nie dein Passwort.', fr: 'Jamais ton mot de passe.' },
  refund1: { nl: 'Niet geleverd?', en: 'Not delivered?', de: 'Nicht geliefert?', fr: 'Pas livré ?' },
  refund2: { nl: 'Geld terug.', en: 'Money back.', de: 'Geld zurück.', fr: 'Remboursé.' },
  code1: { nl: 'Je code per e-mail.', en: 'Your code by email.', de: 'Dein Code per E-Mail.', fr: 'Ton code par e-mail.' },
  code2: { nl: 'En op je bestelpagina.', en: 'And on your order page.', de: 'Und auf deiner Bestellseite.', fr: 'Et sur ta page de commande.' },
  platform: { nl: (p) => `Voor ${p}`, en: (p) => `For ${p}`, de: (p) => `Für ${p}`, fr: (p) => `Pour ${p}` },
  guest: { nl: 'Zonder account', en: 'No account needed', de: 'Ohne Konto', fr: 'Sans compte' },
};

const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m || '{}') : (m || {}); } catch { return {}; } };

/** The product's siblings a buyer chooses between: same brand, same unit. */
async function ladderFor(row, lang) {
  const pack = packOf(row.name);
  const brand = brandSlug(row.name);
  const rows = await all(`SELECT id, name, price, category, metadata FROM products WHERE active = 1 AND price > 0 AND category = @c`, { c: row.category });
  const same = rows.filter((r) => {
    const p = packOf(r.name);
    if (pack) return p && p.unit === pack.unit && brandSlug(r.name) === brand;
    return brand && brandSlug(r.name) === brand;
  });
  /* One row per amount: two listings of "1,000 Robux" are one choice to a
     buyer. The advertised product keeps its row. */
  const byAmount = new Map();
  for (const r of same) {
    const key = packOf(r.name)?.n ?? r.name.toLowerCase();
    if (!byAmount.has(key) || r.id === row.id) byAmount.set(key, r);
  }
  const unique = [...byAmount.values()];
  if (unique.length < 2) return null;
  /* Three around this product's own price: the one being advertised is in it. */
  const sorted = unique.sort((a, b) => Number(a.price) - Number(b.price));
  const i = Math.max(0, sorted.findIndex((r) => r.id === row.id));
  const pick = sorted.slice(Math.max(0, Math.min(i - 1, sorted.length - 3)), Math.max(0, Math.min(i - 1, sorted.length - 3)) + 3);
  return pick.map((r) => {
    const p = packOf(r.name);
    return { id: r.id, name: p ? `${countText(p.n, lang)} ${p.unit}` : r.name, price: priceText(Number(r.price), lang),
      image: adImage(r), self: r.id === row.id };
  });
}

/** Everything the page needs to draw the static ads of one product in one language. */
export async function staticAds(productId, lang = 'nl') {
  const L = STATIC_LANGS.includes(lang) ? lang : 'nl';
  const row = await get(`SELECT id, name, price, category, metadata FROM products WHERE id = @id`, { id: productId });
  if (!row) return null;
  const f = await factsFor(row.id);
  const pack = packOf(row.name);
  const plat = adPlatform(row);
  const name = pack ? `${countText(pack.n, L)} ${pack.unit}` : row.name;
  const price = priceText(Number(row.price), L);
  const base = { name, price, platform: plat ? T.platform[L](plat.label) : null };

  const candidates = [
    { id: 'price', why: 'the product, its price, the platform', lines: {} },
    { id: 'ladder', when: true, lines: { title: T.ladder[L] } },
    { id: 'myth', when: !!pack && !!f?.accountField, lines: { title: pack ? T.myth[L](pack.unit) : '', stamp: T.mythStamp[L], sub: T.mythSub[L] } },
    { id: 'password', when: !!f?.accountField, lines: { l1: T.pw1[L], l2: T.pw2[L] } },
    { id: 'code', when: !!f?.codeByMail, lines: { l1: T.code1[L], l2: T.code2[L] } },
    { id: 'refund', when: true, lines: { l1: T.refund1[L], l2: T.refund2[L] } },
  ];
  const ladder = await ladderFor(row, L);
  const templates = []; const refused = [];
  for (const c of candidates) {
    if (c.when === false) continue;
    if (c.id === 'ladder' && !ladder) continue;
    const strings = [...Object.values(c.lines), name, price, base.platform].filter((x) => typeof x === 'string' && x);
    const bad = [
      ...strings.map((t) => [t, gate(t, f)]).filter(([, why]) => why),
      ...localRefusals(strings, L).map((t) => [t, ['a claim the shop cannot prove']]),
    ];
    if (bad.length) { refused.push({ template: c.id, lines: bad.map(([t, why]) => ({ text: t, why })) }); continue; }
    templates.push({ id: c.id, ...c.lines });
  }
  const site = (config.appUrl || 'https://www.forgemarket.nl').replace(/\/$/, '');
  return {
    product: { id: row.id, ...base, image: adImage(row), ownArt: /^\/api\/images\//.test(adImage(row) || ''), category: row.category },
    theme: adTheme(row),
    lang: L,
    templates,
    ladder,
    cta: 'forgemarket.nl',
    disclaimer: gate(DISCLAIMER[L], f) ? null : DISCLAIMER[L],
    formats: STATIC_FORMATS,
    /* Where the ad sends people, tagged so the attribution reports can tell
       which image sold — utm_content = template-format, filled in per file. */
    link: `${site}/product/${row.id}?utm_source={network}&utm_medium=paid_social&utm_campaign=static&utm_content={template}-{format}-${L}`,
    refused,
  };
}

/** Products worth an ad: active, priced, best first by real sales. */
export async function staticProducts() {
  const rows = await all(`SELECT p.id, p.name, p.price, p.category,
        COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                   WHERE oi.product_id = p.id AND o.status = 'completed'), 0) AS sold
       FROM products p WHERE p.active = 1 AND p.price > 0 ORDER BY sold DESC, p.category, p.price`);
  return rows.map((r) => ({ id: r.id, name: r.name, price: Number(r.price), category: r.category, sold: Number(r.sold) }));
}
