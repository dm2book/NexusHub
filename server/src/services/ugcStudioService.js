/**
 * UGC presets for Ad Studio: one of the fifty scripts in ugcScripts.js, read
 * against the live catalogue, as a four-beat storyboard the browser renders.
 *
 * A script is available only when every product it names is on sale and its
 * price sums still hold; otherwise it is listed with the reason. Every line,
 * on screen and spoken, passes the same claim gate as the rest of Ad Studio.
 */
import { all } from '../db/index.js';
import { factsFor, gate } from './adScriptService.js';
import { PLATFORMS, DISCLAIMER } from './adStudioService.js';
import { config } from '../config/env.js';
import { number, price, priceText, countText } from '../../../src/lib/adStudio/speak.js';
import { deliveryField } from '../../../src/lib/deliveryInfo.js';
import { iconFor } from '../../../src/lib/sampleCatalog.js';
import { ACCENT } from '../../../scripts/art/design.mjs';
import { UGC_SCRIPTS, THEMES, BEATS, BEAT_DUR, skusOf } from './ugcScripts.js';

class Missing extends Error {}

/** The first number in a product name: "13,500 V-Bucks" → 13500, "1,720 Minecoins — Minecraft" → 1720. */
export function sizeOf(name) {
  const m = /(\d{1,3}(?:[.,]\d{3})+|\d+)/.exec(String(name || ''));
  return m ? Number(m[1].replace(/[.,]/g, '')) : null;
}

/** An address as a voice says it: "forgemarket.nl/refunds" → "forgemarket punt n l slash refunds". */
export function spokenSite(s) {
  return String(s)
    .replace(/vbuckscard/gi, 'V-Bucks card')
    .replace(/\.nl\b/g, ' punt n l').replace(/\.com\b/g, ' punt com')
    .replace(/\//g, ' slash ')
    .replace(/\s+/g, ' ').trim();
}

/** The live products every script may read, by SKU. */
export async function catalogue() {
  const rows = await all(`SELECT id, sku, name, price, category, metadata FROM products WHERE active = 1 AND price > 0 AND sku IS NOT NULL`);
  return new Map(rows.map((r) => [r.sku, { ...r, price: Number(r.price), size: sizeOf(r.name) }]));
}

/**
 * The `$` a script's lines are written against. `mode` 'text' writes for the
 * screen ("€9,99", "13.500"), 'voice' for the voice-over ("negen euro
 * negenennegentig", "dertienduizend vijfhonderd"). An unknown SKU throws, so a
 * script never prints a price it could not read.
 */
export function resolver(cat, mode = 'text') {
  const v = mode === 'voice';
  const row = (sku) => { const r = cat.get(sku); if (!r) throw new Missing(sku); return r; };
  const money = (c) => (v ? price(c, 'nl') : priceText(c, 'nl'));
  const per1k = (sku) => { const r = row(sku); if (!r.size) throw new Missing(sku); return Math.round((r.price / r.size) * 1000); };
  return {
    c: (sku) => row(sku).price,
    p: (sku) => money(row(sku).price),
    per1k,
    per: (sku) => money(per1k(sku)),
    m: (c) => money(Math.round(c)),
    size: (sku) => { const n = row(sku).size; if (!n) throw new Missing(sku); return v ? number(n, 'nl') : countText(n, 'nl'); },
    site: (s) => (v ? spokenSite(s) : s),
    say: (text, spoken) => (v ? spoken : text),
    field: (sku) => deliveryField(String(row(sku).category || '').toLowerCase(), 'nl') || 'gebruikersnaam',
  };
}

/* "1,000 Robux" → "1.000 Robux": a Dutch ad writes thousands the Dutch way. */
export const dutchName = (n) => String(n || '').replace(/(\d),(\d{3})\b/g, '$1.$2');
/* The word the hook writes huge behind the line: "Robux", "V-Bucks", "Steam". */
const wordOf = (n) => (String(n).replace(/^[\d.,\s]+/, '').split(/\s+—\s+|\s+/)[0] || '').toUpperCase();

const sentence = (t) => String(t || '').replace(/(^|[.!?…]\s+)([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
const imageOf = (row) => {
  let meta = {};
  try { meta = JSON.parse(row.metadata || '{}'); } catch { /* none */ }
  const own = meta.image && /^\/(api\/images|products)\//.test(meta.image) ? meta.image : null;
  return iconFor(String(row.category || '').toLowerCase()) || own || null;
};

/** One script against the catalogue: its lines and pictures, or why it cannot run. */
export function resolveScript(s, cat) {
  const T = resolver(cat, 'text'), V = resolver(cat, 'voice');
  try {
    for (const sku of skusOf(s)) T.c(sku);
    if (s.ok && !s.ok(T)) return { ok: false, reason: 'De prijzen kloppen niet meer met de rekensom in dit script' };
    const lines = Object.fromEntries(BEATS.map((b) => [b, { text: s[b](T), voice: sentence(s[b](V)) }]));
    /* A tile: the per-1.000 price only for packs counted in the hundreds and up
       (a "1 Month" or a "€10" card has no meaningful price per 1.000). */
    const card = (sku) => { const r = cat.get(sku); return { name: dutchName(r.name), price: priceText(r.price, 'nl'), per: r.size >= 100 ? priceText(Math.round((r.price / r.size) * 1000), 'nl') : null, image: imageOf(r) }; };
    const props = {
      problem: { kind: s.problemProp || 'text' },
      solution: { kind: s.solutionProp || 'text' },
    };
    if (s.receipt) { props.problem.receipt = card(s.receipt); props.problem.count = s.count || 5; }
    if (s.packs) {
      props.solution.packs = s.packs.map(card);
      /* The last tile is lit only when the script's sum says it is the better buy. */
      props.solution.highlight = !!s.ok;
    }
    if (s.checklist) props.solution.checklist = s.checklist(T);
    if (['username'].includes(props.solution.kind)) props.solution.field = T.field(s.sku);
    if (props.problem.kind === 'scam') props.problem.title = `GRATIS ${String(cat.get(s.sku).name).replace(/^[\d.,\s]+/, '').toUpperCase()}`;
    return { ok: true, lines, props, product: card(s.sku), productRow: cat.get(s.sku) };
  } catch (e) {
    if (e instanceof Missing) return { ok: false, reason: `Product ${e.message} staat niet (actief) in de catalogus` };
    throw e;
  }
}

/** Every string a resolved script prints or speaks. */
const stringsOf = (r) => [
  ...BEATS.flatMap((b) => [r.lines[b].text, r.lines[b].voice]),
  ...(r.props.solution.checklist || []),
  ...(r.props.problem.title ? [r.props.problem.title] : []),
];

/** The fifty scripts, each with what it would say today — or why not. */
export async function ugcOptions() {
  const cat = await catalogue();
  const scripts = UGC_SCRIPTS.map((s) => {
    const r = resolveScript(s, cat);
    return {
      id: s.id, theme: s.theme, title: s.title, sku: s.sku,
      available: r.ok, reason: r.ok ? null : r.reason,
      lines: r.ok ? Object.fromEntries(BEATS.map((b) => [b, r.lines[b].text])) : null,
    };
  });
  return { themes: THEMES, scripts };
}

/**
 * The storyboard for one script: four beats, each with what is on screen, what
 * the voice says, and the picture under it. `null` for an unknown id; an
 * `error` when the script cannot run on today's catalogue or a line fails the gate.
 */
export async function buildUgcBoard({ scriptId, platform = 'tiktok' } = {}) {
  const s = UGC_SCRIPTS.find((x) => x.id === scriptId);
  if (!s) return null;
  const cat = await catalogue();
  const r = resolveScript(s, cat);
  if (!r.ok) return { error: r.reason };
  const f = await factsFor(r.productRow.id);
  const refused = stringsOf(r).map((t) => [t, gate(t, f)]).filter(([, why]) => why);
  if (refused.length) return { error: `Geweigerd door de claim-controle: ${refused.map(([t, why]) => `"${t}" (${why.join('; ')})`).join(', ')}` };

  const P = PLATFORMS[platform] ? platform : 'tiktok';
  const plat = PLATFORMS[P];
  const accent = ACCENT[String(r.productRow.category || '').toLowerCase()] || '#a855f7';
  const scenes = BEATS.map((b, i) => ({
    id: `${i + 1}-${b}`, type: `ugc-${b}`,
    accent: b === 'problem' ? '#f43f5e' : accent,
    data: {
      text: r.lines[b].text,
      ...(b === 'hook' ? { word: wordOf(r.productRow.name) } : {}),
      ...(b === 'problem' ? { prop: r.props.problem } : {}),
      ...(b === 'solution' ? { prop: r.props.solution } : {}),
      product: r.product,
      image: r.product.image,
    },
    voice: r.lines[b].voice,
    minDur: BEAT_DUR[b],
    tail: 0.3,
  }));
  const base = (config.appUrl || 'https://www.forgemarket.nl').replace(/\/$/, '');
  return {
    kind: 'ugc',
    script: { id: s.id, title: s.title, theme: s.theme },
    product: { id: r.productRow.id, name: r.productRow.name, price: r.productRow.price, image: r.product.image, category: r.productRow.category },
    lang: 'nl', platform: { id: P, ...plat }, length: 15,
    angles: { chosen: [], possible: [], skipped: [] },
    scenes,
    disclaimer: gate(DISCLAIMER.nl, f) ? null : DISCLAIMER.nl,
    estimatedSeconds: scenes.reduce((a, x) => a + x.minDur, 0),
    link: `${base}/product/${r.productRow.id}?utm_source=${plat.utm}&utm_campaign=ugc&utm_content=${s.id}`,
    refused: [],
  };
}
