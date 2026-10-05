/**
 * Ad concepts: the 100 TikTok concepts of ads/conceptLibrary.js, filled in for
 * one product from its facts and passed through the claim gate.
 *
 * A concept is produced only when every fact it `needs` exists, and only when
 * every string a viewer would see or hear — hook, on-screen text per beat,
 * voice-over, caption, CTA — passes adScriptService.gate unchanged. Anything
 * else is listed under `skipped`, with the missing fact or the failed claim,
 * so the owner sees why a concept is not on the list instead of a padded one.
 *
 * Creator-made formats (UGC, the forum-thread style) get "#advertentie" in the
 * caption: the Reclamecode Social Media asks for it, and a creator script that
 * hides that it is an ad is the kind of trick this shop does not play.
 */
import { factsFor, gate } from './adScriptService.js';
import { CONCEPTS, NEEDS, FORMATS, FORMAT_LABEL, DISCLOSE } from './ads/conceptLibrary.js';
import { all } from '../db/index.js';
import { config } from '../config/env.js';

const DISCLOSURE = '#advertentie';
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Every string a viewer meets in this rendered concept, labelled. */
export function visibleStrings(r) {
  const out = [['hook', r.hook], ['caption', r.caption], ['cta', r.cta]];
  if (r.vo) out.push(['vo', r.vo]);
  r.beats.forEach((b, i) => { out.push([`beat ${i + 1}`, b.text]); });
  return out.filter(([, s]) => clean(s));
}

/** Render one concept for these facts, or return why it cannot be. */
export function renderConcept(concept, f, { base = config.appUrl } = {}) {
  const missing = concept.needs.filter((n) => !NEEDS[n]?.test(f)).map((n) => NEEDS[n]?.label || n);
  if (missing.length) return { skipped: { id: concept.id, title: concept.title, format: concept.format, why: missing.map((m) => `needs ${m}`) } };
  let r;
  try {
    r = {
      id: concept.id, format: concept.format, formatLabel: FORMAT_LABEL[concept.format], title: concept.title,
      angle: concept.angle, persona: concept.persona, sound: concept.sound,
      hook: clean(concept.hook(f)),
      beats: concept.beats(f).map(([time, shot, text]) => ({ time, shot: clean(shot), text: clean(text) })),
      vo: clean(concept.vo ? concept.vo(f) : ''),
      caption: clean(concept.caption(f)),
      cta: clean(concept.cta(f)),
    };
  } catch (e) {
    return { skipped: { id: concept.id, title: concept.title, format: concept.format, why: [`could not be filled in: ${e.message}`] } };
  }
  if (DISCLOSE.has(concept.format) && !r.caption.includes(DISCLOSURE)) r.caption = `${r.caption} ${DISCLOSURE}`;
  const failed = [];
  for (const [where, text] of visibleStrings(r)) {
    const reasons = gate(text, f);
    if (reasons) failed.push(`${where}: ${reasons.join('; ')}`);
  }
  if (failed.length) return { skipped: { id: concept.id, title: concept.title, format: concept.format, why: failed } };
  /* A tagged link per concept, so Ad Intelligence can tell them apart once
     they run — the same utm scheme the scripts use. */
  const site = String(base || 'https://www.forgemarket.nl').replace(/\/$/, '');
  r.link = `${site}/product/${encodeURIComponent(f.product.id)}?utm_source=tiktok&utm_medium=paid&utm_campaign=concepts&utm_content=${encodeURIComponent(concept.id)}`;
  r.seconds = Number(String(r.beats.at(-1)?.time || '').split('–')[1]?.replace(/\D/g, '')) || null;
  return { concept: r };
}

/** All concepts for one product, grouped by format, with what was skipped and why. */
export async function generateConcepts(productId, { now = Date.now(), facts = null } = {}) {
  const f = facts || await factsFor(productId, { now });
  if (!f) return null;
  const concepts = [], skipped = [];
  for (const c of CONCEPTS) {
    const out = renderConcept(c, f);
    if (out.concept) concepts.push(out.concept); else skipped.push(out.skipped);
  }
  const byFormat = Object.fromEntries(FORMATS.map((k) => [k, concepts.filter((c) => c.format === k).length]));
  return { product: f.product, total: CONCEPTS.length, produced: concepts.length, byFormat, formats: FORMATS, formatLabels: FORMAT_LABEL, concepts, skipped };
}

/** One concept as a shooting script, for the phone or a creator. */
export function shootingScript(c, productName) {
  const lines = [
    `# ${c.title} (${c.formatLabel})`, `Product: ${productName}`, '',
    `**Hook (eerste frame):** ${c.hook}`, `**Waarom het werkt:** ${c.angle}`,
    `**Wie:** ${c.persona} · **Geluid:** ${c.sound}${c.seconds ? ` · **Lengte:** ±${c.seconds}s` : ''}`, '',
    '| Tijd | Beeld | Tekst op beeld |', '|---|---|---|',
    ...c.beats.map((b) => `| ${b.time} | ${b.shot} | ${b.text} |`), '',
  ];
  if (c.vo) lines.push(`**Voice-over:** ${c.vo}`, '');
  lines.push(`**Caption:** ${c.caption}`, `**CTA:** ${c.cta}`, `**Link:** ${c.link}`, '');
  return lines.join('\n');
}

/** Every concept of a product as one Markdown document. */
export async function conceptsMarkdown(productId) {
  const out = await generateConcepts(productId);
  if (!out) return null;
  const head = [`# TikTok-concepten — ${out.product.name}`, '',
    `${out.produced} van ${out.total} concepten passen bij dit product. Elk getal komt uit echte gegevens; wat niet bewezen kan worden, staat er niet in.`, ''];
  return head.join('\n') + out.concepts.map((c) => shootingScript(c, out.product.name)).join('\n---\n\n');
}

/** The products to pick from: active ones, best sellers first. */
export async function conceptProducts() {
  return all(`SELECT p.id, p.name, p.category,
                     (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                       WHERE oi.product_id = p.id AND o.status = 'completed') AS sold
                FROM products p WHERE p.active = 1 ORDER BY sold DESC, p.name LIMIT 300`).catch(() => []);
}
