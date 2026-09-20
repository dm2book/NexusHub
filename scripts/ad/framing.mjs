/**
 * Where a shot points, and what may be spliced between two shots.
 *
 * Both of these were missing from the compositor in the same way: the edit
 * could only ever aim at the middle of the frame, and a still could only ever
 * be the first thing or the last thing. The two together are most of the
 * grammar a 9:16 advert is competing against — the push onto the number that
 * matters, and the held card in the middle that lets a viewer catch up.
 *
 * They live here rather than inline in compose.mjs because they are the only
 * part of that file that is pure arithmetic over beats.json, and arithmetic
 * that decides where the camera points is worth being able to test without
 * rendering a video.
 */

/** The recorder's capture size. Boxes in beats.json are in this space. */
export const CAPTURE = { w: 540, h: 960 };

/**
 * The centre of a measured box, normalised to 0..1 of the frame.
 *
 * record.mjs has written the price's bounding box into beats.json since the
 * first version and nothing ever read it, so every push in the toolkit aimed
 * at the centre of the picture or at a hardcoded top-20% band — including the
 * shot of the price, which is the one shot the advert exists for.
 *
 * Clamped away from the edges: a crop window centred on something at x=0.99
 * is a window mostly off the picture, and ffmpeg answers that by sliding it
 * back without saying so, which looks like the aim silently not working.
 */
export function boxCentre(box, capture = CAPTURE) {
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;
  const clamp = (n) => Math.min(0.95, Math.max(0.05, n));
  return {
    cx: clamp((box.x + box.width / 2) / capture.w),
    cy: clamp((box.y + box.height / 2) / capture.h),
  };
}

/**
 * Resolve declared inserts against the scenes this recording actually produced.
 *
 * An insert names a BEAT, not a scene number, because the scene list is built
 * from whichever beats the recording contains — a run without a database has no
 * email beats at all, and a scene number would then point at a different shot
 * rather than at nothing.
 *
 * Anything that cannot be placed is dropped and reported, never guessed at:
 * that is the same rule the rest of this toolkit follows, where footage that
 * does not exist removes the claim instead of faking it.
 *
 * Returned back-to-front, so splicing an earlier one cannot move the index a
 * later one was measured against.
 */
export function resolveInserts(declared = [], cuts = [], { exists = () => true } = {}) {
  const placed = [];
  const dropped = [];
  for (const ins of declared) {
    if (!ins?.card) { dropped.push({ ...ins, why: 'no card named' }); continue; }
    if (!exists(ins.card)) { dropped.push({ ...ins, why: `no ${ins.card} rendered` }); continue; }
    const at = cuts.findIndex((c) => c.from === ins.before || c.label === ins.before);
    if (at < 0) { dropped.push({ ...ins, why: `no scene starts at '${ins.before}'` }); continue; }
    placed.push({
      card: ins.card,
      at,
      len: Math.max(0.2, Number(ins.len ?? 1.0)),
      zoom: ins.zoom === 'in' ? 'in' : 'punch',
    });
  }
  placed.sort((a, b) => b.at - a.at);
  return { placed, dropped, total: placed.reduce((a, i) => a + i.len, 0) };
}

/**
 * How much later a scene plays once inserts sit in front of it.
 *
 * The stopwatch is overlaid on the finished picture, so it reads output time.
 * An insert before scene 4 pushes scenes 4..n later by its length, and a clock
 * that does not know that is a clock disagreeing with the picture it is drawn
 * on — the one failure the stopwatch exists to prevent.
 */
export function shiftAt(sceneIndex, inserts = [], hero = 0) {
  return hero + inserts.reduce((a, ins) => a + (ins.at <= sceneIndex ? ins.len : 0), 0);
}
