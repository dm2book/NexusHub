/**
 * How long each scene is on screen, in one place.
 *
 * compose.mjs owned this maths and storyboard.mjs needs the same answer. Two
 * copies of a rule is how this codebase has repeatedly shipped a rule that
 * disagreed with itself — carriesOwnBackground in two files, the Roblox
 * delivery sentence in two files, the raster-icon list in three. So the resolver
 * lives here and both call it.
 *
 * The model, unchanged:
 *
 *   · Every scene is a span between two beats the RECORDER actually marked. A
 *     recording that skipped a step has fewer scenes, not frozen frames.
 *   · The budget is DISTRIBUTED by weight rather than capped and scaled down.
 *     Capping produced a seven-second advert with the product shot missing: it
 *     had been on screen 236ms, under the floor, so the one frame the whole
 *     thing exists to show was the frame that got dropped.
 *   · Real time is the floor. A scene gets its share, but never more seconds
 *     than it has frames for. Distributing the whole budget by weight turned a
 *     seventeen-second recording into a "fast-paced" advert entirely in slow
 *     motion.
 *   · Still over? Take it back from the fastest-ramping scenes first — the ones
 *     already carrying the least information per second.
 */

export const FPS = 30;

/** Scenes whose beats exist, with their source length. */
export function planCuts(plan, at) {
  const cuts = [];
  for (const s of plan) {
    let a = at(s.from); let b = at(s.to);
    /* A run without DATABASE_URL has no email beats, and the scene that bridges
       to them would vanish with them — so the last scene falls back to `end`. */
    if (s.from === 'delivered-detail' && b === null) b = at('end');
    if (a === null || b === null || b <= a) continue;
    const rawLen = (b - a) / 1000;
    if (rawLen < 0.12) continue;                     // nothing happened here
    cuts.push({ ...s, start: a / 1000, srcLen: rawLen });
  }
  return cuts;
}

/**
 * Give every cut its `played` length and the `speed` ramp that reaches it.
 * Mutates and returns the array, plus the end card length it settled on.
 */
export function resolveTiming(cuts, { target = 20, card = 2.6, min = 15 } = {}) {
  let CARD = card;
  const room = Math.max(min - CARD, target - CARD);
  const totalWeight = cuts.reduce((n, c) => n + (c.weight || 1), 0) || 1;

  for (const c of cuts) {
    const share = room * ((c.weight || 1) / totalWeight);
    const fastest = c.srcLen / (c.speed || 1);       // the ramp this scene wants
    c.played = Math.min(Math.max(fastest, share), c.srcLen);
    c.speed = c.srcLen / c.played;
  }

  let used = cuts.reduce((n, c) => n + c.played, 0);
  if (used > room) {
    const k = room / used;
    for (const c of cuts) {
      c.played = Math.max(c.srcLen / 6, c.played * k);
      c.speed = c.srcLen / c.played;
    }
    used = cuts.reduce((n, c) => n + c.played, 0);
  }

  /* A variant with little footage — a showcase has no checkout to film — would
     come in under the fifteen seconds the brief asks for. The end card takes up
     the slack rather than the footage being stretched: brand time is honest
     time, and half a second of slow motion on a screen recording is not. */
  const footage = cuts.reduce((n, c) => n + c.played, 0);
  if (footage + CARD < min) CARD = Math.min(4.5, min - footage);

  return { cuts, card: CARD, total: footage + CARD };
}

/** Where each cut starts in the finished edit, and where the flash frames land. */
export function timeline(cuts, card) {
  let t = 0;
  const rows = cuts.map((c) => {
    const row = { ...c, in: t, out: t + c.played };
    t += c.played;
    return row;
  });
  return {
    rows,
    // A cut is a single white frame pair; the whoosh lands on the same frame.
    flashes: rows.slice(0, -1).map((r) => +r.out.toFixed(3)),
    card: { in: t, out: t + card },
    total: t + card,
  };
}
