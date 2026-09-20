/**
 * Where a shot points, what may be spliced between two shots, and who is
 * allowed to be in frame.
 *
 * Three things the ad toolkit could not do, and one it was doing wrongly:
 *
 *   · a push could only ever aim at the middle of the picture, so the shot of
 *     the price aimed at whatever happened to be beside it — while record.mjs
 *     had been measuring the price's bounding box since the first version and
 *     nothing had ever read it;
 *   · a still could only be the FIRST thing or the LAST thing, so the whole
 *     middle of the grammar — the held card, the proof, the pattern interrupt —
 *     was unreachable;
 *   · the seller's side of a hand-delivered order could not be filmed at all,
 *     which is the one shot a marketplace of third-party sellers structurally
 *     cannot make;
 *   · and `networkidle`, which this storefront never reaches.
 *
 * The privacy assertions are the important ones. Filming the fulfilment queue
 * means pointing a camera at a list of other people's orders, and four attempts
 * at masking it each looked right in the source and each still leaked a frame
 * or two into the rendered file. So the rule here is not "it is masked" — it is
 * that the recorder MEASURES what is on screen and the cut does not use the
 * list at all.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxCentre, resolveInserts, shiftAt, CAPTURE } from '../../scripts/ad/framing.mjs';
import { VARIANTS, blockedReason } from '../../scripts/ad/variants.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const record = read('scripts/ad/record.mjs');
const compose = read('scripts/ad/compose.mjs');
const cards = read('scripts/ad/cards.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

console.log('\n— A push aims at something measured —');
{
  // The real box out of a real beats.json: the price on a 540x960 capture.
  const c = boxCentre({ x: 20, y: 665, width: 106, height: 36 });
  ok('the centre of a box is where the box is',
    Math.abs(c.cx - 73 / CAPTURE.w) < 1e-6 && Math.abs(c.cy - 683 / CAPTURE.h) < 1e-6,
    JSON.stringify(c));
  ok('a box with no size is not a target', boxCentre({ x: 1, y: 1, width: 0, height: 9 }) === null);
  ok('and neither is no box at all', boxCentre(null) === null && boxCentre(undefined) === null);

  /* Clamped away from the edges. A crop window centred on something at the very
     edge is a window mostly off the picture, and ffmpeg slides it back without
     saying so — which reads as the aim silently not working. */
  const edge = boxCentre({ x: 538, y: 958, width: 4, height: 4 });
  ok('a target at the edge is pulled back into the frame', edge.cx <= 0.95 && edge.cy <= 0.95,
    JSON.stringify(edge));

  ok('compose reads the measured box rather than the centre of the frame',
    /boxCentre\(/.test(compose) && /zoomAt/.test(compose));
  ok('…and falls back to a gentle push when nothing was measured',
    /c\.zoom === 'at'/.test(compose));
}

console.log('\n— A card can go in the middle —');
{
  const cuts = [
    { from: 'product', label: 'the product' },
    { from: 'buy', label: 'buy' },
    { from: 'email-open', label: 'the email' },
  ];
  const r = resolveInserts(
    [{ before: 'email-open', card: 'statement.png', len: 1.3 }], cuts, { exists: () => true });
  ok('an insert lands before the scene it names', r.placed.length === 1 && r.placed[0].at === 2);
  ok('…and its length comes out of the budget', r.total === 1.3);

  /* Back to front, so splicing an earlier one cannot move the index a later one
     was measured against. */
  const many = resolveInserts([
    { before: 'product', card: 'a.png', len: 1 },
    { before: 'email-open', card: 'b.png', len: 1 },
  ], cuts, { exists: () => true });
  ok('several inserts come back back-to-front',
    many.placed.map((i) => i.at).join(',') === '2,0', many.placed.map((i) => i.at).join(','));

  ok('a beat this recording does not have is dropped, not guessed',
    resolveInserts([{ before: 'nowhere', card: 'x.png' }], cuts, { exists: () => true })
      .dropped.length === 1);
  ok('…and so is a card that was never rendered',
    resolveInserts([{ before: 'product', card: 'x.png' }], cuts, { exists: () => false })
      .dropped[0].why.includes('x.png'));
  ok('every drop says why', resolveInserts([{ before: 'nope', card: 'x.png' }], cuts)
    .dropped.every((d) => typeof d.why === 'string' && d.why.length > 0));

  ok('compose can render a still anywhere, not only front and back',
    /names\.splice\(ins\.at, 0, nm\)/.test(compose));
  ok('and cards.mjs can draw the statement that goes there',
    /statement\.png/.test(cards) && /shootOpaque/.test(cards));
}

console.log('\n— The clock still agrees with the picture —');
{
  const inserts = [{ at: 2, len: 1.3 }];
  ok('a scene before the insert is untouched', shiftAt(1, inserts, 0.8) === 0.8);
  ok('a scene after it plays later', Math.abs(shiftAt(2, inserts, 0.8) - 2.1) < 1e-9,
    String(shiftAt(2, inserts, 0.8)));
  ok('the hero still counts on its own', shiftAt(0, [], 1.2) === 1.2);
  ok('compose shifts the stopwatch through the same function',
    /shiftAt\(i, INSERTS, HERO\)/.test(compose));
}

console.log('\n— The seller can be filmed, and only with their own session —');
{
  ok('the recorder can film a hand-delivered order', /seller-send/.test(record));
  ok('…but never mints its own admin session',
    /AD_SELLER_TOKEN/.test(record) && !/requestEmailOtp|otp\/verify/.test(record));
  ok('it fulfils THIS order, not whatever is at the top of the queue',
    /filter\(\{ hasText: orderNumber \}\)/.test(record));
  ok('…and checks the shop agrees before believing the click',
    /still awaiting fulfilment/.test(record));
  ok('an expired token says so instead of blaming the queue',
    /seller token was rejected/.test(record));
}

console.log('\n— Nobody else is in the advert —');
{
  ok('the recorder counts what is on screen before marking the beat',
    /queue rows are visible|othersVisible/.test(record));
  ok('…and blurs anything that looks like an address',
    /__ad_blur/.test(record) && /EMAIL/.test(record));
  ok('rows are hidden by default and revealed by exception, not the other way round',
    /\.card\{display:none !important\}/.test(record) && /__ad_show/.test(record));
  ok('the masking is scoped to the fulfilment screen',
    /location\.pathname\.startsWith\('\/admin\/fulfillment'\)/.test(record));

  /* The rule that actually holds: the cut never shows the list. */
  const P = VARIANTS.find((v) => v.id === 'P');
  ok('there is a cut built on the seller footage', !!P);
  ok('…and it does not cut to the queue list at all',
    !P.scenes.some((s) => s.from === 'seller-queue'),
    P.scenes.map((s) => s.from).join(','));
  ok('…starting instead at the modal, which holds one order by construction',
    P.scenes.some((s) => s.from === 'seller-open'));
}

console.log('\n— A cut that claims a person must have filmed one —');
{
  const P = VARIANTS.find((v) => v.id === 'P');
  const tokens = { price: '€5,99', delivery: 'x', orderNumber: 'FM-1', name: '1.000 V-Bucks' };
  const order = { status: 'completed' };
  ok('it is refused when nobody was filmed delivering',
    !!blockedReason(P, { tokens, order, beats: [{ label: 'product' }] }));
  ok('…and the refusal says how to fix it',
    /seller-token/.test(blockedReason(P, { tokens, order, beats: [] })));
  ok('and it renders once the seller beats exist',
    blockedReason(P, { tokens, order,
      beats: [{ label: 'seller-open' }, { label: 'seller-send' }] }) === null);
}

console.log('\n— And the pages are waited for properly —');
{
  /* `networkidle` never fires on this storefront: earlyFetch leaves speculative
     requests open, measured at four still pending ten seconds after the page
     had rendered. It only ever worked because the usual path clicks a card
     instead of navigating. */
  ok('nothing waits for networkidle any more',
    !/waitUntil: 'networkidle'/.test(record));
  ok('…it waits for the document and then for what the shot needs',
    /waitUntil: 'domcontentloaded'/.test(record) && /async function open\(url, ready\)/.test(record));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-framing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
