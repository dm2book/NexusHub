/**
 * The stopwatch cut, and the one thing it must never do.
 *
 * The concept is a test on camera — "ik ga kijken hoe snel ForgeMarket dit
 * levert" — with a clock running from the first frame. Which makes the clock
 * the whole advert, and a clock is the easiest thing in a video to fake. Two
 * ways to fake one, and both are cheap:
 *
 *   1. count seconds of VIDEO. The cut is ramped 2–8× through the parts nobody
 *      needs to watch, so a clock counting screen time would say a purchase
 *      took twelve seconds when it took thirty-eight.
 *   2. show a total anyway. If the delivery is not in the footage, any figure
 *      on the badge is a promise wearing the costume of a measurement.
 *
 * So the tests below take a recording, ramp it hard, and check the clock still
 * reads the recording's own seconds — then take the delivery away and check no
 * number survives it.
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
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

const sw = await import(join(ROOT, 'scripts/ad/stopwatch.mjs'));
const { sourceAt, outputAt, formatClock, stopwatchBlockedReason, clockZero,
  stopwatchFrames, CLOCK_COPY, SW_W, SW_H } = sw;
const { planCuts, resolveTiming, timeline } = await import(join(ROOT, 'scripts/ad/timing.mjs'));
const { variantById, tokensFor, fill } = await import(join(ROOT, 'scripts/ad/variants.mjs'));
const compose = read('scripts/ad/compose.mjs');
const cards = read('scripts/ad/cards.mjs');
const L = variantById('L');

/* A recording with room in every beat, so the resolver is free to honour the
   storyboard rather than being pinned by how little footage there is. */
const BEATS = {
  product: 0, buy: 6000, checkout: 14000, 'order-placed': 24000,
  confirmed: 30000, delivery: 38000, 'email-open': 45000, end: 48000,
};
const at = (l) => (l in BEATS ? BEATS[l] : null);
const build = (beats = at, spec = L.stopwatch) => {
  const cuts = planCuts(L.scenes, beats);
  const r = resolveTiming(cuts, { target: L.target, card: L.card, min: Math.min(15, L.target - 1) });
  const rows = timeline(r.cuts, r.card).rows;
  const zero = clockZero(spec, rows);
  return { cuts: r.cuts, rows, card: r.card, total: r.total, zero };
};
const plan = build();

console.log('— The cut is the storyboard that was asked for —');
{
  const want = [
    ['the product', 0, 1.5], ['select', 1.5, 3.5], ['checkout', 3.5, 5.5],
    ['payment', 5.5, 7.0], ['the mailbox', 7.0, 9.5], ['the code', 9.5, 11.0],
  ];
  ok('six scenes and an end card', plan.rows.length === 6, `${plan.rows.length}`);
  for (const [label, a, b] of want) {
    const row = plan.rows.find((r) => r.label === label);
    ok(`${a.toFixed(1)}–${b.toFixed(1)}s  ${label}`,
      !!row && near(row.in, a) && near(row.out, b),
      row ? `${row.in.toFixed(2)}–${row.out.toFixed(2)}` : 'missing');
  }
  ok('the CTA card runs 11.0–12.0s', near(plan.total - plan.card, 11) && near(plan.card, 1));
  ok('twelve seconds in total', near(plan.total, 12), plan.total.toFixed(2));
  /* The weights ARE the brief. If someone rewrites them, the timings above stop
     being the thing that was asked for, and this says so. */
  ok('every scene is asked for by weight, not by accident',
    L.scenes.reduce((n, s) => n + s.weight, 0) === L.target - L.card);
}

console.log('\n— The clock counts the recording, not the video —');
{
  const { frames, freezeAt, total } = stopwatchFrames({
    rows: plan.rows, t0: plan.zero.t0, freezeSrc: at('delivery') / 1000,
    fps: 30, until: 11, lang: 'nl',
  });
  ok('one frame per frame of the body', frames.length === 330, `${frames.length}`);
  ok('it starts at zero', frames[0].secs === 0, String(frames[0].secs));

  /* The whole point. Twelve seconds of video over a purchase that took most of
     a minute — a clock reading video time would be out by a factor of three. */
  ok('thirty-eight real seconds are measured, not eleven', near(total, 37.65, 0.05), String(total));
  ok('…which is more than three times the running time', total / 11 > 3);

  /* Per scene: real time has to advance at exactly the ramp that scene plays
     at, or the clock and the picture are describing different recordings. */
  for (const r of plan.rows) {
    if (r.in >= freezeAt) continue;               // stopped by then, and rightly
    const a = frames.find((f) => f.t >= r.in + 0.10);
    const b = frames.find((f) => f.t >= Math.min(r.out - 0.05, r.in + 0.60));
    if (!a || !b || b.t <= a.t) continue;
    const measured = (b.secs - a.secs) / (b.t - a.t);
    ok(`${r.label}: the clock runs at the scene's own ${r.speed.toFixed(2)}×`,
      near(measured, r.speed, 0.06), measured.toFixed(3));
  }

  ok('it never goes backwards', frames.every((f, i) => i === 0 || f.secs >= frames[i - 1].secs));
  ok('and never negative', frames.every((f) => f.secs >= 0));
}

console.log('\n— It stops when the shop delivered, and stays stopped —');
{
  const { frames, freezeAt, total } = stopwatchFrames({
    rows: plan.rows, t0: plan.zero.t0, freezeSrc: at('delivery') / 1000,
    fps: 30, until: 11, lang: 'nl',
  });
  /* delivery is 8s into a 15s scene playing at 6×, so it lands 1.33s in. */
  const row = plan.rows.find((r) => r.label === 'the mailbox');
  ok('the freeze is where that beat actually appears',
    near(freezeAt, row.in + (38 - row.start) / row.speed, 0.02), String(freezeAt));
  const after = frames.filter((f) => f.t >= freezeAt);
  ok('every frame after it reads the same', new Set(after.map((f) => f.text)).size === 1,
    [...new Set(after.map((f) => f.text))].join('/'));
  ok('and that reading is the measured figure', near(after[0].secs, total, 0.001));
  ok('the badge says so', after.every((f) => f.frozen));
  ok('nothing before it is marked delivered', frames.filter((f) => f.t < freezeAt - 0.04).every((f) => !f.frozen));
  ok('the clock is still on screen at the last frame — the total is the proof',
    frames[frames.length - 1].frozen);
}

console.log('\n— No delivery in the footage, no number on the badge —');
{
  /* The beat exists in the recording but falls in the stretch this cut skips.
     True of the real demo recording: order-placed → confirmed is eighteen
     milliseconds, under the floor, so that scene is dropped entirely. */
  /* Exactly the shape of the real demo recording: the order is marked paid
     eighteen milliseconds after it is placed, so the payment scene is under the
     floor and planCuts drops it — and the delivery falls in the hole. */
  const gap = { ...BEATS, 'order-placed': 24000, confirmed: 24018, delivery: 24010 };
  const p2 = build((l) => (l in gap ? gap[l] : null));
  ok('the payment scene drops out, as it does on a demo purchase',
    p2.rows.length === 5 && !p2.rows.some((r) => r.label === 'payment'));
  const r2 = stopwatchFrames({
    rows: p2.rows, t0: p2.zero.t0, freezeSrc: 24.010, fps: 30, until: 11, lang: 'nl',
  });
  ok('the clock never stops', r2.freezeAt === null);
  ok('and there is no total to show', r2.total === null);
  ok('no frame claims a delivery', r2.frames.every((f) => !f.frozen));
  ok('it just keeps counting', r2.frames[r2.frames.length - 1].secs > r2.frames[0].secs);

  /* And the caption that would have stated it removes itself, because the
     token has no real value — the same gate every other fact in this toolkit
     goes through. */
  const line = L.captions.find((c) => c.text.includes('{measured}'));
  ok('a caption states the measured total', !!line);
  const tokens = tokensFor({ product: { name: 'Steam Wallet €10', price: 1199 }, lang: 'nl' });
  ok('…and it drops itself when nothing was measured',
    fill(line.text, { ...tokens, measured: null }) === null);
  ok('…and appears when something was', !!fill(line.text, { ...tokens, measured: '13,4 seconden' }));
  ok('it is the only line that makes a speed claim',
    L.captions.filter((c) => /\{measured\}|seconde|second|snel/i.test(c.text)).length === 1);
}

console.log('\n— A recording with no delivery at all is refused outright —');
{
  ok('no delivery beat, no advert',
    /nothing was delivered/.test(stopwatchBlockedReason(L.stopwatch, (l) => (l === 'delivery' ? null : 0)) || ''));
  ok('no beat to start on either',
    /start the clock on/.test(stopwatchBlockedReason(L.stopwatch, () => null) || ''));
  ok('a complete recording is not refused', stopwatchBlockedReason(L.stopwatch, at) === null);
  ok('and a variant with no stopwatch is none of its business',
    stopwatchBlockedReason(null, () => null) === null);
  ok('the variant also refuses a purchase that never completed',
    L.needs.includes('order') && L.needs.includes('delivery'));
}

console.log('\n— Zero on the clock is the first frame, not the beat —');
{
  /* The opening scene settles past the first 350ms of its beat, because a beat
     fires when a navigation resolves rather than when the page has painted.
     Timing from the beat would open the advert on "0,4". */
  ok('the settle is why this matters', L.scenes[0].settle > 0);
  ok('zero is where the picture starts', near(plan.zero.t0, L.scenes[0].settle, 0.001),
    String(plan.zero.t0));
  ok('…which is later than the beat', plan.zero.t0 > at('product') / 1000);
  ok('so the first frame reads 0,0',
    stopwatchFrames({ rows: plan.rows, t0: plan.zero.t0, freezeSrc: 38, fps: 30, until: 11 })
      .frames[0].text === '0,0');
  ok('a variant that starts somewhere else is an authoring error, and says so',
    /times from/.test(clockZero({ from: 'checkout', freeze: 'delivery' }, plan.rows).error || ''));
}

console.log('\n— Mapping between the cut and the recording —');
{
  const rows = plan.rows;
  for (const r of rows) {
    const mid = r.in + r.played / 2;
    ok(`${r.label}: output → source → output is the same instant`,
      near(outputAt(rows, sourceAt(rows, mid)), mid, 0.001));
  }
  /* Contiguous here by construction, so the skipped moment comes from the cut
     that drops its payment scene — see above. */
  const dropped = build((l) => {
    const g = { ...BEATS, 'order-placed': 24000, confirmed: 24018, delivery: 24010 };
    return l in g ? g[l] : null;
  });
  ok('a moment the cut skipped has no place in it', outputAt(dropped.rows, 24.010) === null);
  ok('…while the moments either side of it do',
    outputAt(dropped.rows, 23.9) !== null && outputAt(dropped.rows, 24.1) !== null);
  ok('and the end card is not footage of anything', sourceAt(rows, plan.total - 0.1) === null);
}

console.log('\n— The badge —');
{
  ok('0,0 in Dutch', formatClock(0, 'nl') === '0,0');
  ok('7.4 in English', formatClock(7.4, 'en') === '7.4');
  ok('one decimal, always', formatClock(12, 'nl') === '12,0');
  ok('past the minute it reads as a clock', formatClock(72.4, 'nl') === '1:12,4');
  ok('…with a padded second', formatClock(65.0, 'nl') === '1:05,0');
  ok('negative is impossible, not displayed', formatClock(-3, 'nl') === '0,0');
  ok('every language the shop speaks has a badge',
    ['nl', 'en', 'de', 'fr'].every((l) => CLOCK_COPY[l]?.span && CLOCK_COPY[l]?.done));
  /* The span is printed on the badge because it is LONGER than the part the
     shop controls — it can only understate how fast delivery is. */
  ok('the label names the span it measures', /→/.test(CLOCK_COPY.nl.span));

  const { frames } = stopwatchFrames({
    rows: plan.rows, t0: plan.zero.t0, freezeSrc: 38, fps: 30, until: 11, lang: 'nl',
  });
  ok('it scales in over the first third of a second',
    frames[0].intro < 0.2 && frames.find((f) => f.t >= 0.30).intro === 1);
  ok('and snaps once, on the frame it stops',
    frames.find((f) => f.frozen).pop > 0.9 && frames[frames.length - 1].pop === 0);
}

console.log('\n— Wired into the editor —');
{
  ok('compose refuses the variant before rendering a frame',
    /stopwatchBlockedReason\(variant\.stopwatch, at\)/.test(compose));
  ok('the rows come from timeline(), not a second copy of the accumulation',
    /timeline\(cuts, CARD\)\.rows/.test(compose));
  ok('the measured total is only ever the freeze',
    /tokens\.measured = sw\.total === null \? null/.test(compose));
  ok('the clock is a PNG sequence, because the number changes every frame',
    /-framerate.*-start_number.*%05d\.png/s.test(compose));
  ok('and it lets the end card through instead of freezing on top of it',
    /eof_action=pass/.test(compose));
  ok('overlays are a chain, so a second one does not rewrite the first',
    /post\.forEach/.test(compose) && /\[body\$\{i\}\]/.test(compose));

  /* The first cut printed "forgemarket.nl" across the clock's own label. */
  const tagTop = Number(/padding:(\d+)px 0 0 46px/.exec(cards)?.[1]);
  const swY = Number(/const SW_Y = (\d+)/.exec(compose)?.[1]);
  ok('the badge clears the corner tag', swY > tagTop + 67, `tag ${tagTop}, clock ${swY}`);
  ok('…and the platforms’ own furniture at the bottom', swY + SW_H < 1920 - 420);
  ok('it is centred', /Math\.round\(\(W - SW_W\) \/ 2\)/.test(compose));
  ok('and no wider than the frame', SW_W < 1080);
}

console.log('\n— The storyboard describes the cut that will actually be rendered —');
{
  const story = read('scripts/ad/storyboard.mjs');
  /* It hardcoded target 20 / card 2.6 / floor 15, so the storyboard for a
     variant asking for twelve seconds described a fifteen-second edit nothing
     would ever render. Same three arguments as compose, or it is fiction. */
  ok('it reads the target off the variant', /String\(v\.target \|\| 20\)/.test(story));
  ok('…and the card length too', /card: v\.card \?\? 2\.6/.test(story));
  ok('…and the same floor', /min: Math\.min\(15, TARGET - HERO - 1\)/.test(story));
  ok('compose passes exactly those', /min: Math\.min\(15, TARGET - HERO - 1\)/.test(compose));
  /* A hero still is paid for out of the footage, so the storyboard has to make
     the same subtraction or it describes an edit nothing will render. */
  ok('…including the hero it does not have', /target: TARGET - HERO/.test(story)
    && /target: TARGET - HERO/.test(compose) && (L.hero ?? 0) === 0);
  ok('the clock is described, since it is neither a caption nor a card',
    /stopwatch: starts on the first frame/.test(story));
}

console.log('\n— Nothing that already worked was disturbed —');
{
  const K = variantById('K');
  ok('the performance cut has no stopwatch', !K.stopwatch);
  ok('…and still resolves to its own timings', K.target === 10 && K.scenes.length === 7);
  ok('L is its own variant, not a rewrite of K', L.id === 'L' && L.slug === 'stopwatch');
  ok('the price badge is off — the clock owns the top of the frame', L.priceCard === false);
  ok('every other variant is untouched by the overlay chain',
    /const post = \[\];/.test(compose) && /if \(ctaChain\) post\.push/.test(compose));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ad-stopwatch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
