/**
 * Ad Studio — the storyboard behind a finished video ad.
 *
 * The owner chooses a product, what the ad is FOR (the angles), the platform,
 * a length and a language; this returns the scenes: what is on screen, what the
 * voice says, and how long each needs. The browser draws and records it (see
 * src/lib/adStudio/) — a serverless function has neither a browser nor the
 * minutes a render takes.
 *
 * Every word comes from the product row and the catalogue, and every word —
 * on screen and spoken — passes the same claim gate as the ad scripts: no
 * "instant", no "best price", no ratings, no customer counts. Numbers the voice
 * reads are written out ("negen euro negenennegentig"), so a text-to-speech
 * engine cannot mangle a price into "nine comma nine nine".
 */
import { all, get } from '../db/index.js';
import { factsFor, gate, packOf } from './adScriptService.js';
import { config } from '../config/env.js';
import { number, price, priceText, countText, domain } from '../../../src/lib/adStudio/speak.js';
import { iconFor } from '../../../src/lib/sampleCatalog.js';
import { ACCENT } from '../../../scripts/art/design.mjs';

export const ANGLES = {
  trust: { nl: 'Vertrouwen: nooit je wachtwoord', en: 'Trust: never your password', de: 'Vertrauen: nie dein Passwort', fr: 'Confiance : jamais ton mot de passe' },
  myth: { nl: 'Mythe: "gratis" is nep', en: 'Myth: "free" is fake', de: 'Mythos: "gratis" ist Fake', fr: 'Mythe : « gratuit » est faux' },
  math: { nl: 'Rekensom: prijs per 1.000', en: 'Maths: price per 1,000', de: 'Rechnung: Preis pro 1.000', fr: 'Calcul : prix pour 1 000' },
  beforeafter: { nl: 'Voor / Na', en: 'Before / After', de: 'Vorher / Nachher', fr: 'Avant / Après' },
  guest: { nl: 'Geen account nodig', en: 'No account needed', de: 'Kein Konto nötig', fr: 'Pas de compte nécessaire' },
  refund: { nl: 'Niet geleverd? Geld terug', en: 'Not delivered? Money back', de: 'Nicht geliefert? Geld zurück', fr: 'Pas livré ? Remboursé' },
};
export const PLATFORMS = {
  tiktok: { label: 'TikTok', w: 1080, h: 1920, safeBottom: 0.21, safeRight: 0.13, utm: 'tiktok' },
  reels: { label: 'Instagram Reels', w: 1080, h: 1920, safeBottom: 0.21, safeRight: 0.13, utm: 'instagram' },
  shorts: { label: 'YouTube Shorts', w: 1080, h: 1920, safeBottom: 0.18, safeRight: 0.13, utm: 'youtube' },
  story: { label: 'Instagram / Facebook Story', w: 1080, h: 1920, safeBottom: 0.15, safeRight: 0.06, utm: 'instagram' },
  feed: { label: 'Instagram / Facebook feed (4:5)', w: 1080, h: 1350, safeBottom: 0.06, safeRight: 0.06, utm: 'facebook' },
  square: { label: 'Square (1:1)', w: 1080, h: 1080, safeBottom: 0.06, safeRight: 0.06, utm: 'social' },
};
export const LENGTHS = [15, 30, 45, 60];
export const LANGS = ['nl', 'en'];

/* How long a scene needs without a voice, and how much it adds to a target length. */
const BASE_DUR = { hook: 3, myth: 5, trust: 6, math: 7.5, beforeafter: 5.5, guest: 5, refund: 4.5, end: 5 };
const ORDER = ['myth', 'trust', 'math', 'beforeafter', 'guest', 'refund'];
const SCENE_ACCENT = { hook: '#ec4899', myth: '#ec4899', math: '#38bdf8', beforeafter: '#a855f7', guest: '#6366f1', refund: '#f97316', end: '#a855f7' };

/** Only images the canvas may read back: same-origin. An external link would taint the recording. */
const sameOrigin = (u) => (u && /^\/(api\/images|products)\//.test(u) ? u : null);
function imageOf(row) {
  let meta = {};
  try { meta = JSON.parse(row.metadata || '{}'); } catch { /* none */ }
  /* The category's own 3D icon first: it is the shape a viewer recognises in a
     feed. The product's tile second. */
  return iconFor(String(row.category || '').toLowerCase()) || sameOrigin(meta.image) || null;
}

/** The dearest and the cheapest price per 1.000 across the packs of one currency. */
async function packRange(category, unit) {
  const rows = await all(`SELECT id, name, price, category, metadata FROM products WHERE active = 1 AND price > 0 AND category = @c`, { c: category });
  const packs = rows.map((r) => ({ ...r, pack: packOf(r.name) })).filter((r) => r.pack && r.pack.unit === unit && r.pack.n >= 100)
    .map((r) => ({ ...r, per: Math.round((Number(r.price) / r.pack.n) * 1000) }));
  if (packs.length < 2) return null;
  const dear = packs.reduce((a, b) => (b.per > a.per ? b : a));
  const cheap = packs.reduce((a, b) => (b.per < a.per ? b : a));
  return dear.per > cheap.per ? { dear, cheap } : null;
}

/** Which angles this product can honestly carry. */
export async function anglesFor(f) {
  const out = ['trust', 'guest', 'refund'];
  if (f.pack) out.push('myth', 'beforeafter');
  if (f.pack && await packRange(f.product.category, f.pack.unit)) out.push('math');
  return ORDER.filter((a) => out.includes(a));
}

/* ── The words ─────────────────────────────────────────────────────────── */

function words(f, lang, extra) {
  const nl = lang === 'nl';
  const unit = f.pack?.unit || null;
  const thingText = f.pack ? `${countText(f.pack.n, lang)} ${unit}` : f.product.name;
  const thingSpoken = f.pack ? `${number(f.pack.n, lang)} ${unit}` : f.product.name;
  const p = f.product.price;
  const account = f.accountField;                                   // e.g. "Roblox-gebruikersnaam"
  const r = extra.range;
  return {
    hook: {
      pw: nl ? { big: 'STOP.', l1: 'Geef nooit je', l2: 'wachtwoord', strike: true, voice: 'Stop. Geef nooit je wachtwoord.' }
        : { big: 'STOP.', l1: 'Never give out', l2: 'your password', strike: true, voice: 'Stop. Never give out your password.' },
      math: nl ? { big: 'WACHT.', l1: 'Niemand rekent', l2: 'dit uit.', voice: 'Wacht. Niemand rekent dit uit.' }
        : { big: 'WAIT.', l1: 'Nobody does', l2: 'this maths.', voice: 'Wait. Nobody does this maths.' },
      guest: nl ? { big: 'NEE.', l1: 'Nog een account', l2: 'aanmaken?', voice: 'Nog een account aanmaken? Nee.' }
        : { big: 'NOPE.', l1: 'Another account', l2: 'to sign up for?', voice: 'Another account to sign up for? Nope.' },
      refund: nl ? { big: 'BANG?', l1: 'Dat je code', l2: 'niet komt?', voice: 'Bang dat je code niet komt?' }
        : { big: 'WORRIED?', l1: 'That your code', l2: 'never arrives?', voice: 'Worried your code never arrives?' },
    },
    myth: unit && (nl
      ? { title: `"Gratis ${unit}"`, stamp: 'NEP', sub: 'Ze willen maar één ding: je wachtwoord.',
        voice: `Gratis ${unit} generators zijn nep. Ze willen maar één ding: je wachtwoord.` }
      : { title: `"Free ${unit}"`, stamp: 'FAKE', sub: 'They want one thing: your password.',
        voice: `Free ${unit} generators are fake. They want one thing: your password.` }),
    trust: account
      ? (nl ? { label: 'Bij ForgeMarket:', l1: 'alleen je', l2: 'gebruikersnaam.', card: [thingText, priceText(p, lang)],
        voice: `Bij ForgeMarket geef je alleen je ${account}. ${thingSpoken}, ${price(p, lang)}.` }
        : { label: 'At ForgeMarket:', l1: 'just your', l2: 'username.', card: [thingText, priceText(p, lang)],
          voice: `At ForgeMarket you only give your username. ${thingSpoken}, ${price(p, lang)}.` })
      : (nl ? { label: 'Bij ForgeMarket:', l1: 'je krijgt', l2: 'gewoon een code.', card: [thingText, priceText(p, lang)],
        voice: `Bij ForgeMarket krijg je gewoon een code in je mail. ${thingSpoken}, ${price(p, lang)}.` }
        : { label: 'At ForgeMarket:', l1: 'you simply', l2: 'get a code.', card: [thingText, priceText(p, lang)],
          voice: `At ForgeMarket you simply get a code by email. ${thingSpoken}, ${price(p, lang)}.` }),
    math: r && (nl
      ? { chip: 'Reken mee', rows: [[`${countText(r.dear.pack.n, lang)} ${unit}`, priceText(r.dear.price, lang)], [`${countText(r.cheap.pack.n, lang)} ${unit}`, priceText(r.cheap.price, lang)]],
        from: r.dear.per, to: r.cheap.per, label: `per 1.000 ${unit}`, sub: 'Reken het zelf na.',
        voice: `Reken even mee. ${number(r.dear.pack.n, lang)} ${unit} kost ${price(r.dear.price, lang)}. Bij het pak van ${number(r.cheap.pack.n, lang)} betaal je ${price(r.cheap.per, lang)} per duizend.` }
      : { chip: 'Do the maths', rows: [[`${countText(r.dear.pack.n, lang)} ${unit}`, priceText(r.dear.price, lang)], [`${countText(r.cheap.pack.n, lang)} ${unit}`, priceText(r.cheap.price, lang)]],
        from: r.dear.per, to: r.cheap.per, label: `per 1,000 ${unit}`, sub: 'Check it yourself.',
        voice: `Do the maths. ${number(r.dear.pack.n, lang)} ${unit} costs ${price(r.dear.price, lang)}. In the ${number(r.cheap.pack.n, lang)} pack you pay ${price(r.cheap.per, lang)} per thousand.` }),
    beforeafter: f.pack && (nl
      ? { rows: ['Voor', 'Na', 'Daartussen'], unit, n: f.pack.n, price: priceText(p, lang),
        voice: `Van nul naar ${thingSpoken}. Voor ${price(p, lang)}.` }
      : { rows: ['Before', 'After', 'In between'], unit, n: f.pack.n, price: priceText(p, lang),
        voice: `From zero to ${thingSpoken}. For ${price(p, lang)}.` }),
    guest: nl
      ? { l1: 'Geen account.', l2: 'Geen gedoe.', sub: `Afrekenen als gast · ${extra.catalogue}+ producten`,
        voice: 'Geen account nodig. Je rekent gewoon af als gast.' }
      : { l1: 'No account.', l2: 'No hassle.', sub: `Guest checkout · ${extra.catalogue}+ products`,
        voice: 'No account needed. You just check out as a guest.' },
    refund: nl
      ? { l1: 'Niet geleverd?', l2: 'Geld terug.', sub: 'Zwart op wit: forgemarket.nl/refunds',
        voice: 'En niet geleverd? Dan krijg je je geld terug. Zwart op wit.' }
      : { l1: 'Not delivered?', l2: 'Money back.', sub: 'In writing: forgemarket.nl/refunds',
        voice: 'And if it is not delivered? You get your money back. In writing.' },
    end: nl
      ? { cta: 'forgemarket.nl', tag: 'Link in bio', voice: `${domain(lang)}. Link in bio.` }
      : { cta: 'forgemarket.nl', tag: 'Link in bio', voice: `${domain(lang)}. Link in bio.` },
  };
}

export const DISCLAIMER = {
  nl: 'Alle merknamen zijn van hun eigenaars. ForgeMarket is niet gelieerd aan de uitgevers van deze games of diensten.',
  en: 'All brand names belong to their owners. ForgeMarket is not affiliated with the publishers of these games or services.',
  de: 'Alle Markennamen gehören ihren Eigentümern. ForgeMarket ist nicht mit den Herausgebern dieser Spiele oder Dienste verbunden.',
  fr: 'Toutes les marques appartiennent à leurs propriétaires. ForgeMarket n’est pas affilié aux éditeurs de ces jeux ou services.',
};

/** Every string a scene prints or speaks. */
const stringsOf = (data) => Object.values(data).flatMap((v) => (Array.isArray(v) ? v.flat() : [v]))
  .filter((v) => typeof v === 'string');

/**
 * The storyboard.
 * angles: the owner's choice, in their order; impossible ones are listed in
 * `skipped` with the reason rather than dropped silently.
 */
export async function buildStoryboard({ productId, angles = [], platform = 'tiktok', length = 30, lang = 'nl' } = {}) {
  const f = await factsFor(productId);
  if (!f) return null;
  const L = LANGS.includes(lang) ? lang : 'nl';
  const P = PLATFORMS[platform] ? platform : 'tiktok';
  const possible = await anglesFor(f);
  const wanted = (angles.length ? angles : possible).filter((a) => ANGLES[a]);
  const nl = lang === 'nl';
  const skipped = wanted.filter((a) => !possible.includes(a)).map((a) => ({ angle: a,
    reason: a === 'math'
      ? (nl ? 'daarvoor zijn twee pakken van deze valuta nodig met een andere prijs per 1.000' : 'needs two packs of this currency at different prices per 1,000')
      : (nl ? 'daarvoor is een pak met een aantal nodig (zoals 1.000 Robux) — dit product is dat niet' : 'needs a countable pack (like 1,000 Robux) — this product is not one') }));
  let chosen = wanted.filter((a) => possible.includes(a));
  if (!chosen.length) chosen = ['trust'];

  const range = f.pack ? await packRange(f.product.category, f.pack.unit) : null;
  const catalogue = Math.floor(Number((await get(`SELECT COUNT(*) AS n FROM products WHERE active = 1`))?.n || 0) / 10) * 10;
  const W = words(f, L, { range, catalogue });

  /* The opening follows the first angle. */
  const hookKey = { trust: 'pw', myth: 'pw', math: 'math', beforeafter: 'math', guest: 'guest', refund: 'refund' }[chosen[0]];
  const target = LENGTHS.includes(Number(length)) ? Number(length) : 30;
  const scenes = [{ type: 'hook', data: W.hook[hookKey] }];
  let budget = target - BASE_DUR.hook - BASE_DUR.end;
  for (const a of chosen) {
    if (budget < BASE_DUR[a] * 0.8 && scenes.length > 1) { skipped.push({ angle: a, reason: nl ? `past niet in ${target} seconden — kies een langere ad` : `does not fit in ${target} seconds` }); continue; }
    scenes.push({ type: a, data: W[a] });
    budget -= BASE_DUR[a];
  }
  scenes.push({ type: 'end', data: W.end });

  /* Images: the product's own, plus two other categories for the guest scene. */
  const product = await get(`SELECT id, name, price, category, metadata FROM products WHERE id = @id`, { id: productId });
  const others = (await all(`SELECT DISTINCT ON (category) id, name, price, category, metadata FROM products
                               WHERE active = 1 AND category <> @c ORDER BY category, price`, { c: product.category }))
    .map(imageOf).filter(Boolean);
  const image = imageOf(product);
  const accent = ACCENT[String(product.category || '').toLowerCase()] || '#22c55e';

  /* Sentences start with a capital, also after a number was written out. */
  const sentence = (t) => String(t || '').replace(/(^|[.!?]\s+)([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
  const out = scenes.map((s, i) => ({
    id: `${i + 1}-${s.type}`, type: s.type,
    accent: s.type === 'trust' ? accent : SCENE_ACCENT[s.type],
    data: { ...s.data, image, images: s.type === 'guest' ? [image, ...others.slice(0, 2)].filter(Boolean) : undefined },
    voice: sentence(s.data.voice),
    minDur: BASE_DUR[s.type],
  }));

  /* The gate, on every printed and spoken word. One failure removes the line's scene. */
  const refused = [];
  const kept = out.filter((s) => {
    const bad = stringsOf({ ...s.data, image: undefined, images: undefined }).map((t) => [t, gate(t, f)]).filter(([, why]) => why);
    if (bad.length) refused.push({ scene: s.id, lines: bad.map(([t, why]) => ({ text: t, why })) });
    return !bad.length || s.type === 'end';
  });
  const disclaimerWhy = gate(DISCLAIMER[L], f);

  const plat = PLATFORMS[P];
  const base = (config.appUrl || 'https://www.forgemarket.nl').replace(/\/$/, '');
  return {
    product: { id: f.product.id, name: f.product.name, price: f.product.price, image, category: f.product.category },
    lang: L, platform: { id: P, ...plat }, length: target,
    angles: { chosen, possible, skipped },
    scenes: kept,
    disclaimer: disclaimerWhy ? null : DISCLAIMER[L],
    estimatedSeconds: kept.reduce((a, s) => a + s.minDur, 0),
    link: `${base}/product/${f.product.id}?utm_source=${plat.utm}&utm_campaign=ad-studio&utm_content=${chosen.join('-')}-${target}s`,
    refused,
  };
}

/** What the studio offers: products (best-selling first), the angles each supports, platforms, voices. */
export async function studioOptions() {
  const rows = await all(`SELECT id, name, price, category, metadata FROM products WHERE active = 1 AND price > 0 ORDER BY category, price`);
  const products = [];
  for (const r of rows) {
    const pack = packOf(r.name);
    const angles = ['trust', 'guest', 'refund', ...(pack ? ['myth', 'beforeafter'] : [])];
    if (pack && await packRange(r.category, pack.unit)) angles.push('math');
    products.push({ id: r.id, name: r.name, price: Number(r.price), category: r.category, image: imageOf(r), angles: ORDER.filter((a) => angles.includes(a)) });
  }
  return {
    products,
    angles: ANGLES,
    platforms: Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [k, { label: v.label, w: v.w, h: v.h }])),
    lengths: LENGTHS,
    langs: LANGS,
    voices: {
      browser: [
        { id: 'nl_BE-rdh-medium', label: 'Rdh — Vlaams, man (gratis, CC0)', lang: 'nl' },
        { id: 'nl_NL-mls-medium', label: 'MLS — Nederlands (gratis, CC BY 4.0)', lang: 'nl' },
        { id: 'en_US-ryan-medium', label: 'Ryan — English (free)', lang: 'en' },
      ],
      premium: {
        elevenlabs: !!config.tts?.elevenlabsKey,
        openai: !!config.tts?.openaiKey,
      },
    },
  };
}

/* ── Premium voice ─────────────────────────────────────────────────────── */

export const VOICE_PROVIDERS = ['elevenlabs', 'openai'];

/**
 * A spoken line from ElevenLabs or OpenAI, with the owner's own key. The text
 * is gated first: a voice is a claim like any other.
 */
export async function synthesizePremium({ text, provider, lang = 'nl', voice = null, facts = { instant: false, delivery: { n: 0 }, market: null, stats: {} } }) {
  const t = String(text || '').trim().slice(0, 600);
  if (!t) { const e = new Error('Nothing to say'); e.status = 400; throw e; }
  const why = gate(t, facts);
  if (why) { const e = new Error(`Refused: ${why.join('; ')}`); e.status = 400; throw e; }
  const tts = config.tts || {};
  if (provider === 'elevenlabs') {
    if (!tts.elevenlabsKey) { const e = new Error('No ElevenLabs key — add it under Keys and connections'); e.status = 400; throw e; }
    const id = voice || tts.elevenlabsVoice || 'pNInz6obpgDQGcFmaJgB';
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': tts.elevenlabsKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: t, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 } }),
    });
    if (!r.ok) { const e = new Error(`ElevenLabs ${r.status}`); e.status = 502; throw e; }
    return Buffer.from(await r.arrayBuffer());
  }
  if (provider === 'openai') {
    if (!tts.openaiKey) { const e = new Error('No OpenAI key — add it under Keys and connections'); e.status = 400; throw e; }
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${tts.openaiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: voice || 'onyx', input: t, response_format: 'mp3',
        instructions: lang === 'nl' ? 'Spreek Nederlands, energiek en duidelijk, als een TikTok-voice-over.' : 'Energetic, clear, like a TikTok voice-over.' }),
    });
    if (!r.ok) { const e = new Error(`OpenAI ${r.status}`); e.status = 502; throw e; }
    return Buffer.from(await r.arrayBuffer());
  }
  const e = new Error('Unknown voice provider'); e.status = 400; throw e;
}
