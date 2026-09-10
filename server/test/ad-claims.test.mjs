/**
 * No advert may say something this shop cannot show.
 *
 * The toolkit already had two honesty gates and both share one blind spot.
 * `fill()` drops a caption whose TOKEN has no real value; `blockedReason()`
 * refuses a variant whose NEEDS are unmet. Neither looks at a line containing
 * no tokens at all:
 *
 *     { at: 'buy', text: '4.9/5 — 24/7 support, instant delivery' }
 *
 * passes both untouched. The only thing that ever caught a string like that was
 * honest-copy.test.mjs grepping a HARDCODED LIST OF FILES — so a new file was
 * invisible until somebody remembered it (cuts.mjs was, for one round), and
 * `--cta=`, `--tagline=` and `--name=` were never seen at all.
 *
 * These two halves close it:
 *
 *   1. the layer itself — what it proves, what it refuses, and what it puts in
 *      the place of what it refuses
 *   2. every string every advert in this repo would actually render, walked
 *      through it. Not a file list: the exported data structures, so a variant
 *      added anywhere is covered on the day it is added.
 *
 * honest-copy.test.mjs keeps its source grep, and the two are complementary
 * rather than duplicated: that one reads text this one cannot reach (a string
 * built at runtime, a comment that became code), this one reads text that one
 * cannot parse.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

const {
  CLAIMS, claimById, gatherEvidence, NO_EVIDENCE, inspect, validateText, validateLines, report,
} = await import(join(ROOT, 'scripts/ad/claims.mjs'));
const { VARIANTS, tokensFor, fill } = await import(join(ROOT, 'scripts/ad/variants.mjs'));
const { CONCEPTS } = await import(join(ROOT, 'scripts/ad/concepts.mjs'));
const { CONCEPTS_50 } = await import(join(ROOT, 'scripts/ad/concepts-50.mjs'))
  .then((m) => ({ CONCEPTS_50: m.CONCEPTS_50 || m.CONCEPTS || [] }));
const { CUTS } = await import(join(ROOT, 'scripts/ad/cuts.mjs'));
const { HOOKS } = await import(join(ROOT, 'scripts/ad/hooks.mjs'));
const { CLOCK_COPY } = await import(join(ROOT, 'scripts/ad/stopwatch.mjs'));
const compose = read('scripts/ad/compose.mjs');
const cards = read('scripts/ad/cards.mjs');
const record = read('scripts/ad/record.mjs');

/* A shop with a trading history, for the "proven" half. None of these numbers
   are ForgeMarket's — the point is that the SAME sentence flips on evidence. */
const busy = gatherEvidence({
  stats: { rating: 4.9, reviews: 212, customers: 3400, delivered: 4100, avgDeliverySeconds: 22 },
  product: { instant: true, deliveryLine: 'Sent as soon as your payment lands' },
  observations: 14, suppliers: 2, support: { alwaysOpen: true }, lang: 'en',
});
const today = gatherEvidence({
  product: { instant: false, deliveryLine: 'Meestal binnen een paar uur, met de hand' },
  lang: 'nl',
});

console.log('— The seven claims that must not appear unproven —');
{
  /* The list from the brief, verbatim. Each is checked as a whole line so the
     answer is the one an advert would actually get. */
  const banned = [
    ['4.9/5', 'rating'],
    ['24/7 support', 'support-247'],
    ['instant delivery', 'instant-delivery'],
    ['cheapest', 'price-comparison'],
    ['lowest price', 'price-comparison'],
    ['delivered in under 60 seconds', 'time-promise'],
    ['thousands of customers', 'customer-count'],
  ];
  for (const [text, id] of banned) {
    const found = inspect(text, NO_EVIDENCE);
    ok(`"${text}" is caught`, found.some((f) => f.id === id), found.map((f) => f.id).join(',') || 'nothing');
    ok(`…and is not proven by an empty shop`, found.every((f) => !f.proven));
    const r = validateText(text, NO_EVIDENCE);
    ok(`…so it never reaches a frame as written`, r.text !== text);
  }
}

console.log('\n— Missing data means a neutral wording or nothing at all —');
{
  /* The brief: neutral formulation, or leave it out. Both, and which is which
     is a property of the claim rather than a preference. */
  ok('the hours come off "24/7 support", and support stays',
    validateText('24/7 support', today).text === 'support');
  ok('…leaving the rest of the sentence standing',
    validateText('Vragen? 24/7 support via Discord.', today).text === 'Vragen? support via Discord.');
  ok('"instant delivery" becomes the shop’s own sentence for that product',
    validateText('Instant delivery on every order', today).text
    === 'Meestal binnen een paar uur, met de hand');
  ok('…and so does a promise in seconds',
    validateText('Geleverd in 20 seconden', today).text
    === 'Meestal binnen een paar uur, met de hand');

  /* And where there is no true version of the sentence, the line goes. A
     rating you do not have has no quieter form; a comparison with nothing to
     compare against has no subject. */
  for (const text of ['4.9/5 from real buyers', 'The cheapest Robux anywhere',
    'Thousands of customers', 'Lowest price, guaranteed']) {
    ok(`"${text}" is dropped rather than softened`, validateText(text, today).dropped === true);
  }

  /* With no delivery sentence to fall back on, even the rewritable ones go —
     a neutral that does not exist is not a reason to keep the claim. */
  ok('no fallback sentence, no rewrite', validateText('Instant delivery', NO_EVIDENCE).dropped === true);
}

console.log('\n— A claim the evidence proves is left alone —');
{
  ok('a rating that IS the rating', validateText('4.9/5 from real buyers', busy).ok === true);
  ok('…but not one that is not', validateText('4.2/5 from real buyers', busy).dropped === true);
  ok('a time the measurements beat', validateText('Delivered in under 30 seconds', busy).ok === true);
  /* Refused, and this one HAS a true version to fall back on — the shop's own
     delivery sentence — so it is rewritten rather than dropped. Either way the
     number nobody measured does not reach a frame. */
  ok('…but not one they do not', validateText('Delivered in under 10 seconds', busy).ok === false
    && validateText('Delivered in under 10 seconds', busy).text === 'Sent as soon as your payment lands');
  ok('"thousands" when there are thousands', validateText('Thousands of customers', busy).ok === true);
  ok('…but not fifty thousand', validateText('50000 customers', busy).dropped === true);
  ok('"instant delivery" when the product auto-delivers from stock',
    validateText('Instant delivery', busy).ok === true);
  ok('a comparison once a competitor price has been observed',
    validateText('The cheapest Robux anywhere', busy).ok === true);
  ok('around-the-clock support when somebody is rostered',
    validateText('24/7 support', busy).ok === true);

  /* The measurement this recording made itself outranks the shop average — it
     is the delivery the advert is actually showing. */
  const measured = gatherEvidence({ measuredSeconds: 4, lang: 'en' });
  ok('this recording’s own gap proves a time', validateText('In 5 seconds', measured).ok === true);
  ok('…and refuses one it does not reach', validateText('In 3 seconds', measured).dropped === true);
}

console.log('\n— Nothing is proven by accident —');
{
  /* The single most important property here: every default is "not proven".
     A caller that forgets an argument gets a quieter advert, never a bolder
     one, so every bug in this layer fails safe. */
  ok('empty evidence proves nothing',
    CLAIMS.every((c) => c.patterns.every((re) => {
      const probe = { rating: '4.9/5', 'support-247': '24/7', 'instant-delivery': 'instant delivery',
        'time-promise': 'in 60 seconds', 'price-comparison': 'cheapest',
        'customer-count': 'thousands of customers', 'supplier-network': 'multi-supplier engine' }[c.id];
      return inspect(probe, NO_EVIDENCE).every((f) => !f.proven);
    })));
  ok('and gatherEvidence() with no arguments is that empty evidence',
    NO_EVIDENCE.rating === null && NO_EVIDENCE.reviews === 0 && NO_EVIDENCE.customers === 0
    && NO_EVIDENCE.observations === 0 && NO_EVIDENCE.instant === false
    && NO_EVIDENCE.alwaysOpen === false && NO_EVIDENCE.measuredSeconds === null);
  /* The bug this layer could least afford, found by rendering an advert rather
     than by testing gatherEvidence(): Number(null) is 0, so a MISSING
     measurement arrived as "0 seconds" and proved every time promise, because
     zero is under sixty. Every spelling of absent, because the no-argument case
     passed happily while an explicit null did not. */
  for (const missing of [null, undefined, '']) {
    const e = gatherEvidence({
      measuredSeconds: missing, observations: missing,
      stats: { rating: missing, avgDeliverySeconds: missing, customers: missing },
    });
    ok(`${JSON.stringify(missing)} is missing, not zero`,
      e.measuredSeconds === null && e.avgDeliverySeconds === null && e.rating === null);
    ok(`…so it proves no delivery time`, validateText('In under 60 seconds', e).ok === false);
    ok(`…and no rating`, validateText('4.9/5', e).ok === false);
  }

  ok('a shop is never on call unless it says so',
    gatherEvidence({ support: {} }).alwaysOpen === false
    && gatherEvidence({ support: { alwaysOpen: 'yes' } }).alwaysOpen === false);
  ok('every claim says what would prove it',
    CLAIMS.every((c) => typeof c.proof === 'string' && c.proof.length > 20));
  ok('every claim has a plain-words label', CLAIMS.every((c) => c.label && !/\{|\}/.test(c.label)));
  ok('ids are unique', new Set(CLAIMS.map((c) => c.id)).size === CLAIMS.length);
  ok('and addressable', CLAIMS.every((c) => claimById(c.id) === c));

  /* A neutral that would itself need a neutral is a bug in the table, and
     swapping one unproven claim for another is the failure this layer exists
     to prevent. */
  for (const c of CLAIMS) {
    const n = c.neutral ? c.neutral(today) : null;
    ok(`${c.id}: its replacement is itself provable`,
      n === null || n === '' || inspect(n, today).every((f) => f.proven), String(n));
  }
}

console.log('\n— Every advert in this repo, checked —');
{
  /* Not a list of files. The exported structures, so a variant added anywhere
     is covered the day it is added rather than the day somebody remembers to
     add its file here. */
  const strings = [];
  const add = (where, text) => { if (text && typeof text === 'string') strings.push({ where, text }); };
  const walk = (label, set) => {
    for (const v of set) {
      add(`${label} ${v.id} hook`, v.hook);
      add(`${label} ${v.id} hookSub`, v.hookSub);
      add(`${label} ${v.id} cta`, v.cta);
      for (const c of v.captions || []) { add(`${label} ${v.id} caption`, c.text); add(`${label} ${v.id} sub`, c.sub); }
      for (const o of v.onScreen || []) add(`${label} ${v.id} onScreen`, o);
      add(`${label} ${v.id} post`, v.post?.text);
    }
  };
  walk('variant', VARIANTS);
  walk('concept', CONCEPTS);
  walk('concept50', CONCEPTS_50);
  walk('cut', CUTS);
  for (const h of HOOKS) { add(`hook ${h.id}`, h.text); add(`hook ${h.id} sub`, h.sub); }
  for (const [lang, c] of Object.entries(CLOCK_COPY)) { add(`clock ${lang}`, c.span); add(`clock ${lang}`, c.done); }

  ok('there is something to check', strings.length > 200, `${strings.length}`);

  /* Checked against an EMPTY shop, because that is what ForgeMarket is: 0
     completed orders, 0 published reviews, 0 competitor observations, nobody on
     a rota. A line that survives this survives anywhere. */
  const bad = [];
  for (const { where, text } of strings) {
    /* Tokens first — a line saying "{delivery}" is checked as the sentence it
       becomes, not as a template. Both the instant and the hand-delivered
       product, because a variant is cut from whichever it films. */
    for (const instant of [true, false]) {
      const tokens = tokensFor({
        product: { name: 'Steam Wallet €10', price: 1199, currency: 'EUR', instant },
        order: { number: 'FM-2026-ABCD1234' }, stock: 3,
        review: { author: 'Sanne', body: 'Prima', stars: 5 }, lang: 'nl',
      });
      const filled = fill(text, tokens);
      if (!filled) continue;                     // token-gated: it never renders
      const ev = gatherEvidence({
        product: { instant, deliveryLine: tokens.delivery },
        // The same review the tokens quoted, so its stars are judged against it.
        review: { author: 'Sanne', body: 'Prima', stars: 5 }, lang: 'nl',
      });
      const unproven = inspect(filled, ev).filter((f) => !f.proven);
      if (unproven.length) bad.push(`${where}: "${filled}" — ${unproven.map((f) => f.label).join(', ')}`);
    }
  }
  ok('no advert in this repo makes a claim this shop cannot show',
    bad.length === 0, bad.slice(0, 6).join(' | '));
}

console.log('\n— The generator cannot be talked past —');
{
  ok('compose checks every caption before rendering one',
    /validateLines\(capLines, evidence\)/.test(compose));
  ok('…after the tokens are filled, so it sees the sentence',
    compose.indexOf('const hook = fill(hookText, tokens)') < compose.indexOf('validateLines(capLines'));
  ok('…and before the captions are drawn',
    compose.indexOf('validateLines(capLines') < compose.indexOf('await renderCaptions('));
  ok('it says what it rewrote and what it dropped',
    /⚖  claims: \$\{checked\.rewritten\.length\} rewritten/.test(compose));
  ok('the corner tag is checked too — it is command-line text',
    /const ctaChecked = validateText\(variant\?\.cta \|\| CTA_TEXT, evidence\)/.test(compose)
    && /const ctaText = ctaChecked\.text/.test(compose));

  /* The end card and the tag were the most-seen text this toolkit makes and the
     least checked: typed on the command line, straight onto a PNG. */
  ok('the cards check their copy', /validateText\(text, gatherEvidence/.test(cards));
  ok('…and refuse rather than quietly editing authored copy',
    /process\.exit\(1\)/.test(cards) && /Change the copy/.test(cards));
  ok('…including the tagline and the name', /said\('--tagline'/.test(cards) && /said\('--name'/.test(cards));

  /* Evidence has to come from the shop, or "proven" means "the generator said
     so". record.mjs reads the site it is filming. */
  ok('the recorder captures the shop’s own figures', /\/api\/social\/stats/.test(record));
  ok('…and a shop that does not serve them proves nothing',
    /every statistical claim stays unproven/.test(record));
  ok('compose feeds those figures to the gate', /stats: extras\.stats/.test(compose));
  ok('…and this recording’s own measured delivery',
    /measuredSeconds: tokens\.deliverySeconds/.test(compose));
}

console.log('\n— The report is legible —');
{
  const r = validateLines([
    { text: '4.9/5 — the best', style: 'big' },
    { text: 'Vragen? 24/7 support', style: 'small' },
    { text: 'Steam Wallet €10', style: 'small' },
  ], today);
  ok('a dropped line is gone', r.lines.length === 2);
  ok('a rewritten line is kept, rewritten', r.lines[0].text === 'Vragen? support');
  ok('a clean line is untouched', r.lines[1].text === 'Steam Wallet €10');
  const lines = report(r);
  ok('the report names both', lines.length === 2);
  ok('…and says what would have proved the dropped one',
    lines.some((l) => /market_observations|published reviews/.test(l)), lines.join(' | '));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-claims: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
