#!/usr/bin/env node
/**
 * Every claim an advert makes, checked against what this shop can actually show.
 *
 * ── WHY A LAYER AND NOT ANOTHER LIST ──────────────────────────────────────
 * This toolkit already refuses to lie in two ways, and both have the same hole.
 * `fill()` drops a caption whose TOKEN has no real value, and `blockedReason()`
 * refuses a variant whose NEEDS are not met — so a line saying "{price}" is
 * safe. Neither looks at a line that contains no tokens at all:
 *
 *     { at: 'buy', text: '4.9/5 — 24/7 support, instant delivery' }
 *
 * passes `fill()` untouched, because there is nothing in it to resolve. The only
 * thing that ever caught a string like that was honest-copy.test.mjs grepping a
 * HARDCODED LIST OF FILES — which meant a new file was invisible until somebody
 * remembered to add it (cuts.mjs was, for exactly one round), and which never
 * saw `--cta=`, `--tagline=` or `--name=` at all, because those arrive on the
 * command line and go straight onto a card.
 *
 * So this is a gate on the RENDERED TEXT, after tokens are filled and after the
 * command line has had its say. Nothing reaches a frame without passing it.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * A claim is allowed only when the evidence proves it. When the data is
 * missing the claim is REWRITTEN to a neutral form that is itself provable, or,
 * where no such form exists, the whole line is DROPPED. Nothing is softened
 * into a vaguer version of the same promise.
 *
 * "Not proven" is the default for everything. An evidence object with nothing
 * in it — which is what you get from a recording that carried no statistics —
 * proves nothing at all, so the failure mode of every bug in this file is a
 * quieter advert rather than a bolder one.
 *
 * ── WHY THESE CLAIMS ──────────────────────────────────────────────────────
 * Each one has been removed from this codebase before and come back, because
 * nothing failed when it did. They are the claims a storefront reaches for when
 * it has no trading history, and this shop has none: 0 completed orders, 0
 * published reviews, 0 competitor observations, and one person answering
 * support.
 */

/** The neutral vocabulary, per language. Nothing here is a promise. */
const NEUTRAL = {
  nl: { support: 'support', delivery: 'levering', fast: 'snel' },
  en: { support: 'support', delivery: 'delivery', fast: 'fast' },
  de: { support: 'Support', delivery: 'Lieferung', fast: 'schnell' },
  fr: { support: 'support', delivery: 'livraison', fast: 'rapide' },
};
const words = (e) => NEUTRAL[e?.lang] || NEUTRAL.en;

/**
 * Everything a claim may be checked against, and nothing else.
 *
 * Absent means NOT PROVEN, never "assume yes" — so a caller that forgets to
 * pass something gets a quieter advert, not a bolder one. `stats` is the shop's
 * own /api/social/stats, which is computed from orders and published reviews
 * and returns nulls until there are some.
 */
export function gatherEvidence({
  product, extras, review, stats, measuredSeconds, observations, suppliers, support, lang = 'nl',
} = {}) {
  /* Number(null) is 0, and 0 is not "missing" — it is the strongest possible
     evidence. A recording with no measured delivery therefore PROVED "in under
     60 seconds", because zero is under sixty. Caught by rendering one; the
     no-argument case was fine (Number(undefined) is NaN) which is exactly why a
     unit test on gatherEvidence() alone did not see it.
     Absent is null, always, whichever spelling of absent arrives. */
  const n = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const s = stats || {};
  return Object.freeze({
    lang,
    /* The shop's own per-product promise: auto-delivery AND a code on the shelf
       right now. It is the one thing that can make "direct" true, and it is
       true of a product rather than of the shop. */
    instant: (extras?.instant ?? product?.instant) === true,
    deliveryLine: product?.deliveryLine || null,
    rating: n(s.rating),
    reviews: n(s.reviews) ?? 0,
    /* The stars of the ONE review this advert quotes, which is a different
       claim from the shop's rating and is proven by a different thing. "★★★★★"
       beside a named buyer's own words says what that buyer gave; "4.9/5" says
       what everybody gave, and this shop has no everybody yet. Conflating them
       would have made a quoted review unpublishable and a made-up average
       publishable, which is the wrong way round. */
    quotedStars: n(review?.stars ?? extras?.review?.stars),
    customers: n(s.customers) ?? 0,
    delivered: n(s.delivered) ?? 0,
    avgDeliverySeconds: n(s.avgDeliverySeconds),
    fastestDeliverySeconds: n(s.fastestDeliverySeconds),
    /* This recording's own payment → code gap. Null unless the payment was real
       — see stopwatch.mjs; a demo order is marked paid the instant it is placed
       and nothing timed against it means anything. */
    measuredSeconds: n(measuredSeconds),
    // Competitor prices actually observed. market_observations is empty.
    observations: n(observations) ?? 0,
    suppliers: n(suppliers) ?? 0,
    /* Nobody is on call. This is a configuration flag rather than a constant so
       a shop that genuinely staffs a rota can turn it on — but it has to be
       turned on, and it defaults to off. */
    alwaysOpen: support?.alwaysOpen === true,
  });
}

/** Evidence that proves nothing — the safe default, and what the tests use. */
export const NO_EVIDENCE = gatherEvidence();

/** The number in "4.9/5" or "under 60 seconds", tolerating a decimal comma. */
const num = (s) => Number(String(s).replace(',', '.'));

const MAGNITUDE = [
  [/\b(thousands|duizenden|tausende|milliers)\b/i, 1000],
  [/\b(hundreds|honderden|hunderte|centaines)\b/i, 100],
];

/**
 * @typedef {object} Claim
 * @property {string} id
 * @property {string} label     what it claims, in plain words
 * @property {RegExp[]} patterns  how it shows up, in every language this shop speaks
 * @property {(m: RegExpExecArray, e: object) => boolean} proven
 * @property {string} proof     where the proof would come from
 * @property {((e: object) => string|null)} [neutral]
 *           what to put in its place. Returning null drops the whole line —
 *           which is the right answer whenever there is no true version of the
 *           sentence, only a quieter false one. An empty string deletes the
 *           matched words and leaves the rest of the line standing.
 * @property {'span'|'line'} [scope]
 *           'span' (the default) splices the replacement in where the claim
 *           was. 'line' replaces the WHOLE line, and is for the claims whose
 *           only honest form is a sentence of its own: the shop's delivery
 *           copy cannot be spliced into the middle of somebody else's clause
 *           without producing "Geleverd Meestal binnen een paar uur".
 */

/** @type {Claim[]} */
export const CLAIMS = [
  {
    id: 'rating',
    label: 'a star rating',
    patterns: [
      /\b(\d(?:[.,]\d)?)\s*(?:\/|out of|op|von|sur)\s*5\b/i,
      /★{1,5}/,
      /\b(five|vijf|fünf|cinq)[\s-]star/i,
      /\b\d(?:[.,]\d)?\s*(?:stars|sterren|sternen|étoiles)\b/i,
    ],
    proof: 'the average of the shop’s published reviews (/api/social/stats)',
    proven: (m, e) => {
      /* A run of stars is one review's, not the shop's — proven by the review
         being quoted, and only when it gave exactly that many. */
      if (/^★+$/.test(m[0])) return e.quotedStars !== null && m[0].length === e.quotedStars;
      if (!e.reviews || e.rating === null) return false;
      const stated = num(m[1]);
      // A rating is only proven by BEING the rating, to the tenth it prints.
      return Number.isFinite(stated) && Math.abs(stated - e.rating) < 0.05;
    },
    // There is no neutral way to state a rating you do not have.
    neutral: () => null,
  },
  {
    id: 'support-247',
    label: 'support around the clock',
    patterns: [
      /\b24\s*[\/x·-]\s*7\b/i,
      /\b24h?\s*\/\s*24\b/i,
      /around the clock/i,
      /altijd (bereikbaar|open|beschikbaar)/i,
      /rund um die uhr/i,
    ],
    proof: 'a staffed rota — support.alwaysOpen, which is off unless configured',
    proven: (m, e) => e.alwaysOpen === true,
    /* The support exists; the clock does not. Deleting the hours leaves the
       sentence standing and true — "24/7 support" becomes "support", "Vragen?
       24/7 support via Discord" keeps its Discord — which is why this one has a
       neutral and the rating does not. Empty, not the word itself: replacing
       "24/7" WITH "support" in "24/7 support" says it twice. */
    neutral: () => '',
  },
  {
    id: 'instant-delivery',
    label: 'instant delivery',
    patterns: [
      /\binstant(ly|e|ané?e?)?[\s-]*(automated[\s-]*)?(deliver\w*|levering|lieferung|livraison)/i,
      /\bdeliver(ed|y)\s+instantly\b/i,
      /\b(direct|onmiddellijk|meteen)\s+geleverd\b/i,
      /\bsofort(ige)?\s+geliefert\b/i,
      /\blivraison\s+instantan\w*/i,
      /\bautomated\s+fulfil?lment\b/i,
    ],
    proof: 'the product’s own instant flag — auto-delivery AND a code on the shelf',
    proven: (m, e) => e.instant === true,
    scope: 'line',
    /* The shop's own sentence for THIS product, which says what actually
       happens. Null when the recording did not carry one, and then the line
       goes rather than being softened into "fast delivery". */
    neutral: (e) => e.deliveryLine,
  },
  {
    id: 'time-promise',
    label: 'a delivery time',
    patterns: [
      /\b(?:in|within|under|binnen|in minder dan|less than|en moins de)\s+(\d+)\s*(seconds?|seconden|sekunden|secondes)\b/i,
      /\bdeliver(ed|y)\s+in\s+seconds\b/i,
      /\b(geleverd|verstuurd)\s+in\s+seconden\b/i,
      /\b(under|binnen|in less than)\s+(a|één|one|1)\s*(minute|minuut|minute)\b/i,
    ],
    proof: 'a measured delivery — this recording’s own gap, or the shop’s average',
    proven: (m, e) => {
      const stated = m[1] ? num(m[1]) : 60;          // "under a minute" is 60
      const measured = e.measuredSeconds ?? e.avgDeliverySeconds;
      return measured !== null && Number.isFinite(stated) && measured <= stated;
    },
    scope: 'line',
    neutral: (e) => e.deliveryLine,
  },
  {
    id: 'price-comparison',
    label: 'a price comparison',
    patterns: [
      /\b(cheapest|goedkoopste|billigste|le moins cher)\b/i,
      /\b(lowest|laagste|niedrigste[rn]?|plus bas)\s+(price|prijs|preis|prix)\b/i,
      /\b(cheaper|goedkoper|billiger|moins cher)\s+(than|dan|als|que)\b/i,
      /\b(beat|verslaan|schlagen)\s+any\s+(price|prijs)\b/i,
      /\b(best|beste|meilleur)\s+(price|prijs|preis|prix)\b/i,
    ],
    proof: 'market_observations — a competitor price this shop actually observed',
    proven: (m, e) => e.observations > 0,
    /* No neutral. A comparison with nothing to compare against is not a bolder
       version of a true sentence, it is a sentence with no subject. */
    neutral: () => null,
  },
  {
    id: 'customer-count',
    label: 'how many people have bought',
    patterns: [
      /\b(thousands|hundreds|duizenden|honderden|tausende|hunderte|milliers|centaines)\s+of\s+(customers|buyers|klanten|kopers|kunden|clients)\b/i,
      /\b(duizenden|honderden|tausende|milliers)\s+(klanten|kopers|kunden|clients)\b/i,
      /\b(\d[\d.,]*)\s*\+?\s*(customers|buyers|klanten|kopers|kunden|clients|orders|bestellingen)\b/i,
      /\b(join|sluit je aan bij|trusted by|vertrouwd door)\b/i,
    ],
    proof: 'the shop’s own order table — distinct buyers, and completed orders',
    proven: (m, e) => {
      const have = Math.max(e.customers, e.delivered);
      if (!have) return false;
      for (const [re, floor] of MAGNITUDE) if (re.test(m[0])) return have >= floor;
      const stated = m[1] ? num(String(m[1]).replace(/[.,]/g, '')) : null;
      return stated !== null && Number.isFinite(stated) ? have >= stated : false;
    },
    neutral: () => null,
  },
  {
    id: 'supplier-network',
    label: 'a supplier network',
    patterns: [/\bmulti-?supplier\s+engine\b/i, /\bsupplier\s+network\b/i],
    proof: 'supplier_products — an active supplier this shop actually buys from',
    proven: (m, e) => e.suppliers > 0,
    neutral: () => null,
  },
];

export const claimById = (id) => CLAIMS.find((c) => c.id === id) || null;

/** Every claim in this text, proven or not. */
export function inspect(text, evidence = NO_EVIDENCE) {
  const out = [];
  if (!text) return out;
  const s = String(text);
  for (const claim of CLAIMS) {
    for (const re of claim.patterns) {
      const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      let m;
      while ((m = rx.exec(s)) !== null) {
        if (m[0] === '') { rx.lastIndex++; continue; }
        out.push({
          id: claim.id, label: claim.label, proof: claim.proof,
          matched: m[0], index: m.index, proven: !!claim.proven(m, evidence), claim,
        });
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/* A replacement leaves the seams of the sentence it was cut out of. */
const tidy = (s) => String(s)
  .replace(/\s{2,}/g, ' ')
  .replace(/\s+([.,!?])/g, '$1')
  .replace(/^[\s—–-]+|[\s—–-]+$/g, '')
  .trim();

/**
 * One line of advert copy, checked.
 *
 * Returns the text to use — the original when everything in it is proven, a
 * rewritten version when every unproven claim has a provable replacement, or
 * null when the line has to go.
 */
export function validateText(text, evidence = NO_EVIDENCE, { depth = 0 } = {}) {
  const findings = inspect(text, evidence);
  const unproven = findings.filter((f) => !f.proven);
  if (!unproven.length) return { text, ok: true, changed: false, dropped: false, findings };

  const drop = () => ({ text: null, ok: false, changed: true, dropped: true, findings });
  const replace = (f) => (f.claim.neutral ? f.claim.neutral(evidence, f) : null);

  /* A line-scoped claim wins outright and ends it. Letting a span splice into
     a line that has already been replaced writes into a string the index no
     longer describes — "24/7 support en instant delivery" came out as "tal
     binnen een paar uur, met de hand", which is a filtergraph-grade bug in a
     layer whose whole job is to be trustworthy. Nothing is lost by stopping:
     the rest of the line went with the replacement. */
  const whole = unproven.find((f) => f.claim.scope === 'line');
  if (whole) {
    const replacement = replace(whole);
    if (replacement == null || replacement === '') return drop();
    const out = tidy(replacement);
    if (!out) return drop();
    if (depth === 0 && inspect(out, evidence).some((f) => !f.proven)) return drop();
    return { text: out, ok: false, changed: true, dropped: false, findings };
  }

  let out = String(text);
  // Right to left, so an earlier finding's index is still valid after a splice.
  for (const f of [...unproven].sort((a, b) => b.index - a.index)) {
    const replacement = replace(f);
    // null drops the line; '' deletes the words and leaves the rest standing.
    if (replacement == null) return drop();
    out = out.slice(0, f.index) + replacement + out.slice(f.index + f.matched.length);
  }
  out = tidy(out);
  if (!out) return { text: null, ok: false, changed: true, dropped: true, findings };

  /* The replacement has to survive the same check, or the layer has swapped one
     unproven claim for another and called it progress. Once only: a neutral
     that needs a neutral is a bug in the table, not something to iterate on. */
  if (depth === 0 && inspect(out, evidence).some((f) => !f.proven)) {
    return { text: null, ok: false, changed: true, dropped: true, findings };
  }
  return { text: out, ok: false, changed: true, dropped: false, findings };
}

/**
 * A set of caption lines, checked.
 *
 * A line whose main text has to go is removed; a second line that has to go
 * takes only itself with it.
 */
export function validateLines(lines = [], evidence = NO_EVIDENCE) {
  const kept = []; const dropped = []; const rewritten = [];
  for (const line of lines) {
    const main = validateText(line.text, evidence);
    if (main.dropped) {
      dropped.push({ line, findings: main.findings.filter((f) => !f.proven) });
      continue;
    }
    const sub = line.sub ? validateText(line.sub, evidence) : null;
    if (main.changed) rewritten.push({ from: line.text, to: main.text, findings: main.findings.filter((f) => !f.proven) });
    if (sub?.changed && !sub.dropped) rewritten.push({ from: line.sub, to: sub.text, findings: sub.findings.filter((f) => !f.proven) });
    if (sub?.dropped) dropped.push({ line: { text: line.sub }, findings: sub.findings.filter((f) => !f.proven) });
    kept.push({ ...line, text: main.text, sub: sub ? sub.text : (line.sub ?? null) });
  }
  return { lines: kept, dropped, rewritten };
}

/** What happened, for the operator — silence would make this layer invisible. */
export function report(result) {
  const out = [];
  for (const r of result.rewritten) {
    const why = r.findings.map((f) => f.label).join(', ');
    out.push(`   ↻ "${r.from}" → "${r.to}"  (${why} — not proven)`);
  }
  for (const d of result.dropped) {
    const why = d.findings.map((f) => `${f.label}: ${f.proof}`).join('; ');
    out.push(`   ✗ "${d.line.text}" dropped — ${why}`);
  }
  return out;
}

// Runnable on its own, so a copywriter can check a line without rendering one.
if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv.slice(2).join(' ');
  if (!text) {
    console.log('\nWhat an advert may say, and what has to prove it:\n');
    for (const c of CLAIMS) console.log(`  ${c.id.padEnd(18)} ${c.label.padEnd(32)} ${c.proof}`);
    console.log('\n  node scripts/ad/claims.mjs "4.9/5 — instant delivery, 24/7 support"\n');
    process.exit(0);
  }
  const r = validateText(text, NO_EVIDENCE);
  console.log(`\n  in   "${text}"`);
  console.log(r.dropped ? '  out   — dropped —' : `  out  "${r.text}"`);
  for (const f of r.findings) {
    console.log(`   ${f.proven ? '✓' : '✗'} ${f.label.padEnd(30)} ${f.proven ? 'proven' : f.proof}`);
  }
  console.log('');
}
