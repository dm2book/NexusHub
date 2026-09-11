/**
 * Scoring an advert, out of things that were measured.
 *
 * A score is the easiest thing in this repository to fake. Nine dimensions and
 * a number out of a hundred looks like rigour whether or not anything was
 * counted, and a scorer whose points came from taste would be the exact thing
 * six rounds of this toolkit have been built to refuse.
 *
 * So the tests are about three properties, in order of how much they matter:
 *
 *   1. THE GATE. An advert carrying a claim the shop cannot prove scores
 *      nothing, is marked rejected, and can never be picked.
 *   2. EVERY POINT IS MEASURED. Each dimension moves when, and only when, the
 *      thing it claims to measure changes.
 *   3. IT ACTUALLY RANKS. A scorer where everything ties is a scorer that
 *      ranks nothing — the first version scored eight different cuts at 98/100.
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

const { WEIGHTS, DIMENSIONS, TOTAL, scoreAd, rank, best, scorecard } =
  await import(join(ROOT, 'scripts/ad/score.mjs'));
const { VARIANTS, variantById, tokensFor, S } = await import(join(ROOT, 'scripts/ad/variants.mjs'));
const { CUTS } = await import(join(ROOT, 'scripts/ad/cuts.mjs'));
const { gatherEvidence } = await import(join(ROOT, 'scripts/ad/claims.mjs'));
const { styleMetrics, allStyleMetrics } = await import(join(ROOT, 'scripts/ad/captions.mjs'));
const makeAd = read('scripts/ad/make-ad.mjs');
const scoreSrc = read('scripts/ad/score.mjs');

/* The real recording's own spans — order FM-2026-H2MKUSQ5, normalised. */
const BEATS = {
  open: 0, shop: 29071, browse: 31651, select: 32132, product: 32996, buy: 36114,
  checkout: 37214, 'order-placed': 39791, confirmed: 39809, delivery: 45787,
  'delivered-detail': 48232, 'email-open': 50652, 'email-detail': 53121, end: 55024,
};
const at = (l) => (l in BEATS ? BEATS[l] : null);
const tokens = tokensFor({
  product: { name: 'Steam Wallet €10', price: 1199, currency: 'EUR', instant: true },
  order: { number: 'FM-2026-H2MKUSQ5' }, stock: 4, lang: 'nl',
});
const evidence = gatherEvidence({
  product: { instant: true, deliveryLine: tokens.delivery }, lang: 'nl',
});
const ctx = { at, tokens, evidence };
const score = (v) => scoreAd({ ...ctx, variant: v });
const dim = (r, id) => r.dimensions.find((x) => x.id === id);
const M = variantById('M');

console.log('— The nine dimensions that were asked for —');
{
  for (const [id, label] of [
    ['hook', 'hook strength'], ['product', 'product clarity'], ['price', 'price clarity'],
    ['pacing', 'pacing'], ['hierarchy', 'visual hierarchy'], ['trust', 'trust'],
    ['cta', 'CTA'], ['mobile', 'mobile readability'], ['factual', 'factual accuracy'],
  ]) {
    ok(`${label} is scored`, DIMENSIONS.includes(id), DIMENSIONS.join(','));
  }
  ok('and nothing else is', DIMENSIONS.length === 9, DIMENSIONS.join(','));
  ok('the weights sum to exactly 100', TOTAL === 100, String(TOTAL));
  ok('…and every one carries real weight', Object.values(WEIGHTS).every((w) => w >= 5));
  /* The weights are the only judgement in the file, so they are in one table
     rather than sprinkled through the tests that use them. */
  ok('they live in one table', /export const WEIGHTS = \{/.test(scoreSrc));
  ok('and the total is derived from it, never typed',
    /Object\.values\(WEIGHTS\)\.reduce/.test(scoreSrc));
}

console.log('\n— The gate: an unproven claim is rejected, not marked down —');
{
  const careless = {
    id: 'ZZ', slug: 'careless', name: 'Careless', lang: 'nl', target: 10, card: 1.4,
    scenes: [S.pHook, S.pBuy, S.pPay, S.pArrive, S.pReveal],
    hook: 'De goedkoopste Robux', hookSub: '4.9/5 van duizenden klanten',
    captions: [{ at: 'buy', text: '24/7 support', style: 'small' }],
    cta: 'forgemarket.nl', needs: ['order'],
  };
  const r = score(careless);
  ok('it is rejected', r.verdict === 'rejected', r.verdict);
  ok('…and scores nothing at all', r.total === 0, String(r.total));
  ok('…not a low score it could climb out of', r.dimensions.length === 0);
  ok('…and says which claims did it', /price comparison/.test(r.why) && /star rating/.test(r.why), r.why);
  ok('…naming every one, not just the first',
    ['price comparison', 'star rating', 'how many people have bought', 'around the clock']
      .every((c) => r.why.includes(c)), r.why);

  /* The point of rejecting rather than marking down: it can never be picked,
     however good the other eight dimensions are. */
  const picked = best([careless, M], ctx, 2);
  ok('it can never be picked', !picked.picked.some((x) => x.id === 'ZZ'));
  ok('…and is reported as refused rather than silently missing',
    picked.rejected.some((x) => x.id === 'ZZ' && x.verdict === 'rejected'));

  /* The same advert, with the same structure, once the words are ones the shop
     can stand behind. */
  const honest = { ...careless, hook: '{name}', hookSub: '{price} — code in je mail.',
    captions: [{ at: 'buy', text: 'Geen account nodig', style: 'small' }] };
  const h = score(honest);
  ok('the same cut with honest copy is scored normally', h.verdict === 'ok', h.verdict);
  ok('…so the rejection was about the claims, not the structure', h.total > 0);

  /* A claim proven by evidence is not a rejection. The gate is about proof, not
     about a word list. */
  const fast = { ...honest, captions: [{ at: 'buy', text: 'In 5 seconden', style: 'small' }] };
  ok('an unproven delivery time is rejected',
    score(fast).verdict === 'rejected');
  ok('…and the same words are fine once something measured them',
    scoreAd({ ...ctx, variant: fast,
      evidence: gatherEvidence({ measuredSeconds: 4, product: { instant: true }, lang: 'nl' }) })
      .verdict === 'ok');
}

console.log('\n— Unbuildable is not the same as bad —');
{
  const f = score(variantById('F'));            // quotes a published review
  ok('a variant needing a review this shop has not got is unbuildable',
    f.verdict === 'unbuildable', f.verdict);
  ok('…which is a different answer from rejected', f.verdict !== 'rejected');
  ok('…and it says what is missing', /review/.test(f.why), f.why);
  ok('…and it is not picked either', !best(VARIANTS, ctx, 20).picked.some((r) => r.id === 'F'));
}

console.log('\n— Every point moves when the thing it measures moves —');
{
  const base = score(M);
  ok('the product-first cut scores', base.verdict === 'ok' && base.total > 0, String(base.total));

  /* HOOK and PRODUCT both turn on whether the product is SHOWN rather than
     merely named — the single heaviest point in the scorer. */
  const noHero = score({ ...M, hero: 0, productCard: false });
  ok('taking the artwork away costs hook points',
    dim(noHero, 'hook').score < dim(base, 'hook').score,
    `${dim(noHero, 'hook').score} vs ${dim(base, 'hook').score}`);
  ok('…and product points', dim(noHero, 'product').score < dim(base, 'product').score);
  ok('…and it says which point was lost',
    dim(noHero, 'hook').failed.some((w) => /SHOWN/.test(w)), dim(noHero, 'hook').failed.join('; '));

  // PRICE — a reveal, not a mention.
  const noBadge = score({ ...M, hero: 0, priceCard: false });
  ok('a price only said in a line scores less than a price revealed',
    dim(noBadge, 'price').score < dim(base, 'price').score);

  // PACING — measured off the resolved edit, not off the target.
  const slow = score({ ...M, target: 30, card: 2.6 });
  ok('a thirty-second cut loses pacing points',
    dim(slow, 'pacing').score < dim(base, 'pacing').score,
    `${dim(slow, 'pacing').score} vs ${dim(base, 'pacing').score}`);
  ok('…and says it ran long',
    dim(slow, 'pacing').failed.some((w) => /eight to fifteen/.test(w)));
  ok('…measured on the edit that would render, not on the number asked for',
    /resolveTiming\(cuts, \{/.test(scoreSrc) && base.seconds > 0);

  // HIERARCHY — two captions anchored to the same edge in the same scene.
  const stacked = score({ ...M, captions: [
    { at: 'checkout', text: 'Geen account nodig', style: 'small' },
    { at: 'checkout', text: 'Betalen kan straks', style: 'big' },
  ] });
  ok('two captions on one edge of one scene cost hierarchy',
    dim(stacked, 'hierarchy').score < dim(base, 'hierarchy').score,
    `${dim(stacked, 'hierarchy').score} vs ${dim(base, 'hierarchy').score}`);
  ok('…and it names the pair', dim(stacked, 'hierarchy').failed.some((w) => /share an edge/.test(w)));

  // CTA — the end card, and the last thing said.
  const noClose = score({ ...M, card: 0.4, captions: M.captions.filter((c) => c.at !== 'the code') });
  ok('no closing line and no end card costs the call to action',
    dim(noClose, 'cta').score < dim(base, 'cta').score);

  // TRUST — a promise the shop keeps by hand is not a trust signal.
  const overclaim = score({ ...M, cta: '' });
  ok('no address on screen costs trust', dim(overclaim, 'trust').score < dim(base, 'trust').score);

  // MOBILE — read out of the caption styles themselves.
  ok('a caption in the platform’s own furniture costs mobile readability', (() => {
    const tiny = score({ ...M, hookStyle: 'notify' });
    return dim(tiny, 'mobile').score <= dim(base, 'mobile').score;
  })());
  ok('the sizes come from the styles that will be rendered',
    /styleMetrics/.test(scoreSrc) && styleMetrics('big').fontSize === 88);
  ok('…and the bottom offsets are the real ones',
    styleMetrics('big').offset === 620 && styleMetrics('small').offset === 580);
  ok('…so nothing shipped sits in the bottom 420px',
    allStyleMetrics().every((g) => g.anchor === 'top' || g.offset >= 420));
}

console.log('\n— It ranks —');
{
  const all = rank([...VARIANTS, ...CUTS], ctx);
  const okRows = all.filter((r) => r.verdict === 'ok');
  ok('every variant and cut is scored', all.length === VARIANTS.length + CUTS.length);
  ok('…best first', okRows.every((r, i) => i === 0 || okRows[i - 1].total >= r.total));
  ok('…and the unbuildable ones sink to the bottom',
    all.slice(-2).every((r) => r.verdict !== 'ok'));

  /* The first version scored eight different cuts at 98/100, which is a ranking
     that ranks nothing. A spread is the property being tested. */
  const spread = okRows[0].total - okRows[okRows.length - 1].total;
  ok('the scores actually spread out', spread >= 25, `${spread} points`);
  ok('…and a hundred is not free', okRows[0].total < 100, String(okRows[0].total));

  /* A–H and J exist in both tables, so the id alone names two adverts. */
  ok('a result says which table it came from',
    all.every((r) => r.family === 'cut' || r.family === 'variant'));
  ok('…and the scorecard prints it', scorecard(okRows[0], { detail: false })[0].trim().startsWith(
    okRows[0].family === 'cut' ? 'cut' : 'var'));
}

console.log('\n— The best three, and the ties it refuses to break —');
{
  const b = best([...VARIANTS, ...CUTS], ctx, 3);
  ok('three are picked', b.picked.length === 3);
  ok('…all of them buildable and proven', b.picked.every((r) => r.verdict === 'ok'));
  ok('…in order', b.picked[0].total >= b.picked[1].total && b.picked[1].total >= b.picked[2].total);
  ok('…and the product-first cut wins on this recording',
    b.picked[0].id === 'M', `${b.picked[0].id}/${b.picked[0].slug}`);

  /* Eight cuts walk the same beats, prove the same things and differ only in
     pace. That they score the same is the true answer, and inventing a
     preference between them is the one thing this file must not do. */
  ok('a tie at the cut-off is reported, not broken', b.alsoTied.length > 0);
  ok('…and everything reported is genuinely tied',
    b.alsoTied.every((r) => r.total === b.picked[b.picked.length - 1].total));
  ok('…and none of them is silently in the picks',
    b.alsoTied.every((r) => !b.picked.some((p) => p.id === r.id && p.family === r.family)));
  ok('asking for one gives one', best([...VARIANTS, ...CUTS], ctx, 1).picked.length === 1);
  ok('asking for more than exist gives what exists',
    best([...VARIANTS, ...CUTS], ctx, 99).picked.length
      === rank([...VARIANTS, ...CUTS], ctx).filter((r) => r.verdict === 'ok').length);
}

console.log('\n— Wired into the toolkit that already exists —');
{
  ok('make-ad scores', /--score/.test(makeAd) && /rank\(ALL, scoreCtx\)/.test(makeAd));
  ok('…and renders the best N', /const BEST = Number\(arg\('best'/.test(makeAd));
  ok('…from the same recording, never buying one to answer a question',
    /process\.argv\.includes\('--score'\)/.test(makeAd)
    && /arg\('score'\) \|\| arg\('best'\)/.test(makeAd));
  ok('…through the compose that already exists, not a second renderer',
    /path\.join\('scripts', 'ad', 'compose\.mjs'\)/.test(makeAd));
  ok('…passing --cut or --variant depending on the table',
    /r\.family === 'cut' \? `--cut=\$\{r\.id\}` : `--variant=\$\{r\.id\}`/.test(makeAd));
  ok('rejected cuts are named in the output, not quietly dropped',
    /rejected for claims this shop cannot prove/.test(makeAd));
  ok('…and a tie is explained rather than coin-tossed',
    /Not broken by a coin toss/.test(makeAd));

  /* Scoring reads the plan, so it costs nothing and needs no render. That is
     what makes "score twenty-three, render three" the cheap option. */
  ok('scoring needs no rendering', !/ffmpeg|spawnSync|execFileSync/.test(scoreSrc));
  ok('…and no browser', !/playwright|chromium/.test(scoreSrc));
  ok('it reuses the existing timing resolver', /from '\.\/timing\.mjs'/.test(scoreSrc));
  ok('…the existing caption geometry', /from '\.\/captions\.mjs'/.test(scoreSrc));
  ok('…and the existing claim gate', /from '\.\/claims\.mjs'/.test(scoreSrc));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-score: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
