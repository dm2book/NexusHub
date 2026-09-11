/**
 * The first two seconds, generated per product.
 *
 * A hook used to be one line on the variant, so every advert cut from variant K
 * opened with the same sentence whatever it was selling. This pins the
 * catalogue that replaced it, and — far more importantly — the rule that keeps
 * it honest:
 *
 *   a hook may only say something the recording can prove.
 *
 * That rule is not a style preference here. This shop has 0 completed orders,
 * 0 published reviews and 0 competitor observations behind it, so the openings
 * that would perform best in a feed ("4.9/5", "instant delivery", "goedkoper
 * dan X") are exactly the ones it is not entitled to. The tests below try to
 * make each of those appear anyway, from empty data, and require that the
 * generator refuses.
 *
 * The second requirement is cheapness: one recording, many openings. Buying
 * something and filming it costs money, consumes a code and trips the shop's
 * own order limiter; changing the first two seconds costs nothing, and must not
 * cost a re-recording.
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

const { HOOKS, HOOK_TYPES, hookById, eligibleHooks, hookBlockedReason } =
  await import(join(ROOT, 'scripts/ad/hooks.mjs'));
const { tokensFor, fill, variantById } = await import(join(ROOT, 'scripts/ad/variants.mjs'));
const compose = read('scripts/ad/compose.mjs');
const makeAd = read('scripts/ad/make-ad.mjs');

/* One real purchase, the way the recorder writes it down: a product row, an
   order with its own status history, a published review, a disclosed stock
   count. Everything a hook is allowed to draw on, and nothing else. */
const paidAt = '2026-09-08T12:00:00.000Z';
const doneAt = '2026-09-08T12:00:04.000Z';
const everything = {
  product: { name: '1000 Robux', price: 1199, currency: 'EUR', instant: true },
  order: {
    number: 'FM-2026-ABCD1234',
    history: [{ to: 'payment_received', at: paidAt }, { to: 'completed', at: doneAt }],
  },
  review: { body: 'Code was er meteen.', author: 'Sanne', stars: 5 },
  stock: 3,
  lang: 'nl',
  provenance: { live: true, realPayment: true },
};
const rich = tokensFor(everything);
/* And the recording this shop can actually make today: a real product, a test
   payment, no review, no disclosed stock. */
const today = tokensFor({
  product: { name: 'Steam Wallet €10', price: 1199, currency: 'EUR', instant: true },
  order: { number: 'FM-2026-H2MKUSQ5' }, lang: 'nl',
  provenance: { live: true, realPayment: false },
});
const nothing = tokensFor({ product: {}, lang: 'nl' });

console.log('— The catalogue is the one that was asked for —');
{
  ok('at least ten hook variants', HOOKS.length >= 10, `${HOOKS.length}`);
  for (const type of ['product-first', 'price-first', 'speed-first', 'problem-solution',
    'testimonial', 'watch-me-buy', 'stopwatch']) {
    ok(`there is a ${type} hook`, HOOKS.some((h) => h.type === type));
  }
  ok('and no eighth kind crept in', HOOK_TYPES.length === 7, HOOK_TYPES.join(', '));
  ok('ids are unique — they name the output file',
    new Set(HOOKS.map((h) => h.id)).size === HOOKS.length);
  ok('ids are filename-safe', HOOKS.every((h) => /^[a-z0-9-]+$/.test(h.id)));
  ok('every hook says where its claim comes from',
    HOOKS.every((h) => typeof h.proves === 'string' && h.proves.length > 20));
}

console.log('\n— Nothing may be claimed that the data cannot prove —');
{
  /* The gate is `needs`, so a token used in a line but left out of `needs`
     would be a claim nobody checks. */
  const tokensIn = (s) => [...String(s || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  for (const h of HOOKS) {
    const used = [...new Set([...tokensIn(h.text), ...tokensIn(h.sub)])];
    ok(`${h.id}: every token it renders is declared in needs`,
      used.every((t) => h.needs.includes(t)),
      used.filter((t) => !h.needs.includes(t)).join(', '));
  }

  /* The numbers this shop has repeatedly been asked not to invent. A hook is a
     literal string, so this is checkable by reading it. */
  const forbidden = [/\d[.,]\d\s*\/\s*5/, /\b\d+\s*\/\s*5\b/, /24\s*\/\s*7/,
    /\b\d[\d.,]*\+?\s*(klanten|customers|reviews|beoordelingen|verkocht|sold)\b/i,
    /goedkoper dan|cheaper than|beste prijs|best price|laagste prijs/i];
  for (const h of HOOKS) {
    const line = `${h.text} ${h.sub || ''}`;
    ok(`${h.id}: no invented rating, count or comparison`,
      !forbidden.some((re) => re.test(line)), line);
  }

  /* Every free-standing number in a hook has to be a token, because a token is
     the only kind that gets checked. "1.000" in "per 1.000" is the unit of the
     rate beside it, not a claim about this shop. */
  for (const h of HOOKS) {
    const withoutTokens = `${h.text} ${h.sub || ''}`.replace(/\{\w+\}/g, '');
    ok(`${h.id}: no hard-coded figure`,
      !/\d/.test(withoutTokens.replace('1.000', '')), withoutTokens);
  }
}

console.log('\n— With no data, no hook is possible —');
{
  ok('an empty recording produces nothing', eligibleHooks(nothing, fill).length === 0);
  ok('…and every one of them says why',
    HOOKS.every((h) => typeof hookBlockedReason(h, nothing) === 'string'));
  ok('the reason names the token that is missing',
    hookBlockedReason(hookById('price'), nothing).includes('{price}'),
    hookBlockedReason(hookById('price'), nothing));
}

console.log('\n— Social proof needs a review that exists —');
{
  const ids = eligibleHooks(today, fill).map((h) => h.id);
  ok('no review, no stars', !ids.includes('review-stars'));
  ok('no review, no quote', !ids.includes('review-quote'));
  ok('…and the reason is the review, not something vague',
    hookBlockedReason(hookById('review-quote'), today).includes('{reviewBody}'));

  const withReview = eligibleHooks(rich, fill).map((h) => h.id);
  ok('a published review unlocks both', withReview.includes('review-stars')
    && withReview.includes('review-quote'));
  ok('the stars are the ones the review carries', rich.reviewStars === '★★★★★');
  ok('and the quote is the reviewer’s own words',
    fill(hookById('review-quote').text, rich).includes('Code was er meteen.'));
}

console.log('\n— A stopwatch may only show a time that was measured —');
{
  const ids = eligibleHooks(today, fill).map((h) => h.id);
  ok('a test payment gives no seconds', today.deliverySeconds === null);
  ok('…so neither stopwatch hook is made',
    !ids.includes('stopwatch') && !ids.includes('countdown'));

  ok('a real payment with real transitions does', rich.deliverySeconds === '4');
  ok('…and the hook reads back the measured number',
    fill(hookById('stopwatch').text, rich) === '4 seconden.');

  /* The failure modes that would each produce a true-but-unusable number. */
  const secs = (o, p) => tokensFor({ product: everything.product, order: o, provenance: p }).deliverySeconds;
  ok('a live-looking order on a demo payment is still refused',
    secs(everything.order, { realPayment: false }) === null);
  ok('sub-second is refused — it reads as a lie even when it is not',
    secs({ history: [{ to: 'payment_received', at: paidAt },
      { to: 'completed', at: '2026-09-08T12:00:00.400Z' }] }, { realPayment: true }) === null);
  ok('an order that never completed is refused',
    secs({ history: [{ to: 'payment_received', at: paidAt }] }, { realPayment: true }) === null);
  ok('and a gap longer than ten minutes is not a hook',
    secs({ history: [{ to: 'payment_received', at: paidAt },
      { to: 'completed', at: '2026-09-08T12:20:00.000Z' }] }, { realPayment: true }) === null);
}

console.log('\n— Scarcity and unit price come from the product row —');
{
  const ids = eligibleHooks(rich, fill).map((h) => h.id);
  ok('a disclosed stock count unlocks the scarcity hook', ids.includes('last-few'));
  ok('…and it is the count itself', fill(hookById('last-few').text, rich) === 'Nog 3 op voorraad.');
  const many = tokensFor({ ...everything, stock: 40 });
  ok('a count the shop does not publish is not published here either',
    !eligibleHooks(many, fill).map((h) => h.id).includes('last-few'), String(many.stockLeft));

  ok('a countable pack has a per-1.000 price', rich.perThousand === '€11.99');
  ok('…rendered as a rate, not as a claim about anyone else',
    fill(hookById('per-thousand').text, rich) === '€11.99 per 1.000');
  ok('a currency-denominated card has none', today.perThousand === null);
  ok('…so that hook is not offered for it',
    !eligibleHooks(today, fill).map((h) => h.id).includes('per-thousand'));
}

console.log('\n— What today’s footage can honestly open with —');
{
  const ids = eligibleHooks(today, fill).map((h) => h.id);
  /* Nine of fifteen on a shop with no reviews and no real payment behind it,
     and ten once the product page is disclosing a stock count. The point of the
     catalogue is that the honest set is still large. */
  ok('a real product with no review still gives nine openings', ids.length === 9, `${ids.length}`);
  ok('…and ten when the shelf count is one the shop publishes',
    eligibleHooks(tokensFor({
      product: { name: 'Steam Wallet €10', price: 1199, currency: 'EUR', instant: true },
      order: { number: 'FM-2026-H2MKUSQ5' }, stock: 2, lang: 'nl',
      provenance: { live: true, realPayment: false },
    }), fill).length === 10);
  ok('the product itself is always one of them', ids.includes('product'));
  ok('guest checkout is provable — the recording buys without signing in',
    ids.includes('no-account'));
  ok('the refund line is provable — it is on the policy page', ids.includes('money-back'));
  ok('every eligible hook fills both its lines', eligibleHooks(today, fill)
    .every((h) => fill(h.text, today) && (!h.sub || fill(h.sub, today))));
  ok('everything real unlocks the whole catalogue',
    eligibleHooks(rich, fill).length === HOOKS.length,
    `${eligibleHooks(rich, fill).length}/${HOOKS.length}`);
}

console.log('\n— Lookup —');
{
  ok('by id', hookById('watch-me')?.type === 'watch-me-buy');
  ok('case does not matter — it comes off a command line', hookById('Watch-Me')?.id === 'watch-me');
  ok('an unknown id is null, not a guess', hookById('nope') === null);
  ok('…and null does not throw', hookById(undefined) === null);
}

console.log('\n— The editor takes a named hook —');
{
  ok('compose accepts --hook', /arg\('hook'/.test(compose));
  ok('an unknown hook stops the render', /no hook "\$\{HOOK_ID\}"/.test(compose));
  ok('a hook the footage cannot support exits 2, not 1',
    /hookBlockedReason[\s\S]{0,220}process\.exit\(2\)/.test(compose));
  ok('…and says which token was missing rather than falling back silently',
    /⏭[\s\S]{0,80}\$\{why\}/.test(compose));
  ok('the hook id is in the filename, so a batch does not overwrite itself',
    /hookTag[\s\S]{0,200}baseName/.test(compose) && /\$\{hookTag\}/.test(compose));
  ok('HOOK_ID is read before the filename uses it',
    compose.indexOf("arg('hook'") < compose.indexOf('const hookTag'));
  ok('without --hook the variant’s own hook is still used',
    /let hookText = variant\.hook/.test(compose));
}

console.log('\n— One recording, many openings —');
{
  ok('the wrapper takes --hooks', /arg\('hooks'\)/.test(makeAd));
  ok('--hooks=all walks every eligible opening', /hooksArg === 'all'/.test(makeAd));
  ok('--hooks=list reports without rendering anything',
    /hooksArg === 'list'/.test(makeAd) && /process\.exit\(0\)/.test(makeAd));
  ok('a --hooks run reuses the recording instead of buying again',
    /const REUSE = [\s\S]{0,120}arg\('hooks'\)/.test(makeAd));
  ok('…and nothing is filmed when there is a take already',
    /if \(REUSE && alreadyRecorded\)/.test(makeAd));
  ok('a missing recording is refused rather than silently recorded over',
    /nothing to reuse in \$\{OUT\}/.test(makeAd));
  ok('a skipped hook does not fail the batch', /r\.status === 2\)\s*skipped\.push/.test(makeAd));
  ok('a broken one does', /✖ hook \$\{h\.id\} failed to render/.test(makeAd));
  ok('the hooks are judged against the same side files compose reads',
    /order\.json/.test(makeAd) && /extras\.json/.test(makeAd));
  ok('…and against the recording’s own provenance',
    /provenance: manifest\.provenance/.test(makeAd));
  ok('the end cards are reused too — only the opening changes',
    /REUSE && fs\.existsSync\(path\.join\(OUT, 'endcard\.png'\)\)/.test(makeAd));
}

console.log('\n— Nothing that already worked was disturbed —');
{
  /* The default moved from K to the flagship, which is what a hook batch is
     for. Hardcoded to K, `--variant=N --hooks=all` quietly rendered eight
     openings of a different advert. */
  ok('a hook batch defaults to the flagship',
    /variantById\(arg\('variant'\) \|\| 'N'\)/.test(makeAd));
  ok('…and honours whatever was actually asked for',
    /cutById\(arg\('cut'\) \|\| ''\) \|\| variantById\(arg\('variant'\)/.test(makeAd));
  ok('the variants still resolve', !!variantById('performance') && !!variantById('A'));
  ok('their own hooks are untouched', variantById('performance').hook.includes('{name}'));
  ok('and --variants= still builds variants, not hooks',
    /arg\('variants'\) === 'all'/.test(makeAd));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-hooks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
